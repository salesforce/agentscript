/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Action I/O validation — validates that reasoning action `with`/`set` clauses
 * reference defined inputs/outputs, and reports missing required inputs.
 *
 * Diagnostics: action-unknown-input, action-unknown-output, action-missing-input
 */

import type { LintPass } from '@agentscript/language';
import {
  defineRule,
  each,
  attachDiagnostic,
  findSuggestion,
  extractOutputRef,
  lintDiagnostic,
} from '@agentscript/language';
import type { CstMeta, Range, SyntaxNode } from '@agentscript/types';
import { toRange, DiagnosticSeverity } from '@agentscript/types';
import { reasoningActionsKey } from './reasoning-actions.js';

export function actionIoRule(): LintPass {
  return defineRule({
    id: 'action-io',
    description:
      'Validates with/set clauses match action input/output definitions',
    deps: { entry: each(reasoningActionsKey) },

    run({ entry }) {
      const { refActionName, sig, statements, actionRefRange, ra } = entry;
      const inputNames = [...sig.inputs.keys()];
      const outputNames = [...sig.outputs.keys()];
      const providedInputs = new Set<string>();

      if (!statements) {
        for (const [inputName, info] of sig.inputs) {
          if (!info.hasDefault && info.isRequired !== false && actionRefRange) {
            attachDiagnostic(
              ra,
              lintDiagnostic(
                actionRefRange,
                `Missing required input '${inputName}' for action '${refActionName}'`,
                DiagnosticSeverity.Error,
                'action-missing-input'
              )
            );
          }
        }
        return;
      }

      for (const stmt of statements) {
        if (stmt.__kind === 'WithClause') {
          const param = stmt.param as string;
          if (!param) continue;
          providedInputs.add(param);

          if (!sig.inputs.has(param)) {
            const cst = stmt.__cst as CstMeta | undefined;
            if (cst) {
              const paramCstNode = (stmt as { __paramCstNode?: SyntaxNode })
                .__paramCstNode;
              const range: Range = paramCstNode
                ? toRange(paramCstNode)
                : cst.range;

              const suggestion = findSuggestion(param, inputNames);
              const msg = `'${param}' is not a defined input of action '${refActionName}'`;
              attachDiagnostic(
                stmt,
                lintDiagnostic(
                  range,
                  msg,
                  DiagnosticSeverity.Error,
                  'action-unknown-input',
                  { suggestion }
                )
              );
            }
          }
        }

        if (stmt.__kind === 'SetClause') {
          const outputRef = extractOutputRef(stmt.value);
          if (outputRef && !sig.outputs.has(outputRef.name)) {
            const cst = outputRef.cst;
            if (cst) {
              const suggestion = findSuggestion(outputRef.name, outputNames);
              const msg = `'${outputRef.name}' is not a defined output of action '${refActionName}'`;
              attachDiagnostic(
                stmt,
                lintDiagnostic(
                  cst.range,
                  msg,
                  DiagnosticSeverity.Error,
                  'action-unknown-output',
                  { suggestion }
                )
              );
            }
          }
        }
      }

      for (const [inputName, info] of sig.inputs) {
        if (
          !info.hasDefault &&
          info.isRequired !== false &&
          !providedInputs.has(inputName) &&
          actionRefRange
        ) {
          attachDiagnostic(
            ra,
            lintDiagnostic(
              actionRefRange,
              `Missing required input '${inputName}' for action '${refActionName}'`,
              DiagnosticSeverity.Error,
              'action-missing-input'
            )
          );
        }
      }
    },
  });
}
