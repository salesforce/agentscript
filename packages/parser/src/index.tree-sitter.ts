/**
 * @agentscript/parser — tree-sitter entry point.
 *
 * Selected via the "tree-sitter" package.json exports condition.
 * Uses native tree-sitter (Node.js) as the backend.
 *
 * To use: build/run with --conditions=tree-sitter
 */

import { createNativeBackend } from './tree-sitter-backend.js';
import { createApi } from './api.js';

// ── Public type re-exports ──────────────────────────────────────────────

export type { SyntaxNode } from '@agentscript/types';
export type { HighlightCapture, Parser, ParserBackend } from './types.js';
export type { WasmInitOptions } from './wasm-backend.js';

// Factory re-exports
export { createTsBackend } from './ts-backend.js';
export { createNativeBackend } from './tree-sitter-backend.js';
export { createWasmBackend, stripWasmSourceMapUrl } from './wasm-backend.js';

// ── Backend + public API ────────────────────────────────────────────────

const { parse, parseAndHighlight, getParser, executeQuery } = createApi(
  createNativeBackend()
);

export { parse, parseAndHighlight, getParser, executeQuery };
