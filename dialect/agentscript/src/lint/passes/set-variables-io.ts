/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * setVariables I/O validation — validates that `with` clause parameters in
 * @utils.setVariables reasoning actions reference defined mutable variables.
 *
 * Diagnostics: set-variables-unknown-variable, set-variables-immutable-target
 */

import type { LintPass, PassStore } from '@agentscript/language';
import {
  defineRule,
  each,
  attachDiagnostic,
  findSuggestion,
  lintDiagnostic,
} from '@agentscript/language';
import type { CstMeta, SyntaxNode } from '@agentscript/types';
import { toRange, DiagnosticSeverity } from '@agentscript/types';
import { setVariablesEntriesKey } from './reasoning-actions.js';
import { typeMapKey } from './type-map.js';

/**
 * Variables written by `@utils.setVariables` are targeted by the bare `with`
 * param name (e.g. `with artifacts=...`), not by an `@variables.artifacts`
 * member expression, so the unused-variable walk never observes them. Feed
 * these write-targets to `unusedVariablePass` so an assigned-only variable is
 * treated as used — matching how `set @variables.X=...` already counts.
 */
export function collectSetVariablesTargets(store: PassStore): Iterable<string> {
  const entries = store.get(setVariablesEntriesKey);
  const names = new Set<string>();
  if (!entries) return names;

  for (const entry of entries) {
    for (const stmt of entry.statements ?? []) {
      if (stmt.__kind !== 'WithClause') continue;
      const param = stmt.param as string | undefined;
      if (param) names.add(param);
    }
  }
  return names;
}

export function setVariablesIoRule(): LintPass {
  return defineRule({
    id: 'set-variables-io',
    description:
      'Validates with clause params in @utils.setVariables reference defined mutable variables',
    deps: { entry: each(setVariablesEntriesKey), typeMap: typeMapKey },

    run({ entry, typeMap }) {
      const { statements } = entry;
      if (!statements) return;

      for (const stmt of statements) {
        if (stmt.__kind !== 'WithClause') continue;
        const param = stmt.param as string;
        if (!param) continue;

        const varInfo = typeMap.variables.get(param);
        if (!varInfo) {
          const cst = stmt.__cst as CstMeta | undefined;
          if (!cst) continue;
          const paramCstNode = (stmt as { __paramCstNode?: SyntaxNode })
            .__paramCstNode;
          const range = paramCstNode ? toRange(paramCstNode) : cst.range;

          const suggestion = findSuggestion(param, [
            ...typeMap.variables.keys(),
          ]);
          const msg = `'${param}' is not a defined variable. @utils.setVariables can only assign to declared variables.`;
          attachDiagnostic(
            stmt,
            lintDiagnostic(
              range,
              msg,
              DiagnosticSeverity.Warning,
              'set-variables-unknown-variable',
              { suggestion }
            )
          );
          continue;
        }

        if (varInfo.modifier !== 'mutable') {
          const cst = stmt.__cst as CstMeta | undefined;
          if (!cst) continue;
          const paramCstNode = (stmt as { __paramCstNode?: SyntaxNode })
            .__paramCstNode;
          const range = paramCstNode ? toRange(paramCstNode) : cst.range;

          const qualifier = varInfo.modifier ?? 'non-mutable';
          const msg = `'${param}' is a ${qualifier} variable. @utils.setVariables can only assign to mutable variables.`;
          attachDiagnostic(
            stmt,
            lintDiagnostic(
              range,
              msg,
              DiagnosticSeverity.Error,
              'set-variables-immutable-target'
            )
          );
        }
      }
    },
  });
}
