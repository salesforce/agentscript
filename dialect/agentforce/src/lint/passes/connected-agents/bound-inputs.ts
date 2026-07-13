/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Validates that connected agent input bindings are simple variable references
 * or literal values.
 *
 * Every input on a connected agent block must have a default value (be bound).
 * The default value must be either:
 *   - a bare `@variables.X` reference to a linked or mutable variable, or
 *   - a literal value (string, number, boolean, or None).
 * Computed expressions (e.g. `@variables.X + 1`) are not allowed.
 *
 * The core check (`isSimpleVariableReference`) is intentionally reusable for
 * future tool-call `with` clause validation.
 *
 * Diagnostics: bound-input-required, bound-input-not-variable, bound-input-not-linked-or-mutable
 */

import type { LintPass } from '@agentscript/language';
import {
  decomposeAtMemberExpression,
  isAstNodeLike,
  attachDiagnostic,
  lintDiagnostic,
  defineRule,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from '@agentscript/agentscript-dialect';

/**
 * Check whether an expression is a simple `@variables.X` member reference.
 * Returns the variable name if valid, or undefined if the expression is
 * anything else (computed, literal, wrong namespace, etc.).
 */
export function isSimpleVariableReference(expr: unknown): string | undefined {
  if (!isAstNodeLike(expr)) return undefined;
  if (expr.__kind !== 'MemberExpression') return undefined;
  const ref = decomposeAtMemberExpression(expr);
  if (!ref || ref.namespace !== 'variables') return undefined;
  return ref.property;
}

/** Literal expression kinds accepted as connected-agent input defaults. */
const LITERAL_KINDS = new Set([
  'StringLiteral',
  'NumberLiteral',
  'BooleanLiteral',
  'NoneLiteral',
]);

/**
 * Check whether an expression is a literal value (string, number, boolean, or
 * None) that can be used directly as a bound input default.
 */
export function isLiteralValue(expr: unknown): boolean {
  if (!isAstNodeLike(expr)) return false;
  return typeof expr.__kind === 'string' && LITERAL_KINDS.has(expr.__kind);
}

export function boundInputsRule(): LintPass {
  return defineRule({
    id: 'connected-agent/bound-inputs',
    description:
      'Connected agent inputs must be bound to linked or mutable variables',
    deps: { typeMap: typeMapKey },

    run({ typeMap }) {
      for (const [, agentInfo] of typeMap.connectedAgents) {
        for (const [inputName, inputInfo] of agentInfo.inputs) {
          // Check if input has a default value (is bound)
          if (!inputInfo.defaultValueNode || !inputInfo.defaultValueCst) {
            const declCst = (inputInfo.decl as any).__cst;
            const range = declCst?.range ?? {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            };

            attachDiagnostic(
              inputInfo.decl,
              lintDiagnostic(
                range,
                `Input '${inputName}' must be bound to a variable (e.g. ${inputName}: string = @variables.X).`,
                DiagnosticSeverity.Error,
                'bound-input-required'
              )
            );
            continue;
          }

          // Literal defaults (e.g. "test", 42, True) are passed through as-is.
          if (isLiteralValue(inputInfo.defaultValueNode)) {
            continue;
          }

          const varName = isSimpleVariableReference(inputInfo.defaultValueNode);
          if (!varName) {
            attachDiagnostic(
              inputInfo.decl,
              lintDiagnostic(
                inputInfo.defaultValueCst.range,
                `Bound input must be a simple variable reference (e.g. @variables.X) or a literal value.`,
                DiagnosticSeverity.Error,
                'bound-input-not-variable'
              )
            );
            continue;
          }

          const varInfo = typeMap.variables.get(varName);
          if (
            varInfo &&
            varInfo.modifier !== 'linked' &&
            varInfo.modifier !== 'mutable'
          ) {
            attachDiagnostic(
              inputInfo.decl,
              lintDiagnostic(
                inputInfo.defaultValueCst.range,
                `Bound input must reference a linked or mutable variable — '${varName}' is ${varInfo.modifier ?? 'unmodified'}.`,
                DiagnosticSeverity.Error,
                'bound-input-not-linked-or-mutable'
              )
            );
          }
        }
      }
    },
  });
}
