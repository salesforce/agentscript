/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Blocks `transition to @connected_subagent.X` — connected agents cannot be
 * transition targets yet. They may only be invoked as tools from reasoning
 * actions (e.g. `call_agent: @connected_subagent.X`).
 *
 * Consumes `transitionTargets` from the type map rather than walking the
 * AST directly.
 *
 * Diagnostic: connected-agent-no-transition
 */

import type { LintPass } from '@agentscript/language';
import {
  attachDiagnostic,
  lintDiagnostic,
  defineRule,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from '@agentscript/agentscript-dialect';

export function noTransitionRule(): LintPass {
  return defineRule({
    id: 'connected-agent/no-transition',
    description:
      'Connected agents cannot be transition targets (not yet supported)',
    deps: { typeMap: typeMapKey },

    run({ typeMap }) {
      for (const target of typeMap.transitionTargets.get(
        'connected_subagent'
      ) ?? []) {
        attachDiagnostic(
          target.diagnosticParent,
          lintDiagnostic(
            target.range,
            `Transition to a connected agent is not yet supported. Use @connected_subagent.${target.property} as a tool invocation instead.`,
            DiagnosticSeverity.Error,
            'connected-agent-no-transition'
          )
        );
      }
    },
  });
}
