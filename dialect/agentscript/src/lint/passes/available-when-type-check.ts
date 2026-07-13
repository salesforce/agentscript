/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Validates that `available when` conditions resolve to boolean expressions
 * or references. Non-boolean literals (strings, numbers, None, lists, dicts)
 * are flagged as errors.
 *
 * Diagnostic: available-when-non-boolean (Warning severity)
 */

import type { LintPass } from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import {
  defineRule,
  each,
  attachDiagnostic,
  lintDiagnostic,
  inferExpressionType,
  inferredTypeLabel,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { reasoningActionsKey } from './reasoning-actions.js';
import { typeMapKey } from './type-map.js';

export function availableWhenTypeCheckRule(): LintPass {
  return defineRule({
    id: 'available-when-type-check',
    description:
      'Validates that available when conditions are boolean expressions or references',
    deps: {
      typeMap: typeMapKey,
      entry: each(reasoningActionsKey),
    },

    run({ typeMap, entry }) {
      const { statements } = entry;
      if (!statements) return;

      const resolveVar = (name: string) =>
        typeMap.variables.get(name)?.type ?? null;

      for (const stmt of statements) {
        if (stmt.__kind !== 'AvailableWhen') continue;

        const condition = stmt.condition;
        if (!condition) continue;

        const conditionType = inferExpressionType(condition, resolveVar);

        // Skip if type is unknown (null) or boolean. Unresolved references,
        // function calls, ternaries, list/dict literals, and None all return
        // null and are treated as "can't determine, allow it".
        if (conditionType === null || conditionType === 'boolean') {
          continue;
        }

        const cst = (condition as Record<string, unknown>).__cst as
          | CstMeta
          | undefined;
        if (!cst) continue;

        attachDiagnostic(
          stmt,
          lintDiagnostic(
            cst.range,
            `'available when' condition should be a boolean expression or reference, but found ${inferredTypeLabel(conditionType)}`,
            DiagnosticSeverity.Warning,
            'available-when-non-boolean'
          )
        );
      }
    },
  });
}
