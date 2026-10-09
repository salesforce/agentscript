/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';

import type { ToolAdapter, ToolAdapterInvocation } from './registry.js';
import {
  MCP_DEFAULT_TIMEOUT_MS,
  type McpServerSettings,
  type McpToolDef,
} from './mcp-types.js';

const CLIENT_INFO = { name: 'agentscript', version: '0.1.0' } as const;

/** Safety belt: refuse to follow more than this many `nextCursor` pages. */
const MAX_LIST_TOOLS_PAGES = 50;

/** Timeout for the liveness probe sent after an ambiguous tool-call failure. */
const MCP_LIVENESS_PROBE_TIMEOUT_MS = 5_000;

/**
 * Multi-server MCP adapter — wraps the official `@modelcontextprotocol/sdk`
 * `Client` for each registered server. Registered against the `mcp://` scheme,
 * so a target `mcp://<server>/<tool>` routes to the matching connection.
 *
 * The adapter takes already-resolved settings (URL, headers, optional
 * transport/factory). Env-var resolution happens in the server package
 * before construction.
 *
 * Extending transports is a one-line change in {@link createTransport}.
 */
export class McpAdapter implements ToolAdapter {
  private readonly connections = new Map<string, McpConnection>();

  constructor(servers: Record<string, McpServerSettings>) {
    for (const [name, settings] of Object.entries(servers)) {
      this.connections.set(name, new McpConnection(name, settings));
    }
  }

  async invoke({
    target,
    args,
    signal,
  }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
    const parsed = parseMcpTarget(target);
    const connection = this.connections.get(parsed.server);
    if (!connection) {
      throw new Error(
        `No MCP server registered as "${parsed.server}" (target "${target}")`
      );
    }
    return connection.callTool(parsed.tool, args, signal);
  }

  /** List tools exposed by a specific MCP server. */
  async listTools(server: string, signal?: AbortSignal): Promise<McpToolDef[]> {
    const connection = this.connections.get(server);
    if (!connection) {
      throw new Error(`No MCP server registered as "${server}"`);
    }
    return connection.listTools(signal);
  }

  /** Names of all registered MCP servers. */
  servers(): string[] {
    return [...this.connections.keys()];
  }

  /** Close every underlying transport. Idempotent. */
  async close(): Promise<void> {
    await Promise.all(
      [...this.connections.values()].map(c => c.close().catch(() => {}))
    );
  }
}

/**
 * Parse an `mcp://<server>/<tool>` target.
 *
 * Note: server names cannot contain `/` (we split on the first `/`). Tool
 * names may be percent-encoded; `%2F` is allowed (it decodes to `/`) and the
 * `..` traversal check is performed AFTER percent-decoding, so encoded
 * traversal attempts (`%2e%2e/`) are also rejected.
 */
export function parseMcpTarget(target: string): {
  server: string;
  tool: string;
} {
  if (!target.startsWith('mcp://')) {
    throw new Error(`Invalid MCP target: ${target}`);
  }
  const rest = target.slice('mcp://'.length);
  // Split on first '/' — server names cannot contain '/'.
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) {
    throw new Error(
      `Invalid MCP target "${target}". Expected "mcp://<server>/<tool>".`
    );
  }
  const server = rest.slice(0, slash);
  const rawTool = rest.slice(slash + 1);
  let tool: string;
  try {
    tool = decodeURIComponent(rawTool);
  } catch {
    throw new Error(`Invalid MCP tool name (malformed escape): ${rawTool}`);
  }
  if (tool.includes('..')) {
    throw new Error(`Invalid MCP tool name: ${tool}`);
  }
  return { server, tool };
}

/**
 * Strategy seam: returns a `Transport` for the given resolved server
 * settings. Branches on `settings.transport` to support HTTP, SSE, and stdio.
 */
function createTransport(settings: McpServerSettings): Transport {
  if (settings.transport === 'stdio') {
    return new StdioClientTransport({
      command: settings.command,
      args: settings.args,
      env: settings.env ? mergeStdioEnv(settings.env) : undefined,
      cwd: settings.cwd,
      stderr: 'pipe',
    });
  }

  if (settings.transport === 'sse') {
    return new SSEClientTransport(new URL(settings.url), {
      requestInit: settings.headers ? { headers: settings.headers } : undefined,
    });
  }

  // Default: http or streamable-http
  return new StreamableHTTPClientTransport(new URL(settings.url), {
    requestInit: {
      headers: settings.headers,
    },
  });
}

