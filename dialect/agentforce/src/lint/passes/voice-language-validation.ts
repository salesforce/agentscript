/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that validates `modality voice: language:` keys against declared languages.
 *
 * Voice language overrides in `modality voice: language:` must be a subset of the text languages
 * declared in the top-level `language` block (`default_locale` + `additional_locales`).
 *
 * In addition, voice `language_settings` keys must be declared in `modality voice: language` block (`default_locale` + `additional_locales`).
 *
 * Diagnostics:
 *   - voice-language-not-declared: A voice language is not in the declared locales of the text languages.
 *   - voice-language-missing-language-block: Voice languages defined but no language block exists
 *   - voice-language-settings-not-declared: A voice language setting is not in the declared voice languages.
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
  extractStringSequence,
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
 * Build a set of locales declared on a language block from its `default_locale`
 * and `additional_locales` fields.
 */
function collectLocales(language: AstNodeLike): Set<string> {
  const locales = new Set(extractStringSequence(language.additional_locales));
  const defaultLocale = extractStringValue(language.default_locale);
  if (defaultLocale) locales.add(defaultLocale);
  return locales;
}

class VoiceLanguageValidationPass implements LintPass {
  readonly id = storeKey('voice-language-validation');
  readonly description =
    'Validates that voice language keys are declared in the language block';

  run(_store: PassStore, root: AstRoot): void {
    const modality = root.modality;
    if (!isNamedMap(modality) || !modality.has('voice')) return;

    const voice = modality.get('voice') as AstNodeLike;
    const voiceLanguage = voice.language as AstNodeLike | undefined;
    const voiceSettings = voice.language_settings;

    const hasVoiceLanguage =
      !!voiceLanguage && typeof voiceLanguage === 'object';
    const hasVoiceSettings =
      isNamedMap(voiceSettings) && voiceSettings.size > 0;
    if (!hasVoiceLanguage && !hasVoiceSettings) return;

    // Check A: the voice languages must be a subset of the top-level text languages.
    if (hasVoiceLanguage) {
      const textLanguage = root.language as AstNodeLike | undefined;

      if (!textLanguage || typeof textLanguage !== 'object') {
        // Voice languages are defined but no text 'language' block exists.
        attachDiagnostic(
          voice,
          lintDiagnostic(
            getBlockRange(voiceLanguage),
            "Voice languages are defined but no 'language' block exists. Define 'default_locale' and/or 'additional_locales'.",
            DiagnosticSeverity.Warning,
            'voice-language-missing-language-block'
          )
        );
      } else {
        const textLocales = collectLocales(textLanguage);

        const defaultLocale = extractStringValue(voiceLanguage.default_locale);
        if (defaultLocale && !textLocales.has(defaultLocale)) {
          attachDiagnostic(
            voiceLanguage,
            lintDiagnostic(
              getBlockRange(voiceLanguage.default_locale),
              `Voice language '${defaultLocale}' is not declared in the language block. Add it to 'default_locale' or 'additional_locales'.`,
              DiagnosticSeverity.Error,
              'voice-language-not-declared'
            )
          );
        }

        const additionalLocales = extractStringSequence(
          voiceLanguage.additional_locales
        );
        for (const locale of additionalLocales) {
          if (!textLocales.has(locale)) {
            attachDiagnostic(
              voiceLanguage,
              lintDiagnostic(
                getBlockRange(voiceLanguage.additional_locales),
                `Voice language '${locale}' is not declared in the language block. Add it to 'default_locale' or 'additional_locales'.`,
                DiagnosticSeverity.Error,
                'voice-language-not-declared'
              )
            );
          }
        }
      }
    }

    // Check B: each language_settings key must be a declared voice language.
    if (hasVoiceSettings) {
      // A voice 'all_additional_locales: True' accepts every language_settings key.
      const allAdditionalLocales = hasVoiceLanguage
        ? extractBooleanValue(voiceLanguage.all_additional_locales)
        : undefined;

      if (allAdditionalLocales !== true) {
        // Locales declared on the voice language block. Empty when there is no
        // voice language block, in which case every settings key is undeclared.
        const voiceLocales = hasVoiceLanguage
          ? collectLocales(voiceLanguage)
          : new Set<string>();

        for (const [langKey, decl] of voiceSettings) {
          if (!voiceLocales.has(langKey)) {
            attachDiagnostic(
              decl as AstNodeLike,
              lintDiagnostic(
                getBlockRange(decl as AstNodeLike),
                `Voice language setting '${langKey}' is not a declared voice language. Add it to the voice 'language' block's 'default_locale' or 'additional_locales'.`,
                DiagnosticSeverity.Error,
                'voice-language-settings-not-declared'
              )
            );
          }
        }
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
  'language',
  'language_settings',
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
