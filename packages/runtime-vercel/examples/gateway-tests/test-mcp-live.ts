/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: end-to-end MCP integration with a live LLM.
 *
 * Validates the full path:
 *   .agent script  →  compileSource (server.mcp resolved)
 *               →  createMcpAdapter()  (env-refs resolved, headers folded in)
 *                       →  ToolRegistry.register('mcp', adapter)
 *                       →  Runtime.turn() drives the LLM
 *                       →  LLM picks the action whose target is `mcp://repo/<tool>`
 *                       →  ToolRegistry routes to McpAdapter.invoke()
 *                       →  StreamableHTTPClientTransport hits the in-process mock
 *                       →  result is parsed and merged back into agent state
 *
 * Also exercises `mcpToolsForVercel()` separately: that the same adapter
 * exposes its tool list as Vercel `ToolSet` entries, ready to hand to
 * `generateText` for use cases where the LLM picks MCP tools directly
 * (rather than via a declared action).
 *
 * Architecture under test:
 *
 *   in-process node:http MCP server (port :random)
 *       ├── tool: search_repos     →  { repos: ['agentscript', 'salesforce'] }
 *       └── tool: get_repo_info    →  { name, stars, language }
 *
 *   .agent script declares:
 *     server.mcp.repo = { transport: 'streamable-http', url: env(MCP_URL),
 *                         auth: { strategy: 'bearer', key: env(MCP_TOKEN) } }
 *     start_agent.actions.Find_Repo.target = "mcp://repo/search_repos"
 *     start_agent.actions.Get_Info.target  = "mcp://repo/get_repo_info"
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-mcp-live.ts
 */

import { createServer, type Server } from 'node:http';
import { generateText, jsonSchema } from 'ai';
import {
  McpAdapter,
  ToolRegistry,
  resolveServerBlockValue,
  type AgentDSLAuthoringWithServerBlock,
  type EnvSource,
  type McpServerConfig,
  type McpServerSettings,
} from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  assertions,
  report,
} from './harness.js';
import { mcpToolsForVercel, compileSource } from '@agentscript/runtime-vercel';

// ---------------------------------------------------------------------------
// 0. Adapter helper — resolves a parsed McpServerConfig into runtime settings.
//    Mirrors `createMcpAdapter()` in `@sf-agentscript/server`; inlined here so
//    this example doesn't depend on the server package.
// ---------------------------------------------------------------------------

function resolveServerSettings(
  server: McpServerConfig,
  name: string,
  env: EnvSource
): McpServerSettings {
  const url = resolveServerBlockValue(
    server.url,
    env,
    `server.mcp.${name}.url`
  );
  if (!url) throw new Error(`server.mcp.${name}.url is required.`);
  const headers: Record<string, string> = {};
  if (server.headers) {
    for (const [k, v] of Object.entries(server.headers)) {
      const r = resolveServerBlockValue(
        v,
        env,
        `server.mcp.${name}.headers.${k}`
      );
      if (r !== undefined) headers[k] = r;
    }
  }
  if (server.auth && server.auth.strategy !== 'none') {
    const key = resolveServerBlockValue(
      server.auth.key,
      env,
      `server.mcp.${name}.auth.key`
    );
    if (key) headers.authorization = `Bearer ${key}`;
  }
  return Object.keys(headers).length > 0 ? { url, headers } : { url };
}

// ---------------------------------------------------------------------------
// 1. In-process MCP server (mock, but speaks the real wire format)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface MockServerHandle {
  url: string;
  stop: () => Promise<void>;
  /** Records every Bearer token the server saw — for auth assertion. */
  authHeaders: string[];
  /** Records every tools/call invocation. */
  toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

