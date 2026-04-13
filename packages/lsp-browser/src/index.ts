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
  compile,
  serialize,
} from '@agentscript/agentforce';
import type { ParsedAgentforce } from '@agentscript/agentforce';
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
      compile(ast, source) {
        const result = compile(ast as ParsedAgentforce);
        // Serialize in the worker — ranges WeakMap can't cross postMessage.
        const { json, sourceMap } = serialize(result.output, result.ranges, {
          sourcePath: 'input.agent',
          sourceContent: source,
        });
        return {
          diagnostics: result.diagnostics,
          output: { json, sourceMap },
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
