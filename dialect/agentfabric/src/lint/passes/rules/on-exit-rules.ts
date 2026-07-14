/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap, FieldChild } from '@agentscript/language';
import { asStatements, attachError, type AstLike } from './shared.js';

interface ClauseLike {
  __kind?: string;
}

interface TransitionLike {
  __kind?: string;
  clauses?: unknown;
}

interface NodeLike {
  __children?: unknown[];
}

function countToClauses(procedure: unknown): number {
  let count = 0;
  for (const stmt of asStatements(procedure)) {
    const t = stmt as TransitionLike;
    if (t.__kind !== 'TransitionStatement' || !Array.isArray(t.clauses))
      continue;
    for (const clause of t.clauses) {
      if ((clause as ClauseLike).__kind === 'ToClause') count++;
    }
  }
  return count;
}

function countOnExitFields(entry: unknown): number {
  const node = entry as NodeLike;
  if (!Array.isArray(node.__children)) return 0;
  return node.__children.filter(
    c => c instanceof FieldChild && c.key === 'on_exit'
  ).length;
}

export function checkOnExitRules(root: Record<string, unknown>): void {
  const nodeGroups = [
    root.orchestrator,
    root.subagent,
    root.generator,
    root.executor,
    root.echo,
  ];
  for (const group of nodeGroups) {
    if (!isNamedMap(group)) continue;
    for (const [, entry] of group) {
      if (entry == null || typeof entry !== 'object') continue;
      const onExit = (entry as Record<string, unknown>).on_exit;
      if (onExit === undefined) continue;
      const invalid = asStatements(onExit).some(
        stmt => stmt.__kind !== 'TransitionStatement'
      );
      if (invalid) {
        attachError(
          entry as AstLike,
          "on_exit may only contain a 'transition ...' statement.",
          'on-exit-transition-only'
        );
      }
      if (countToClauses(onExit) > 1 || countOnExitFields(entry) > 1) {
        attachError(
          entry as AstLike,
          "on_exit must contain exactly one 'transition to' target.",
          'on-exit-single-transition'
        );
      }
    }
  }
}
