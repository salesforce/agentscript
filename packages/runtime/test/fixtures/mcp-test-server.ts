/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Test-only MCP server fixture.
 *
 * Spins up a real `@modelcontextprotocol/sdk` `McpServer` behind
 * `WebStandardStreamableHTTPServerTransport` (the same combo used by
 * `packages/server/src/embedded-mcp.ts`), so adapter tests exercise the
 * actual JSON-RPC + Streamable HTTP wire format. Only the per-tool handler
 * responses are scriptable per-test.
 *
 * Stateless mode (`enableJsonResponse: true`, no session id generator) is
 * used to keep each HTTP request self-contained, matching how the embedded
 * demo runs and how `McpAdapter` is exercised in production.
 */

import type { AddressInfo, Socket } from 'node:net';
import { Hono } from 'hono';
import { serve, type ServerType } from '@hono/node-server';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
  type ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import type { ZodRawShape } from 'zod';

export interface ScriptableTool {
  name: string;
  description?: string;
  inputSchema?: ZodRawShape;
  outputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
  /** Per-call handler. Returns whatever the SDK accepts as a CallToolResult body. */
  handler: (
    args: Record<string, unknown>
  ) => Promise<CallToolResult> | CallToolResult;
}

export interface StartMcpTestServerOptions {
  tools: ScriptableTool[];
  /** Optional: simulate paginated tools/list for tests that need it. */
  paginate?: { pageSize: number };
  /**
   * Optional: assert per-call HTTP headers. Throw to reject the request — the
   * client will see a 400 (and `Client.connect` / `callTool` will reject).
   */
  expectHeaders?: (headers: Record<string, string | undefined>) => void;
  /** Optional name/version. Defaults are fine. */
  serverInfo?: { name: string; version: string };
}

export interface McpTestServerHandle {
  /** Full URL to POST JSON-RPC payloads, e.g. `http://127.0.0.1:NNNN/mcp`. */
  url: string;
  /** Stop the server and release the port. Idempotent. */
  close: () => Promise<void>;
  /** Destroy all open sockets to simulate a server restart. */
  resetSockets: () => void;
  /** Counters exposed for assertions. */
  stats: {
    readonly initializeCalls: number;
    readonly toolCallsByName: Record<string, number>;
  };
}

const DEFAULT_SERVER_INFO = {
  name: 'mcp-test-fixture',
  version: '0.0.0',
} as const;

/**
 * Boot a real MCP server on an ephemeral port. Resolves once the port is
 * bound and a `url` can be reported.
 */
