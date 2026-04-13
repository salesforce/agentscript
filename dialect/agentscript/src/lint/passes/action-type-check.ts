/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Action type checking — validates type compatibility between `with` clause
 * values and input parameter types, and `set` clause targets and output types.
 *
 * Conservative: skips checks when types can't be resolved.
 * Diagnostic: type-mismatch
 */

import type { LintPass } from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import {
  defineRule,
  each,
  typeMismatchDiagnostic,
  attachDiagnostic,
  LINT_SOURCE,
  extractOutputRef,
  extractVariableRef,
} from '@agentscript/language';
import { reasoningActionsKey } from './reasoning-actions.js';
import { typeMapKey } from './type-map.js';
import type { TypeMap } from './type-map.js';

/**
 * Infer expression type: @variables.X → type map lookup,
 * literals → their type, anything else → null (skip check).
 */
function inferExpressionType(expr: unknown, typeMap: TypeMap): string | null {
  if (!expr || typeof expr !== 'object') return null;
  const obj = expr as Record<string, unknown>;

  const varName = extractVariableRef(expr);
  if (varName) {
    return typeMap.variables.get(varName)?.type ?? null;
  }

  switch (obj.__kind) {
    case 'StringLiteral':
    case 'TemplateExpression':
      return 'string';
    case 'NumberLiteral':
      return 'number';
    case 'BooleanLiteral':
      return 'boolean';
    default:
      return null;
  }
}

/** Case-insensitive type compatibility. "object" is a wildcard. */
function typesCompatible(expected: string, actual: string): boolean {
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();
  if (e === a) return true;
  if (e === 'object' || a === 'object') return true;
  return false;
}

export function actionTypeCheckRule(): LintPass {
  return defineRule({
    id: 'action-type-check',
    description:
      'Validates type compatibility in with/set clauses against action parameter types',
    deps: {
      typeMap: typeMapKey,
      entry: each(reasoningActionsKey),
    },

    run({ typeMap, entry }) {
      const { sig, statements } = entry;
      if (!statements) return;

      for (const stmt of statements) {
        if (stmt.__kind === 'WithClause') {
          const param = stmt.param as string;
          if (!param) continue;

          const inputInfo = sig.inputs.get(param);
          if (!inputInfo) continue;

          const actualType = inferExpressionType(stmt.value, typeMap);
          if (actualType && !typesCompatible(inputInfo.type, actualType)) {
            const cst = stmt.__cst as CstMeta | undefined;
            if (cst) {
              attachDiagnostic(
                stmt,
                typeMismatchDiagnostic(
                  cst.range,
                  `Type mismatch: input '${param}' expects '${inputInfo.type}' but got '${actualType}'`,
                  inputInfo.type,
                  actualType,
                  LINT_SOURCE
                )
              );
            }
          }
        }

        if (stmt.__kind === 'SetClause') {
          const outputRef = extractOutputRef(stmt.value);
          if (!outputRef) continue;

          const outputInfo = sig.outputs.get(outputRef.name);
          if (!outputInfo) continue;

          const targetVarName = extractVariableRef(stmt.target);
          if (!targetVarName) continue;

          const targetType = typeMap.variables.get(targetVarName)?.type;
          if (targetType && !typesCompatible(targetType, outputInfo.type)) {
            const cst = stmt.__cst as CstMeta | undefined;
            if (cst) {
              attachDiagnostic(
                stmt,
                typeMismatchDiagnostic(
                  cst.range,
                  `Type mismatch: output '${outputRef.name}' is '${outputInfo.type}' but target '@variables.${targetVarName}' expects '${targetType}'`,
                  targetType,
                  outputInfo.type,
                  LINT_SOURCE
                )
              );
            }
          }
        }
      }
    },
  });
}
