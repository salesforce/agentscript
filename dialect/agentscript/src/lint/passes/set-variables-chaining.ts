/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * setVariables chaining validation — flags chained actions after
 * `@utils.setVariables`. A `run` or `transition to` clause chained onto a
 * setVariables reasoning action — including one nested in an `if`/`else` — is
 * silently dropped (the variable is set, but the chained action/transition
 * never fires), so it must be a hard error.
 *
 * This mirrors the compiler-side check in
 * `packages/compiler/src/nodes/compile-set-variables.ts`, but lives in the lint
 * layer so it surfaces live in the editor for every dialect — not only when the
 * agentforce compile hook runs. The compiler check stays as a safety net for
 * callers of raw `compile()`, which skips lint. Both emit the identical message
 * so `dedupeDiagnostics` collapses them to one diagnostic.
 *
 * Diagnostics: set-variables-chained-action (Error)
 */

import type { LintPass } from '@agentscript/language';
import {
  defineRule,
  each,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import { setVariablesEntriesKey } from './reasoning-actions.js';

/**
 * Chained statement kinds that are silently dropped after
 * `@utils.setVariables`, mapped to the keyword shown in the diagnostic.
 */
const PROHIBITED_CHAINED_KINDS: Record<string, string> = {
  TransitionStatement: 'transition to',
  RunStatement: 'run',
};

type Statement = Record<string, unknown>;

function checkStatements(statements: readonly Statement[] | undefined): void {
  if (!statements) return;

  for (const stmt of statements) {
    const kind = stmt.__kind as string | undefined;
    if (kind === 'IfStatement') {
      checkStatements(stmt.body as Statement[] | undefined);
      checkStatements(stmt.orelse as Statement[] | undefined);
      continue;
    }

    const prohibitedType = kind && PROHIBITED_CHAINED_KINDS[kind];
    if (!prohibitedType) continue;

    const range = (stmt.__cst as CstMeta | undefined)?.range;
    if (!range) continue;

    const msg = `Actions using @utils.setVariables cannot have transitions or follow-up actions. The '${prohibitedType}' after this utils action will be ignored at runtime.`;
    attachDiagnostic(
      stmt,
      lintDiagnostic(
        range,
        msg,
        DiagnosticSeverity.Error,
        'set-variables-chained-action'
      )
    );
  }
}

export function setVariablesChainingRule(): LintPass {
  return defineRule({
    id: 'set-variables-chaining',
    description:
      'Flags run/transition clauses chained after @utils.setVariables, which are ignored at runtime',
    deps: { entry: each(setVariablesEntriesKey) },

    run({ entry }) {
      checkStatements(entry.statements);
    },
  });
}
