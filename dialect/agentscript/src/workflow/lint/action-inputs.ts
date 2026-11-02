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

import type { AstNodeLike } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { analyzeActionIo } from '../../lint/passes/action-io.js';
import { extractActionSignature } from '../../lint/passes/type-map.js';

function lookupAction(actions: unknown, name: string): AstNodeLike | undefined {
  if (!isNamedMap(actions)) return undefined;
  const action = actions.get(name);
  return isAstNodeLike(action) ? action : undefined;
}

/**
 * The action definition a workflow's `run @actions.<name>` executes. Workflows
 * only run their own `actions:`; top-level actions are not inherited.
 */
export function resolveWorkflowAction(
  workflow: AstNodeLike,
  name: string
): AstNodeLike | undefined {
  return lookupAction(workflow.actions, name);
}

export function workflowUnknownActionMessage(name: string): string {
  return `'run' target '${name}' is not an action defined in this workflow's 'actions'. Workflows can only run their own actions.`;
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

  const unnamed = workflow.steps;
  if (isAstNodeLike(unnamed)) walk(unnamed.statements, validate);

  const named = workflow.step;
  if (!isNamedMap(named)) return;
  for (const [, step] of named) {
    if (isAstNodeLike(step)) walk(step.statements, validate);
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

  // undefined-reference resolves `@actions.X` against the top-level actions
  // too, so only this pass can report one the workflow can't run. Names
  // defined nowhere are left to undefined-reference.
  if (!action && range && lookupAction(topLevelActions, ref.property)) {
    attachDiagnostic(
      run,
      lintDiagnostic(
        range,
        workflowUnknownActionMessage(ref.property),
        DiagnosticSeverity.Error,
        'workflow-unknown-action'
      )
    );
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
