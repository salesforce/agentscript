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
import { Identifier } from '../core/expressions.js';
import { lintDiagnostic } from './lint-utils.js';

class NullLiteralValidationPass implements LintPass {
  readonly id = storeKey('null-literal-validation');
  readonly description =
    'Rejects null used as an identifier value in expressions';

  visitExpression(expr: AstNodeLike, _ctx: ScopeContext): void {
    if (!(expr instanceof Identifier)) return;
    if (expr.name.toLowerCase() !== 'null') return;

    const cst = expr.__cst;
    if (!cst) return;

    attachDiagnostic(
      expr,
      lintDiagnostic(
        cst.range,
        `'null' is not a valid value in AgentScript. Use 'None' for an empty value or '""' for an empty string.`,
        DiagnosticSeverity.Error,
        'null-not-allowed'
      )
    );
  }
}

export function nullLiteralValidationPass(): LintPass {
  return new NullLiteralValidationPass();
}
