/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstMeta, Range } from '../core/types.js';
import { isAstNodeLike } from '../core/types.js';
import { DiagnosticSeverity, DiagnosticTag } from '../core/diagnostics.js';
import type { Diagnostic } from '../core/diagnostics.js';
import { decomposeAtMemberExpression } from '../core/expressions.js';

export const LINT_SOURCE = 'agentscript-lint';

/** Distance <= 40% of the longer name's length is considered a plausible typo. */
export const SUGGESTION_THRESHOLD = 0.4;

/** Levenshtein edit distance with O(min(a,b)) space. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  if (a.length > b.length) {
    [a, b] = [b, a];
  }

  const aLen = a.length;
  const bLen = b.length;

  let prev = new Array<number>(aLen + 1);
  let curr = new Array<number>(aLen + 1);

  for (let j = 0; j <= aLen; j++) {
    prev[j] = j;
  }

  for (let i = 1; i <= bLen; i++) {
    curr[0] = i;
    for (let j = 1; j <= aLen; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1, // insertion
        prev[j] + 1, // deletion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[aLen];
}

/**
 * Append a "Did you mean '...'?" hint to a message if a suggestion is provided.
 * Use `prefix` to prepend a sigil (e.g., '@') to the suggestion display.
 */
export function formatSuggestionHint(
  message: string,
  suggestion: string | undefined,
  prefix: string = ''
): string {
  if (!suggestion) return message;
  return `${message}. Did you mean '${prefix}${suggestion}'?`;
}

/** Find the closest "Did you mean?" candidate within the similarity threshold. */
export function findSuggestion(
  name: string,
  candidates: string[]
): string | undefined {
  if (candidates.length === 0) return undefined;

  let bestCandidate: string | undefined;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const dist = levenshtein(name.toLowerCase(), candidate.toLowerCase());
    if (dist < bestDistance) {
      bestDistance = dist;
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) return undefined;

  const maxLen = Math.max(name.length, bestCandidate.length);
  if (bestDistance / maxLen > SUGGESTION_THRESHOLD) return undefined;

  // Case-insensitive exact match: suggest only if casing differs
  if (bestDistance === 0) {
    return name === bestCandidate ? undefined : bestCandidate;
  }

  return bestCandidate;
}

/** Extract the action name from a reasoning action's colinear `@actions.X` value. */
export function resolveColinearAction(raBlock: {
  value?: unknown;
}): string | null {
  const decomposed = decomposeAtMemberExpression(raBlock.value);
  if (!decomposed || decomposed.namespace !== 'actions') return null;
  return decomposed.property;
}

/** Create a lint diagnostic with the standard source tag and optional suggestion. */
export function lintDiagnostic(
  range: Range,
  message: string,
  severity: DiagnosticSeverity,
  code: string,
  options?: { suggestion?: string; tags?: DiagnosticTag[] }
): Diagnostic {
  return {
    range,
    message,
    severity,
    code,
    source: LINT_SOURCE,
    ...(options?.tags ? { tags: options.tags } : {}),
    ...(options?.suggestion
      ? { data: { suggestion: options.suggestion } }
      : {}),
  };
}

/** Extract an `@outputs.X` reference and its CST range from a SetClause value. */
export function extractOutputRef(
  value: unknown
): { name: string; cst?: CstMeta } | null {
  const decomposed = decomposeAtMemberExpression(value);
  if (!decomposed || decomposed.namespace !== 'outputs') return null;

  const cst = isAstNodeLike(value) ? value.__cst : undefined;
  return { name: decomposed.property, ...(cst ? { cst } : {}) };
}

/** Extract an `@variables.X` reference, or null if not a variables reference. */
export function extractVariableRef(expr: unknown): string | null {
  const decomposed = decomposeAtMemberExpression(expr);
  if (!decomposed || decomposed.namespace !== 'variables') return null;
  return decomposed.property;
}
