/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Precomputed line-to-line+column lookup tables for instant bidirectional cursor sync.
 *
 * Built from a standard Source Map V3 — no custom format needed.
 * For each source line, stores the best generated position to jump to (and vice versa).
 */

import { TraceMap, eachMapping } from '@jridgewell/trace-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';

/**
 * Precomputed O(1) lookup tables for cursor sync with column precision.
 *
 * Arrays are interleaved (line, col) pairs:
 *   sourceToGen[srcLine * 2]     = generated line (0-based), or -1 if unmapped
 *   sourceToGen[srcLine * 2 + 1] = generated column (0-based), or -1 if unmapped
 *
 * This keeps the data in a single transferable Int32Array (important for postMessage).
 */
export interface CursorMap {
  /** sourceToGen[srcLine*2] = genLine, sourceToGen[srcLine*2+1] = genCol */
  sourceToGen: Int32Array;
  /** genToSource[genLine*2] = srcLine, genToSource[genLine*2+1] = srcCol */
  genToSource: Int32Array;
}

/**
 * Build O(1) cursor sync tables from a standard Source Map V3.
 *
 * For each line, picks the mapping with the smallest generated column
 * (first content on that line), giving precise cursor sync.
 */
export function buildCursorMap(
  sourceMap: EncodedSourceMap,
  sourceLineCount: number,
  genLineCount: number
): CursorMap {
  const tracer = new TraceMap(sourceMap);

  // Interleaved (line, col) pairs — 2 entries per line
  const sourceToGen = new Int32Array(sourceLineCount * 2).fill(-1);
  const sourceBestCol = new Int32Array(sourceLineCount).fill(0x7fffffff);

  const genToSource = new Int32Array(genLineCount * 2).fill(-1);
  const genBestCol = new Int32Array(genLineCount).fill(0x7fffffff);

  eachMapping(tracer, mapping => {
    if (mapping.originalLine === null || mapping.originalColumn === null)
      return;

    const srcLine = mapping.originalLine - 1; // trace-mapping is 1-based → 0-based
    const srcCol = mapping.originalColumn;
    const genLine = mapping.generatedLine - 1; // 1-based → 0-based
    const genCol = mapping.generatedColumn;

    // Source line → generated position (pick smallest generated column)
    if (srcLine >= 0 && srcLine < sourceLineCount) {
      if (genCol < sourceBestCol[srcLine]) {
        sourceBestCol[srcLine] = genCol;
        sourceToGen[srcLine * 2] = genLine;
        sourceToGen[srcLine * 2 + 1] = genCol;
      }
    }

    // Generated line → source position (pick smallest source column)
    if (genLine >= 0 && genLine < genLineCount) {
      if (srcCol < genBestCol[genLine]) {
        genBestCol[genLine] = srcCol;
        genToSource[genLine * 2] = srcLine;
        genToSource[genLine * 2 + 1] = srcCol;
      }
    }
  });

  return { sourceToGen, genToSource };
}
