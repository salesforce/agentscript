/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that validates `modality voice: languages:` keys against declared locales.
 *
 * Voice language overrides in `languages:` must be a subset of the locales
 * declared in the `language` block (`default_locale` + `additional_locales`).
 *
 * Diagnostics:
 *   - voice-language-not-declared: A language key is not in the declared locales
 *   - voice-language-missing-language-block: Voice languages defined but no language block exists
 */

import type { AstNodeLike, AstRoot } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import {
  extractStringValue,
  getBlockRange,
  getFieldLineRange,
} from '../utils.js';

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

/**
 * Parse comma-separated locale string into a set of trimmed locale codes.
 */
function parseLocales(value: string | undefined): Set<string> {
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
  );
}

class VoiceLanguageValidationPass implements LintPass {
  readonly id = storeKey('voice-language-validation');
  readonly description =
    'Validates that voice language keys are declared in the language block';

  run(_store: PassStore, root: AstRoot): void {
    const modality = root.modality;
    if (!isNamedMap(modality) || !modality.has('voice')) return;

    const voice = modality.get('voice') as AstNodeLike;
    const languages = voice.languages;
    if (!isNamedMap(languages) || languages.size === 0) return;

    const language = root.language as AstNodeLike | undefined;

    // If no language block exists but voice languages are defined, warn
    if (!language || typeof language !== 'object') {
      attachDiagnostic(
        voice,
        lintDiagnostic(
          getBlockRange(languages as unknown as AstNodeLike),
          "Voice languages are defined but no 'language' block exists. Define 'default_locale' and/or 'additional_locales'.",
          DiagnosticSeverity.Warning,
          'voice-language-missing-language-block'
        )
      );
      return;
    }

    // If adaptive language is enabled, skip validation (adaptive-language rule handles voice conflict)
    const adaptive = extractBooleanValue(language.adaptive);
    if (adaptive === true) return;

    // If all_additional_locales is True, all locales are valid
    const allAdditionalLocales = extractBooleanValue(
      language.all_additional_locales
    );
    if (allAdditionalLocales === true) return;

    // Build set of allowed locales from default_locale and additional_locales
    const allowedLocales = new Set<string>();

    const defaultLocale = extractStringValue(language.default_locale);
    if (defaultLocale) {
      allowedLocales.add(defaultLocale);
    }

    const additionalLocales = extractStringValue(language.additional_locales);
    const additionalSet = parseLocales(additionalLocales);
    for (const locale of additionalSet) {
      allowedLocales.add(locale);
    }

    // Validate each voice language key
    for (const [langKey, decl] of languages) {
      if (!allowedLocales.has(langKey)) {
        attachDiagnostic(
          decl as AstNodeLike,
          lintDiagnostic(
            getBlockRange(decl as AstNodeLike),
            `Voice language '${langKey}' is not declared in the language block. Add it to 'default_locale' or 'additional_locales'.`,
            DiagnosticSeverity.Error,
            'voice-language-not-declared'
          )
        );
      }
    }
  }
}

export function voiceLanguageValidationRule(): LintPass {
  return new VoiceLanguageValidationPass();
}

// --- V1/V2 voice property mixing detection ---

const V2_VOICE_PROPERTIES = [
  'inbound',
  'outbound',
  'session_language_switching',
  'languages',
] as const;

const V1_VOICE_PROPERTIES = [
  'inbound_keywords',
  'inbound_filler_words_detection',
  'voice_id',
  'outbound_speed',
  'outbound_style_exaggeration',
  'outbound_stability',
  'outbound_similarity',
  'outbound_filler_sentences',
  'pronunciation_dict',
  'additional_configs',
] as const;

class VoiceVersionMixingPass implements LintPass {
  readonly id = storeKey('voice-version-mixing');
  readonly description =
    'Ensures V1 and V2 voice properties are not mixed in the same modality voice block';

  run(_store: PassStore, root: AstRoot): void {
    const modality = root.modality;
    if (!isNamedMap(modality) || !modality.has('voice')) return;

    const voice = modality.get('voice') as AstNodeLike;

    const presentV1: string[] = [];
    const presentV2: string[] = [];

    for (const prop of V1_VOICE_PROPERTIES) {
      if (voice[prop] !== undefined) presentV1.push(prop);
    }
    for (const prop of V2_VOICE_PROPERTIES) {
      if (voice[prop] !== undefined) presentV2.push(prop);
    }

    if (presentV1.length === 0 || presentV2.length === 0) return;

    for (const field of presentV1) {
      const fieldNode = voice[field];
      const range = getFieldLineRange(fieldNode);
      attachDiagnostic(
        voice,
        lintDiagnostic(
          range,
          `Cannot mix V1 and V2 voice properties. '${field}' is a V1 property but V2 properties are also present: ${presentV2.join(', ')}. Use exclusively V1 or V2 properties.`,
          DiagnosticSeverity.Error,
          'voice-version-mixing'
        )
      );
    }
  }
}

export function voiceVersionMixingRule(): LintPass {
  return new VoiceVersionMixingPass();
}
