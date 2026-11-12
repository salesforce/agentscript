/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that surfaces the pilot/beta terms notice on every `workflow` block.
 *
 * Diagnostic: workflow-beta-notice (information).
 */

import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
  isAstNodeLike,
  computeRanges,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

export const WORKFLOW_BETA_NOTICE =
  "Workflow is a pilot or beta service that is subject to the Beta Services Terms at Agreements - Salesforce.com (salesforce.com/company/legal/customer-agreements) or a written Unified Pilot Agreement if executed by Customer, and applicable terms in the Product Terms Directory (ptd.salesforce.com). Use of this pilot or beta service is at the Customer's sole discretion";

class WorkflowBetaNoticePass implements LintPass {
  readonly id = storeKey('workflow-beta-notice');
  readonly description =
    'Reports an informational pilot/beta terms notice on each workflow block';

  run(_store: PassStore, root: AstRoot): void {
    const workflows = root.workflow;
    if (!isNamedMap(workflows)) return;

    for (const [, workflow] of workflows) {
      if (!isAstNodeLike(workflow) || !workflow.__cst) continue;
      // selectionRange is the `workflow <name>` header key.
      attachDiagnostic(
        workflow,
        lintDiagnostic(
          computeRanges(workflow.__cst).selectionRange,
          WORKFLOW_BETA_NOTICE,
          DiagnosticSeverity.Information,
          'workflow-beta-notice'
        )
      );
    }
  }
}

export function workflowBetaNoticeRule(): LintPass {
  return new WorkflowBetaNoticePass();
}
