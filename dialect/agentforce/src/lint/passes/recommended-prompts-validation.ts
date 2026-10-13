/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that validates `system.recommended_prompts.starter_prompts`.
 * Runs at lint time so authors get live editor feedback (squiggles) as they
 * type. The four rules:
 *
 *   1. starter_prompts only allowed when welcome_screen is True (cross-field).
 *      Diagnostic: recommended-prompts-welcome-screen
 *   2. at least 3 entries.  Diagnostic: recommended-prompts-min-entries
 *   3. at most 20 entries.  Diagnostic: recommended-prompts-max-entries
 *   4. each string 1–50 characters.  Diagnostic: recommended-prompts-length
 *   5. each entry is a text value.  Diagnostic: recommended-prompts-type
 *
 * starter_prompts supports both YAML (`- "a"`) and inline-list (`["a","b"]`)
 * syntax, so we read it via the shared `readStringSequence` reader (which
 * handles both) rather than touching CST internals here. The agent-type
 * restriction lives separately in config-validation.ts.
 */

import type { AstNodeLike, AstRoot } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isAstNodeLike,
  readSequenceEntries,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange } from '../utils.js';

const MIN_ENTRIES = 3;
const MAX_ENTRIES = 20;
const MIN_LENGTH = 1;
const MAX_LENGTH = 50;

/** Extract a boolean from a BooleanValue/BooleanLiteral node or raw boolean. */
function extractBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value == null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    (record.__kind === 'BooleanValue' || record.__kind === 'BooleanLiteral') &&
    typeof record.value === 'boolean'
  ) {
    return record.value;
  }
  return undefined;
}

class RecommendedPromptsValidationPass implements LintPass {
  readonly id = storeKey('recommended-prompts-validation');
  readonly description =
    'Validates recommended_prompts.starter_prompts value constraints';

  run(_store: PassStore, root: AstRoot): void {
    const system = isAstNodeLike(root.system) ? root.system : undefined;
    const recommendedPrompts = system?.recommended_prompts;
    if (!isAstNodeLike(recommendedPrompts)) return;

    const starterPrompts = recommendedPrompts.starter_prompts;
    // No starter_prompts configured — nothing to validate here.
    if (!isAstNodeLike(starterPrompts)) return;

    const promptsNode = starterPrompts as AstNodeLike;
    // All authored entries (string or not); non-string entries have no `value`.
    const allEntries = readSequenceEntries(promptsNode);
    // Count / length rules apply to the valid string entries only.
    const entries = allEntries.filter(entry => entry.value !== undefined);

    // Rule 1: starter_prompts requires welcome_screen: True.
    const welcomeScreen = extractBooleanValue(
      recommendedPrompts.welcome_screen
    );
    if (welcomeScreen !== true) {
      attachDiagnostic(
        promptsNode,
        lintDiagnostic(
          getBlockRange(promptsNode),
          'starter_prompts can only be set when welcome_screen is True',
          DiagnosticSeverity.Error,
          'recommended-prompts-welcome-screen'
        )
      );
    }

    // Rule 2: at least 3 entries.
    if (entries.length < MIN_ENTRIES) {
      attachDiagnostic(
        promptsNode,
        lintDiagnostic(
          getBlockRange(promptsNode),
          `starter_prompts must contain at least ${MIN_ENTRIES} entries`,
          DiagnosticSeverity.Error,
          'recommended-prompts-min-entries'
        )
      );
    }

    // Rule 3: at most 20 entries.
    if (entries.length > MAX_ENTRIES) {
      attachDiagnostic(
        promptsNode,
        lintDiagnostic(
          getBlockRange(promptsNode),
          `starter_prompts can have at most ${MAX_ENTRIES} entries`,
          DiagnosticSeverity.Error,
          'recommended-prompts-max-entries'
        )
      );
    }

    // Rule 4: each string 1–50 characters. Attach to the individual entry so
    // the squiggle lands on the offending prompt when its range is known.
    for (const entry of entries) {
      const value = entry.value ?? '';
      if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) {
        attachDiagnostic(
          promptsNode,
          lintDiagnostic(
            entry.range ?? getBlockRange(promptsNode),
            `Each starter prompt must be between ${MIN_LENGTH} and ${MAX_LENGTH} characters`,
            DiagnosticSeverity.Error,
            'recommended-prompts-length'
          )
        );
      }
    }

    // Rule 5: each entry must be a text value. `starter_prompts` is an
    // expression sequence, so booleans/numbers parse but are not valid prompts;
    // flag them instead of silently dropping the entry.
    for (const entry of allEntries) {
      if (entry.value === undefined) {
        attachDiagnostic(
          promptsNode,
          lintDiagnostic(
            entry.range ?? getBlockRange(promptsNode),
            'Each starter prompt must be a text value',
            DiagnosticSeverity.Error,
            'recommended-prompts-type'
          )
        );
      }
    }
  }
}

export function recommendedPromptsValidationRule(): LintPass {
  return new RecommendedPromptsValidationPass();
}
