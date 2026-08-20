/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike } from '../core/types.js';
import { attachDiagnostic, DiagnosticSeverity } from '../core/diagnostics.js';
import { type LintPass, storeKey } from '../core/analysis/lint-engine.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import {
  AtIdentifier,
  BinaryExpression,
  CallExpression,
  Identifier,
  MemberExpression,
  SliceExpression,
  StringLiteral,
  SubscriptExpression,
} from '../core/expressions.js';
import {
  findSuggestion,
  formatSuggestionHint,
  lintDiagnostic,
} from './lint-utils.js';
import {
  BUILTIN_CATALOG,
  catalogFromNames,
  type FunctionCatalog,
  type FunctionDefinition,
} from './function-catalog.js';

/**
 * Default set of built-in function names recognized by the AgentScript runtime.
 * Derived from {@link BUILTIN_CATALOG} so the name list and the catalog can
 * never drift. Dialects can replace the recognized functions entirely via
 * {@link ExpressionValidationOptions.functions} or {@link ExpressionValidationOptions.catalog}.
 */
export const BUILTIN_FUNCTIONS: ReadonlySet<string> = new Set(
  BUILTIN_CATALOG.keys()
);

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
  /**
   * Complete function catalog (name → arity + validators). Takes precedence
   * over {@link functions}. Defaults to {@link BUILTIN_CATALOG}.
   */
  catalog?: FunctionCatalog;
  /**
   * Complete set of allowed function names. Convenience for dialects that only
   * need name recognition (no arity/validators) — wrapped into a name-only
   * catalog. Ignored when {@link catalog} is provided.
   */
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

  private readonly catalog: FunctionCatalog;
  private readonly namespacedFunctions: Record<string, ReadonlySet<string>>;
  private readonly allowedFunctionsList: string[];
  private readonly supportedOperators: ReadonlySet<string>;
  private ancestorStack: unknown[] = [];

  constructor(options: ExpressionValidationOptions = {}) {
    this.catalog =
      options.catalog ??
      (options.functions
        ? catalogFromNames(options.functions)
        : BUILTIN_CATALOG);
    this.namespacedFunctions = options.namespacedFunctions ?? {};
    this.supportedOperators =
      options.supportedOperators ?? DEFAULT_SUPPORTED_OPERATORS;
    this.allowedFunctionsList = [...this.catalog.keys()];
  }

  init(): void {
    this.ancestorStack = [];
  }

  enterNode(_key: string, value: unknown): void {
    this.ancestorStack.push(value);
  }

  exitNode(): void {
    this.ancestorStack.pop();
  }

  visitExpression(expr: AstNodeLike, _ctx: ScopeContext): void {
    if (expr instanceof CallExpression) {
      this.checkCallExpression(expr);
    } else if (expr instanceof BinaryExpression) {
      this.checkBinaryExpression(expr);
    } else if (expr instanceof SubscriptExpression) {
      this.checkSubscriptExpression(expr);
    } else if (expr instanceof MemberExpression) {
      this.checkMemberExpression(expr);
    }
  }

  /**
   * Both `@system_variables.uploaded_files` (MemberExpression) and
   * `@system_variables["uploaded_files"]` (SubscriptExpression with a string
   * index) resolve to the same raw list at compile time. Flag both when the
   * result isn't consumed by a subscript or `len()`.
   */
  private checkBareUploadedFilesReference(expr: AstNodeLike): void {
    const parent = this.ancestorStack[this.ancestorStack.length - 2];
    if (isUploadedFilesConsumer(parent, expr)) return;

    const cst = expr.__cst;
    if (!cst) return;
    attachDiagnostic(
      expr,
      lintDiagnostic(
        cst.range,
        '@system_variables.uploaded_files is a list; index it with [N], slice it with [a:b], or wrap in len() — a bare reference renders as a raw list at runtime',
        DiagnosticSeverity.Error,
        'bare-uploaded-files-reference'
      )
    );
  }

  private checkMemberExpression(expr: MemberExpression): void {
    if (
      !(expr.object instanceof AtIdentifier) ||
      expr.object.name !== 'system_variables' ||
      expr.property !== 'uploaded_files'
    ) {
      return;
    }
    // The current node was pushed onto `ancestorStack` by enterNode() before
    // this visitor fires, so the syntactic parent lives at length - 2.
    this.checkBareUploadedFilesReference(expr as unknown as AstNodeLike);
  }

  private checkSubscriptExpression(expr: AstNodeLike): void {
    if (!(expr instanceof SubscriptExpression)) return;

    // `@system_variables["uploaded_files"]` — same list as the dot form, so
    // apply the same bare-reference gate.
    if (
      expr.object instanceof AtIdentifier &&
      expr.object.name === 'system_variables' &&
      expr.index instanceof StringLiteral &&
      expr.index.value === 'uploaded_files'
    ) {
      this.checkBareUploadedFilesReference(expr);
      return;
    }

    if (!(expr.index instanceof SliceExpression)) return;
    if (
      !(expr.object instanceof AtIdentifier) ||
      expr.object.name !== 'system_variables'
    ) {
      return;
    }
    const cst = expr.__cst;
    if (!cst) return;
    attachDiagnostic(
      expr,
      lintDiagnostic(
        cst.range,
        'Slices are not supported on @system_variables (use @system_variables.uploaded_files[…] for slicing uploaded files)',
        DiagnosticSeverity.Error,
        'unsupported-slice-target'
      )
    );
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
      this.validateIdentifier(func, expr);
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

  private validateIdentifier(func: Identifier, expr: AstNodeLike) {
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
      return;
    }

    const sig = this.catalog.get(funcName);
    if (!sig) {
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
      return;
    }

    // The call expression is the node currently being visited.
    const call = expr as unknown as CallExpression;
    const args = call.args ?? [];

    // Generic arity check driven by the catalog signature.
    const arityMessage = arityViolationMessage(funcName, sig, args.length);
    if (arityMessage) {
      attachDiagnostic(
        expr,
        lintDiagnostic(
          cst.range,
          arityMessage,
          DiagnosticSeverity.Error,
          'function-argument-count'
        )
      );
      return;
    }

    const findings = sig.validators?.flatMap(validate => validate(args)) ?? [];
    for (const finding of findings) {
      attachDiagnostic(
        expr,
        lintDiagnostic(
          finding.range,
          finding.message,
          finding.severity,
          finding.code,
          finding.suggestion ? { suggestion: finding.suggestion } : undefined
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

/**
 * True when `parent` is a syntactic context that consumes the uploaded-files
 * list in a well-defined way — i.e. a subscript whose `.object` is the list
 * (`uploaded_files[…]`) or a `len(...)` call with the list as its argument.
 * Applies to both the dot form (`@system_variables.uploaded_files`) and the
 * bracket form (`@system_variables["uploaded_files"]`).
 */
function isUploadedFilesConsumer(parent: unknown, expr: AstNodeLike): boolean {
  if (
    parent instanceof SubscriptExpression &&
    (parent.object as unknown) === expr
  ) {
    return true;
  }
  if (parent instanceof CallExpression) {
    const func = parent.func;
    if (func instanceof Identifier && func.name === 'len') {
      return true;
    }
  }
  return false;
}

/**
 * Return a human-readable arity-violation message, or null if the argument
 * count is within the signature's bounds. Name-only catalog entries
 * (`minArgs: 0, maxArgs: null`) never violate, so pass-through dialects are
 * unaffected.
 */
function arityViolationMessage(
  functionName: string,
  definition: FunctionDefinition,
  actual: number
): string | null {
  const { minArgs, maxArgs } = definition;
  const plural = (n: number) => (n === 1 ? 'argument' : 'arguments');

  if (maxArgs !== null && minArgs === maxArgs) {
    if (actual === minArgs) return null;
    return `'${functionName}' expects exactly ${minArgs} ${plural(minArgs)} but received ${actual}`;
  }
  if (actual < minArgs) {
    if (maxArgs === null) {
      return `'${functionName}' expects at least ${minArgs} ${plural(minArgs)} but received ${actual}`;
    }
    return `'${functionName}' expects ${minArgs} to ${maxArgs} arguments but received ${actual}`;
  }
  if (maxArgs !== null && actual > maxArgs) {
    return `'${functionName}' expects ${minArgs} to ${maxArgs} arguments but received ${actual}`;
  }
  return null;
}

export function expressionValidationPass(
  options?: ExpressionValidationOptions
): LintPass {
  return new ExpressionValidationPass(options);
}
