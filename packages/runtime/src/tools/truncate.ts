/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Character budget for tool result outputs. Oversized results are truncated
 * with head+tail retention to keep both the start AND end visible (e.g. for
 * stack traces where the error message is at the bottom).
 *
 * Matches the reference agent's MCP_MAX_OUTPUT_CHARS (100K).
 */
export const MAX_TOOL_RESULT_CHARS = 100_000;

/**
 * When truncating, retain this many characters from the head and tail.
 * Matches the reference agent's split: approximately 90%/10% (90K head, 10K tail).
 */
const DEFAULT_HEAD_RATIO = 0.9;
const DEFAULT_TAIL_RATIO = 0.1;

export interface TruncateOptions {
  /** Character budget. Default: MAX_TOOL_RESULT_CHARS. */
  maxChars?: number;
  /** Head retention chars (overrides ratio). */
  headChars?: number;
  /** Tail retention chars (overrides ratio). */
  tailChars?: number;
  /** Head retention ratio (0-1). Default: 0.9. Ignored if headChars is set. */
  headRatio?: number;
  /** Tail retention ratio (0-1). Default: 0.1. Ignored if tailChars is set. */
  tailRatio?: number;
}

/**
 * Truncate oversized tool result outputs with head+tail retention.
 *
 * - Caps string-valued fields (`output`, `error`, `result`, any string value)
 * - Preserves non-string fields untouched
 * - Inserts a clear marker stating how many chars were removed
 * - Returns the input untouched when under budget
 */
export function truncateToolResult(
  result: Record<string, unknown>,
  opts: TruncateOptions = {}
): Record<string, unknown> {
  const maxChars = opts.maxChars ?? MAX_TOOL_RESULT_CHARS;
  const headRatio = opts.headRatio ?? DEFAULT_HEAD_RATIO;
  const tailRatio = opts.tailRatio ?? DEFAULT_TAIL_RATIO;

  // Calculate head/tail based on the budget, with explicit overrides
  const headChars = opts.headChars ?? Math.floor(maxChars * headRatio);
  const tailChars = opts.tailChars ?? Math.floor(maxChars * tailRatio);

  const truncated: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'string') {
      if (value.length > maxChars) {
        const removed = value.length - headChars - tailChars;
        const head = value.slice(0, headChars);
        const tail = value.slice(value.length - tailChars);
        truncated[key] =
          `${head}\n\n[Output truncated: removed ${removed} characters. Use pagination or more specific queries to get remaining content.]\n\n${tail}`;
      } else {
        truncated[key] = value;
      }
    } else {
      // Preserve non-string fields (booleans, numbers, objects, arrays)
      truncated[key] = value;
    }
  }

  return truncated;
}
