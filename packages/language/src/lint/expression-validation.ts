/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike } from '../core/types.js';
import { DiagnosticSeverity } from '../core/diagnostics.js';
import { attachDiagnostic } from '../core/diagnostics.js';
import { storeKey, type LintPass } from '../core/analysis/lint.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import {
  CallExpression,
  BinaryExpression,
  Identifier,
} from '../core/expressions.js';
import {
  lintDiagnostic,
  findSuggestion,
  formatSuggestionHint,
} from './lint-utils.js';

/**
 * Default set of built-in functions recognized by the AgentScript runtime.
 * Dialects can replace this entirely via {@link ExpressionValidationOptions.functions}.
 */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set([
  'len',
  'max',
  'min',
]);

/**
 * Default set of supported binary operators.
 * Operators not in this set will produce an "unsupported-operator" diagnostic.
 */
const DEFAULT_SUPPORTED_OPERATORS: ReadonlySet<string> = new Set([
  '+',
  '-',
  '==',
  '!=',
  '<',
  '>',
  '<=',
  '>=',
  'and',
  'or',
  'not',
  'in',
  'not in',
]);

/**
 * Configuration options for the expression validation lint pass.
 * Allows dialects to customise the set of recognized functions and operators.
 * Both options replace the defaults entirely when provided.
 */
export interface ExpressionValidationOptions {
  /** Complete set of allowed function names. Defaults to {@link BUILTIN_FUNCTIONS}. */
  functions?: ReadonlySet<string>;
  /** Complete set of supported binary operators. Defaults to the built-in operator set. */
  supportedOperators?: ReadonlySet<string>;
}

/**
 * Lint pass that validates function calls and operators in expressions.
 *
 * Diagnostics are emitted inline during the expression walk — no cross-node
 * context is required, so there is no deferred phase.
 */
class ExpressionValidationPass implements LintPass {
  readonly id = storeKey('expression-validation');
  readonly description =
    'Validates function calls and operators used in expressions';

  private readonly allowedFunctions: ReadonlySet<string>;
  private readonly allowedFunctionsList: string[];
  private readonly supportedOperators: ReadonlySet<string>;

  constructor(options: ExpressionValidationOptions = {}) {
    this.allowedFunctions = options.functions ?? BUILTIN_FUNCTIONS;
    this.supportedOperators =
      options.supportedOperators ?? DEFAULT_SUPPORTED_OPERATORS;
    this.allowedFunctionsList = [...this.allowedFunctions];
  }

  visitExpression(expr: AstNodeLike, _ctx: ScopeContext): void {
    if (expr instanceof CallExpression) {
      this.checkCallExpression(expr);
    } else if (expr instanceof BinaryExpression) {
      this.checkBinaryExpression(expr);
    }
  }

  private checkCallExpression(expr: AstNodeLike): void {
    const cst = expr.__cst;
    if (!cst) return;

    const func = expr.func;
    if (!func || typeof func !== 'object' || !('__kind' in func)) return;

    // Direct function call (e.g. len(...)) — validate against allowlist
    if (func instanceof Identifier) {
      const funcName = func.name;
      if (funcName.length === 0) {
        // Identifier node missing 'name' — emit a diagnostic so this
        // doesn't silently disappear if the AST shape changes.
        attachDiagnostic(
          expr,
          lintDiagnostic(
            cst.range,
            'Unexpected Identifier node: missing "name" property',
            DiagnosticSeverity.Warning,
            'malformed-ast'
          )
        );
        return;
      }

      if (!this.allowedFunctions.has(funcName)) {
        const suggestion = findSuggestion(funcName, this.allowedFunctionsList);
        const base = `'${funcName}' is not a recognized function. Available functions: ${this.allowedFunctionsList.join(', ')}`;
        const message = formatSuggestionHint(base, suggestion);

        attachDiagnostic(
          expr,
          lintDiagnostic(
            cst.range,
            message,
            DiagnosticSeverity.Error,
            'unknown-function',
            { suggestion }
          )
        );
      }
      return;
    }

    // Indirect / method call (e.g. @variables.items.append(...))
    attachDiagnostic(
      expr,
      lintDiagnostic(
        cst.range,
        `Indirect function calls are not permitted. Only direct calls to built-in functions are allowed (${this.allowedFunctionsList.join(', ')})`,
        DiagnosticSeverity.Error,
        'indirect-function-call'
      )
    );
  }

  private checkBinaryExpression(expr: AstNodeLike): void {
    const op = expr.operator;
    if (typeof op !== 'string') return;

    if (!this.supportedOperators.has(op)) {
      const cst = expr.__cst;
      if (!cst) return;
      attachDiagnostic(
        expr,
        lintDiagnostic(
          cst.range,
          `Operator '${op}' is not supported`,
          DiagnosticSeverity.Error,
          'unsupported-operator'
        )
      );
    }
  }
}

export function expressionValidationPass(
  options?: ExpressionValidationOptions
): LintPass {
  return new ExpressionValidationPass(options);
}
