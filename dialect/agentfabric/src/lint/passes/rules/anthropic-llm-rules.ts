/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import {
  AnthropicKind,
  THINKING_ALWAYS_ON_PATTERN,
} from '../../../constants.js';
import { attachError, extractStringValue, type AstLike } from './shared.js';

/**
 * Fable models reject `thinking: disabled` with a 400 (verified against the
 * API): extended thinking is always on for them. Pairing one with
 * `thinking: disabled` is a lint error (`llm-thinking-always-on`).
 */

/** The `thinking` value that disables extended thinking. */
const ANTHROPIC_THINKING_DISABLED = 'disabled';

const ANTHROPIC_KINDS = new Set<string>([
  AnthropicKind.Anthropic,
  AnthropicKind.BedrockAnthropic,
]);

/** Literal node kinds that can never be a stop sequence string. */
const NON_STRING_LITERAL_KINDS = new Set([
  'NumberLiteral',
  'BooleanLiteral',
  'ListLiteral',
  'DictLiteral',
  // bare `none` / `false` parse as identifiers
  'Identifier',
]);

/**
 * Reads a numeric literal field's value. Returns `undefined` when the field is
 * not a plain number literal (e.g. an interpolation expression), so callers can
 * skip value checks they cannot evaluate.
 */
function extractNumberValue(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (value != null && typeof value === 'object') {
    const inner = (value as Record<string, unknown>).value;
    if (typeof inner === 'number') return inner;
  }
  return undefined;
}

/**
 * Cross-field and per-kind validations for the `Anthropic` / `BedrockAnthropic`
 * LLM kinds that the schema cannot express on its own:
 *
 *  - `max_tokens` must be an integer (the schema has no integer
 *    constraint; required/`>= 1` live in the schema).
 *  - A model that always thinks with `thinking: disabled` is invalid.
 *  - `stop_sequences` items must be strings (expressions that may resolve to
 *    a string are allowed).
 *
 * Everything else — `model` pattern, required fields, the `effort`/`thinking`
 * value sets, `target`, and rejection of non-Anthropic parameters — is
 * enforced by the schema and the strict-schema-validation pass.
 */
export function checkAnthropicLlmRules(root: Record<string, unknown>): void {
  const llmEntries = root.llm;
  if (!isNamedMap(llmEntries)) return;

  for (const [, entry] of llmEntries) {
    if (entry == null || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const kind = extractStringValue(rec.kind);
    if (kind === undefined || !ANTHROPIC_KINDS.has(kind)) continue;

    const model = extractStringValue(rec.model);

    const maxTokens = extractNumberValue(rec.max_tokens);
    if (maxTokens !== undefined && !Number.isInteger(maxTokens)) {
      attachError(
        entry as AstLike,
        'llm.max_tokens must be an integer.',
        'llm-max-tokens-not-integer'
      );
    }

    const thinking = extractStringValue(rec.thinking);
    if (
      model !== undefined &&
      THINKING_ALWAYS_ON_PATTERN.test(model) &&
      thinking === ANTHROPIC_THINKING_DISABLED
    ) {
      attachError(
        entry as AstLike,
        `llm.thinking cannot be 'disabled' for model '${model}': extended thinking is always on.`,
        'llm-thinking-always-on'
      );
    }

    // Only the dash-list form yields `items`. On the pinned language 2.20.0 an
    // inline `[...]` list or a scalar parses to an empty sequence with no
    // diagnostic, so those forms cannot be linted here until the pin moves.
    const stopItems =
      (rec.stop_sequences as { items?: unknown[] } | undefined)?.items ?? [];
    if (
      stopItems.some(item =>
        NON_STRING_LITERAL_KINDS.has(
          (item as { __kind?: string } | null)?.__kind ?? ''
        )
      )
    ) {
      attachError(
        entry as AstLike,
        'llm.stop_sequences must be a list of strings.',
        'llm-stop-sequences-invalid'
      );
    }
  }
}
