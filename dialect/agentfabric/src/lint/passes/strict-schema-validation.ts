/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  storeKey,
  DiagnosticSeverity,
  collectDiagnostics,
} from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';

const PROMOTE_CODES = new Set(['unknown-field', 'unknown-block']);

/**
 * Promotes unknown-field and unknown-block diagnostics from Warning to Error
 * for the AgentFabric dialect. AgentFabric is a strict compilation target —
 * unrecognized fields are silently dropped and indicate author mistakes.
 */
class StrictSchemaValidationPass implements LintPass {
  readonly id = storeKey('agentfabric-strict-schema');
  readonly description =
    'Promotes unknown field/block warnings to errors for AgentFabric';

  finalize(_store: PassStore, root: Record<string, unknown>): void {
    const diagnostics = collectDiagnostics(root);
    for (const diag of diagnostics) {
      if (
        diag.severity === DiagnosticSeverity.Warning &&
        PROMOTE_CODES.has(diag.code ?? '')
      ) {
        diag.severity = DiagnosticSeverity.Error;
      }
    }
  }
}

export function strictSchemaValidationPass(): LintPass {
  return new StrictSchemaValidationPass();
}
