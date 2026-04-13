/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * A single source-to-generated position mapping.
 */
export interface SourceMapping {
  /** 0-based line in original source */
  originalLine: number;
  /** 0-based column in original source */
  originalColumn: number;
  /** 1-based line in generated output */
  generatedLine: number;
  /** 0-based column in generated output */
  generatedColumn: number;
}

/**
 * Find the generated position nearest to a source cursor position.
 *
 * Strategy:
 * 1. Binary search for the greatest original position ≤ cursor (GLB).
 * 2. Collect all mappings that share that same original position —
 *    many output properties annotateBlock to the same source range.
 * 3. Among those, return the **earliest** generated position so the
 *    user lands at the top of the relevant compiled section.
 *
 * @param mappings - Sorted array of SourceMapping (sorted by original position)
 * @param sourceLine - 0-based line in original source
 * @param sourceColumn - 0-based column in original source
 * @returns Generated position (1-based line, 0-based column) or null
 */
export function findGeneratedPosition(
  mappings: SourceMapping[],
  sourceLine: number,
  sourceColumn: number
): { line: number; column: number } | null {
  if (mappings.length === 0) return null;

  // Binary search for greatest lower bound
  let lo = 0;
  let hi = mappings.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const m = mappings[mid];
    const cmp = m.originalLine - sourceLine || m.originalColumn - sourceColumn;

    if (cmp <= 0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === -1) {
    // Cursor is before all mappings — use the first one
    const first = mappings[0];
    return { line: first.generatedLine, column: first.generatedColumn };
  }

  const match = mappings[best];

  // Scan backwards to find all mappings with the same source position,
  // and pick the one with the earliest generated position.
  let earliestGen = match;
  for (let i = best - 1; i >= 0; i--) {
    const m = mappings[i];
    if (
      m.originalLine !== match.originalLine ||
      m.originalColumn !== match.originalColumn
    ) {
      break;
    }
    if (
      m.generatedLine < earliestGen.generatedLine ||
      (m.generatedLine === earliestGen.generatedLine &&
        m.generatedColumn < earliestGen.generatedColumn)
    ) {
      earliestGen = m;
    }
  }
  // Also scan forward (GLB may not be the last in the tie group)
  for (let i = best + 1; i < mappings.length; i++) {
    const m = mappings[i];
    if (
      m.originalLine !== match.originalLine ||
      m.originalColumn !== match.originalColumn
    ) {
      break;
    }
    if (
      m.generatedLine < earliestGen.generatedLine ||
      (m.generatedLine === earliestGen.generatedLine &&
        m.generatedColumn < earliestGen.generatedColumn)
    ) {
      earliestGen = m;
    }
  }

  return {
    line: earliestGen.generatedLine,
    column: earliestGen.generatedColumn,
  };
}

/**
 * Find the original (source) position nearest to a generated cursor position.
 * Uses binary search on generated-sorted mappings (greatest lower bound).
 *
 * @param mappings - Sorted array of SourceMapping (sorted by generated position)
 * @param generatedLine - 1-based line in generated output
 * @param generatedColumn - 0-based column in generated output
 * @returns Original position (0-based line, 0-based column) or null
 */
export function findOriginalPosition(
  mappings: SourceMapping[],
  generatedLine: number,
  generatedColumn: number
): { line: number; column: number } | null {
  if (mappings.length === 0) return null;

  // Binary search for greatest lower bound by generated position
  let lo = 0;
  let hi = mappings.length - 1;
  let best = -1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const m = mappings[mid];
    const cmp =
      m.generatedLine - generatedLine || m.generatedColumn - generatedColumn;

    if (cmp <= 0) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (best === -1) {
    const first = mappings[0];
    return { line: first.originalLine, column: first.originalColumn };
  }

  const match = mappings[best];
  return { line: match.originalLine, column: match.originalColumn };
}
