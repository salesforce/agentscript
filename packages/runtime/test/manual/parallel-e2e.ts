#!/usr/bin/env npx tsx
/*
 * Manual integration test for parallel tool calls + parallel delegation.
 *
 * Run:  npx tsx test/manual/parallel-e2e.ts
 *
 * What it does:
 *   1. Starts a real HTTP tool server on a random port
 *   2. Starts an MCP tool server (JSON-RPC over HTTP) on another random port
 *   3. Wires the runtime with both adapters (http:// and mcp://)
 *   4. Runs parallel tool dispatch (3 tools in parallel) against real servers
 *   5. Runs parallel delegation (2 children calling real tools concurrently)
 *   6. Prints timing results — parallel should be faster than sequential
 *
 * Only the LLM output is scripted. Tools execute against real HTTP/MCP servers.
 */

import * as http from 'node:http';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import {
  Runtime,
  ToolRegistry,
  HttpAdapter,
  type ToolAdapter,
  type RuntimeEvent,
} from '../../src/index.js';
import { ScriptedLlm } from '../helpers.js';

// ─── Colors ──────────────────────────────────────────────────────────────────

const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';
const YELLOW = '\x1b[33m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';

function log(prefix: string, msg: string) {
  console.log(
    `${DIM}[${new Date().toISOString().slice(11, 23)}]${RESET} ${prefix} ${msg}`
  );
}

// ─── HTTP Tool Server ────────────────────────────────────────────────────────

function createHttpToolServer(): Promise<{ url: string; server: http.Server }> {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      void (async () => {
        const url = new URL(req.url!, `http://localhost`);
        const path = url.pathname;
        let body = '';
        for await (const chunk of req) body += chunk;
        const args = body ? JSON.parse(body) : {};

        log(
          `${CYAN}[HTTP]${RESET}`,
          `${req.method} ${path} args=${JSON.stringify(args)}`
        );

        // Simulate work with a delay
        const delay = args.delay ?? 80;
        await new Promise(r => setTimeout(r, delay));

        let result: Record<string, unknown>;
        switch (path) {
          case '/weather':
            result = {
              location: args.location ?? 'unknown',
              temperature: Math.round(15 + Math.random() * 20),
              unit: 'celsius',
              conditions: ['sunny', 'cloudy', 'rainy'][
                Math.floor(Math.random() * 3)
              ],
            };
            break;
          case '/translate':
            result = {
              original: args.text ?? '',
              translated: `[${args.target_lang ?? 'fr'}] ${args.text}`,
              source_lang: 'en',
            };
            break;
          case '/search':
            result = {
              query: args.query ?? '',
              results: [
                {
                  title: `Result 1 for "${args.query}"`,
                  url: 'https://example.com/1',
                },
                {
                  title: `Result 2 for "${args.query}"`,
                  url: 'https://example.com/2',
                },
              ],
              total: 42,
            };
            break;
          case '/summarize':
            result = {
              summary: `Summary of "${(args.text ?? '').slice(0, 30)}..." in ${args.max_words ?? 50} words.`,
              word_count: args.max_words ?? 50,
            };
            break;
          default:
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'not found' }));
            return;
        }

        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
      })();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

// ─── MCP Tool Server (JSON-RPC over HTTP) ────────────────────────────────────

interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

