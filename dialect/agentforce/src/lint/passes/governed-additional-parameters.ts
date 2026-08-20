/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Governs additional_parameter__ config fields via two data-only maps.
 *
 * entry:
 *   - FORBIDDEN_ADDITIONAL_PARAMS — suffix → hard-error message. These have no
 *     runtime replacement, so they carry a bespoke message and emit an Error.
 *   - DEPRECATED_ADDITIONAL_PARAMS — suffix → its config.runtime.* replacement
 *     field. The deprecation message is interpolated from the destination, and
 *     the diagnostic is a Warning tagged Deprecated (strike-through in editors).
 * Any other additional_parameter__ field is allowed and produces no diagnostic.
 *
 * Diagnostics: disabled-additional-parameter, deprecated-additional-parameter
 */

import type { AstRoot, LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isAstNodeLike,
} from '@agentscript/language';
import { DiagnosticSeverity, DiagnosticTag } from '@agentscript/types';
import { getBlockRange, getFieldLineRange } from '../utils.js';

const PREFIX = 'additional_parameter__';

const DISABLED_CODE = 'disabled-additional-parameter';
const DEPRECATED_CODE = 'deprecated-additional-parameter';

/**
 * Deprecated additional_parameter__ suffixes → their config.runtime.* replacement
 * field. Exported so tests derive their cases from this single source of truth.
 */
export const DEPRECATED_ADDITIONAL_PARAMS: ReadonlyMap<string, string> =
  new Map([
    ['reset_to_initial_node', 'reset_to_initial_node'],
    ['disable_groundedness', 'groundedness'],
    ['enable_groundedness', 'groundedness'],
    ['disable_streaming', 'streaming'],
    ['disable_citation', 'citation'],
    ['enable_thought_chunks', 'thought_chunks'],
  ]);

/** Forbidden additional_parameter__ suffixes → hard-error message (no runtime replacement). */
const FORBIDDEN_ADDITIONAL_PARAMS: ReadonlyMap<string, string> = new Map([
  [
    'disable_graph_runtime',
    'Disabling the graph runtime is not permitted. Please reach out to support if you need that.',
  ],
]);

function deprecationMessage(suffix: string, runtimeField: string): string {
  return `The ${PREFIX}${suffix} parameter is deprecated and will be removed in a future release. Use config.runtime.${runtimeField} instead.`;
}

class GovernedAdditionalParametersPass implements LintPass {
  readonly id = storeKey('governed-additional-parameters');
  readonly description =
    'Governs additional_parameter__ config fields — forbids some, deprecates others';

  run(_store: PassStore, root: AstRoot): void {
    const config = root.config;
    if (!isAstNodeLike(config)) return;

    for (const key of Object.keys(config)) {
      const lowerKey = key.toLowerCase();
      if (!lowerKey.startsWith(PREFIX)) continue;
      const suffix = lowerKey.slice(PREFIX.length);

      const forbiddenMessage = FORBIDDEN_ADDITIONAL_PARAMS.get(suffix);
      const runtimeField = DEPRECATED_ADDITIONAL_PARAMS.get(suffix);

      let message: string;
      let severity: DiagnosticSeverity;
      let code: string;
      let tags: DiagnosticTag[] | undefined;
      if (forbiddenMessage !== undefined) {
        message = forbiddenMessage;
        severity = DiagnosticSeverity.Error;
        code = DISABLED_CODE;
      } else if (runtimeField !== undefined) {
        message = deprecationMessage(suffix, runtimeField);
        severity = DiagnosticSeverity.Warning;
        code = DEPRECATED_CODE;
        // Deprecations strike the field through in editors; errors have no tag.
        tags = [DiagnosticTag.Deprecated];
      } else {
        // Ungoverned additional_parameter__ field — allowed, no diagnostic.
        continue;
      }

      // Anchor the diagnostic on the offending field when possible; fall back to
      // the config block (always attachable) for any non-node-like value.
      // Range spans the whole `key: value` line, not just the value token.
      const fieldNode = config[key];
      const target = isAstNodeLike(fieldNode) ? fieldNode : config;
      const range = isAstNodeLike(fieldNode)
        ? getFieldLineRange(fieldNode)
        : getBlockRange(config);

      attachDiagnostic(
        target,
        lintDiagnostic(
          range,
          message,
          severity,
          code,
          tags ? { tags } : undefined
        )
      );
    }
  }
}

export function governedAdditionalParametersRule(): LintPass {
  return new GovernedAdditionalParametersPass();
}