function startMockMcp(
  tools: Record<string, (args: Record<string, unknown>) => unknown>
): Promise<MockServerHandle> {
  return new Promise(resolve => {
    const authHeaders: string[] = [];
    const toolCalls: Array<{ name: string; args: Record<string, unknown> }> =
      [];

    const server: Server = createServer((req, res) => {
      const auth = req.headers.authorization;
      if (typeof auth === 'string') authHeaders.push(auth);

      let body = '';
      req.on('data', chunk => {
        body += String(chunk);
      });
      req.on('end', () => {
        let parsed: JsonRpcRequest;
        try {
          parsed = JSON.parse(body) as JsonRpcRequest;
        } catch {
          res.statusCode = 400;
          res.end('invalid json');
          return;
        }
        if (parsed.id === undefined) {
          res.statusCode = 202;
          res.end();
          return;
        }
        const reply = (result: Record<string, unknown>) => {
          res.statusCode = 200;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result }));
        };
        if (parsed.method === 'initialize') {
          reply({
            protocolVersion: '2024-11-05',
            capabilities: {},
            serverInfo: { name: 'mock-repo', version: '0.0.0' },
          });
          return;
        }
        if (parsed.method === 'tools/list') {
          reply({
            tools: [
              {
                name: 'search_repos',
                description: 'Search GitHub-style repositories by query',
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: { type: 'string', description: 'Search query' },
                  },
                  required: ['query'],
                },
              },
              {
                name: 'get_repo_info',
                description: 'Get information about a single repository',
                inputSchema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Repository name' },
                  },
                  required: ['name'],
                },
              },
            ],
          });
          return;
        }
        if (parsed.method === 'tools/call') {
          const params = (parsed.params ?? {}) as {
            name?: string;
            arguments?: Record<string, unknown>;
          };
          const handler = params.name ? tools[params.name] : undefined;
          if (!handler) {
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(
              JSON.stringify({
                jsonrpc: '2.0',
                id: parsed.id,
                error: { code: -32601, message: `unknown ${params.name}` },
              })
            );
            return;
          }
          toolCalls.push({
            name: params.name!,
            args: params.arguments ?? {},
          });
          const out = handler(params.arguments ?? {});
          const text = typeof out === 'string' ? out : JSON.stringify(out);
          reply({ content: [{ type: 'text', text }] });
          return;
        }
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: parsed.id,
            error: { code: -32601, message: 'unknown method' },
          })
        );
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        throw new Error('failed to start mock MCP server');
      }
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        stop: () =>
          new Promise<void>((res, rej) =>
            server.close(err => (err ? rej(err) : res()))
          ),
        get authHeaders() {
          return authHeaders;
        },
        get toolCalls() {
          return toolCalls;
        },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 2. Inline agent source — uses server.mcp + mcp:// action targets
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are a repository assistant. When the user asks to search for repositories, immediately call the search action with the query they provided."

config:
    agent_name: "McpRepoTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

server:
    mcp:
        repo:
            transport: "streamable-http"
            url: "env(MCP_URL)"
            auth:
                strategy: "bearer"
                key: "env(MCP_TOKEN)"

variables:
    last_query: mutable string = ""
        description: "Last query the user asked about"

start_agent repo_bot:
    description: "Searches and inspects repositories via MCP"

    actions:
        Find_Repo:
            description: "Search for repositories matching a query"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                repos: string
                    description: "JSON array of matching repository names"
            target: "mcp://repo/search_repos"

    reasoning:
        instructions: ->
            |   The user wants to search repositories. Call {!@actions.search}
                with the user's query verbatim. Report the results back.
        actions:
            search: @actions.Find_Repo
                with query=...
                set @variables.last_query = ...
