/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that warns when the experimental `live` block is used.
 *
 * Diagnostic: live-experimental (warning).
 */

import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isAstNodeLike,
  computeRanges,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

export const LIVE_EXPERIMENTAL_WARNING = 'The `live` block is experimental.';

class LiveExperimentalPass implements LintPass {
  readonly id = storeKey('live-experimental');
  readonly description = 'Warns that the live block is an experimental feature';

  run(_store: PassStore, root: AstRoot): void {
    const live = root.live;
    if (!isAstNodeLike(live) || !live.__cst) return;

    attachDiagnostic(
      live,
      lintDiagnostic(
        computeRanges(live.__cst).selectionRange,
        LIVE_EXPERIMENTAL_WARNING,
        DiagnosticSeverity.Warning,
        'live-experimental'
      )
    );
  }
}

export function liveExperimentalRule(): LintPass {
  return new LiveExperimentalPass();
}
