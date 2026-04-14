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
import { extractStringValue } from '../ast-helpers.js';
import type { Range } from '@agentscript/types';

/**
 * Minimal interface for sequence-like AST nodes.
 * These fields represent internal AST structure that may change.
 */
interface SequenceLike {
  items?: unknown[];
  __children?: unknown[];
  __cst?: {
    node?: CSTNode;
    range?: Range;
  };
}

/**
 * Minimal interface for CST nodes used in inline list extraction.
 */
interface CSTNode {
  type?: string;
  text?: string;
  namedChildren?: CSTNode[];
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
 * Extract string array from a SequenceNode that may be:
 * 1. YAML sequence syntax: - "item1"\n- "item2"  (populated __children/items)
 * 2. Inline list syntax: ["item1", "item2"]       (CST-only, empty __children)
 *
 * This helper provides deterministic extraction with diagnostic feedback
 * instead of silent failures.
 */
export function extractStringSequence(
  sequenceNode: SequenceLike | undefined,
  fieldName: string,
  ctx: CompilerContext
): string[] {
  if (!sequenceNode) {
    return [];
  }

  const result: string[] = [];

  // Strategy 1: Extract from typed AST (YAML sequence syntax)
  // SequenceNode with populated __children or items property
  const children = sequenceNode.__children || [];
  const items = sequenceNode.items || [];

  if (children.length > 0 || items.length > 0) {
    // Use items first (it's the public API), fall back to __children
    const source = items.length > 0 ? items : children;

    for (const item of source) {
      // Handle SequenceItemChild wrapper
      const itemObj = item as Record<string, unknown>;
      const value = itemObj._value || item;
      const str = extractStringValue(value);
      if (str) {
        result.push(str);
      }
    }

    if (result.length > 0) {
      return result;
    }
  }

  // Strategy 2: Extract from CST (inline list syntax)
  // Handle: keywords: ["item1", "item2"]
  const cstNode = sequenceNode.__cst?.node;
  if (cstNode) {
    const extracted = extractFromInlineList(cstNode);
    if (extracted.length > 0) {
      return extracted;
    }

    // If CST exists but extraction failed, emit diagnostic
    if (cstNode.type === 'expression_with_to' || cstNode.type === 'list') {
      ctx.warning(
        `Unable to extract ${fieldName} from inline list syntax. CST structure may have changed.`,
        sequenceNode.__cst?.range
      );
    }
  }

  // Strategy 3: Empty sequence is valid (return empty array, no diagnostic)
  return result;
}

/**
 * Extract strings from inline list CST structure.
 * Handles: ["string1", "string2"]
 *
 * CST structure:
 *   expression_with_to -> expression -> atom -> list -> expression* -> atom -> string -> string_content
 */
function extractFromInlineList(cstNode: CSTNode): string[] {
  const result: string[] = [];

  // Navigate to list node
  let listNode = cstNode;

  // expression_with_to -> expression
  if (cstNode.type === 'expression_with_to' && cstNode.namedChildren?.[0]) {
    listNode = cstNode.namedChildren[0];
  }

  // expression -> atom
  if (listNode.type === 'expression' && listNode.namedChildren?.[0]) {
    listNode = listNode.namedChildren[0];
  }

  // atom -> list
  if (listNode.type === 'atom' && listNode.namedChildren?.[0]) {
    listNode = listNode.namedChildren[0];
  }

  // Extract from list items
  if (listNode.type === 'list' && listNode.namedChildren) {
    for (const listItem of listNode.namedChildren) {
      if (listItem.type === 'expression') {
        const str = extractStringFromExpression(listItem);
        if (str) {
          result.push(str);
        }
      }
    }
  }

  return result;
}

/**
 * Extract string from expression CST node.
 * Handles: expression -> atom -> string -> string_content
 */
function extractStringFromExpression(expressionNode: CSTNode): string | null {
  // expression -> atom
  let node = expressionNode.namedChildren?.[0];
  if (!node || node.type !== 'atom') {
    return null;
  }

  // atom -> string
  node = node.namedChildren?.[0];
  if (!node || node.type !== 'string') {
    return null;
  }

  // string -> string_content
  node = node.namedChildren?.[0];
  if (!node || node.type !== 'string_content') {
    return null;
  }

  return node.text || null;
}
