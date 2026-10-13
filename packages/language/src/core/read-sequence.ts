/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * @module read-sequence
 *
 * Shared reader for string sequences that supports both syntax forms a
 * SequenceNode can take:
 *
 * 1. YAML sequence syntax — `- "item1"` / `- "item2"` — populates the node's
 *    typed `items`/`__children` with StringLiteral values.
 * 2. Inline list syntax — `["item1", "item2"]` — leaves `items` empty; the
 *    values live only in the CST (`expression_with_to → expression → atom →
 *    list → expression* → atom → string → string_content`).
 *
 * The compiler consumes this to extract compiled values; the Agentforce lint
 * layer consumes it to validate `starter_prompts` at parse time. Both need the
 * same dual-syntax handling, so it lives here in the language package (the
 * shared dependency) rather than being duplicated.
 */

import type { Range, SyntaxNode } from './types.js';
import { toRange } from './types.js';

/** A single string entry read from a sequence, with its source range. */
export interface SequenceStringEntry {
  value: string;
  /** Source range of the individual entry, when resolvable. */
  range?: Range;
}

/**
 * A single authored entry read from a sequence. `value` holds the string when
 * the entry reads as one (a string literal or a bare identifier); it is
 * `undefined` for entries that are not strings (booleans, numbers, …), so
 * callers can distinguish and diagnose them rather than silently dropping.
 */
export interface SequenceEntry {
  value?: string;
  /** Source range of the individual entry, when resolvable. */
  range?: Range;
}

/**
 * Minimal structural view of a sequence-like AST node. Kept intentionally
 * loose so callers can pass parsed values without exposing SequenceNode's full
 * type surface.
 */
interface SequenceLike {
  items?: unknown[];
  __children?: unknown[];
  __cst?: {
    node?: SyntaxNode;
    range?: Range;
  };
}

/**
 * Read a typed sequence item into an entry (unwrapping SequenceItemChild).
 * Reads a StringLiteral's `.value`, and falls back to a node's `.name` so
 * unquoted scalars that parse as identifier/reference nodes (e.g. bare `en_US`
 * locales) are still read as strings. A recognizable node that is not a string
 * (a boolean/number literal) yields an entry with `value: undefined` so callers
 * can flag it; only truly unclassifiable items (non-objects) yield `undefined`.
 */
function readTypedEntry(item: unknown): SequenceEntry | undefined {
  if (item === null || typeof item !== 'object') return undefined;
  // Unwrap SequenceItemChild wrapper (`_value`) if present.
  const unwrapped = (item as { _value?: unknown })._value ?? item;
  if (unwrapped === null || typeof unwrapped !== 'object') return undefined;
  const node = unwrapped as {
    value?: unknown;
    name?: unknown;
    __cst?: { range?: Range };
  };
  const value =
    typeof node.value === 'string'
      ? node.value
      : typeof node.name === 'string'
        ? node.name
        : undefined;
  return { value, range: node.__cst?.range };
}

/**
 * Read every authored entry of a sequence, string or not, with source ranges.
 * Handles both YAML and inline-list syntax. Non-string entries are preserved
 * with `value: undefined` so callers can diagnose them. Returns an empty array
 * for an absent or empty sequence.
 */
export function readSequenceEntries(
  sequenceNode: SequenceLike | undefined
): SequenceEntry[] {
  if (!sequenceNode) return [];

  // Strategy 1: typed AST (YAML sequence syntax).
  const items = sequenceNode.items ?? [];
  const children = sequenceNode.__children ?? [];
  const source = items.length > 0 ? items : children;
  if (source.length > 0) {
    const result: SequenceEntry[] = [];
    for (const item of source) {
      const entry = readTypedEntry(item);
      if (entry) result.push(entry);
    }
    if (result.length > 0) return result;
  }

  // Strategy 2: CST (inline list syntax).
  const cstNode = sequenceNode.__cst?.node;
  if (cstNode) {
    return readInlineList(cstNode);
  }

  return [];
}

/**
 * Read a string sequence into entries with source ranges. Handles both YAML
 * and inline-list syntax. Non-string entries are dropped; use
 * {@link readSequenceEntries} to see them. Returns an empty array for an absent
 * or empty sequence (a valid state — callers decide whether emptiness is an
 * error).
 */
export function readStringSequence(
  sequenceNode: SequenceLike | undefined
): SequenceStringEntry[] {
  return readSequenceEntries(sequenceNode).filter(
    (entry): entry is SequenceStringEntry => entry.value !== undefined
  );
}

/** Convenience: just the string values (drops ranges). */
export function readStringSequenceValues(
  sequenceNode: SequenceLike | undefined
): string[] {
  return readStringSequence(sequenceNode).map(e => e.value);
}

/**
 * Extract entries from an inline-list CST node.
 * Handles: `["string1", "string2"]`
 *
 * List items that are not strings (e.g. `True`, `42`) are preserved with
 * `value: undefined` and their range so callers can diagnose them.
 */
function readInlineList(cstNode: SyntaxNode): SequenceEntry[] {
  const result: SequenceEntry[] = [];

  let listNode: SyntaxNode = cstNode;

  // expression_with_to -> expression
  if (cstNode.type === 'expression_with_to' && cstNode.namedChildren[0]) {
    listNode = cstNode.namedChildren[0];
  }

  // expression -> atom
  if (listNode.type === 'expression' && listNode.namedChildren[0]) {
    listNode = listNode.namedChildren[0];
  }

  // atom -> list
  if (listNode.type === 'atom' && listNode.namedChildren[0]) {
    listNode = listNode.namedChildren[0];
  }

  // Extract from list items
  if (listNode.type === 'list') {
    for (const listItem of listNode.namedChildren) {
      if (listItem.type === 'expression') {
        const value = readStringFromExpression(listItem);
        result.push({
          value: value ?? undefined,
          range: toRange(listItem),
        });
      }
    }
  }

  return result;
}

/**
 * Extract a string from an expression CST node.
 * Handles: expression -> atom -> string -> string_content
 */
function readStringFromExpression(expressionNode: SyntaxNode): string | null {
  // expression -> atom
  let node = expressionNode.namedChildren[0];
  if (!node || node.type !== 'atom') return null;

  // atom -> string
  node = node.namedChildren[0];
  if (!node || node.type !== 'string') return null;

  // string -> string_content
  node = node.namedChildren[0];
  if (!node || node.type !== 'string_content') return null;

  return node.text ?? null;
}
