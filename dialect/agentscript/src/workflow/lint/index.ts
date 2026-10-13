/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  attachDiagnostic,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
  storeKey,
} from '@agentscript/language';

import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { validateWorkflowActionInputs } from './action-inputs.js';
import { workflowNameCollisions } from './node-names.js';
import { validateStepsWorkflow } from './steps-structure.js';

class WorkflowValidationPass implements LintPass {
  readonly id = storeKey('workflow-validation');
  readonly description =
    'Validates workflow step structure, action input bindings, and node names';

  run(_store: PassStore, root: AstRoot): void {
    const workflows = root.workflow;
    if (!isNamedMap(workflows)) return;

    for (const [, rawWorkflow] of workflows) {
      if (!isAstNodeLike(rawWorkflow)) continue;
      validateStepsWorkflow(rawWorkflow);
      validateWorkflowActionInputs(rawWorkflow, root.actions);
    }

    for (const { workflow, message } of workflowNameCollisions(root)) {
      const range = workflow.__cst?.range;
      if (!range) continue;
      attachDiagnostic(
        workflow,
        lintDiagnostic(
          range,
          message,
          DiagnosticSeverity.Error,
          'workflow-duplicate-node-name'
        )
      );
    }
  }
}

export function workflowValidationPass(): LintPass {
  return new WorkflowValidationPass();
}

export { validateStepsWorkflow } from './steps-structure.js';
export {
  resolveWorkflowAction,
  workflowUnknownActionMessage,
} from './action-inputs.js';
export { workflowNameCollisions } from './node-names.js';
export type { WorkflowNameCollision } from './node-names.js';
