/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpAdapter } from '@agentscript/runtime';
import { mcpToolsForVercel } from '../src/mcp-tools.js';

interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

/**
 * Minimal in-process MCP server for tests. Mirrors the shape used in
 * `packages/runtime/test/mcp-adapter.test.ts` so the round-trip exercises
 * the same wire format the official SDK speaks.
 */
function startMockMcp(
  tools: Record<string, (args: Record<string, unknown>) => unknown>
): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise(resolve => {
    const server: Server = createServer((req, res) => {
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
            serverInfo: { name: 'mock', version: '0.0.0' },
          });
          return;
        }
        if (parsed.method === 'tools/list') {
          reply({
            tools: Object.keys(tools).map(name => ({
              name,
              description: `mock ${name}`,
              inputSchema: {
                type: 'object' as const,
                properties: { name: { type: 'string' } },
              },
            })),
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
      });
    });
  });
}

/** Minimal `tool()`/`jsonSchema()` shims modeling the Vercel AI SDK surface. */
interface CapturedTool {
  description: string;
  inputSchema: unknown;
  execute: (
    args: Record<string, unknown>,
    opts?: { signal?: AbortSignal }
  ) => Promise<Record<string, unknown>>;
}
function makeFactory() {
  const builtTools: CapturedTool[] = [];
  const jsonSchemaCalls: Array<Record<string, unknown>> = [];
  const factory = {
    tool: (config: CapturedTool) => {
      builtTools.push(config);
      return { __captured: true, ...config };
    },
    jsonSchema: (schema: Record<string, unknown>) => {
      jsonSchemaCalls.push(schema);
      return { __wrapped: true, schema };
    },
  };
  return { factory, builtTools, jsonSchemaCalls };
}

describe('mcpToolsForVercel', () => {
  let mock: Awaited<ReturnType<typeof startMockMcp>>;
  let adapter: McpAdapter;

  beforeEach(async () => {
    mock = await startMockMcp({
      greet: args => ({ greeting: `hello ${args.name ?? 'world'}` }),
      add: args => ({ sum: Number(args.a ?? 0) + Number(args.b ?? 0) }),
    });
    adapter = new McpAdapter({ demo: { url: mock.url } });
  });

  afterEach(async () => {
    await adapter.close();
    await mock.stop();
  });

  it('builds one ToolSet entry per server/tool, keyed `<server>__<tool>`', async () => {
    const { factory, builtTools, jsonSchemaCalls } = makeFactory();

    const tools = await mcpToolsForVercel(adapter, factory);

    expect(Object.keys(tools).sort()).toEqual(['demo__add', 'demo__greet']);
    expect(builtTools).toHaveLength(2);
    // jsonSchema injector is invoked once per tool with the raw MCP schema.
    expect(jsonSchemaCalls).toHaveLength(2);
    expect(jsonSchemaCalls[0]).toMatchObject({ type: 'object' });
  });

  it('execute() round-trips through the same McpAdapter', async () => {
    const { factory, builtTools } = makeFactory();
    await mcpToolsForVercel(adapter, factory);

    const greet = builtTools.find(t => t.description.includes('greet'));
    expect(greet).toBeDefined();

    const result = await greet!.execute({ name: 'agentscript' });
    expect(result).toEqual({ greeting: 'hello agentscript' });
  });

  it('falls back to the raw MCP schema when jsonSchema is omitted', async () => {
    const { factory, builtTools } = makeFactory();
    const factoryNoJsonSchema = { tool: factory.tool };

    await mcpToolsForVercel(adapter, factoryNoJsonSchema);

    const first = builtTools[0];
    // Without jsonSchema(), the raw MCP schema flows through verbatim.
    expect(first.inputSchema).toMatchObject({ type: 'object' });
  });

  it('execute() propagates server errors to the LLM driver', async () => {
    // The Vercel SDK relies on `execute()` rejecting so it can surface tool
    // errors back to the model. Bypass the registry by invoking a tool the
    // mock doesn't expose — the mock returns a JSON-RPC error response.
    const { factory } = makeFactory();
    await mcpToolsForVercel(adapter, factory);

    await expect(
      adapter.invoke({ target: 'mcp://demo/missing_tool', args: {} })
    ).rejects.toThrow(/missing_tool|unknown/i);
  });

  it('execute() forwards an aborted signal to the underlying adapter', async () => {
    const { factory, builtTools } = makeFactory();
    await mcpToolsForVercel(adapter, factory);

    const greet = builtTools.find(t => t.description.includes('greet'));
    expect(greet).toBeDefined();

    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      greet!.execute({ name: 'agentscript' }, { signal: ctrl.signal })
    ).rejects.toThrow();
  });

  it('returns an empty ToolSet when no servers are registered', async () => {
    const empty = new McpAdapter({});
    const { factory, builtTools } = makeFactory();
    const tools = await mcpToolsForVercel(empty, factory);
    expect(tools).toEqual({});
    expect(builtTools).toHaveLength(0);
    await empty.close();
  });

  it('produces unchanged `<server>__<tool>` keys for alphanumeric names', async () => {
    // Happy path: ASCII-safe server + tool names round-trip verbatim, no
    // sanitization or hash suffix is appended.
    const { factory } = makeFactory();
    const tools = await mcpToolsForVercel(adapter, factory);
    expect(Object.keys(tools).sort()).toEqual(['demo__add', 'demo__greet']);
  });
});

