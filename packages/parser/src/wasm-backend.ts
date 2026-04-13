/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * WASM tree-sitter backend.
 *
 * Provides async initialization for browser environments where native
 * tree-sitter bindings are not available. The WASM binaries (engine +
 * grammar) are passed in by the caller — this module has no dependency
 * on specific grammar packages or bundled assets.
 *
 * Unlike the other backends, this one requires async initialization
 * (loading WASM binaries). Use createWasmBackend() which returns a
 * Promise<ParserBackend>.
 */

import type { SyntaxNode } from '@agentscript/types';
import { adaptNode, type RawTreeSitterNode } from './adapter.js';
import type { HighlightCapture, ParserBackend } from './types.js';

// ── WASM-specific type shapes (avoids importing web-tree-sitter) ────────

interface WasmParser {
  parse(source: string): { rootNode: RawTreeSitterNode } | null;
  setLanguage(language: WasmLanguage): void;
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
interface WasmLanguage {
  // opaque — web-tree-sitter Language instance
}

interface WasmQuery {
  captures(
    node: RawTreeSitterNode
  ): Array<{ name: string; node: RawTreeSitterNode }>;
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Options for WASM initialization.
 * Callers provide base64-encoded WASM binaries — this keeps the
 * parser free of grammar-specific build artifacts.
 */
export interface WasmInitOptions {
  /** Base64-encoded tree-sitter engine WASM (may be chunked). */
  engineWasmBase64: string[];
  /** Base64-encoded grammar WASM (may be chunked). */
  grammarWasmBase64: string[];
}

/**
 * Create a WASM tree-sitter backend.
 *
 * Loads the provided WASM binaries, initializes web-tree-sitter, and
 * returns a ParserBackend. The returned backend is a self-contained
 * object with no module-level singletons.
 *
 * @example
 * ```typescript
 * const backend = await createWasmBackend({
 *   engineWasmBase64: [...],
 *   grammarWasmBase64: [...],
 * });
 * setBackend(backend);
 * ```
 */
export async function createWasmBackend(
  options: WasmInitOptions
): Promise<ParserBackend> {
  const engineWasm = base64ToUint8Array(options.engineWasmBase64.join(''));
  const grammarWasm = base64ToUint8Array(options.grammarWasmBase64.join(''));

  // Dynamic import of web-tree-sitter.
  // Computed path prevents bundlers from statically resolving.
  const webTsModule = 'web-tree-sitter';
  const {
    Parser: TSParser,
    Language,
    Query,
  } = await import(/* @vite-ignore */ webTsModule);

  // Initialize tree-sitter engine with the provided WASM.
  // Strip the sourceMappingURL custom section first — otherwise the browser
  // tries to resolve the embedded source map URL relative to the empty
  // wasmBinaryFile path, producing spurious network requests.
  await TSParser.init({
    locateFile: () => '',
    wasmBinary: stripWasmSourceMapUrl(engineWasm),
  } as Record<string, unknown>);

  const language = await Language.load(grammarWasm);

  const wasmParser = new TSParser() as unknown as WasmParser;
  wasmParser.setLanguage(language as unknown as WasmLanguage);

  const WasmQueryCtor = Query as unknown as new (
    language: WasmLanguage,
    source: string
  ) => WasmQuery;
  const wasmLanguage = language as unknown as WasmLanguage;

  // ── Build the backend object ──────────────────────────────────────

  function parse(source: string): { rootNode: SyntaxNode } {
    const tree = wasmParser.parse(source);
    if (!tree) {
      throw new Error('tree-sitter parse returned null');
    }
    return { rootNode: adaptNode(tree.rootNode) };
  }

  function parseAndHighlight(_source: string): HighlightCapture[] {
    // WASM backend doesn't have a built-in CST-walk highlighter.
    // This shouldn't normally be called directly — executeQuery with a
    // query source should be used instead. Fall back to an empty array.
    // In practice, the top-level executeQuery routes correctly.
    return [];
  }

  function executeQuery(
    source: string,
    querySource: string
  ): HighlightCapture[] {
    const tree = wasmParser.parse(source);
    if (!tree) {
      throw new Error('tree-sitter parse returned null');
    }

    const query = new WasmQueryCtor(wasmLanguage, querySource);
    const captures = query.captures(tree.rootNode);
    return captures.map(capture => ({
      name: capture.name,
      text: capture.node.text,
      startRow: capture.node.startPosition.row,
      startCol: capture.node.startPosition.column,
      endRow: capture.node.endPosition.row,
      endCol: capture.node.endPosition.column,
    }));
  }

  return { parse, parseAndHighlight, executeQuery };
}

// ── Utilities ───────────────────────────────────────────────────────────

/**
 * Strip the 'sourceMappingURL' custom section (id=0) from a WASM binary.
 * Without this, browsers try to resolve the embedded source map URL relative
 * to the (empty) wasmBinaryFile path, producing spurious network requests
 * like wasm://wasm/.tree-sitter.wasm.map even when loading from base64.
 *
 * @internal — exported for testing only
 */
export function stripWasmSourceMapUrl(wasm: Uint8Array): Uint8Array {
  // Validate WASM magic: \0asm
  if (
    wasm.length < 8 ||
    wasm[0] !== 0x00 ||
    wasm[1] !== 0x61 ||
    wasm[2] !== 0x73 ||
    wasm[3] !== 0x6d
  ) {
    return wasm;
  }

  const sections: Array<[number, number]> = []; // [start, end] of each section
  let i = 8; // skip magic + version

  while (i < wasm.length) {
    const sectionStart = i;
    const sectionId = wasm[i++];

    // Decode LEB128 section size
    let size = 0;
    let shift = 0;
    let b: number;
    do {
      b = wasm[i++];
      size |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);

    const contentStart = i;
    const sectionEnd = contentStart + size;

    let keep = true;
    if (sectionId === 0 && size > 0) {
      // Read custom section name (LEB128 length prefix + UTF-8 bytes)
      let nameLen = 0;
      let nameShift = 0;
      let j = contentStart;
      do {
        b = wasm[j++];
        nameLen |= (b & 0x7f) << nameShift;
        nameShift += 7;
      } while (b & 0x80);
      const name = String.fromCharCode(...wasm.slice(j, j + nameLen));
      if (name === 'sourceMappingURL') keep = false;
    }

    if (keep) sections.push([sectionStart, sectionEnd]);
    i = sectionEnd;
  }

  const totalSize = 8 + sections.reduce((s, [a, b]) => s + b - a, 0);
  if (totalSize === wasm.length) return wasm; // nothing was stripped

  const out = new Uint8Array(totalSize);
  out.set(wasm.slice(0, 8), 0);
  let offset = 8;
  for (const [start, end] of sections) {
    out.set(wasm.slice(start, end), offset);
    offset += end - start;
  }
  return out;
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    // Node.js
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  // Browser
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
