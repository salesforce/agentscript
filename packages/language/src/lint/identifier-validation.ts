/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import { storeKey, type LintPass } from '../core/analysis/lint-engine.js';
import type { AstNodeLike } from '../core/types.js';
import type { ScopeContext } from '../core/analysis/scope.js';
import { Identifier, CallExpression } from '../core/expressions.js';
import { lintDiagnostic } from './lint-utils.js';

/**
 * Validates bare identifiers used as expression *values*.
 *
 * AgentScript has no loops, comprehensions, enums, or local/loop variable
 * bindings, so a bare identifier is only meaningful in two positions:
 *   1. the callee of a call expression (e.g. `len(...)`) — validated separately
 *      by the expression-validation pass against the known-function set; and
 *   2. the property of a member expression (`x.prop`), which is stored as a
 *      string field and never visited as an expression.
 *
 * Any other standalone bare identifier resolves to nothing at runtime — most
 * commonly a lowercase `none`/`true`/`false`/`null` that the author meant as a
 * literal, or an arbitrary word like `abcd`. This pass flags those with a
 * message steering toward the correct literal or an `@variables.X` reference.
 *
 * Diagnostics: identifier-confusable-none, identifier-confusable-boolean,
 * null-not-allowed, unknown-identifier
 */
class IdentifierValidationPass implements LintPass {
  readonly id = storeKey('identifier-validation');
  readonly description =
    'Rejects bare identifiers used as expression values (e.g. `none`, `abcd`)';

  private ancestorStack: unknown[] = [];

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
    if (!(expr instanceof Identifier)) return;

    // Skip the callee of a call expression — `len`/`max`/`min` and any
    // dialect-registered functions are validated by expression-validation.
    const parent = this.ancestorStack[this.ancestorStack.length - 2];
    if (parent instanceof CallExpression && parent.func === expr) return;

    const cst = expr.__cst;
    if (!cst) return;

    const { message, code } = describeIdentifier(expr.name);

    attachDiagnostic(
      expr,
      lintDiagnostic(cst.range, message, DiagnosticSeverity.Error, code)
    );
  }
}

function describeIdentifier(name: string): { message: string; code: string } {
  switch (name.toLowerCase()) {
    case 'none':
      return {
        message: `'${name}' is not a valid value in AgentScript. Did you mean 'None' (capitalized) for an empty value?`,
        code: 'identifier-confusable-none',
      };
    case 'true':
    case 'false': {
      const capitalized = name[0].toUpperCase() + name.slice(1).toLowerCase();
      return {
        message: `'${name}' is not a valid value in AgentScript. Did you mean '${capitalized}' (capitalized)?`,
        code: 'identifier-confusable-boolean',
      };
    }
    case 'null':
      return {
        message: `'null' is not a valid value in AgentScript. Use 'None' for an empty value or '""' for an empty string.`,
        code: 'null-not-allowed',
      };
    default:
      return {
        message: `'${name}' is not a defined value. Bare identifiers are not allowed here; use a literal ("...", a number, True/False/None) or an @variables.X reference.`,
        code: 'unknown-identifier',
      };
  }
}

export function identifierValidationPass(): LintPass {
  return new IdentifierValidationPass();
}
