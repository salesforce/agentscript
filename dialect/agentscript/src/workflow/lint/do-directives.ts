/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  attachDiagnostic,
  decomposeAtMemberChain,
  decomposeAtMemberExpression,
  isAstNodeLike,
  isIfStatement,
  isTemplate,
  isTemplateInterpolation,
  lintDiagnostic,
  walkAstExpressions,
} from '@agentscript/language';

import type { AstNodeLike, Template } from '@agentscript/language';
import type { Range } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import {
  reportTopLevelWorkflowAction,
  resolveWorkflowAction,
} from './action-inputs.js';
import { workflowStepBodies } from './steps-structure.js';

/** Longest instruction text, in characters, that one `do` directive can hold. */
export const WORKFLOW_DO_MAX_LENGTH = 1000;

/** The namespaces that a `{! }` in a `do` directive can refer to. */
const WORKFLOW_DO_NAMESPACES: ReadonlySet<string> = new Set([
  'variables',
  'actions',
  'system_variables',
  'knowledge',
]);

/** A `{! }` reference that a `do` directive cannot use. */
export interface WorkflowDoReferenceError {
  message: string;
  range: Range | undefined;
}

/**
 * Find the first reference in a `{! }` expression that a `do` directive cannot
 * use. All parts of the expression are checked. A `{!@actions.X}` must be the
 * whole expression, because only then does it become a tool. The compiler
 * uses the same messages, so the lint and compile diagnostics merge.
 */
export function workflowDoReferenceError(
  expression: unknown
): WorkflowDoReferenceError | undefined {
  if (decomposeAtMemberExpression(expression)?.namespace === 'actions') {
    return undefined;
  }
  let error: WorkflowDoReferenceError | undefined;
  walkAstExpressions(expression, node => {
    const chain = decomposeAtMemberChain(node);
    if (error || !chain) return;
    const reference = `@${[chain.namespace, ...chain.path].join('.')}`;
    const range = node.__cst?.range;
    if (chain.namespace === 'actions') {
      error = {
        message: `'${reference}' must be the entire '{! }' expression.`,
        range,
      };
    } else if (!WORKFLOW_DO_NAMESPACES.has(chain.namespace)) {
      error = {
        message: `'${reference}' is not supported in a workflow '|' line. Use @variables, @system_variables, @knowledge, or @actions.`,
        range,
      };
    }
  });
  return error;
}

/**
 * Validate the `do` directives of a workflow: each one must fit in
 * {@link WORKFLOW_DO_MAX_LENGTH}, each `{!@actions.X}` must name an
 * action of the workflow itself, and each `{! }` must use a supported
 * namespace.
 */
export function validateWorkflowDoDirectives(
  workflow: AstNodeLike,
  topLevelActions: unknown
): void {
  const visit = (statements: unknown): void => {
    if (!Array.isArray(statements)) return;
    for (const stmt of statements.filter(isAstNodeLike)) {
      if (isTemplate(stmt)) {
        validateDoLength(stmt);
        validateDoActions(stmt, workflow, topLevelActions);
      } else if (isIfStatement(stmt)) {
        visit(stmt.body);
        visit(stmt.orelse);
      }
    }
  };
  for (const statements of workflowStepBodies(workflow)) visit(statements);
}

function validateDoLength(template: AstNodeLike & Template): void {
  const length = template.content.trim().length;
  const range = template.__cst?.range;
  if (length <= WORKFLOW_DO_MAX_LENGTH || !range) return;

  attachDiagnostic(
    template,
    lintDiagnostic(
      range,
      `This '|' line and its continuation lines have ${length} characters of instructions. The maximum is ${WORKFLOW_DO_MAX_LENGTH}.`,
      DiagnosticSeverity.Error,
      'workflow-do-too-long'
    )
  );
}

function validateDoActions(
  template: AstNodeLike & Template,
  workflow: AstNodeLike,
  topLevelActions: unknown
): void {
  for (const part of template.parts) {
    if (!isAstNodeLike(part) || !isTemplateInterpolation(part)) continue;
    const range = part.expression.__cst?.range ?? part.__cst?.range;
    const error = workflowDoReferenceError(part.expression);
    const errorRange = error?.range ?? range;
    if (error && errorRange) {
      attachDiagnostic(
        part,
        lintDiagnostic(
          errorRange,
          error.message,
          DiagnosticSeverity.Error,
          'workflow-do-unsupported-reference'
        )
      );
      continue;
    }
    const ref = decomposeAtMemberExpression(part.expression);
    if (ref?.namespace !== 'actions') continue;
    if (resolveWorkflowAction(workflow, ref.property)) continue;

    reportTopLevelWorkflowAction(
      part,
      range,
      ref.property,
      topLevelActions,
      'do'
    );
  }
}
