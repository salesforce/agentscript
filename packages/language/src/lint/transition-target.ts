/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot } from '../core/types.js';
import { isAstNodeLike } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint-engine.js';
import { lintDiagnostic } from './lint-utils.js';
import { TransitionStatement, ToClause } from '../core/statements.js';
import { toRange } from '@agentscript/types';

const MISSING_TARGET_MESSAGE =
  "'transition' requires a target. Use 'transition to <target>'.";

const MULTIPLE_TARGETS_MESSAGE =
  "'transition' accepts a single 'to' target. " +
  "Multiple 'to' clauses are not allowed.";

class TransitionTargetPass implements LintPass {
  readonly id = storeKey('transition-target');
  readonly description =
    "Validates that 'transition' statements have exactly one 'to <target>' clause.";

  private transitions: TransitionStatement[] = [];

  init(): void {
    this.transitions = [];
  }

  enterNode(_key: string, value: unknown, _parent: unknown): void {
    if (
      isAstNodeLike(value) &&
      value.__kind === 'TransitionStatement' &&
      value instanceof TransitionStatement
    ) {
      this.transitions.push(value);
    }
  }

  run(_store: PassStore, _root: AstRoot): void {
    for (const stmt of this.transitions) {
      const toClauses = stmt.clauses.filter(c => c instanceof ToClause);
      const range = stmt.__cst?.range;
      if (!range) continue;
      // Type narrowing for attachDiagnostic; runtime guaranteed by enterNode.
      if (!isAstNodeLike(stmt)) continue;

      if (toClauses.length === 0) {
        // Highlight just the `transition` keyword token (first child of the
        // CST node), not the whole statement — keeps the squiggle pointed
        // at the actual problem.
        const keywordNode = stmt.__cst?.node?.children?.[0];
        const keywordRange = keywordNode ? toRange(keywordNode) : range;
        attachDiagnostic(
          stmt,
          lintDiagnostic(
            keywordRange,
            MISSING_TARGET_MESSAGE,
            DiagnosticSeverity.Error,
            'transition-missing-target'
          )
        );
      } else if (toClauses.length > 1) {
        // Flag every extra `to` clause (keep the first as the intended one).
        for (let i = 1; i < toClauses.length; i++) {
          const extra = toClauses[i];
          const extraRange = extra.__cst?.range ?? range;
          attachDiagnostic(
            stmt,
            lintDiagnostic(
              extraRange,
              MULTIPLE_TARGETS_MESSAGE,
              DiagnosticSeverity.Error,
              'transition-multiple-targets'
            )
          );
        }
      }
    }
  }
}

export function transitionTargetPass(): LintPass {
  return new TransitionTargetPass();
}
