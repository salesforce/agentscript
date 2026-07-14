/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Rejects additional_parameter__ fields that are no longer permitted.
 *
 * FORBIDDEN_ADDITIONAL_PARAMETERS is the single source of truth. To forbid
 * another field, add one entry: { field, code, message }.
 *
 * Diagnostics: disabled-additional-parameter
 */

import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isAstNodeLike,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange, getFieldLineRange } from '../utils.js';

interface ForbiddenParameter {
  /** Full config field name, including the additional_parameter__ prefix. */
  readonly field: string;
  readonly code: string;
  readonly message: string;
}

const FORBIDDEN_ADDITIONAL_PARAMETERS: readonly ForbiddenParameter[] = [
  {
    field: 'additional_parameter__disable_graph_runtime',
    code: 'disabled-additional-parameter',
    message:
      'Disabling the graph runtime is not permitted. Please reach out to support if you need that.',
  },
  // Add future forbidden additional_parameter__ fields here.
];

class DisabledAdditionalParametersPass implements LintPass {
  readonly id = storeKey('disabled-additional-parameters');
  readonly description =
    'Rejects additional_parameter__ config fields that are no longer permitted';

  run(_store: PassStore, root: AstRoot): void {
    const config = root.config;
    if (!isAstNodeLike(config)) return;

    for (const entry of FORBIDDEN_ADDITIONAL_PARAMETERS) {
      const fieldNode = config[entry.field];
      if (fieldNode === undefined) continue;

      // Anchor the error on the offending field when possible; fall back to
      // the config block (always attachable) for any non-node-like value.
      // Range spans the whole `key: value` line, not just the value token.
      const target = isAstNodeLike(fieldNode) ? fieldNode : config;
      const range = isAstNodeLike(fieldNode)
        ? getFieldLineRange(fieldNode)
        : getBlockRange(config);
      attachDiagnostic(
        target,
        lintDiagnostic(
          range,
          entry.message,
          DiagnosticSeverity.Error,
          entry.code
        )
      );
    }
  }
}

export function disabledAdditionalParametersRule(): LintPass {
  return new DisabledAdditionalParametersPass();
}
