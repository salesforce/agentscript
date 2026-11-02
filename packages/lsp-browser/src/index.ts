/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Browser LSP Server Entry Point for AgentScript (Web Worker).
 *
 * Uses the TypeScript parser from @agentscript/agentforce.
 * This file is intended to be imported from a web worker.
 *
 * The connection and server are set up SYNCHRONOUSLY so listen() is called
 * before the client sends its first message. Parser initialization happens
 * inside the onInitialize handler via the onBeforeInitialize hook.
 */

import {
  BrowserMessageReader,
  BrowserMessageWriter,
  createConnection,
} from 'vscode-languageserver/browser.js';
import {
  init,
  getParser,
  executeQuery,
  compileSource,
  serialize,
} from '@agentscript/agentforce';
import { setupServer, defaultDialects } from '@agentscript/lsp';
import type { LspConfig } from '@agentscript/lsp';

const workerContext = globalThis as unknown as {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
};

// Create connection synchronously.
const connection = createConnection(
  new BrowserMessageReader(workerContext as never),
  new BrowserMessageWriter(workerContext as never)
);

let parserReady = false;

const queryExecutor = {
  executeQuery(source: string) {
    return executeQuery(source);
  },
};

const config: LspConfig = {
  dialects: defaultDialects,
  parser: {
    parse(source: string) {
      if (!parserReady) {
        throw new Error('Parser not initialized yet');
      }
      return getParser().parse(source);
    },
  },
  queryExecutor,
  compile(dialectName) {
    if (dialectName !== 'agentforce') return undefined;
    return {
      compile(_ast, source) {
        // Serialize in the worker — ranges WeakMap can't cross postMessage.
        // Emit both snake_case (default) and camelCase variants via the same
        // compileSource path so the UI can toggle between them instantly
        // without a recompile round-trip.
        const serializeOptions = {
          sourcePath: 'input.agent',
          sourceContent: source,
        };
        const snake = compileSource(source);
        const { json, sourceMap } = serialize(
          snake.output,
          snake.ranges,
          serializeOptions
        );
        const camel = compileSource(source, { camelCase: true });
        const { json: camelJson, sourceMap: camelSourceMap } = serialize(
          camel.output,
          camel.ranges,
          serializeOptions
        );
        // compileSource returns merged parse+lint+compile diagnostics; the
        // language service already reports parse/lint, so surface only the
        // compile-stage ones here to avoid duplicates.
        const diagnostics = snake.diagnostics.filter(
          d => d.source === 'compiler'
        );
        return {
          diagnostics,
          output: { json, sourceMap, camelJson, camelSourceMap },
        };
      },
    };
  },
  enableCompletionProvider: true,
  enableSemanticTokens: true,
  onBeforeInitialize: async () => {
    // In tree-sitter mode, init() loads WASM binaries.
    // In parser-javascript mode (default), init() is a no-op-ish — getParser() will
    // fall back to parser-javascript automatically.
    await init();
    parserReady = true;
  },
};

// setupServer calls connection.listen() synchronously.
// Parser init runs inside onInitialize via the onBeforeInitialize hook.
setupServer(connection, config);
