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
 *
 * `VoicePronunciationsPass` (below) adds voice-pronunciations-default-locale-only.
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

function extractSequenceItems(value: unknown): unknown[] {
  if (value == null || typeof value !== 'object') return [];
  const items = (value as { items?: unknown[] }).items;
  return Array.isArray(items) ? items : [];
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

/**
 * Build a set containing just a language block's `default_locale` (if any).
 * Used for the voice-language fallback, which only ever resolves to the agent's
 * default locale, never its additional_locales (see `compileAgentLanguageFallback`
 * in the compiler).
 */
function collectDefaultLocale(language: AstNodeLike): Set<string> {
  const defaultLocale = extractStringValue(language.default_locale);
  return defaultLocale ? new Set([defaultLocale]) : new Set();
}

/**
 * The voice languages in effect: the explicit `modality voice: language` locales, or the agent-language
 * fallback (default locale only, or every agent locale for `all_additional_locales: True`).
 * Undefined when the voice block declares neither a language nor language_settings.
 */
function resolveEffectiveVoiceLocales(
  root: AstRoot,
  voice: AstNodeLike
): Set<string> | undefined {
  const voiceLanguage = voice.language as AstNodeLike | undefined;
  const hasVoiceLanguage = !!voiceLanguage && typeof voiceLanguage === 'object';
  const allAdditionalLocales = hasVoiceLanguage
    ? extractBooleanValue(voiceLanguage.all_additional_locales)
    : undefined;
  const usesAgentLanguageFallback =
    !hasVoiceLanguage || allAdditionalLocales === true;

  if (hasVoiceLanguage && !usesAgentLanguageFallback) {
    return collectLocales(voiceLanguage);
  }

  // Default to an empty set (rather than undefined) when no agent 'language' block exists,
  // so language_settings is still validated instead of silently skipped.
  const textLanguage = root.language as AstNodeLike | undefined;
  const hasTextLanguage = !!textLanguage && typeof textLanguage === 'object';
  const locales = hasTextLanguage
    ? allAdditionalLocales === true
      ? collectLocales(textLanguage)
      : collectDefaultLocale(textLanguage)
    : new Set<string>();
  // compileAgentAllLocales keeps the voice default, so language_settings may target it.
  // It returns nothing without an agent language block, so only add it then.
  const voiceDefaultLocale = hasVoiceLanguage
    ? extractStringValue(voiceLanguage.default_locale)
    : undefined;
  if (hasTextLanguage && allAdditionalLocales === true && voiceDefaultLocale) {
    locales.add(voiceDefaultLocale);
  }
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

    // Explicit 'all_additional_locales: True' expands eagerly to the agent's full
    // locale set (see compileAgentAllLocales); an omitted voice.language block falls
    // back to just the agent's default_locale (see compileAgentLanguageFallback).
    // On the all-locales path the compiler keeps voice.language's own default_locale
    // as the first (start) language and accepts any supported locale there (it
    // validates the code itself), but still ignores additional_locales. So lint does
    // not require the voice default to be declared in the text language block on that
    // path; it only treats it as a valid language_settings key. The declared-subset
    // check below applies to the explicit path only.
    const allAdditionalLocales = hasVoiceLanguage
      ? extractBooleanValue(voiceLanguage.all_additional_locales)
      : undefined;
    const usesAgentLanguageFallback =
      !hasVoiceLanguage || allAdditionalLocales === true;
    const voiceDefaultLocale = hasVoiceLanguage
      ? extractStringValue(voiceLanguage.default_locale)
      : undefined;

    const effectiveVoiceLocales = resolveEffectiveVoiceLocales(root, voice);

    // Check A: the voice languages must be a subset of the top-level text languages.
    // Only the agent-level 'all_additional_locales: True' lifts this requirement: it opens
    // the text language block to every supported locale, so there is no declared subset
    // to check against. The voice block's own flag does not.
    if (hasVoiceLanguage && !usesAgentLanguageFallback) {
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
      } else if (
        extractBooleanValue(textLanguage.all_additional_locales) !== true
      ) {
        const textLocales = collectLocales(textLanguage);

        const defaultLocale = voiceDefaultLocale;
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

    // Check B: each language_settings key must be a declared voice language (explicit or derived).
    if (hasVoiceSettings) {
      if (effectiveVoiceLocales !== undefined) {
        for (const [langKey, decl] of voiceSettings) {
          if (!effectiveVoiceLocales.has(langKey)) {
            attachDiagnostic(
              decl as AstNodeLike,
              lintDiagnostic(
                getBlockRange(decl as AstNodeLike),
                `Voice language setting '${langKey}' is not a declared voice language. Add it to the voice 'language' block's 'default_locale' or 'additional_locales', or add it to the agent's 'language' block.`,
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

/**
 * Warns when top-level `outbound: pronunciations` is set while several voice languages are in effect:
 * the compiler applies it to the default language only (see `moveRootPronunciationsToDefaultLanguage`).
 */
class VoicePronunciationsPass implements LintPass {
  readonly id = storeKey('voice-pronunciations');
  readonly description =
    'Warns that top-level voice pronunciations apply to the default language only when several voice languages are configured';

  run(_store: PassStore, root: AstRoot): void {
    const modality = root.modality;
    if (!isNamedMap(modality) || !modality.has('voice')) return;

    const voice = modality.get('voice') as AstNodeLike;
    const rootPronunciations = (voice.outbound as AstNodeLike | undefined)
      ?.pronunciations;
    if (extractSequenceItems(rootPronunciations).length === 0) return;

    const locales = resolveEffectiveVoiceLocales(root, voice);
    if (locales === undefined || locales.size <= 1) return;

    attachDiagnostic(
      voice,
      lintDiagnostic(
        getBlockRange(rootPronunciations),
        "Multiple voice languages are configured, so 'outbound: pronunciations' is used for the default language only, and it is ignored there if 'language_settings.<default locale>.outbound.pronunciations' is set, because language settings take priority. Add 'pronunciations' under 'language_settings.<locale>.outbound' for the other languages.",
        DiagnosticSeverity.Warning,
        'voice-pronunciations-default-locale-only'
      )
    );
  }
}

export function voicePronunciationsRule(): LintPass {
  return new VoicePronunciationsPass();
}

// --- V1/V2 voice property mixing detection ---

// additional_config is shared by both V1 and V2
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
