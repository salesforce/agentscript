/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Position index for O(1)-ish cursor lookups.
 *
 * Flat arrays of expressions, definition keys, and scope blocks collected
 * during a lint pass. Queries do a linear scan with smallest-range heuristic,
 * much cheaper than a full recursive AST walk per cursor movement.
 */

import type { Range, AstNodeLike } from '../types.js';
import type { ScopeContext } from './scope.js';
import { isPositionInRange, rangeSize } from './ast-utils.js';
import { storeKey } from './lint-engine.js';

export interface ExpressionEntry {
  expr: AstNodeLike;
  range: Range;
  scope: ScopeContext;
}

export interface DefinitionEntry {
  namespace: string;
  name: string;
  keyRange: Range;
  fullRange: Range;
  scope: ScopeContext;
}

export interface ScopeEntry {
  range: Range;
  scope: ScopeContext;
}

export interface PositionIndex {
  expressions: ExpressionEntry[];
  definitions: DefinitionEntry[];
  scopes: ScopeEntry[];
}

export const positionIndexKey = storeKey<PositionIndex>('position-index');

/** Find the expression at a position. Uses smallest-range heuristic. */
export function queryExpressionAtPosition(
  index: PositionIndex,
  line: number,
  character: number
): ExpressionEntry | null {
  let best: ExpressionEntry | null = null;
  let bestSize = Infinity;

  for (const entry of index.expressions) {
    if (!isPositionInRange(line, character, entry.range)) continue;
    const size = rangeSize(entry.range);
    if (size < bestSize) {
      best = entry;
      bestSize = size;
    }
  }

  return best;
}

/** Find the definition key at a position. Uses smallest-range heuristic. */
export function queryDefinitionAtPosition(
  index: PositionIndex,
  line: number,
  character: number
): DefinitionEntry | null {
  let best: DefinitionEntry | null = null;
  let bestSize = Infinity;

  for (const entry of index.definitions) {
    if (!isPositionInRange(line, character, entry.keyRange)) continue;
    const size = rangeSize(entry.keyRange);
    if (size < bestSize) {
      best = entry;
      bestSize = size;
    }
  }

  return best;
}

/** Find the deepest scope context at a position. */
export function queryScopeAtPosition(
  index: PositionIndex,
  line: number,
  character: number
): ScopeContext {
  let best: ScopeEntry | null = null;
  let bestSize = Infinity;

  for (const entry of index.scopes) {
    if (!isPositionInRange(line, character, entry.range)) continue;
    const size = rangeSize(entry.range);
    if (size < bestSize) {
      best = entry;
      bestSize = size;
    }
  }

  return best?.scope ?? {};
}
