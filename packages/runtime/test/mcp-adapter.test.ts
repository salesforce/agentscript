/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpAdapter, parseMcpTarget } from '../src/index.js';
import {
  startMcpTestServer,
  type McpTestServerHandle,
} from './fixtures/mcp-test-server.js';

describe('McpAdapter', () => {
  let mock: McpTestServerHandle;

  beforeEach(async () => {
    mock = await startMcpTestServer({
      tools: [
        {
          name: 'echo',
          description: 'echo args back',
          inputSchema: {
            hello: z.string().optional(),
            n: z.number().optional(),
          } as never,
          handler: args => ({
            structuredContent: { ok: true, args },
            content: [
              { type: 'text', text: JSON.stringify({ ok: true, args }) },
            ],
          }),
        },
        {
          name: 'plain_text',
          description: 'returns a non-JSON string',
          handler: () => ({
            content: [{ type: 'text', text: 'just a string' }],
          }),
        },
        {
          name: 'boom',
          description: 'reports an error result',
          handler: () => ({
            isError: true,
            content: [{ type: 'text', text: 'kaboom' }],
          }),
        },
      ],
    });
  });

  afterEach(async () => {
    await mock.close();
  });

  it('routes calls to the matching server, parses JSON text content', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    const result = await adapter.invoke({
      target: 'mcp://default/echo',
      args: { hello: 'world' },
    });

    expect(result).toEqual({ ok: true, args: { hello: 'world' } });
    await adapter.close();
  });

  it('returns { text, content } when the text content is not JSON', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    const result = await adapter.invoke({
      target: 'mcp://default/plain_text',
      args: {},
    });

    expect(result.text).toBe('just a string');
    expect(Array.isArray(result.content)).toBe(true);
    await adapter.close();
  });

  it('throws when the MCP server reports an error result', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await expect(
      adapter.invoke({ target: 'mcp://default/boom', args: {} })
    ).rejects.toThrow(/kaboom/);
    await adapter.close();
  });

  it('initializes once per server across multiple invokes', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await adapter.invoke({ target: 'mcp://default/echo', args: { n: 1 } });
    await adapter.invoke({ target: 'mcp://default/echo', args: { n: 2 } });

    expect(mock.stats.initializeCalls).toBe(1);
    await adapter.close();
  });

  it('rejects targets without a server segment', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await expect(
      adapter.invoke({ target: 'mcp://only_tool', args: {} })
    ).rejects.toThrow(/Expected "mcp:\/\/<server>\/<tool>"/);
    await adapter.close();
  });

  it('rejects unknown server names', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await expect(
      adapter.invoke({ target: 'mcp://other/echo', args: {} })
    ).rejects.toThrow(/No MCP server registered as "other"/);
    await adapter.close();
  });

  it('routes calls to multiple registered servers', async () => {
    const second = await startMcpTestServer({
      tools: [
        {
          name: 'ping',
          handler: () => ({
            structuredContent: { from: 'server-b' },
            content: [
              { type: 'text', text: JSON.stringify({ from: 'server-b' }) },
            ],
          }),
        },
      ],
    });
    try {
      const adapter = new McpAdapter({
        a: { url: mock.url },
        b: { url: second.url },
      });

      const fromA = await adapter.invoke({
        target: 'mcp://a/echo',
        args: { hello: 'x' },
      });
      const fromB = await adapter.invoke({
        target: 'mcp://b/ping',
        args: {},
      });

      expect(fromA).toEqual({ ok: true, args: { hello: 'x' } });
      expect(fromB).toEqual({ from: 'server-b' });
      expect(adapter.servers().sort()).toEqual(['a', 'b']);
      await adapter.close();
    } finally {
      await second.close();
    }
  });

  it('lists tools from a server', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });
    const tools = await adapter.listTools('default');
    expect(tools.map(t => t.name).sort()).toEqual([
      'boom',
      'echo',
      'plain_text',
    ]);
    await adapter.close();
  });

  it('forwards configured headers', async () => {
    const seenAuth: string[] = [];
    const headerMock = await startMcpTestServer({
      tools: [
        {
          name: 'echo',
          handler: () => ({
            structuredContent: { ok: true },
            content: [{ type: 'text', text: '{"ok":true}' }],
          }),
        },
      ],
      expectHeaders: headers => {
        const auth = headers.authorization;
        if (auth) seenAuth.push(String(auth));
      },
    });
    try {
      const adapter = new McpAdapter({
        gh: {
          url: headerMock.url,
          headers: { authorization: 'Bearer secret' },
        },
      });
      await adapter.invoke({ target: 'mcp://gh/echo', args: {} });
      expect(seenAuth).toContain('Bearer secret');
      await adapter.close();
    } finally {
      await headerMock.close();
    }
  });

  it('rejects targets that do not start with mcp://', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });
    await expect(
      adapter.invoke({ target: 'http://wat/echo', args: {} })
    ).rejects.toThrow(/Invalid MCP target/);
    await adapter.close();
  });

  it('shares one connect() across concurrent invokes', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    const [a, b] = await Promise.all([
      adapter.invoke({ target: 'mcp://default/echo', args: { n: 1 } }),
      adapter.invoke({ target: 'mcp://default/echo', args: { n: 2 } }),
    ]);

    expect(a).toEqual({ ok: true, args: { n: 1 } });
    expect(b).toEqual({ ok: true, args: { n: 2 } });
    expect(mock.stats.initializeCalls).toBe(1);
    await adapter.close();
  });

  it('close() is idempotent', async () => {
    const adapter = new McpAdapter({ default: { url: mock.url } });

    await adapter.invoke({ target: 'mcp://default/echo', args: {} });
    await adapter.close();
    // Idempotent: second close must not throw.
    await expect(adapter.close()).resolves.toBeUndefined();
  });

  it('surfaces a clear error when the MCP server is unreachable', async () => {
    // Port 1 is reserved and never listened on by user processes — `connect`
    // fails fast with ECONNREFUSED instead of timing out.
    const adapter = new McpAdapter({
      gh: { url: 'http://127.0.0.1:1/' },
    });
    await expect(
      adapter.invoke({ target: 'mcp://gh/anything', args: {} })
    ).rejects.toThrow(/Failed to connect to MCP server "gh"/);
    await adapter.close();
  });

  it('returns { content } when there is no text part (images, resources)', async () => {
    const imageMock = await startMcpTestServer({
      tools: [
        {
          name: 'snapshot',
          handler: () => ({
            // 1x1 transparent PNG, base64 — SDK validates `data` as base64.
            content: [
              {
                type: 'image',
                data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=',
                mimeType: 'image/png',
              },
            ],
          }),
        },
      ],
    });
    try {
      const adapter = new McpAdapter({ cam: { url: imageMock.url } });
      const result = await adapter.invoke({
        target: 'mcp://cam/snapshot',
        args: {},
      });
      // No text content → adapter returns `{ content }` (no SDK shape leak).
      expect(Object.keys(result).sort()).toEqual(['content']);
      expect(Array.isArray((result as { content: unknown[] }).content)).toBe(
        true
      );
      await adapter.close();
    } finally {
      await imageMock.close();
    }
  });

  it('parseMcpTarget rejects malformed URIs', () => {
    // Trailing slash → empty tool name.
    expect(() => parseMcpTarget('mcp://server/')).toThrow(
      /Expected "mcp:\/\/<server>\/<tool>"/
    );
    // Missing server segment.
    expect(() => parseMcpTarget('mcp:///tool')).toThrow(
      /Expected "mcp:\/\/<server>\/<tool>"/
    );
    // Path traversal in tool name.
    expect(() => parseMcpTarget('mcp://server/../escape')).toThrow(
      /Invalid MCP tool name/
    );
  });

  it('parseMcpTarget rejects percent-encoded traversal but accepts %2F in tool names', () => {
    // %2e%2e == ".." after decode → traversal, must reject.
    expect(() => parseMcpTarget('mcp://server/%2e%2e/escape')).toThrow(
      /Invalid MCP tool name/
    );
    expect(() => parseMcpTarget('mcp://server/%2E%2E%2Fescape')).toThrow(
      /Invalid MCP tool name/
    );
    // %2F decodes to '/' inside the tool name — allowed (server split happens
    // on the first literal '/', so encoded slashes survive into the tool).
    expect(parseMcpTarget('mcp://server/group%2Ftool')).toEqual({
      server: 'server',
      tool: 'group/tool',
    });
    // Malformed escape → friendly error, not a TypeError.
    expect(() => parseMcpTarget('mcp://server/%ZZ')).toThrow(
      /Invalid MCP tool name \(malformed escape\)/
    );
  });

  it('reconnects after a transport-level failure mid-session', async () => {
    let callCount = 0;
    const flakyRef: { current: McpTestServerHandle | undefined } = {
      current: undefined,
    };
    const flaky = await startMcpTestServer({
      tools: [
        {
          name: 'echo',
          handler: args => {
            callCount++;
            if (callCount === 2) {
              // Second invocation: drop sockets so the SDK request throws.
              flakyRef.current?.resetSockets();
              throw new Error('socket killed');
            }
            const payload = { ok: true, args, callCount };
            return {
              structuredContent: payload,
              content: [{ type: 'text', text: JSON.stringify(payload) }],
            };
          },
        },
      ],
    });
    flakyRef.current = flaky;
    try {
      const adapter = new McpAdapter({
        s: { url: flaky.url, timeoutMs: 2_000 },
      });

      const first = await adapter.invoke({
        target: 'mcp://s/echo',
        args: { n: 1 },
      });
      expect(first).toMatchObject({ ok: true });
      expect(flaky.stats.initializeCalls).toBe(1);

      // Mid-session failure: socket killed before response.
      // NEW BEHAVIOR: In-call recovery with liveness probe. The probe detects the
      // server is still alive (just that socket died), so it retries the call
      // in-place without reconnecting. The handler runs twice (callCount 2 fails,
      // 3 succeeds on retry).
      const second = await adapter.invoke({
        target: 'mcp://s/echo',
        args: { n: 2 },
      });
      expect(second).toMatchObject({ ok: true, callCount: 3 });
      // No new initialize — liveness probe succeeded, so in-place retry was used
      expect(flaky.stats.initializeCalls).toBe(1);

      // Third call uses the same client.
      const third = await adapter.invoke({
        target: 'mcp://s/echo',
        args: { n: 3 },
      });
      expect(third).toMatchObject({ ok: true });
      expect(flaky.stats.initializeCalls).toBe(1); // Still 1, no reconnect needed
      await adapter.close();
    } finally {
      await flaky.close();
    }
  });

  it('aborts when the user signal fires even if the server hangs', async () => {
    let resolveHang: (() => void) | undefined;
    const hangHandle = await startMcpTestServer({
      tools: [
        {
          name: 'slow',
          handler: () =>
            new Promise<CallToolResultLike>(resolve => {
              resolveHang = () =>
                resolve({
                  structuredContent: { ok: true },
                  content: [{ type: 'text', text: '{"ok":true}' }],
                });
            }),
        },
      ],
    });
    try {
      const adapter = new McpAdapter({
        s: { url: hangHandle.url, timeoutMs: 60_000 },
      });

      const ac = new AbortController();
      const promise = adapter.invoke({
        target: 'mcp://s/slow',
        args: {},
        signal: ac.signal,
      });
      // Cancel via user signal before server replies.
      setTimeout(() => ac.abort(new Error('user-cancel')), 20);
      await expect(promise).rejects.toThrow();
      await adapter.close();

      // Sanity: per-call timeout also fires independently when server hangs.
      const adapterFast = new McpAdapter({
        s: { url: hangHandle.url, timeoutMs: 50 },
      });
      // User passes a never-aborting signal; timeout must still win.
      const neverSignal = new AbortController().signal;
      await expect(
        adapterFast.invoke({
          target: 'mcp://s/slow',
          args: {},
          signal: neverSignal,
        })
      ).rejects.toThrow();
      await adapterFast.close();
    } finally {
      // Free the pending handler so the server can close cleanly.
      resolveHang?.();
      await hangHandle.close();
    }
  });

  it('returns structuredContent directly when present', async () => {
    const mockSC = await startMcpTestServer({
      tools: [
        {
          name: 'weather',
          handler: () => ({
            structuredContent: { temp: 72, units: 'F' },
            content: [{ type: 'text', text: '72F' }],
          }),
        },
      ],
    });
    try {
      const adapter = new McpAdapter({ s: { url: mockSC.url } });
      const result = await adapter.invoke({
        target: 'mcp://s/weather',
        args: {},
      });
      expect(result).toEqual({ temp: 72, units: 'F' });
      await adapter.close();
    } finally {
      await mockSC.close();
    }
  });

  it('joins multiple text parts and exposes them as { text, content }', async () => {
    const multi = await startMcpTestServer({
      tools: [
        {
          name: 'chunks',
          handler: () => ({
            content: [
              { type: 'text', text: 'hello' },
              { type: 'text', text: 'world' },
            ],
          }),
        },
      ],
    });
    try {
      const adapter = new McpAdapter({ s: { url: multi.url } });
      const result = await adapter.invoke({
        target: 'mcp://s/chunks',
        args: {},
      });
      expect(result.text).toBe('hello\nworld');
      expect(Array.isArray(result.content)).toBe(true);
      expect((result.content as unknown[]).length).toBe(2);
      await adapter.close();
    } finally {
      await multi.close();
    }
  });

  it('paginates listTools by following nextCursor', async () => {
    const paged = await startMcpTestServer({
      tools: [
        { name: 't1', description: 'one', handler: () => ({ content: [] }) },
        { name: 't2', description: 'two', handler: () => ({ content: [] }) },
        {
          name: 't3',
          description: 'three',
          handler: () => ({ content: [] }),
        },
        { name: 't4', description: 'four', handler: () => ({ content: [] }) },
      ],
      paginate: { pageSize: 2 },
    });
    try {
      const adapter = new McpAdapter({ s: { url: paged.url } });
      const tools = await adapter.listTools('s');
      expect(tools.map(t => t.name)).toEqual(['t1', 't2', 't3', 't4']);
      await adapter.close();
    } finally {
      await paged.close();
    }
  });

  it('filters tools with enabledTools', async () => {
    const adapter = new McpAdapter({
      default: { url: mock.url, enabledTools: ['echo', 'plain_text'] },
    });

    const tools = await adapter.listTools('default');
    expect(tools.map(t => t.name).sort()).toEqual(['echo', 'plain_text']);
    await adapter.close();
  });

  it('filters tools with disabledTools', async () => {
    const adapter = new McpAdapter({
      default: { url: mock.url, disabledTools: ['boom'] },
    });

    const tools = await adapter.listTools('default');
    expect(tools.map(t => t.name).sort()).toEqual(['echo', 'plain_text']);
    await adapter.close();
  });

  it('applies both enabledTools and disabledTools (enabled takes precedence)', async () => {
    const adapter = new McpAdapter({
      default: {
        url: mock.url,
        enabledTools: ['echo', 'boom'],
        disabledTools: ['boom'],
      },
    });

    const tools = await adapter.listTools('default');
    // disabledTools removes 'boom' even though it's in enabledTools
    expect(tools.map(t => t.name)).toEqual(['echo']);
    await adapter.close();
  });

  it('uses separate startup and tool timeouts', async () => {
    // This test just validates that the separate timeouts are accepted
    // Actual timeout behavior is tested by existing timeout tests
    const adapter = new McpAdapter({
      default: {
        url: mock.url,
        startupTimeoutMs: 10_000,
        timeoutMs: 5_000,
      },
    });

    const result = await adapter.invoke({
      target: 'mcp://default/echo',
      args: { hello: 'world' },
    });

    expect(result).toEqual({ ok: true, args: { hello: 'world' } });
    await adapter.close();
  });
});

/**
 * Local alias to keep the hang-handler signature short. Mirrors the SDK's
 * `CallToolResult` shape for the bits we exercise.
 */
interface CallToolResultLike {
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: 'text'; text: string }>;
}
