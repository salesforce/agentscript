/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Public types for @agentscript/parser.
 *
 * These are the only type-level exports consumers should use.
 * Backend-specific types (tree-sitter nodes, adapters) are internal.
 */

import type { SyntaxNode } from '@agentscript/types';

/**
 * A single highlight/query capture result.
 *
 * Produced by parseAndHighlight() and executeQuery().
 * The shape matches tree-sitter's QueryCapture format.
 */
export interface HighlightCapture {
  /** Capture name (e.g., "keyword", "string", "variable") */
  name: string;
  /** The captured text */
  text: string;
  /** Start row (0-based) */
  startRow: number;
  /** Start column (0-based) */
  startCol: number;
  /** End row (0-based) */
  endRow: number;
  /** End column (0-based) */
  endCol: number;
}

/**
 * Parser object returned by getParser().
 */
export interface Parser {
  parse(source: string): { rootNode: SyntaxNode };
}

/**
 * A parser backend implementation.
 *
 * Each backend (parser-javascript, native tree-sitter, WASM tree-sitter) implements
 * this interface. Consumers create backends via factory functions
 * (createTsBackend, createWasmBackend, etc.) and either use them directly
 * or set them as the module-level default via setBackend().
 */
export interface ParserBackend {
  /** Parse source code and return a CST. */
  parse(source: string): { rootNode: SyntaxNode };

  /** Parse and produce highlight captures. */
  parseAndHighlight(source: string): HighlightCapture[];

  /**
   * Execute a tree-sitter query against source.
   * Only available on backends that support query execution (WASM, native tree-sitter).
   * When absent, executeQuery() falls back to parseAndHighlight().
   */
  executeQuery?(source: string, querySource: string): HighlightCapture[];
}
