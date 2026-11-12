/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that flags a workflow transitioning to itself.
 *
 * A `transition to @workflow.<name>` inside workflow `<name>` hands control back
 * to the workflow that is already running, so it restarts from its first step
 * and can loop indefinitely.
 *
 * Diagnostic: workflow-self-transition (warning).
 */

import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
  isAstNodeLike,
  recurseAstChildren,
  decomposeAtMemberExpression,
  ToClause,
  TransitionStatement,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

class WorkflowSelfTransitionPass implements LintPass {
  readonly id = storeKey('workflow-self-transition');
  readonly description =
    'Warns when a workflow transitions to itself, which can loop indefinitely';

  run(_store: PassStore, root: AstRoot): void {
    const workflows = root.workflow;
    if (!isNamedMap(workflows)) return;

    for (const [name, workflow] of workflows) {
      this.checkTransitions(workflow, name);
    }
  }

  private checkTransitions(node: unknown, workflowName: string): void {
    if (node instanceof TransitionStatement) {
      this.checkTransition(node, workflowName);
      return;
    }
    recurseAstChildren(node, (_key, child) =>
      this.checkTransitions(child, workflowName)
    );
  }

  private checkTransition(
    stmt: TransitionStatement,
    workflowName: string
  ): void {
    for (const clause of stmt.clauses) {
      if (!(clause instanceof ToClause)) continue;
      const target = decomposeAtMemberExpression(clause.target);
      if (target?.namespace !== 'workflow' || target.property !== workflowName)
        continue;
      const range = clause.target.__cst?.range;
      if (!range || !isAstNodeLike(stmt)) continue;
      attachDiagnostic(
        stmt,
        lintDiagnostic(
          range,
          `Workflow '${workflowName}' transitions to itself, which can cause an infinite loop.`,
          DiagnosticSeverity.Warning,
          'workflow-self-transition'
        )
      );
    }
  }
}

export function workflowSelfTransitionRule(): LintPass {
  return new WorkflowSelfTransitionPass();
}
