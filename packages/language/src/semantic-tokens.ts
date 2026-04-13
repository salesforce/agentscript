/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared semantic token definitions for syntax highlighting.
 *
 * This module is the single source of truth for the token type/modifier
 * registry and the highlight capture → token mapping used by the LSP
 * server, the Monaco editor integration, and the Agentforce package.
 */

// ── Token type and modifier registries ──────────────────────────────

export const TOKEN_TYPES = [
  'keyword',
  'type',
  'function',
  'variable',
  'string',
  'number',
  'operator',
  'comment',
  'namespace',
  'property',
  'decorator',
] as const;

export const TOKEN_MODIFIERS = [
  'defaultLibrary',
  'modification',
  'readonly',
  'block',
  'blockName',
] as const;

// ── Interfaces ──────────────────────────────────────────────────────

export interface SemanticToken {
  line: number;
  startChar: number;
  length: number;
  tokenType: number;
  tokenModifiers: number;
}

/** A single capture from a highlight highlights query. */
export interface HighlightCapture {
  name: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

// ── Helpers ─────────────────────────────────────────────────────────

/** Index of a token type in TOKEN_TYPES. */
function idx(name: string): number {
  const i = (TOKEN_TYPES as readonly string[]).indexOf(name);
  if (i === -1) throw new Error(`Unknown token type: ${name}`);
  return i;
}

/** Modifier bitmask for a named modifier in TOKEN_MODIFIERS. */
function bit(name: string): number {
  const i = (TOKEN_MODIFIERS as readonly string[]).indexOf(name);
  if (i === -1) throw new Error(`Unknown token modifier: ${name}`);
  return 1 << i;
}

// ── Capture → token mapping ─────────────────────────────────────────

/**
 * Explicit mapping from highlight capture names to semantic token
 * type + modifier pairs.  `null` means "don't highlight".
 */
export const CAPTURE_MAP: Record<
  string,
  { type: number; modifiers: number } | null
> = {
  comment: { type: idx('comment'), modifiers: 0 },
  keyword: { type: idx('keyword'), modifiers: 0 },
  number: { type: idx('number'), modifiers: 0 },
  string: { type: idx('string'), modifiers: 0 },
  operator: { type: idx('operator'), modifiers: 0 },
  variable: { type: idx('variable'), modifiers: 0 },
  property: { type: idx('property'), modifiers: 0 },
  type: { type: idx('type'), modifiers: 0 },
  function: { type: idx('function'), modifiers: 0 },
  namespace: { type: idx('namespace'), modifiers: 0 },

  // Compound capture remappings
  'keyword.modifier': {
    type: idx('keyword'),
    modifiers: bit('modification'),
  },
  'constant.builtin': {
    type: idx('keyword'),
    modifiers: 0,
  },
  'string.escape': { type: idx('string'), modifiers: 0 },
  module: { type: idx('namespace'), modifiers: 0 },
  key: { type: idx('property'), modifiers: 0 },
  'keyword.block': { type: idx('keyword'), modifiers: bit('block') },
  'keyword.block.name': { type: idx('keyword'), modifiers: bit('blockName') },

  // Punctuation: use operator color so they always get an explicit token
  punctuation: { type: idx('operator'), modifiers: 0 },
  'punctuation.delimiter': { type: idx('operator'), modifiers: 0 },
  'punctuation.bracket': { type: idx('operator'), modifiers: 0 },

  // Special punctuation (|, ->) -> operator
  'punctuation.special': { type: idx('operator'), modifiers: 0 },

  // Template expression delimiters ({! }) -> keyword.modification
  'punctuation.template': {
    type: idx('keyword'),
    modifiers: bit('modification'),
  },

  // @ prefix -> decorator
  decorator: { type: idx('decorator'), modifiers: 0 },
};

/**
 * Map a highlight capture name to a token type + modifiers pair.
 * Returns `null` for captures that should not be highlighted.
 */
export function mapCaptureToToken(
  captureName: string
): { type: number; modifiers: number } | null {
  const name = captureName.replace(/^@/, '');

  // Exact match first
  if (name in CAPTURE_MAP) {
    return CAPTURE_MAP[name];
  }

  // Fallback: try base type only (e.g. "keyword.foo" → "keyword")
  const baseType = name.split('.')[0];
  if (baseType in CAPTURE_MAP) {
    return CAPTURE_MAP[baseType];
  }

  // Unknown capture: default to variable
  return { type: idx('variable'), modifiers: 0 };
}

/**
 * Remove overlapping tokens at the same position.
 * Expects tokens pre-sorted by (line, startChar, length desc).
 * When two tokens share the same range, the later one wins (higher
 * query-pattern priority).
 */
export function dedupeOverlappingTokens(
  tokens: SemanticToken[]
): SemanticToken[] {
  if (tokens.length === 0) return [];

  const deduped: SemanticToken[] = [];
  for (const current of tokens) {
    if (deduped.length === 0) {
      deduped.push(current);
      continue;
    }

    const prev = deduped[deduped.length - 1];
    const prevEnd = prev.startChar + prev.length;
    if (current.line === prev.line && current.startChar < prevEnd) {
      // Same range start/size => keep later query match (higher priority).
      if (
        current.startChar === prev.startChar &&
        current.length === prev.length
      ) {
        deduped[deduped.length - 1] = current;
      }
      // Otherwise keep the longer/more-specific token already first by sort.
      continue;
    }

    deduped.push(current);
  }

  return deduped;
}

// ── Token generation ────────────────────────────────────────────────

/**
 * Generate semantic tokens from source code and pre-resolved highlights captures.
 *
 * Handles multi-line capture splitting, position sorting, and deduplication.
 * Callers are responsible for executing the highlight query — this function
 * is parser-agnostic.
 *
 * @param source - Source code (used to compute line lengths)
 * @param captures - Captures from a highlight highlights query
 * @returns Array of semantic tokens sorted by position
 */
export function generateSemanticTokens(
  source: string,
  captures: HighlightCapture[]
): SemanticToken[] {
  if (!source.trim()) return [];

  const lines = source.split('\n');
  const tokens: SemanticToken[] = [];

  for (const capture of captures) {
    const mapped = mapCaptureToToken(capture.name);
    if (!mapped) continue;
    const { type, modifiers } = mapped;

    const startLine = capture.startRow;
    const startChar = capture.startCol;
    const endLine = capture.endRow;
    const endChar = capture.endCol;

    if (startLine === endLine) {
      // Single-line capture
      const lineLength = lines[startLine]?.length ?? 0;
      const safeStart = Math.max(0, Math.min(startChar, lineLength));
      const safeEnd = Math.max(safeStart, Math.min(endChar, lineLength));
      if (safeEnd <= safeStart) continue;

      tokens.push({
        line: startLine,
        startChar: safeStart,
        length: safeEnd - safeStart,
        tokenType: type,
        tokenModifiers: modifiers,
      });
    } else {
      // Split multi-line captures into per-line tokens.
      for (let line = startLine; line <= endLine; line++) {
        const lineLength = lines[line]?.length ?? 0;
        const rawStart = line === startLine ? startChar : 0;
        const rawEnd = line === endLine ? endChar : lineLength;
        const safeStart = Math.max(0, Math.min(rawStart, lineLength));
        const safeEnd = Math.max(safeStart, Math.min(rawEnd, lineLength));
        if (safeEnd <= safeStart) continue;

        tokens.push({
          line,
          startChar: safeStart,
          length: safeEnd - safeStart,
          tokenType: type,
          tokenModifiers: modifiers,
        });
      }
    }
  }

  // Sort by position (required for both Monaco and LSP)
  tokens.sort((a, b) => {
    if (a.line !== b.line) return a.line - b.line;
    if (a.startChar !== b.startChar) return a.startChar - b.startChar;
    return b.length - a.length; // Longer tokens first
  });

  return dedupeOverlappingTokens(tokens);
}
