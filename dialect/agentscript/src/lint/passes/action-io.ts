/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Action I/O validation — validates that action `with`/`set` clauses
 * reference defined inputs/outputs, and reports missing required inputs.
 *
 * `analyzeActionIo` is the single definition shared by reasoning actions (this
 * rule), workflow `run` directives (workflow-validation pass), and the
 * compiler's workflow lowering.
 *
 * Diagnostics: action-unknown-input, action-unknown-output, action-missing-input,
 * workflow-with-ellipsis, workflow-action-missing-input,
 * workflow-action-confirmation-ignored
 */

import type { AstNodeLike, LintPass } from '@agentscript/language';
import {
  defineRule,
  each,
  attachDiagnostic,
  findSuggestion,
  extractOutputRef,
  lintDiagnostic,
} from '@agentscript/language';
import type { Diagnostic, Range, SyntaxNode } from '@agentscript/types';
import { toRange, DiagnosticSeverity } from '@agentscript/types';
import { reasoningActionsKey } from './reasoning-actions.js';
import type { ActionSignature, ParamInfo } from './type-map.js';

/**
 * An input must be bound when it is explicitly `is_required: True` and has no
 * default. Matches the compiled `required` flag the runtime enforces.
 */
export function isRequiredInput(info: ParamInfo): boolean {
  return info.isRequired === true && !info.hasDefault;
}

export interface ActionInvocation {
  /** Action name as referenced (e.g. `X` in `@actions.X`). */
  actionName: string;
  /**
   * Signature of the resolved action. Without one (unresolved action, reported
   * elsewhere) only the invocation-shape checks run.
   */
  sig: ActionSignature | undefined;
  /** `with`/`set` clauses of the invocation. */
  statements: readonly unknown[] | undefined;
  /** Range of the action reference, for invocation-level diagnostics. */
  actionRefRange: Range | undefined;
  /**
   * `reasoning`: unbound required inputs are filled by the LLM (`connected`
   * makes them errors). `workflow`: there is no LLM, so every input must be
   * bound with a value.
   */
  mode: 'reasoning' | 'connected' | 'workflow';
}

export interface ActionIoIssue {
  /**
   * The `with`/`set` clause the diagnostic belongs to; undefined for
   * invocation-level diagnostics, which belong to the invocation itself.
   */
  clause?: AstNodeLike;
  diagnostic: Diagnostic;
}

export function analyzeActionIo(inv: ActionInvocation): ActionIoIssue[] {
  const { actionName, sig, statements, actionRefRange, mode } = inv;
  const issues: ActionIoIssue[] = [];
  const inputNames = [...(sig?.inputs.keys() ?? [])];
  const outputNames = [...(sig?.outputs.keys() ?? [])];
  const providedInputs = new Set<string>();

  for (const raw of statements ?? []) {
    if (!raw || typeof raw !== 'object') continue;
    const stmt = raw as AstNodeLike;
    const cst = stmt.__cst;

    if (stmt.__kind === 'WithClause') {
      const param = stmt.param as string;
      if (!param) continue;

      if (sig && !sig.inputs.has(param)) {
        if (cst) {
          const paramCstNode = (stmt as { __paramCstNode?: SyntaxNode })
            .__paramCstNode;
          const range: Range = paramCstNode ? toRange(paramCstNode) : cst.range;
          issues.push({
            clause: stmt,
            diagnostic: lintDiagnostic(
              range,
              `'${param}' is not a defined input of action '${actionName}'`,
              DiagnosticSeverity.Error,
              'action-unknown-input',
              { suggestion: findSuggestion(param, inputNames) }
            ),
          });
        }
        continue;
      }
      providedInputs.add(param);

      const value = stmt.value as AstNodeLike | undefined;
      if (mode === 'workflow' && value?.__kind === 'Ellipsis' && cst) {
        issues.push({
          clause: stmt,
          diagnostic: lintDiagnostic(
            cst.range,
            `'with ${param} = ...' is not supported in a workflow. Workflow actions have no LLM to fill inputs; bind '${param}' to a value or variable.`,
            DiagnosticSeverity.Error,
            'workflow-with-ellipsis'
          ),
        });
      }
    }

    if (stmt.__kind === 'SetClause') {
      const outputRef = extractOutputRef(stmt.value);
      if (
        sig &&
        outputRef &&
        !sig.outputs.has(outputRef.name) &&
        outputRef.cst
      ) {
        issues.push({
          clause: stmt,
          diagnostic: lintDiagnostic(
            outputRef.cst.range,
            `'${outputRef.name}' is not a defined output of action '${actionName}'`,
            DiagnosticSeverity.Error,
            'action-unknown-output',
            { suggestion: findSuggestion(outputRef.name, outputNames) }
          ),
        });
      }
    }
  }

  if (!sig || !actionRefRange) return issues;

  const missing = [...sig.inputs]
    .filter(
      ([name, info]) => isRequiredInput(info) && !providedInputs.has(name)
    )
    .map(([name]) => name);

  if (mode === 'workflow') {
    if (missing.length > 0) {
      const list = missing.map(name => `'${name}'`).join(', ');
      issues.push({
        diagnostic: lintDiagnostic(
          actionRefRange,
          `Action '${actionName}' has unbound required input${missing.length > 1 ? 's' : ''} ${list}. ` +
            "Workflow actions have no LLM to fill inputs; bind each one with a 'with' clause.",
          DiagnosticSeverity.Error,
          'workflow-action-missing-input'
        ),
      });
    }
    if (sig.requireUserConfirmation?.value === true) {
      issues.push({
        diagnostic: lintDiagnostic(
          actionRefRange,
          `Action '${actionName}' sets 'require_user_confirmation: True', which workflows do not support yet. The action runs without asking for confirmation.`,
          DiagnosticSeverity.Warning,
          'workflow-action-confirmation-ignored'
        ),
      });
    }
    return issues;
  }

  // Connected agents have a strict contract — missing required inputs
  // are real authoring errors. Regular @actions.X references are softer:
  // the compiler auto-fills missing required slots into llm_inputs at
  // runtime, so the diagnostic is only an informational note.
  for (const name of missing) {
    issues.push({
      diagnostic: lintDiagnostic(
        actionRefRange,
        mode === 'connected'
          ? `Missing required input '${name}' for action '${actionName}'`
          : `Input '${name}' on action '${actionName}' has no \`with\` clause and will be filled by the LLM at runtime`,
        mode === 'connected'
          ? DiagnosticSeverity.Error
          : DiagnosticSeverity.Information,
        'action-missing-input'
      ),
    });
  }
  return issues;
}

export function actionIoRule(): LintPass {
  return defineRule({
    id: 'action-io',
    description:
      'Validates with/set clauses match action input/output definitions',
    deps: { entry: each(reasoningActionsKey) },

    run({ entry }) {
      const issues = analyzeActionIo({
        actionName: entry.refActionName,
        sig: entry.sig,
        statements: entry.statements,
        actionRefRange: entry.actionRefRange,
        mode:
          entry.namespace === 'connected_subagent' ? 'connected' : 'reasoning',
      });
      for (const { clause, diagnostic } of issues) {
        attachDiagnostic(clause ?? entry.ra, diagnostic);
      }
    },
  });
}
