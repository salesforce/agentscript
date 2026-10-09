/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { McpAdapter } from '@agentscript/runtime';

/**
 * Convert every tool exposed by the registered MCP servers into a Vercel AI
 * SDK `ToolSet`. Each tool's `execute()` routes back through the same
 * {@link McpAdapter}, so credentials and the underlying MCP transport are
 * reused — no separate connection is opened per tool.
 *
 * ## Keying scheme
 *
 * The map key is `${server}__${tool}` whenever both segments only contain
 * `[A-Za-z0-9_-]` (the conservative subset some Vercel AI SDK providers
 * enforce, capped at 64 chars). Otherwise each segment is sanitized by
 * replacing every disallowed character with `_`, and a 6-char hash suffix
 * (FNV-1a 32-bit, see {@link shortHash}) derived from the original
 * `server::tool` string is appended so distinct MCP names are very unlikely
 * to collide after sanitization (and genuine collisions throw). Example:
 *
 *   server `slack-bot`, tool `send/dm` → `slack-bot__send_dm__a1b2c3`
 *
 * If two distinct (server, tool) pairs would still produce the same key
 * (e.g. via `__` already in either side), construction throws — surfacing
 * the collision loudly is safer than silently shadowing one tool with
 * another.
 *
 * ## Routing
 *
 * The wire `target` URL is `mcp://<server>/<tool>` with each segment
 * percent-encoded via `encodeURIComponent`, so slashes, `%`, and spaces
 * round-trip through the runtime adapter's percent-decoding parser.
 *
 * Designed for use inside `runtime-vercel`'s driver, but exposed publicly so
 * callers can hand the resulting tools directly to `streamText` /
 * `generateText` from `ai`.
 *
 * @example
 *   const tools = await mcpToolsForVercel(adapter, { tool, jsonSchema });
 *   const result = await streamText({ model, messages, tools });
 */
export async function mcpToolsForVercel(
  adapter: McpAdapter,
  factory: VercelToolFactories
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  // Track which (server, tool) pair claimed each key so we can throw on a
  // genuine collision instead of silently overwriting.
  const keyOwner = new Map<string, { server: string; tool: string }>();
  for (const server of adapter.servers()) {
    const defs = await adapter.listTools(server);
    for (const def of defs) {
      const toolName = buildToolKey(server, def.name);
      const prior = keyOwner.get(toolName);
      if (prior && (prior.server !== server || prior.tool !== def.name)) {
        throw new Error(
          `mcpToolsForVercel: tool key collision on "${toolName}" between ` +
            `(${prior.server}, ${prior.tool}) and (${server}, ${def.name})`
        );
      }
      keyOwner.set(toolName, { server, tool: def.name });
      const inputSchema =
        def.inputSchema && factory.jsonSchema
          ? factory.jsonSchema(def.inputSchema)
          : (def.inputSchema ?? { type: 'object' });
      const target = `mcp://${encodeURIComponent(server)}/${encodeURIComponent(def.name)}`;
      out[toolName] = factory.tool({
        description: def.description ?? `MCP tool ${def.name} on ${server}`,
        inputSchema,
        execute: (
          args: Record<string, unknown>,
          opts?: { signal?: AbortSignal }
        ) =>
          adapter.invoke({
            target,
            args,
            signal: opts?.signal,
          }),
      });
    }
  }
  return out;
}

/**
 * Build the Vercel ToolSet key for a `(server, tool)` pair using the scheme
 * documented on {@link mcpToolsForVercel}. Exported only via the module's
 * public surface implicitly through `mcpToolsForVercel`'s behavior; kept
 * private here since callers should not depend on the exact format.
 */
function buildToolKey(server: string, tool: string): string {
  const safe = /^[A-Za-z0-9_-]+$/;
  if (safe.test(server) && safe.test(tool)) {
    return `${server}__${tool}`;
  }
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_');
  return `${sanitize(server)}__${sanitize(tool)}__${shortHash(`${server}::${tool}`)}`;
}

// 6-char non-cryptographic hash (FNV-1a 32-bit). The only requirement is that
// distinct (server, tool) pairs almost-always produce distinct suffixes after
// sanitization; collisions are caught loudly by the keyOwner check upstream.
// Implemented inline to keep this module browser-safe (no node:crypto import).
function shortHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 6);
}

/**
 * Vercel AI SDK builders required to materialize MCP tools. Injected so this
 * package doesn't hard-depend on a specific `ai` major version (mirrors the
 * pattern used by {@link VercelAiSdkDriver}).
 */
export interface VercelToolFactories {
  /** `tool` from the `ai` package. */
  tool: (config: {
    description: string;
    inputSchema: unknown;
    execute: (
      args: Record<string, unknown>,
      opts?: { signal?: AbortSignal }
    ) => Promise<Record<string, unknown>>;
  }) => unknown;
  /**
   * `jsonSchema` from `@ai-sdk/provider-utils` (re-exported by `ai`). Optional
   * — when omitted, the raw JSON Schema is passed through, which works on some
   * builds of `ai` and not others.
   */
  jsonSchema?: (schema: Record<string, unknown>) => unknown;
}
