/**
 * Shared utility functions for Agentforce lint passes.
 */

import type { CstMeta, Range } from '@agentscript/types';

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