/**
 * Merge user-provided env with parent process env for stdio transports.
 * Follows the pattern from the reference agent: parent env as base, overlay config env.
 */
function mergeStdioEnv(
  configEnv?: Record<string, string>,
  parentEnv: Readonly<Record<string, string | undefined>> = process.env
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value !== undefined) merged[key] = value;
  }
  if (configEnv !== undefined) Object.assign(merged, configEnv);
  return merged;
}

/**
 * Error classifiers for retry logic — adapted from the reference agent's client-shared.ts.
 */

function isMcpConnectionClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as Error & { readonly code?: unknown }).code ===
      ErrorCode.ConnectionClosed
  );
}

function isMcpTransportFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (isMcpConnectionClosedError(error)) return true;
  return !(error instanceof McpError);
}

/**
 * True when the error is a client-side validation failure of an otherwise
 * well-formed JSON-RPC response: the SDK rejects with a `ZodError` when the
 * result of `tools/call` does not match `CallToolResultSchema`. The server did
 * answer, so reconnecting is pointless.
 */
function isMcpMalformedResultError(error: unknown): boolean {
  return error instanceof Error && error.name === 'ZodError';
}

/**
 * Probes whether the client's transport is still usable by sending a ping.
 * A server that answers in any way — including `MethodNotFound`, a JSON-RPC
 * error, or an unparseable result — counts as alive; only errors that prove
 * the bytes never made a round trip count as dead. Never rejects; returns
 * false on dead verdict.
 */
async function probeMcpLiveness(
  client: Client,
  signal: AbortSignal
): Promise<boolean> {
  try {
    await client.ping({ signal, timeout: MCP_LIVENESS_PROBE_TIMEOUT_MS });
    return true;
  } catch (error) {
    if (isMcpConnectionClosedError(error)) return false;
    if (isMcpMalformedResultError(error)) return true;
    if (error instanceof McpError) {
      return (
        (error as Error & { readonly code?: unknown }).code !==
        ErrorCode.RequestTimeout
      );
    }
    return false;
  }
}

class McpConnection {
  private connectPromise: Promise<Client> | null = null;
  private readonly startupTimeoutMs: number;
  private readonly timeoutMs: number;
  private readonly enabledTools?: Set<string>;
  private readonly disabledTools?: Set<string>;