export async function startMcpTestServer(
  opts: StartMcpTestServerOptions
): Promise<McpTestServerHandle> {
  const stats = {
    initializeCalls: 0,
    toolCallsByName: {} as Record<string, number>,
  };

  const sockets = new Set<Socket>();

  const app = new Hono();

  app.all('/mcp', async c => {
    // Header assertions run BEFORE we hand off to the transport so a failed
    // assertion bubbles up as a 400 — which the SDK client surfaces as a
    // connect/call rejection in the test.
    if (opts.expectHeaders) {
      const headers: Record<string, string | undefined> = {};
      c.req.raw.headers.forEach((v, k) => {
        headers[k] = v;
      });
      try {
        opts.expectHeaders(headers);
      } catch (err) {
        return c.text((err as Error).message, 400);
      }
    }

    // Sniff the JSON-RPC method name from the body to update counters
    // without breaking the SDK's body parsing — clone the request so the
    // transport still sees the original stream.
    const cloned = c.req.raw.clone();
    try {
      const text = await cloned.text();
      if (text) {
        const parsed = JSON.parse(text) as
          | { method?: string; params?: { name?: string } }
          | Array<{ method?: string; params?: { name?: string } }>;
        const messages = Array.isArray(parsed) ? parsed : [parsed];
        for (const m of messages) {
          if (m?.method === 'initialize') stats.initializeCalls++;
          if (m?.method === 'tools/call') {
            const name = m.params?.name;
            if (typeof name === 'string') {
              stats.toolCallsByName[name] =
                (stats.toolCallsByName[name] ?? 0) + 1;
            }
          }
        }
      }
    } catch {
      // Non-JSON or stream error — let the transport produce the canonical
      // error response. Counters just won't increment for this request.
    }

    const server = buildServer(opts);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  const httpServer: ServerType = serve({ fetch: app.fetch, port: 0 });

  httpServer.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise<void>(resolve => {
    const tryRead = (): void => {
      const addr = httpServer.address() as AddressInfo | null;
      if (addr && typeof addr === 'object') {
        resolve();
        return;
      }
      setImmediate(tryRead);
    };
    tryRead();
  });

  const addr = httpServer.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}/mcp`;

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const s of sockets) s.destroy();
        sockets.clear();
        httpServer.close(err => (err ? reject(err) : resolve()));
      }),
    resetSockets: () => {
      for (const s of sockets) s.destroy();
      sockets.clear();
    },
    stats,
  };
}

/**
 * Build a fresh `McpServer` per request (stateless). When `paginate` is set
 * we register a custom `tools/list` handler on the underlying `Server` and
 * register tools with `registerTool` only for `tools/call` dispatch.
 *
 * NOTE: When pagination is active, calling `registerTool` would also wire up
 * a default `tools/list` handler — to override that we install our handler
 * via `server.server.setRequestHandler` AFTER tool registration, which the
 * SDK respects (last-write-wins on the underlying `Server`).
 */
function buildServer(opts: StartMcpTestServerOptions): McpServer {
  const info = opts.serverInfo ?? DEFAULT_SERVER_INFO;
  const server = new McpServer(info);

  for (const tool of opts.tools) {
    const config: {
      title?: string;
      description?: string;
      inputSchema?: ZodRawShape;
      outputSchema?: ZodRawShape;
      annotations?: ToolAnnotations;
    } = {};
    if (tool.description !== undefined) config.description = tool.description;
    if (tool.inputSchema !== undefined) config.inputSchema = tool.inputSchema;
    if (tool.outputSchema !== undefined)
      config.outputSchema = tool.outputSchema;
    if (tool.annotations !== undefined) config.annotations = tool.annotations;

    server.registerTool(
      tool.name,
      config,
      // Cast: the SDK's `ToolCallback` is generic over the input schema; for
      // a fixture we just hand args through as a record.
      (async (args: Record<string, unknown>) => {
        const result = await tool.handler(args ?? {});
        return result;
      }) as Parameters<typeof server.registerTool>[2]
    );
  }

  if (opts.paginate) {
    const pageSize = opts.paginate.pageSize;
    // Project ScriptableTool definitions to MCP `Tool` wire shapes for the
    // listing. Schemas advertised here are nominal — `tools/call` still
    // dispatches via the registered handlers above, which carry the real
    // (Zod) validation.
    const listed: Tool[] = opts.tools.map(t => ({
      name: t.name,
      description: t.description,
      inputSchema: { type: 'object' as const, properties: {} },
      ...(t.annotations ? { annotations: t.annotations } : {}),
    }));
    server.server.setRequestHandler(ListToolsRequestSchema, async req => {
      const cursor = req.params?.cursor;
      const start = cursor ? parseInt(cursor, 10) : 0;
      if (Number.isNaN(start) || start < 0) {
        return { tools: [] };
      }
      const end = Math.min(start + pageSize, listed.length);
      const slice = listed.slice(start, end);
      const nextCursor = end < listed.length ? String(end) : undefined;
      return nextCursor ? { tools: slice, nextCursor } : { tools: slice };
    });
    // Re-install the `tools/call` handler too — `setRequestHandler` on
    // ListTools above doesn't disturb CallTool, but we want to be explicit
    // that even with a custom listing, calls still route through the
    // registered tools. The McpServer's default CallTool handler (installed
    // by `registerTool`) is preserved; nothing extra needed here.
    void CallToolRequestSchema; // referenced for clarity
  }

  return server;
}
