/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * @module extract-sequence
 *
 * Typed abstraction layer for sequence extraction from parsed AST nodes.
 *
 * ## Problem
 * The compiler needs to extract data from SequenceNode structures, but faces two challenges:
 * 1. **Dual syntax forms**: YAML sequences (`- item`) vs inline lists (`[item1, item2]`)
 * 2. **Internal field coupling**: Direct use of `__children`, `_value`, etc. is brittle
 *
 * ## Solution
 * This module provides stable extraction helpers that:
 * - Abstract away AST internals (__children, _value, items)
 * - Support both YAML and inline list syntax transparently
 * - Emit diagnostics instead of silently failing
 * - Reduce maintenance risk from parser changes
 *
 * ## Usage
 * ```typescript
 * // Extract typed blocks from a sequence
 * const entries = extractSequenceBlocks(voiceBlock.pronunciation_dict);
 * for (const entry of entries) {
 *   const grapheme = extractStringValue(entry.grapheme);
 * }
 *
 * // Extract strings (handles both YAML and inline lists)
 * const keywords = extractStringSequence(
 *   keywordsBlock.keywords,
 *   'inbound_keywords.keywords',
 *   ctx
 * );
 * ```
 */

import type { CompilerContext } from '../compiler-context.js';
import { readStringSequence } from '@agentscript/language';
import type { Range, SyntaxNode } from '@agentscript/types';

/**
 * Minimal interface for sequence-like AST nodes.
 * These fields represent internal AST structure that may change.
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
 * Extracts typed block entries from a Sequence node.
 *
 * Abstracts away internal AST structure (__children, _value) to provide
 * a stable API for sequence traversal. Returns the actual block values
 * without exposing implementation details.
 *
 * @param sequenceNode - SequenceNode containing block entries
 * @returns Array of unwrapped block values
 *
 * @example
 * // pronunciation_dict: Sequence(PronunciationDictEntryBlock)
 * const entries = extractSequenceBlocks(voiceBlock.pronunciation_dict);
 * for (const entry of entries) {
 *   const grapheme = extractStringValue(entry.grapheme);
 *   // ... extract other fields
 * }
 */
export function extractSequenceBlocks<T = unknown>(
  sequenceNode: SequenceLike | undefined
): T[] {
  if (!sequenceNode) {
    return [];
  }

  const result: T[] = [];

  // Access sequence items through public API first, then fall back to internals
  // This provides resilience if the public API stabilizes in future versions
  const children = sequenceNode.items || sequenceNode.__children || [];

  for (const item of children) {
    // Unwrap SequenceItemChild to get the actual block value
    const itemObj = item as Record<string, unknown>;
    const value = itemObj._value || item;
    if (value) {
      result.push(value as T);
    }
  }

  return result;
}

/**
 * Navigate a value CST node down to its inline `list` node, if any.
 * Mirrors the `expression_with_to → expression → atom → list` path used by the
 * shared reader. Returns the `list` node when the value is an inline list
 * (empty or not), or `undefined` for scalars (`""`, bare ids, numbers, …).
 */
function findInlineListNode(cstNode: SyntaxNode): SyntaxNode | undefined {
  let node: SyntaxNode | undefined = cstNode;
  if (node.type === 'expression_with_to') node = node.namedChildren[0];
  if (node?.type === 'expression') node = node.namedChildren[0];
  if (node?.type === 'atom') node = node.namedChildren[0];
  return node?.type === 'list' ? node : undefined;
}

/**
 * Extract string array from a SequenceNode that may be:
 * 1. YAML sequence syntax: - "item1"\n- "item2"  (populated __children/items)
 * 2. Inline list syntax: ["item1", "item2"]       (CST-only, empty __children)
 *
 * Thin wrapper over the shared `readStringSequence` reader in
 * `@agentscript/language` (which both the compiler and the dialect lint layer
 * consume, so the dual-syntax navigation lives in one place). This wrapper
 * preserves the compiler's `ctx.warning` behavior for inline lists whose CST
 * exists but yields no extractable strings.
 */
export function extractStringSequence(
  sequenceNode: SequenceLike | undefined,
  fieldName: string,
  ctx: CompilerContext
): string[] {
  if (!sequenceNode) {
    return [];
  }

  const result = readStringSequence(sequenceNode).map(entry => entry.value);
  if (result.length > 0) {
    return result;
  }

  // If a *non-empty* inline list exists but extraction produced nothing, warn —
  // this usually means the CST structure drifted from what the reader expects.
  // An empty list (`[]`) or a non-list scalar (e.g. `""`) legitimately yields no
  // entries, so those must NOT warn.
  const cstNode = sequenceNode.__cst?.node;
  const listNode = cstNode && findInlineListNode(cstNode);
  if (listNode && listNode.namedChildren.length > 0) {
    ctx.warning(
      `Unable to extract ${fieldName} from inline list syntax. CST structure may have changed.`,
      sequenceNode.__cst?.range
    );
  }

  return result;
}
