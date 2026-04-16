/**
 * Validates that connected agent input bindings are simple variable references.
 *
 * Default values on connected agent inputs (e.g. `foo: string = @variables.bar`)
 * must be a bare `@variables.X` reference to a linked or mutable variable — no
 * computed expressions. This allows both context variables (linked) and agent
 * state variables (mutable) to be passed to connected agents.
 *
 * The core check (`isSimpleVariableReference`) is intentionally reusable for
 * future tool-call `with` clause validation.
 *
 * Diagnostics: bound-input-not-variable, bound-input-not-linked-or-mutable
 */

import type { AstNodeLike } from '@agentscript/language';
import type { LintPass } from '@agentscript/language';
import {
  decomposeAtMemberExpression,
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
  if (!expr || typeof expr !== 'object') return undefined;
  const node = expr as AstNodeLike;
  if (node.__kind !== 'MemberExpression') return undefined;
  const ref = decomposeAtMemberExpression(expr);
  if (!ref || ref.namespace !== 'variables') return undefined;
  return ref.property;
}

export function boundInputsRule(): LintPass {
  return defineRule({
    id: 'connected-agent/bound-inputs',
    description:
      'Connected agent input bindings must be simple linked or mutable variable references',
    deps: { typeMap: typeMapKey },

    run({ typeMap }) {
      for (const [, agentInfo] of typeMap.connectedAgents) {
        for (const [, inputInfo] of agentInfo.inputs) {
          if (!inputInfo.defaultValueNode || !inputInfo.defaultValueCst)
            continue;

          const varName = isSimpleVariableReference(inputInfo.defaultValueNode);
          if (!varName) {
            attachDiagnostic(
              inputInfo.decl,
              lintDiagnostic(
                inputInfo.defaultValueCst.range,
                `Bound input must be a simple variable reference (e.g. @variables.X).`,
                DiagnosticSeverity.Error,
                'bound-input-not-variable'
              )
            );
            continue;
          }

          const varInfo = typeMap.variables.get(varName);
          if (varInfo && varInfo.modifier !== 'linked' && varInfo.modifier !== 'mutable') {
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