function createMcpServer(): Promise<{ url: string; server: http.Server }> {
  const tools: McpTool[] = [
    {
      name: 'calculate',
      description: 'Perform arithmetic calculations',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string', description: 'Math expression' },
        },
        required: ['expression'],
      },
    },
    {
      name: 'lookup_database',
      description: 'Look up a record from the database',
      inputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          id: { type: 'string' },
        },
        required: ['table', 'id'],
      },
    },
    {
      name: 'send_notification',
      description: 'Send a notification to a user',
      inputSchema: {
        type: 'object',
        properties: {
          user: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['user', 'message'],
      },
    },
  ];

  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      void (async () => {
        let body = '';
        for await (const chunk of req) body += chunk;
        const rpc = JSON.parse(body) as {
          jsonrpc: string;
          id: number | string;
          method: string;
          params?: Record<string, unknown>;
        };

        log(
          `${YELLOW}[MCP]${RESET}`,
          `method=${rpc.method} params=${JSON.stringify(rpc.params ?? {})}`
        );

        let result: unknown;

        switch (rpc.method) {
          case 'initialize':
            result = {
              protocolVersion: '2024-11-05',
              capabilities: { tools: {} },
              serverInfo: { name: 'test-mcp-server', version: '1.0.0' },
            };
            break;

          case 'tools/list':
            result = { tools };
            break;

          case 'tools/call': {
            const { name, arguments: args } = rpc.params as {
              name: string;
              arguments: Record<string, unknown>;
            };

            // Simulate work
            await new Promise(r => setTimeout(r, 80));

            let content: string;
            switch (name) {
              case 'calculate': {
                const expr = (args.expression as string) ?? '0';
                // Safe eval for simple math
                const num = Function(
                  `"use strict"; return (${expr.replace(/[^0-9+\-*/().]/g, '')})`
                )();
                content = JSON.stringify({ result: num, expression: expr });
                break;
              }
              case 'lookup_database':
                content = JSON.stringify({
                  table: args.table,
                  id: args.id,
                  record: {
                    name: `Record ${args.id}`,
                    status: 'active',
                    created: '2026-01-15',
                  },
                });
                break;
              case 'send_notification':
                content = JSON.stringify({
                  sent: true,
                  user: args.user,
                  timestamp: new Date().toISOString(),
                });
                break;
              default:
                content = JSON.stringify({ error: `Unknown tool: ${name}` });
            }

            result = {
              content: [{ type: 'text', text: content }],
            };
            break;
          }

          default:
            result = { error: { code: -32601, message: 'Method not found' } };
        }

        const response = { jsonrpc: '2.0', id: rpc.id, result };
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
      })();
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${addr.port}`, server });
    });
  });
}

// ─── MCP Adapter (mcp:// scheme) ────────────────────────────────────────────

class McpHttpAdapter implements ToolAdapter {
  private nextId = 1;
  private initialized = false;

  constructor(private readonly serverUrl: string) {}

  private async rpc(
    method: string,
    params?: Record<string, unknown>
  ): Promise<unknown> {
    const res = await fetch(this.serverUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params,
      }),
    });
    const json = (await res.json()) as { result: unknown };
    return json.result;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agentscript-runtime', version: '0.1.0' },
    });
    this.initialized = true;
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = (await this.rpc('tools/list')) as { tools: McpTool[] };
    return result.tools;
  }

  async invoke({
    target,
    args,
  }: {
    target: string;
    args: Record<string, unknown>;
    signal?: AbortSignal;
  }): Promise<Record<string, unknown>> {
    await this.initialize();
    const toolName = target.slice('mcp://'.length);
    const result = (await this.rpc('tools/call', {
      name: toolName,
      arguments: args,
    })) as { content: Array<{ type: string; text: string }> };

    const textContent = result.content?.find(c => c.type === 'text');
    if (textContent) {
      try {
        return JSON.parse(textContent.text) as Record<string, unknown>;
      } catch {
        return { text: textContent.text };
      }
    }
    return {};
  }
}

// ─── Test IR Documents ───────────────────────────────────────────────────────

function makeParallelToolDoc(httpUrl: string): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'parallel-tools-test',
      initial_node: 'main',
      state_variables: [],
      nodes: [
        {
          developer_name: 'main',
          type: 'subagent',
          instructions: 'You have access to weather, search, and MCP tools.',
          tools: [
            {
              name: 'get_weather',
              target: `${httpUrl}/weather`,
              description: 'Get weather',
            },
            {
              name: 'web_search',
              target: `${httpUrl}/search`,
              description: 'Search the web',
            },
            {
              name: 'translate',
              target: `${httpUrl}/translate`,
              description: 'Translate text',
            },
            {
              name: 'calculate',
              target: 'mcp://calculate',
              description: 'Calculate math',
            },
            {
              name: 'lookup_db',
              target: 'mcp://lookup_database',
              description: 'Look up a DB record',
            },
            {
              name: 'notify',
              target: 'mcp://send_notification',
              description: 'Send notification',
            },
          ],
          action_definitions: [],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
      ],
    },
  } as unknown as AgentDSLAuthoring;
}

function makeParallelDelegationDoc(httpUrl: string): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'parallel-delegation-test',
      initial_node: 'orchestrator',
      state_variables: [
        { developer_name: 'weather_result', data_type: 'string' },
        { developer_name: 'search_result', data_type: 'string' },
      ],
      nodes: [
        {
          developer_name: 'orchestrator',
          type: 'subagent',
          instructions: 'Orchestrator that delegates to worker agents.',
          tools: [],
          action_definitions: [],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
        {
          developer_name: 'weather_worker',
          type: 'subagent',
          instructions: 'Get weather data for the user.',
          tools: [
            {
              name: 'get_weather',
              target: `${httpUrl}/weather`,
              description: 'Get weather',
            },
            {
              name: 'calculate',
              target: 'mcp://calculate',
              description: 'Calculate',
            },
          ],
          action_definitions: [],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
        {
          developer_name: 'research_worker',
          type: 'subagent',
          instructions: 'Search and summarize information.',
          tools: [
            {
              name: 'web_search',
              target: `${httpUrl}/search`,
              description: 'Search',
            },
            {
              name: 'lookup_db',
              target: 'mcp://lookup_database',
              description: 'Look up DB',
            },
            {
              name: 'notify',
              target: 'mcp://send_notification',
              description: 'Notify',
            },
          ],
          action_definitions: [],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
      ],
    },
  } as unknown as AgentDSLAuthoring;
}

// ─── Test Runner ─────────────────────────────────────────────────────────────

async function runParallelToolCallsTest(
  httpUrl: string,
  mcpAdapter: McpHttpAdapter
) {
  console.log(
    `\n${BOLD}═══ TEST 1: Parallel Tool Calls (6 tools in parallel) ═══${RESET}\n`
  );

  const tools = new ToolRegistry();
  tools.register('http', new HttpAdapter());
  tools.register('https', new HttpAdapter());
  tools.register('mcp', mcpAdapter);

  // LLM returns 6 tool calls at once
  const llm = new ScriptedLlm([
    {
      toolCalls: [
        {
          id: 'c1',
          name: 'get_weather',
          arguments: { location: 'Paris', delay: 100 },
        },
        {
          id: 'c2',
          name: 'web_search',
          arguments: { query: 'AgentScript language', delay: 100 },
        },
        {
          id: 'c3',
          name: 'translate',
          arguments: { text: 'Hello world', target_lang: 'es', delay: 100 },
        },
        {
          id: 'c4',
          name: 'calculate',
          arguments: { expression: '42 * 3 + 7' },
        },
        {
          id: 'c5',
          name: 'lookup_db',
          arguments: { table: 'users', id: 'U-001' },
        },
        {
          id: 'c6',
          name: 'notify',
          arguments: { user: 'admin', message: 'Test passed!' },
        },
      ],
    },
    { text: 'All tools returned successfully.' },
  ]);

  const doc = makeParallelToolDoc(httpUrl);
  const events: RuntimeEvent[] = [];

  // ── Run PARALLEL ──
  const parallelRuntime = new Runtime({
    doc,
    llm: new ScriptedLlm([...llm['script']]),
    tools,
    parallel: { strategy: 'always' },
  });
  parallelRuntime.on(e => events.push(e));

  const startParallel = Date.now();
  const parallelResult = await parallelRuntime.turn('Run all tools');
  const parallelTime = Date.now() - startParallel;

  log(
    `${GREEN}[PARALLEL]${RESET}`,
    `Completed in ${BOLD}${parallelTime}ms${RESET}`
  );
  log(
    `${GREEN}[PARALLEL]${RESET}`,
    `Result: "${parallelResult.assistantText}"`
  );

  const toolResults = events.filter(e => e.kind === 'tool-result');
  for (const e of toolResults) {
    if (e.kind === 'tool-result') {
      log(
        `${GREEN}[PARALLEL]${RESET}`,
        `  Tool ${e.name} → ${JSON.stringify(e.result).slice(0, 80)}...`
      );
    }
  }

  // ── Run SEQUENTIAL for comparison ──
  const seqEvents: RuntimeEvent[] = [];
  const seqRuntime = new Runtime({
    doc,
    llm: new ScriptedLlm([...llm['script']]),
    tools,
    parallel: { strategy: 'never' },
  });
  seqRuntime.on(e => seqEvents.push(e));

  const startSeq = Date.now();
  await seqRuntime.turn('Run all tools');
  const seqTime = Date.now() - startSeq;

  log(`${DIM}[SEQUENTIAL]${RESET}`, `Completed in ${BOLD}${seqTime}ms${RESET}`);

  const speedup = (seqTime / parallelTime).toFixed(1);
  console.log(
    `\n  ${BOLD}Speedup: ${speedup}x faster with parallel dispatch${RESET}`
  );
  console.log(
    `  ${DIM}(Parallel: ${parallelTime}ms vs Sequential: ${seqTime}ms)${RESET}`
  );
}

async function runParallelDelegationTest(
  httpUrl: string,
  mcpAdapter: McpHttpAdapter
) {
  console.log(
    `\n${BOLD}═══ TEST 2: Parallel Delegation (2 child agents in parallel) ═══${RESET}\n`
  );

  const tools = new ToolRegistry();
  tools.register('http', new HttpAdapter());
  tools.register('https', new HttpAdapter());
  tools.register('mcp', mcpAdapter);

  // Script: weather_worker calls weather + calculate; research_worker calls search + lookup + notify
  const llm = new ScriptedLlm([
    // weather_worker: 2 tool calls then done
    {
      toolCalls: [
        {
          id: 'w1',
          name: 'get_weather',
          arguments: { location: 'Tokyo', delay: 100 },
        },
      ],
    },
    {
      toolCalls: [
        { id: 'w2', name: 'calculate', arguments: { expression: '273 + 15' } },
      ],
    },
    { text: 'Weather in Tokyo: 15°C (288K).' },
    // research_worker: 3 tool calls then done
    {
      toolCalls: [
        {
          id: 'r1',
          name: 'web_search',
          arguments: { query: 'parallel computing', delay: 100 },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'r2',
          name: 'lookup_db',
          arguments: { table: 'articles', id: 'A-123' },
        },
      ],
    },
    {
      toolCalls: [
        {
          id: 'r3',
          name: 'notify',
          arguments: { user: 'researcher', message: 'Found results' },
        },
      ],
    },
    { text: 'Research complete: found 42 results on parallel computing.' },
  ]);

  const doc = makeParallelDelegationDoc(httpUrl);
  const events: RuntimeEvent[] = [];

  const runtime = new Runtime({
    doc,
    llm,
    tools,
    delegation: {
      maxSteps: 10,
      parallel: { stateMerge: 'last-wins' },
    },
  });
  runtime.on(e => events.push(e));

  const start = Date.now();
  const results = await runtime.delegateMultiple([
    { nodeName: 'weather_worker', context: 'Get weather for Tokyo' },
    { nodeName: 'research_worker', context: 'Research parallel computing' },
  ]);
  const elapsed = Date.now() - start;

  log(
    `${GREEN}[DELEGATION]${RESET}`,
    `Completed in ${BOLD}${elapsed}ms${RESET}`
  );

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    log(
      `${GREEN}[DELEGATION]${RESET}`,
      `  Child ${i}: "${r.assistantText}" (${r.steps} steps, node: ${r.finalNode})`
    );
    if (Object.keys(r.stateChanges).length > 0) {
      log(
        `${GREEN}[DELEGATION]${RESET}`,
        `    State changes: ${JSON.stringify(r.stateChanges)}`
      );
    }
  }

  const delegationStarts = events.filter(e => e.kind === 'delegation-start');
  const delegationEnds = events.filter(e => e.kind === 'delegation-end');
  console.log(
    `\n  ${DIM}Events: ${delegationStarts.length} delegation-start, ${delegationEnds.length} delegation-end${RESET}`
  );
  console.log(
    `  ${BOLD}Both children executed against real HTTP + MCP servers concurrently.${RESET}`
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${BOLD}${CYAN}`);
  console.log(
    `  ╔═══════════════════════════════════════════════════════════╗`
  );
  console.log(`  ║  AgentScript Runtime — Parallel Execution E2E Test       ║`);
  console.log(`  ║  Real HTTP tools + Real MCP server (LLM output mocked)  ║`);
  console.log(
    `  ╚═══════════════════════════════════════════════════════════╝${RESET}`
  );
  console.log();

  // Start servers
  log(`${DIM}[SETUP]${RESET}`, 'Starting HTTP tool server...');
  const { url: httpUrl, server: httpServer } = await createHttpToolServer();
  log(`${DIM}[SETUP]${RESET}`, `HTTP tool server ready at ${httpUrl}`);

  log(`${DIM}[SETUP]${RESET}`, 'Starting MCP tool server...');
  const { url: mcpUrl, server: mcpServer } = await createMcpServer();
  log(`${DIM}[SETUP]${RESET}`, `MCP tool server ready at ${mcpUrl}`);

  // Create MCP adapter and initialize
  const mcpAdapter = new McpHttpAdapter(mcpUrl);
  const mcpTools = await mcpAdapter.listTools();
  log(
    `${DIM}[SETUP]${RESET}`,
    `MCP tools available: ${mcpTools.map(t => t.name).join(', ')}`
  );
  console.log();

  try {
    await runParallelToolCallsTest(httpUrl, mcpAdapter);
    await runParallelDelegationTest(httpUrl, mcpAdapter);

    console.log(`\n${GREEN}${BOLD}  ✓ All manual tests passed!${RESET}\n`);
  } catch (err) {
    console.error(`\n\x1b[31m${BOLD}  ✗ Test failed:${RESET}`, err);
    process.exitCode = 1;
  } finally {
    httpServer.close();
    mcpServer.close();
  }
}

void main();
