/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  attachDiagnostic,
  decomposeAtMemberExpression,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
} from '@agentscript/language';

import type { AstNodeLike, Range } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { analyzeActionIo } from '../../lint/passes/action-io.js';
import { extractActionSignature } from '../../lint/passes/type-map.js';
import { workflowStepBodies } from './steps-structure.js';

/**
 * The action definition a workflow's `run @actions.<name>` executes. Workflows
 * only run their own `actions:`; top-level actions are not inherited.
 */
export function resolveWorkflowAction(
  workflow: AstNodeLike,
  name: string
): AstNodeLike | undefined {
  if (!isNamedMap(workflow.actions)) return undefined;
  const action = workflow.actions.get(name);
  return isAstNodeLike(action) ? action : undefined;
}

/**
 * Message for an action reference outside the workflow's own `actions`, from
 * a `run` target or a `{!@actions.X}` in a `do` directive (`|` lines). The
 * compiler uses the same message, so the lint and compile diagnostics merge.
 */
export function workflowUnknownActionMessage(
  name: string,
  source: 'run' | 'do' = 'run'
): string {
  return source === 'run'
    ? `'run' target '${name}' is not an action defined in this workflow's 'actions'. Workflows can only run their own actions.`
    : `'{!@actions.${name}}' in a '|' line refers to '${name}', which is not an action in this workflow's 'actions'. Workflows can only call their own actions.`;
}

/**
 * Report an `@actions.X` reference in a workflow when `X` is a top-level
 * action and not one of the workflow's own. undefined-reference accepts
 * top-level names, so only this check reports them; names defined nowhere
 * are left to undefined-reference. Returns true when it reports.
 */
export function reportTopLevelWorkflowAction(
  node: AstNodeLike,
  range: Range | undefined,
  name: string,
  topLevelActions: unknown,
  source: 'run' | 'do'
): boolean {
  if (!range || !isNamedMap(topLevelActions) || !topLevelActions.has(name)) {
    return false;
  }
  attachDiagnostic(
    node,
    lintDiagnostic(
      range,
      workflowUnknownActionMessage(name, source),
      DiagnosticSeverity.Error,
      'workflow-unknown-action'
    )
  );
  return true;
}

/**
 * Validate the input bindings of every `run @actions.X` in a workflow with the
 * shared `analyzeActionIo` (workflow mode). Workflow actions run without a
 * reasoning loop, so no LLM fills an input the author leaves open.
 */
export function validateWorkflowActionInputs(
  workflow: AstNodeLike,
  topLevelActions: unknown
): void {
  const validate = (run: AstNodeLike) =>
    validateRun(run, workflow, topLevelActions);

  for (const statements of workflowStepBodies(workflow)) {
    walk(statements, validate);
  }
}

function walk(stmts: unknown, validate: (run: AstNodeLike) => void): void {
  if (!Array.isArray(stmts)) return;
  for (const stmt of stmts) {
    if (!isAstNodeLike(stmt)) continue;
    if (stmt.__kind === 'IfStatement') {
      walk(stmt.body, validate);
      walk(stmt.orelse, validate);
    } else if (stmt.__kind === 'RunStatement') {
      validate(stmt);
    }
  }
}

function validateRun(
  run: AstNodeLike,
  workflow: AstNodeLike,
  topLevelActions: unknown
): void {
  const ref = decomposeAtMemberExpression(run.target);
  if (ref?.namespace !== 'actions') return;

  const target = isAstNodeLike(run.target) ? run.target : undefined;
  const range = target?.__cst?.range ?? run.__cst?.range;
  const action = resolveWorkflowAction(workflow, ref.property);

  if (
    !action &&
    reportTopLevelWorkflowAction(
      run,
      range,
      ref.property,
      topLevelActions,
      'run'
    )
  ) {
    return;
  }

  // The ellipsis check still runs without a signature.
  const issues = analyzeActionIo({
    actionName: ref.property,
    sig: action ? extractActionSignature(action) : undefined,
    statements: Array.isArray(run.body) ? run.body : undefined,
    actionRefRange: range,
    mode: 'workflow',
  });
  for (const { clause, diagnostic } of issues) {
    attachDiagnostic(clause ?? run, diagnostic);
  }
}