  constructor(
    private readonly serverName: string,
    private readonly settings: McpServerSettings
  ) {
    this.startupTimeoutMs = settings.startupTimeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    this.timeoutMs = settings.timeoutMs ?? MCP_DEFAULT_TIMEOUT_MS;
    this.enabledTools = settings.enabledTools
      ? new Set(settings.enabledTools)
      : undefined;
    this.disabledTools = settings.disabledTools
      ? new Set(settings.disabledTools)
      : undefined;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    // Try the call once, applying the 3-way recovery logic if it fails.
    let client = await this.connect();
    let result: Awaited<ReturnType<Client['callTool']>>;

    try {
      result = await client.callTool(
        { name: toolName, arguments: args },
        undefined,
        {
          signal: composeSignal(signal, this.timeoutMs),
        }
      );
    } catch (err) {
      // (a) Server answered with JSON-RPC/malformed error → rethrow immediately
      if (err instanceof McpError || isMcpMalformedResultError(err)) {
        throw err;
      }

      // (b) Ambiguous transport error → probe liveness, retry once if alive
      if (isMcpTransportFailure(err)) {
        const probeSignal = composeSignal(
          signal,
          MCP_LIVENESS_PROBE_TIMEOUT_MS
        );
        const alive = await probeMcpLiveness(client, probeSignal);
        if (alive) {
          // Server is still responsive; retry the call once without reconnecting
          try {
            result = await client.callTool(
              { name: toolName, arguments: args },
              undefined,
              {
                signal: composeSignal(signal, this.timeoutMs),
              }
            );
          } catch (_retryErr) {
            // Retry failed; invalidate and throw original error
            this.invalidate();
            throw err;
          }
        } else {
          // (c) Provably dead → reconnect once, retry on fresh client
          this.invalidate();
          try {
            client = await this.connect();
            result = await client.callTool(
              { name: toolName, arguments: args },
              undefined,
              {
                signal: composeSignal(signal, this.timeoutMs),
              }
            );
          } catch (_reconnectErr) {
            // Reconnect or retry failed; throw original error
            throw err;
          }
        }
      } else {
        // Unknown error type; invalidate and rethrow
        this.invalidate();
        throw err;
      }
    }

    if (result!.isError) {
      const text = joinTextParts(result!.content);
      throw new Error(
        `MCP server "${this.serverName}" tool "${toolName}" reported an error: ${text || 'unknown error'}`
      );
    }

    // Priority 1: typed structured content (MCP 2025-03 spec).
    if (
      result!.structuredContent &&
      typeof result!.structuredContent === 'object'
    ) {
      return result!.structuredContent as Record<string, unknown>;
    }

    const content = Array.isArray(result!.content) ? result!.content : [];
    const textParts = content.filter(
      (p): p is { type: 'text'; text: string } =>
        !!p &&
        typeof p === 'object' &&
        (p as { type?: unknown }).type === 'text' &&
        typeof (p as { text?: unknown }).text === 'string'
    );

    // Priority 2: exactly one text part that parses as JSON.
    if (textParts.length === 1) {
      try {
        const parsed = JSON.parse(textParts[0].text);
        if (parsed !== null && typeof parsed === 'object') {
          return parsed as Record<string, unknown>;
        }
        // Primitive JSON (string/number/bool/null) — fall through to text path.
      } catch {
        // Not JSON — fall through.
      }
    }

    // Priority 3: any text parts → joined `text` plus original content.
    if (textParts.length > 0) {
      const joined = textParts.map(p => p.text).join('\n');
      return { text: joined, content: result!.content };
    }

    // Priority 4: no text parts (images, resource_links, embedded resources).
    return { content: result!.content };
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDef[]> {
    const client = await this.connect();
    const tools: McpToolDef[] = [];
    let cursor: string | undefined;
    let pages = 0;

    do {
      let page: Awaited<ReturnType<Client['listTools']>>;
      try {
        page = await client.listTools(
          cursor === undefined ? undefined : { cursor },
          { signal: composeSignal(signal, this.startupTimeoutMs) }
        );
      } catch (err) {
        this.invalidate();
        throw err;
      }
      for (const t of page.tools) {
        // Apply tool filtering: skip if not in enabledTools (when set) or in disabledTools
        if (this.enabledTools && !this.enabledTools.has(t.name)) {
          continue;
        }
        if (this.disabledTools && this.disabledTools.has(t.name)) {
          continue;
        }
        tools.push({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema as Record<string, unknown> | undefined,
        });
      }
      cursor = page.nextCursor;
      pages++;
      if (pages > MAX_LIST_TOOLS_PAGES) {
        throw new Error(
          `MCP server "${this.serverName}" listTools exceeded ${MAX_LIST_TOOLS_PAGES} pages`
        );
      }
    } while (cursor !== undefined);

    return tools;
  }

  async close(): Promise<void> {
    if (!this.connectPromise) return;
    const client = await this.connectPromise.catch(() => null);
    this.connectPromise = null;
    if (client) await client.close();
  }

  /**
   * Tear down a (presumed-broken) cached client and clear the connect
   * promise so the next call reconnects. Safe to call concurrently.
   */
  private invalidate(): void {
    const pending = this.connectPromise;
    this.connectPromise = null;
    if (pending) {
      void pending.then(
        client => client.close().catch(() => {}),
        () => {}
      );
    }
  }

  private connect(): Promise<Client> {
    if (this.connectPromise === null) {
      this.connectPromise = (async () => {
        const transport = createTransport(this.settings);
        const client = new Client(CLIENT_INFO);
        try {
          await client.connect(transport, {
            timeout: this.startupTimeoutMs,
          });
        } catch (err) {
          this.connectPromise = null;
          throw new Error(
            `Failed to connect to MCP server "${this.serverName}": ${(err as Error).message}`
          );
        }
        return client;
      })();
    }
    return this.connectPromise;
  }
}

/**
 * Compose an optional user signal with a per-call timeout signal so EITHER
 * one can cancel the request. Node 20+ provides `AbortSignal.any` natively.
 */
function composeSignal(
  userSignal: AbortSignal | undefined,
  timeoutMs: number
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!userSignal) return timeout;
  return AbortSignal.any([userSignal, timeout]);
}

/**
 * Concatenate every `type === 'text'` content part with newlines. Returns
 * `undefined` when there are none. Used by the error-message extractor.
 */
function joinTextParts(content: unknown): string | undefined {
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (
      part &&
      typeof part === 'object' &&
      (part as { type?: unknown }).type === 'text' &&
      typeof (part as { text?: unknown }).text === 'string'
    ) {
      parts.push((part as { text: string }).text);
    }
  }
  return parts.length === 0 ? undefined : parts.join('\n');
}
