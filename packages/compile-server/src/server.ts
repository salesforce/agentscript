/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// IMPORTANT: ./otel.js must be imported FIRST so the OpenTelemetry SDK starts
// and patches HTTP/Express BEFORE those modules are loaded transitively via
// @agentscript/agentforce or ./app.js. Do not reorder these imports.
import './otel.js';
import type { Server } from 'node:http';
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { init } from '@agentscript/agentforce';
import app from './app.js';

// Read server-constants.json at runtime instead of using an `import ... with
// { type: "json" }` attribute, which requires Node >= 18.20 / 20.10. CI runners
// occasionally pin an older Node; runtime fs reads work everywhere.
const __dirname = dirname(fileURLToPath(import.meta.url));
const constants = JSON.parse(
  readFileSync(join(__dirname, '..', 'server-constants.json'), 'utf8')
) as { port: number; host: string };

export const COMPILE_SERVER_PORT = constants.port;
export const COMPILE_SERVER_HOST = constants.host;

// Bind `app` to a port and wire up a fatal error handler. Exported (rather than
// inlined into start()) so it can be exercised in tests. `onFatal` defaults to
// process.exit(1) but is injectable so tests can assert on bind failures without
// killing the test runner.
export function listen(
  port: number = COMPILE_SERVER_PORT,
  onFatal: (err: Error) => void = () => process.exit(1)
): Server {
  const server = app.listen(port, '0.0.0.0', () => {
    // eslint-disable-next-line no-console
    console.log(
      `AgentScript compilation server running on http://0.0.0.0:${port}`
    );
  });
  // Without this handler, a bind failure (e.g. EADDRINUSE) surfaces on the
  // async 'error' event, never keeps the event loop alive, and the process
  // exits 0 — a silent failure that masquerades as a successful start.
  server.on('error', err => {
    console.error(`Failed to bind compilation server to port ${port}:`, err);
    onFatal(err);
  });
  return server;
}

async function start(): Promise<void> {
  await init();
  listen();
}

// Only auto-start when run directly as the entrypoint, not when imported (e.g.
// by tests). process.argv[1] is the path Node was invoked with — resolve it
// through realpathSync so launching via the `bin` symlink (whose path differs
// from the real server.js that import.meta.url resolves to) still matches, and
// via pathToFileURL so the comparison is done on canonical, properly-encoded
// file:// URLs rather than a hand-built string.
const isEntrypoint = (): boolean => {
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(argvPath)).href;
  } catch {
    return false;
  }
};

if (isEntrypoint()) {
  start().catch(err => {
    console.error('Failed to start compilation server:', err);
    process.exit(1);
  });
}
