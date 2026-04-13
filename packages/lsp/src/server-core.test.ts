/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for server-core onInitialize dialect wiring.
 */

import { describe, test, expect } from 'vitest';
import type { Connection, InitializeParams } from 'vscode-languageserver';
import { setupServer } from './server-core.js';
import { testConfig } from './test-utils.js';
import type { LspConfig } from './lsp-config.js';

type Handler = (...args: unknown[]) => unknown;

/**
 * Minimal Connection mock that captures registered handlers.
 * Only onInitialize is captured; all others are no-ops.
 */
function createMockConnection() {
  const handlers: Record<string, Handler> = {};
  const noop = () => {};

  const disposable = { dispose: noop };
  const stubHandler = () => disposable;

  const connection = {
    onInitialize: (fn: Handler) => {
      handlers['initialize'] = fn;
    },
    onInitialized: noop,
    onHover: noop,
    onCompletion: noop,
    onDefinition: noop,
    onReferences: noop,
    onCodeAction: noop,
    onDocumentSymbol: noop,
    onWorkspaceSymbol: noop,
    onRenameRequest: noop,
    onDidOpenTextDocument: stubHandler,
    onDidChangeTextDocument: stubHandler,
    onDidCloseTextDocument: stubHandler,
    onWillSaveTextDocument: stubHandler,
    onWillSaveTextDocumentWaitUntil: stubHandler,
    onDidSaveTextDocument: stubHandler,
    onDidChangeConfiguration: noop,
    onDidChangeWatchedFiles: noop,
    onNotification: noop,
    onRequest: noop,
    languages: { semanticTokens: { on: noop } },
    sendDiagnostics: noop,
    console: { log: noop, error: noop, warn: noop, info: noop },
    listen: noop,
    onShutdown: noop,
    onExit: noop,
  } as unknown as Connection;

  return { connection, handlers };
}

function makeInitParams(initializationOptions?: unknown): InitializeParams {
  return {
    processId: 1,
    rootUri: null,
    capabilities: {},
    initializationOptions,
  } as InitializeParams;
}

describe('setupServer onInitialize', () => {
  test('sets config.defaultDialect from initializationOptions.dialect', async () => {
    const config: LspConfig = { ...testConfig };
    const { connection, handlers } = createMockConnection();

    setupServer(connection, config);

    expect(handlers['initialize']).toBeDefined();
    await handlers['initialize'](makeInitParams({ dialect: 'agentforce' }));

    expect(config.defaultDialect).toBe('agentforce');
  });

  test('does not set defaultDialect when dialect is absent', async () => {
    const config: LspConfig = { ...testConfig };
    const { connection, handlers } = createMockConnection();

    setupServer(connection, config);

    await handlers['initialize'](makeInitParams({ highlightsQuery: '...' }));

    expect(config.defaultDialect).toBeUndefined();
  });

  test('does not crash when initializationOptions is undefined', async () => {
    const config: LspConfig = { ...testConfig };
    const { connection, handlers } = createMockConnection();

    setupServer(connection, config);

    await handlers['initialize'](makeInitParams(undefined));

    expect(config.defaultDialect).toBeUndefined();
  });
});
