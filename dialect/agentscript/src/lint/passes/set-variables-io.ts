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

import type { LintPass } from '@agentscript/language';
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

export function setVariablesIoRule(): LintPass {
  return defineRule({
    id: 'set-variables-io',
    description:
      'Validates with clause params in @utils.setVariables reference defined mutable variables',
    deps: { entry: each(setVariablesEntriesKey), typeMap: typeMapKey },

    run({ entry, typeMap }) {
      const { statements } = entry;
      if (!statements) return;

      const variableNames = [...typeMap.variables.keys()];

      for (const stmt of statements) {
        if (stmt.__kind !== 'WithClause') continue;
        const param = stmt.param as string;
        if (!param) continue;

        const cst = stmt.__cst as CstMeta | undefined;
        if (!cst) continue;

        const paramCstNode = (stmt as { __paramCstNode?: SyntaxNode })
          .__paramCstNode;
        const range = paramCstNode ? toRange(paramCstNode) : cst.range;

        const varInfo = typeMap.variables.get(param);
        if (!varInfo) {
          const suggestion = findSuggestion(param, variableNames);
          const msg = `'${param}' is not a defined variable. @utils.setVariables can only assign to declared variables.`;
          attachDiagnostic(
            stmt,
            lintDiagnostic(
              range,
              msg,
              DiagnosticSeverity.Error,
              'set-variables-unknown-variable',
              { suggestion }
            )
          );
          continue;
        }

        if (varInfo.modifier !== 'mutable') {
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
