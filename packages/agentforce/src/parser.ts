/**
 * Parser re-exports and WASM initialization.
 *
 * By default, all parsing delegates to @agentscript/parser,
 * which uses parser-javascript (pure TypeScript). No initialization needed.
 *
 * For browser WASM support, call `await init()` to load bundled WASM
 * binaries. After init, getParser() and executeQuery() use the WASM backend.
 */

import {
  parseAndHighlight as nativeHighlight,
  executeQuery as nativeExecuteQuery,
  getParser as nativeGetParser,
  createWasmBackend,
} from '@agentscript/parser';
import type {
  HighlightCapture,
  Parser,
  ParserBackend,
  WasmInitOptions,
} from '@agentscript/parser';
import { loadWasmModule } from './wasm-loader.js';

export { stripWasmSourceMapUrl } from '@agentscript/parser';
export type { HighlightCapture as QueryCapture, Parser };

// ── Local WASM backend (set after init()) ───────────────────────────────

let _wasmBackend: ParserBackend | null = null;

/**
 * Get a parser object.
 *
 * Returns the WASM backend if initialized, otherwise the default backend.
 */
export function getParser(): Parser {
  if (_wasmBackend) {
    return { parse: (source: string) => _wasmBackend!.parse(source) };
  }
  return nativeGetParser();
}

/**
 * Parse and highlight source code.
 *
 * Uses the WASM backend if initialized, otherwise the default backend.
 */
export function parseAndHighlight(source: string): HighlightCapture[] {
  if (_wasmBackend) {
    return _wasmBackend.parseAndHighlight(source);
  }
  return nativeHighlight(source);
}

/**
 * Execute a highlight query against source code.
 *
 * Uses the WASM backend's executeQuery if initialized, otherwise
 * falls back to the default backend.
 */
export function executeQuery(
  source: string,
  querySource?: string
): HighlightCapture[] {
  if (_wasmBackend) {
    if (querySource && _wasmBackend.executeQuery) {
      return _wasmBackend.executeQuery(source, querySource);
    }
    return _wasmBackend.parseAndHighlight(source);
  }
  return nativeExecuteQuery(source, querySource);
}

// ── WASM initialization ─────────────────────────────────────────────────

/**
 * Initialize the WASM tree-sitter parser for browser environments.
 *
 * Loads the bundled WASM binaries (tree-sitter engine + AgentScript grammar)
 * and stores the WASM backend locally. After calling init(), getParser()
 * and executeQuery() use the WASM backend instead of the default parser.
 *
 * Idempotent — subsequent calls are no-ops. Safe to call concurrently.
 */
let _initPromise: Promise<void> | null = null;
let _initialized = false;

export async function init(): Promise<void> {
  if (_initialized) return;
  if (_initPromise) return _initPromise;

  _initPromise = doInit();
  try {
    await _initPromise;
  } catch (err) {
    _initPromise = null;
    throw err;
  }
}

async function doInit(): Promise<void> {
  // loadWasmModule() dynamically imports the generated WASM constants.
  // In parser-javascript builds the entire wasm-loader module is stubbed out
  // by esbuild, so no wasm-constants-generated reference appears in output.
  const wasmModule = await loadWasmModule();
  if (!wasmModule) {
    _initialized = true;
    return;
  }

  const { TREE_SITTER_ENGINE_BASE64, TREE_SITTER_AGENTSCRIPT_BASE64 } =
    wasmModule;
  if (!TREE_SITTER_ENGINE_BASE64 || !TREE_SITTER_AGENTSCRIPT_BASE64) {
    // Incomplete WASM constants — fall back to parser-javascript.
    _initialized = true;
    return;
  }

  const options: WasmInitOptions = {
    engineWasmBase64: TREE_SITTER_ENGINE_BASE64,
    grammarWasmBase64: TREE_SITTER_AGENTSCRIPT_BASE64,
  };

  _wasmBackend = await createWasmBackend(options);
  _initialized = true;
}
