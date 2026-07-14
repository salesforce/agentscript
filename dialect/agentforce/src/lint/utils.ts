/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared utility functions for Agentforce lint passes.
 */

import type { CstMeta, Range, SyntaxNode } from '@agentscript/types';
import { toRange } from '@agentscript/types';

/** Fallback range when no CST info is available. */
const ZERO_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/**
 * Extract a string value from a raw AST field.
 * Handles plain strings, StringLiteral nodes, and sourced wrappers.
 */
export function extractStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value == null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.value === 'string') return record.value;
  return undefined;
}

/**
 * Get the CST range for an AST node or value.
 * Falls back to ZERO_RANGE when no CST metadata is available.
 */
export function getBlockRange(node: unknown): Range {
  if (node && typeof node === 'object') {
    const cst = (node as { __cst?: CstMeta }).__cst;
    if (cst?.range) return cst.range;
  }
  return ZERO_RANGE;
}

/**
 * Get the range of the entire `key: value` field line for an AST value node.
 *
 * A value node's own CST range covers only the value token (e.g. `True`), so a
 * diagnostic ranged on it underlines just the value. This walks up the CST to
 * the enclosing `mapping_element` — the field's own line — so the range spans
 * key through value. The value node sits a few levels below its
 * `mapping_element` (atom -> expression -> ... -> mapping_element), so the walk
 * must loop rather than take a single parent hop.
 *
 * Falls back to the node's own range, then ZERO_RANGE.
 */
export function getFieldLineRange(node: unknown): Range {
  if (node && typeof node === 'object') {
    const cst = (node as { __cst?: CstMeta }).__cst;
    if (cst?.node) {
      let current: SyntaxNode | null = cst.node;
      while (current) {
        if (current.type === 'mapping_element') return toRange(current);
        current = current.parent;
      }
    }
    if (cst?.range) return cst.range;
  }
  return ZERO_RANGE;
}
