/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike } from '../core/types.js';
import { attachDiagnostic, DiagnosticSeverity } from '../core/diagnostics.js';
import { type LintPass, storeKey } from '../core/analysis/lint.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import {
  BinaryExpression,
  CallExpression,
  Identifier,
  MemberExpression,
} from '../core/expressions.js';
import {
  findSuggestion,
  formatSuggestionHint,
  lintDiagnostic,
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
  /** Map from namespace name to the set of function names allowed under that namespace (e.g. `{ a2a: new Set(['task', 'message']) }`). Defaults to empty object. */
  namespacedFunctions?: Record<string, ReadonlySet<string>>;
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
  private readonly namespacedFunctions: Record<string, ReadonlySet<string>>;
  private readonly allowedFunctionsList: string[];
  private readonly supportedOperators: ReadonlySet<string>;

  constructor(options: ExpressionValidationOptions = {}) {
    this.allowedFunctions = options.functions ?? BUILTIN_FUNCTIONS;
    this.namespacedFunctions = options.namespacedFunctions ?? {};
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

    if (func instanceof MemberExpression) {
      const namespaceExpression = func.object;
      if (namespaceExpression instanceof Identifier) {
        const namespaceName = namespaceExpression.name;
        const allowedInNamespace =
          this.namespacedFunctions[namespaceName] ?? new Set<string>();
        if (!(namespaceName in this.namespacedFunctions)) {
          // Unknown namespace – report the namespace identifier as unrecognized
          const knownNamespaces = Object.keys(this.namespacedFunctions);
          const suggestion = findSuggestion(namespaceName, knownNamespaces);
          const base = `'${namespaceName}' is not a recognized function. Available functions: ${[...this.allowedFunctionsList, ...knownNamespaces].join(', ')}`;
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
        } else if (!allowedInNamespace.has(func.property)) {
          // Known namespace but unknown function within it
          const allowedList = [...allowedInNamespace];
          const suggestion = findSuggestion(func.property, allowedList);
          const base = `'${func.property}' is not a recognized function in namespace '${namespaceName}'. Available functions: ${allowedList.join(', ')}`;
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
      } else {
        const allNamespacedFns = Object.entries(
          this.namespacedFunctions
        ).flatMap(([ns, fns]) => [...fns].map(f => `${ns}.${f}`));
        attachDiagnostic(
          expr,
          lintDiagnostic(
            cst.range,
            `Namespace function calls are not permitted. Only direct namespace function calls are allowed (${allNamespacedFns.join(', ')})`,
            DiagnosticSeverity.Error,
            'namespace-function-call'
          )
        );
      }
    } else if (func instanceof Identifier) {
      this.validateIdentifier(
        func,
        expr,
        this.allowedFunctions,
        this.allowedFunctionsList
      );
    } else {
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
  }

  private validateIdentifier(
    func: Identifier,
    expr: AstNodeLike,
    allowedFunctions: ReadonlySet<string>,
    allowedFunctionList: string[]
  ) {
    const cst = expr.__cst;
    if (!cst) return;

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
    } else if (!allowedFunctions.has(funcName)) {
      const suggestion = findSuggestion(funcName, allowedFunctionList);
      const base = `'${funcName}' is not a recognized function. Available functions: ${allowedFunctionList.join(', ')}`;
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
