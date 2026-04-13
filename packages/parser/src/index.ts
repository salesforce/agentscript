/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * @agentscript/parser — default (parser-javascript) entry point.
 *
 * This is the default export used when no special conditions are set.
 * Uses the pure TypeScript parser — zero native dependencies.
 *
 * To use tree-sitter instead, build/run with --conditions=tree-sitter.
 */

import { createTsBackend } from './ts-backend.js';
import { createApi } from './api.js';

// ── Public type re-exports ──────────────────────────────────────────────

export type { SyntaxNode } from '@agentscript/types';
export type { HighlightCapture, Parser, ParserBackend } from './types.js';
export type { WasmInitOptions } from './wasm-backend.js';

// Factory re-exports
export { createTsBackend } from './ts-backend.js';
export { createWasmBackend, stripWasmSourceMapUrl } from './wasm-backend.js';

// ── Backend + public API ────────────────────────────────────────────────

const { parse, parseAndHighlight, getParser, executeQuery } =
  createApi(createTsBackend());

export { parse, parseAndHighlight, getParser, executeQuery };
