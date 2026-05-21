/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import { storeKey, type LintPass } from '../core/analysis/lint-engine.js';
import type { AstNodeLike } from '../core/types.js';
import {
  CallExpression,
  SpreadExpression,
  ListLiteral,
} from '../core/expressions.js';
import { lintDiagnostic } from './lint-utils.js';

/**
 * Flags SpreadExpression (`*expr`) in positions where it has no valid
 * semantic meaning. Spread is only permitted as a call argument or as a
 * list-literal element; anywhere else would produce invalid Python downstream.
 */
class SpreadContextPass implements LintPass {
  readonly id = storeKey('spread-context');
  readonly description =
    'Rejects spread expressions outside call arguments or list literals';

  enterNode(key: string, value: unknown, parent: unknown): void {
    if (!(value instanceof SpreadExpression)) return;

    if (parent instanceof CallExpression && key !== 'func') return;
    if (parent instanceof ListLiteral) return;

    const cst = value.__cst;
    if (!cst) return;

    attachDiagnostic(
      value as unknown as AstNodeLike,
      lintDiagnostic(
        cst.range,
        'Spread expression is only allowed as a call argument or list element',
        DiagnosticSeverity.Error,
        'invalid-spread-context'
      )
    );
  }
}

export function spreadContextPass(): LintPass {
  return new SpreadContextPass();
}
