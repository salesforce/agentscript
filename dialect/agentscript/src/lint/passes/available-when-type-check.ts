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
  extractVariableRef,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { reasoningActionsKey } from './reasoning-actions.js';
import { typeMapKey } from './type-map.js';
import type { TypeMap } from './type-map.js';

/**
 * Infer whether a condition expression is boolean, a non-boolean type,
 * a reference, or unknown.
 *
 * Returns:
 * - 'boolean' for expressions that are inherently boolean
 * - 'string' | 'number' | 'none' | 'list' | 'dict' | 'template' for non-boolean literals
 * - 'reference' for references we can't type-check
 * - null when the type can't be determined (skip check)
 */
function classifyCondition(expr: unknown, typeMap: TypeMap): string | null {
  if (!expr || typeof expr !== 'object') return null;
  const obj = expr as Record<string, unknown>;

  switch (obj.__kind) {
    // Inherently boolean
    case 'BooleanLiteral':
    case 'ComparisonExpression':
      return 'boolean';

    // Logical operators produce boolean
    case 'BinaryExpression': {
      const op = obj.operator as string;
      if (op === 'and' || op === 'or') return 'boolean';
      // Arithmetic operators (+, -, *, /) produce non-boolean
      return 'number';
    }

    case 'UnaryExpression': {
      const op = obj.operator as string;
      if (op === 'not') return 'boolean';
      // Unary +/- produce numbers
      return 'number';
    }

    // Non-boolean literals
    case 'StringLiteral':
      return 'string';
    case 'TemplateExpression':
      return 'template';
    case 'NumberLiteral':
      return 'number';
    case 'NoneLiteral':
      return 'none';
    case 'ListLiteral':
      return 'list';
    case 'DictLiteral':
      return 'dict';

    // References: check type map if possible
    case 'MemberExpression':
    case 'AtIdentifier': {
      const varName = extractVariableRef(expr);
      if (varName) {
        const varInfo = typeMap.variables.get(varName);
        if (varInfo) {
          return varInfo.type.toLowerCase() === 'boolean'
            ? 'boolean'
            : varInfo.type;
        }
      }
      // Reference we can't resolve — allow it
      return 'reference';
    }

    // Call expressions (e.g. len()) — can't infer return type
    case 'CallExpression':
      return null;

    // Ternary — can't easily infer, skip
    case 'TernaryExpression':
      return null;

    default:
      return null;
  }
}

/** Readable label for the classified type. */
function typeLabel(type: string): string {
  switch (type) {
    case 'string':
      return 'a string';
    case 'template':
      return 'a template string';
    case 'number':
      return 'a number';
    case 'none':
      return 'None';
    case 'list':
      return 'a list';
    case 'dict':
      return 'a dictionary';
    default:
      return `'${type}'`;
  }
}

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

      for (const stmt of statements) {
        if (stmt.__kind !== 'AvailableWhen') continue;

        const condition = stmt.condition;
        if (!condition) continue;

        const conditionType = classifyCondition(condition, typeMap);

        // Skip if type is unknown, boolean, or an unresolvable reference
        if (
          conditionType === null ||
          conditionType === 'boolean' ||
          conditionType === 'reference'
        ) {
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
            `'available when' condition should be a boolean expression or reference, but found ${typeLabel(conditionType)}`,
            DiagnosticSeverity.Warning,
            'available-when-non-boolean'
          )
        );
      }
    },
  });
}
