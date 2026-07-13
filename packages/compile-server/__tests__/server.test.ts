/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// Tests for the server bootstrap in src/server.ts.
//
// The regression under test: a port conflict used to fail silently. app.listen's
// callback fires on the 'listening' event, which on a dual-stack 0.0.0.0 bind
// can fire before the bind is settled — so the "running" line printed even when
// the bind was about to fail with EADDRINUSE. With no 'error' handler that
// failure surfaced on the async 'error' event, never kept the event loop alive,
// and the process exited 0. listen() now installs an error handler that reports
// the failure via the injectable onFatal callback (process.exit(1) in prod).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

// Keep the suite fast and hermetic — no real parser init or OTLP exporter.
vi.mock('@agentscript/agentforce', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  compileSource: vi.fn(),
  DSL_VERSION: '0.0.0-test',
  DiagnosticSeverity: { Error: 1, Warning: 2, Information: 3, Hint: 4 },
}));

const { listen } = await import('../src/server.js');

const closeServer = (server: Server): Promise<void> =>
  new Promise(resolve => server.close(() => resolve()));

// Wait one macrotask tick so pending 'listening'/'error' events flush.
const tick = (): Promise<void> =>
  new Promise(resolve => setTimeout(resolve, 50));

const openServers: Server[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer));
  vi.restoreAllMocks();
});

describe('listen()', () => {
  it('binds to an ephemeral port and logs a start message', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    // Port 0 lets the OS pick a free port, avoiding conflicts in CI.
    const server = listen(0);
    openServers.push(server);
    await tick();

    expect(server.listening).toBe(true);
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining('AgentScript compilation server running')
    );
  });

  it('invokes onFatal instead of exiting silently when the port is in use', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    // First bind grabs a concrete port.
    const first = listen(0);
    openServers.push(first);
    await tick();
    const { port } = first.address() as { port: number };

    // Second bind to the same port must fail — and must surface that failure.
    const onFatal = vi.fn();
    const second = listen(port, onFatal);
    openServers.push(second);
    await tick();

    expect(onFatal).toHaveBeenCalledTimes(1);
    const err = onFatal.mock.calls[0][0] as NodeJS.ErrnoException;
    expect(err.code).toBe('EADDRINUSE');
  });
});