`;

// ---------------------------------------------------------------------------
// 3. Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-mcp-live ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // 1. Spin up the mock MCP server
  const mock = await startMockMcp({
    search_repos: args => ({
      query: args.query ?? '',
      repos: ['agentscript', 'salesforce-cli', 'lwc-dev'],
    }),
    get_repo_info: args => ({
      name: args.name ?? 'unknown',
      stars: 1234,
      language: 'TypeScript',
    }),
  });
  console.log(`Mock MCP: ${mock.url}\n`);

  // 2. Compile the .agent source through the full Agentforce pipeline
  const compiled = compileSource(AGENT_SOURCE);
  const errors = compiled.diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (errors.length > 0) {
    console.error('Compile errors:');
    for (const e of errors) console.error(`  - [${e.code}] ${e.message}`);
    process.exit(1);
  }
  const serverBlock = (compiled.output as AgentDSLAuthoringWithServerBlock)
    .server;
  const mcpServers = serverBlock?.mcp;
  assertions.truthy(mcpServers, 'compiled server.mcp is present');
  assertions.truthy(
    mcpServers && mcpServers.repo,
    'server.mcp.repo survives the parser/dialect-schema gate'
  );

  // 3. Build the McpAdapter directly. Env-refs in url + auth.key are
  //    resolved here against an explicit env so we don't depend on the
  //    user's shell env for anything except the LLM gateway. (This mirrors
  //    `createMcpAdapter()` in @sf-agentscript/server — inlined so this
  //    example doesn't depend on the server package.)
  const env: EnvSource = {
    MCP_URL: mock.url,
    MCP_TOKEN: 'live-test-token-1234',
  };
  const adapter = new McpAdapter(
    Object.fromEntries(
      Object.entries(mcpServers!).map(([name, server]) => [
        name,
        resolveServerSettings(server, name, env),
      ])
    )
  );
  assertions.eq(
    adapter.servers().length,
    1,
    'McpAdapter exposes one server (repo)'
  );

  try {
    // 4. Sanity-check that the adapter can list tools (initializes the
    //    transport, sends notifications/initialized, fetches tools/list).
    const tools = await adapter.listTools('repo');
    assertions.eq(
      tools.length,
      2,
      'adapter.listTools(repo) returns 2 tool defs'
    );
    assertions.truthy(
      tools.find(t => t.name === 'search_repos'),
      'tools include search_repos'
    );
    assertions.truthy(
      tools.find(t => t.name === 'get_repo_info'),
      'tools include get_repo_info'
    );

    // 5. Sanity-check `mcpToolsForVercel()` — same adapter, but flipped
    //    around to surface the MCP tools as Vercel AI SDK ToolSet entries.
    //    We don't hand them to `generateText` here (the agent uses the
    //    action-target path); we just verify the conversion + an end-to-end
    //    round-trip via the captured `execute()`.
    const vercelTools = await mcpToolsForVercel(adapter, {
      tool: cfg => cfg,
      jsonSchema: schema => schema,
    });
    assertions.eq(
      Object.keys(vercelTools).sort().join(','),
      'repo__get_repo_info,repo__search_repos',
      'mcpToolsForVercel keys tools as <server>__<tool>'
    );
    const searchTool = vercelTools['repo__search_repos'] as {
      execute: (
        args: Record<string, unknown>
      ) => Promise<Record<string, unknown>>;
    };
    const directResult = await searchTool.execute({ query: 'agentscript' });
    assertions.eq(
      Array.isArray((directResult as { repos?: unknown }).repos),
      true,
      'mcpToolsForVercel execute() round-trips through the adapter'
    );
    // Make sure that tool exec, also passed Bearer through.
    assertions.truthy(
      mock.authHeaders.some(h => h === 'Bearer live-test-token-1234'),
      'auth.bearer was applied as `Authorization: Bearer <key>` on every request'
    );

    // 6. Build the agent runtime with the MCP adapter wired into the
    //    ToolRegistry under the `mcp` scheme (alongside no other adapters
    //    — this script's actions only use mcp:// targets).
    const registry = new ToolRegistry();
    registry.register('mcp', adapter);

    const runtime = createTestAgent({
      source: AGENT_SOURCE,
      tools: registry,
      maxStepsPerTurn: 8,
      llmDriver,
    });

    // 7. Drive a real turn with the gateway.
    console.log('> user: Search for agentscript repositories\n');
    const capture = await runTurn(
      runtime,
      'Search for agentscript repositories'
    );

    console.log(`  Duration: ${capture.durationMs}ms`);
    console.log(`  Final node: ${capture.result.finalNode}`);

    let toolResultText = '';
    for (const e of capture.events) {
      if (e.kind === 'tool-call') {
        console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
      } else if (e.kind === 'tool-result') {
        console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
        toolResultText = JSON.stringify(e.result);
      } else if (
        e.kind === 'state-change' &&
        !e.name.startsWith('AgentScriptInternal_')
      ) {
        console.log(
          `  [state]      ${e.name}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`
        );
      } else if (e.kind === 'tool-error') {
        console.log(`  [tool-err]   ${e.name}: ${e.error}`);
      }
    }
    console.log('');

    // 8. Assertions — structural, deterministic. The LLM's word choice is
    //    irrelevant; what we care about is that the action target wired
    //    through MCP and the mock observed the call.
    const toolCallEvents = capture.events.filter(e => e.kind === 'tool-call');
    const mcpCalled = toolCallEvents.some(
      e => e.kind === 'tool-call' && e.name === 'mcp://repo/search_repos'
    );
    assertions.ok(
      mcpCalled,
      'agent invoked mcp://repo/search_repos via the registered MCP adapter',
      `tool-call events: ${
        toolCallEvents
          .map(e => (e.kind === 'tool-call' ? e.name : ''))
          .join(', ') || '(none)'
      }`
    );

    const searchCalls = mock.toolCalls.filter(c => c.name === 'search_repos');
    assertions.gte(
      searchCalls.length,
      1,
      'mock MCP server received at least one search_repos invocation'
    );

    // The LLM should have passed *some* query string. We don't pin the
    // exact text — that's a model-decision — but it must be a non-empty
    // string the model derived from the user prompt.
    const argsLooksReasonable = searchCalls.some(c => {
      const q = c.args.query;
      return typeof q === 'string' && q.length > 0;
    });
    assertions.ok(
      argsLooksReasonable,
      'search_repos was called with a non-empty `query` string from the LLM',
      `invocations: ${JSON.stringify(searchCalls.map(c => c.args))}`
    );

    // Bearer token was applied to every HTTP request — including the ones
    // initiated by the agent turn (not just the listTools sanity check).
    const bearerCount = mock.authHeaders.filter(
      h => h === 'Bearer live-test-token-1234'
    ).length;
    assertions.gte(
      bearerCount,
      2,
      'auth.bearer applied to listTools + at least one tools/call request'
    );

    // No errors leaked through.
    const errorEvents = capture.events.filter(
      e => e.kind === 'tool-error' || e.kind === 'abort'
    );
    assertions.eq(errorEvents.length, 0, 'no tool-error or abort events');

    // The mock returned a JSON object with `repos`; the runtime should have
    // surfaced that intact in the tool-result event.
    assertions.ok(
      toolResultText.includes('agentscript'),
      'tool-result carried the mock payload back to the runtime',
      `result: ${toolResultText.slice(0, 200)}`
    );
  } finally {
    await adapter.close().catch(() => {});
    await mock.stop().catch(() => {});
  }

  // Silence the lint about unused `generateText` / `jsonSchema` imports if
  // tree-shaking ever matters — they're here so a follow-up test can hand
  // `mcpToolsForVercel` directly to `generateText({ tools })`.
  void generateText;
  void jsonSchema;
  void McpAdapter;

  report('test-mcp-live');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