/**
 * The remaining cases drive `mcpToolsForVercel` against a hand-rolled fake
 * adapter so we can fabricate MCP names that the real SDK transport would
 * reject (e.g. tool names containing `/`). The fake satisfies the surface
 * `mcpToolsForVercel` actually consumes.
 */
interface InvokeCall {
  target: string;
  args: Record<string, unknown>;
}
interface FakeToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}
function fakeAdapter(
  layout: Record<string, FakeToolDef[]>,
  invokeCalls: InvokeCall[]
): import('@agentscript/runtime').McpAdapter {
  return {
    servers: () => Object.keys(layout),
    listTools: async (server: string) => layout[server] ?? [],
    invoke: async (req: { target: string; args: Record<string, unknown> }) => {
      invokeCalls.push({ target: req.target, args: req.args });
      return { ok: true };
    },
    // Methods the function under test does not call — left undefined behind
    // a cast so we don't have to mirror the full McpAdapter surface.
  } as unknown as import('@agentscript/runtime').McpAdapter;
}

describe('mcpToolsForVercel — name safety', () => {
  it('encodes `/` (and other unsafe chars) in the wire target and sanitizes the key', async () => {
    const invokeCalls: InvokeCall[] = [];
    const adapter = fakeAdapter(
      { demo: [{ name: 'send/dm', description: 'send a DM' }] },
      invokeCalls
    );
    const { factory, builtTools } = makeFactory();

    const tools = await mcpToolsForVercel(adapter, factory);

    // Key: sanitized `send_dm` plus a 6-char hash suffix derived from
    // `demo::send/dm`. The hash algorithm is deliberately not part of the
    // contract — only the shape (`<server>__<tool>__<6-hex>`) and the
    // ASCII-safe charset are.
    const keys = Object.keys(tools);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^demo__send_dm__[a-f0-9]{6}$/);
    expect(keys[0]).toMatch(/^[A-Za-z0-9_-]+$/);

    // execute() routes through a percent-encoded target so the runtime parser
    // can decode the original tool name (slashes round-trip via `%2F`).
    await builtTools[0]!.execute({ to: 'alice' });
    expect(invokeCalls).toHaveLength(1);
    expect(invokeCalls[0]!.target).toBe('mcp://demo/send%2Fdm');
    expect(decodeURIComponent('send%2Fdm')).toBe('send/dm');
  });

  it('throws on a real key collision listing both offending pairs', async () => {
    // Both pairs sanitize-and-concat to `a__b__c`, so construction must
    // surface the collision rather than silently shadow one tool.
    const invokeCalls: InvokeCall[] = [];
    const adapter = fakeAdapter(
      {
        a__b: [{ name: 'c' }],
        a: [{ name: 'b__c' }],
      },
      invokeCalls
    );
    const { factory } = makeFactory();

    await expect(mcpToolsForVercel(adapter, factory)).rejects.toThrow(
      /collision.*a__b.*c|collision.*a.*b__c/i
    );
  });

  it('avoids collisions between distinct sanitization inputs via the hash suffix', async () => {
    // `send/dm` and `send_dm` would collide under naive sanitization, but the
    // hash suffix is derived from the original name, so the keys diverge.
    const invokeCalls: InvokeCall[] = [];
    const adapter = fakeAdapter(
      {
        slack: [{ name: 'send/dm' }, { name: 'send_dm' }],
      },
      invokeCalls
    );
    const { factory } = makeFactory();

    const tools = await mcpToolsForVercel(adapter, factory);
    const keys = Object.keys(tools);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    // `send_dm` is fully ASCII-safe → no hash suffix.
    expect(keys).toContain('slack__send_dm');
    // `send/dm` → sanitized + 6-hex hash suffix (algorithm-agnostic match).
    expect(keys.some(k => /^slack__send_dm__[a-f0-9]{6}$/.test(k))).toBe(true);
  });
});
