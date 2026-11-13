/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../src/compile.js';
import { parseSource } from '../test-utils.js';

// ---------------------------------------------------------------------------
// Basic Voice compilation tests
// ---------------------------------------------------------------------------

describe('compile()', () => {
  it('compiles the Japanese Kotoba STT model, parameters, and keywords unchanged', () => {
    const source = `
config:
  agent_name: "KotobaTest"
  agent_type: "AgentforceServiceAgent"
  default_agent_user: "test@example.com"

language:
  default_locale: "en_US"
  additional_locales:
    - "ja"

modality voice:
  language:
    default_locale: "en_US"
    additional_locales:
      - "ja"

  session_language_switching: "Monolingual"

  inbound:
    model:
      id: "nova-3"

  language_settings:
    ja:
      inbound:
        model:
          id: "EinsteinKotobaSTT"
          parameters:
            silence_duration_ms: 0
            kana: False
        keywords:
          - "サータック"

start_agent main:
  description: "test"
`.trimStart();

    const { output, diagnostics } = compile(parseSource(source));
    const voice =
      output.agent_version.modality_parameters!.voice!.voice2_config!;
    const japanese = voice.languages!.find(
      language => language.language_code === 'ja'
    );

    expect(diagnostics).toHaveLength(0);
    expect(voice.inbound!.model!.id).toBe('nova-3');
    expect(japanese!.inbound!.model).toEqual({
      id: 'EinsteinKotobaSTT',
      params: { silence_duration_ms: 0, kana: false },
    });
    expect(japanese!.inbound!.keywords).toEqual(['サータック']);
  });

  it('does not invent Kotoba STT parameter defaults when parameters are omitted', () => {
    const source = `
config:
  agent_name: "KotobaDefaultsTest"
  agent_type: "AgentforceServiceAgent"
  default_agent_user: "test@example.com"

language:
  default_locale: "ja"

modality voice:
  language:
    default_locale: "ja"

  session_language_switching: "Monolingual"

  inbound:
    model:
      id: "EinsteinKotobaSTT"

start_agent main:
  description: "test"
`.trimStart();

    const { output, diagnostics } = compile(parseSource(source));
    const inbound =
      output.agent_version.modality_parameters!.voice!.voice2_config!.inbound!;

    expect(diagnostics).toHaveLength(0);
    expect(inbound.model).toEqual({ id: 'EinsteinKotobaSTT' });
  });

  it('should compile modality voice', () => {
    const fullVoiceSourceV2 = `
language:
    default_locale: "de"
    additional_locales:
        - fr_CA
        - it

modality voice:
  language:
    default_locale: "de"
    additional_locales:
      - fr_CA
      - it

  session_language_switching: "Multilingual"

  outbound:
    persona_id: "0VPx123456789ab"
    model:
      id: "SalesforceInternal"
      parameters:
        speed: 0.8
        stability: 1.0
        prompt: "Use an average speed voice with large variances of tonality."

    pronunciation_dict:
        - grapheme: "whatwhat"
          phoneme: "whætwhæt"
          type: "IPA"

        - grapheme: "Eliquis"
          phoneme: "ɛlɪkwɪs"
          type: "IPA"

  inbound:
    keywords:
        - "urgent"
        - "emergency"
        - "help"

    model:
      id: "0VMx123456789yz"
      parameters:
        prompt: "Try two passes"

  language_settings:
    fr_CA:
      outbound:
        model:
          id: "0VMx123456789ab"
          parameters:
            prompt: "Oui"
    
        persona_id: "0VPx123456789ab"

    de:
      inbound:
        model:
          id: "0VMx123456789yx"        
    
    it:
      inbound:
        keywords:
          - "urgent_it"
          - "emergency_it"
          - "help_it"

`.trimStart();

    const ast = parseSource(fullVoiceSourceV2);
    const { output } = compile(ast);
    const voiceOutput = output.agent_version.modality_parameters!.voice!;
    expect(voiceOutput.voice2_config!.outbound!.voice_id).toBe(
      '0VPx123456789ab'
    );
    expect(voiceOutput.voice2_config!.mode).toBe('Multilingual');
    const deLang = voiceOutput.voice2_config!.languages!.find(
      lang => lang.language_code === 'de'
    )!;
    expect(deLang.inbound!.model!.id).toBe('0VMx123456789yx');
    expect(voiceOutput.voice2_config!.languages![0].language_code).toBe('de');
  });

  it.each([
    ['bare', '      - in\n      - is', ['in', 'is']],
    ['quoted', '      - "fr"\n      - "de"', ['fr', 'de']],
    ['mixed', '      - fr\n      - "de"', ['fr', 'de']],
  ])(
    'compiles a %s voice.language locale sequence',
    (_variant, members, expected) => {
      const source = `
config:
  agent_name: "VoiceLocaleListBot"

language:
  default_locale: "en_US"
  additional_locales:
${members}

modality voice:
  language:
    default_locale: "en_US"
    additional_locales:
${members}

start_agent main:
  description: "test"
`;
      const { output, diagnostics } = compile(parseSource(source));
      const languages =
        output.agent_version.modality_parameters!.voice!.voice2_config!
          .languages!;

      expect(languages.map(language => language.language_code)).toEqual([
        'en_US',
        ...expected,
      ]);
      expect(diagnostics).toHaveLength(0);
    }
  );

  describe('voice language block fallback (V2 only)', () => {
    it('derives voice.languages from agent-level language block when voice.language is absent', () => {
      const source = `
config:
  agent_name: "NoVoiceLanguageBlock"
  agent_type: "AgentforceEmployeeAgent"

language:
  default_locale: "es"
  additional_locales:
    - "en_GB"
  all_additional_locales: True

modality voice:
  outbound:
    persona_id: "Christina"
    model:
      id: "elevenlabs"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages).toBeDefined();
      // Fallback emits only the default_locale.
      expect(voice.languages!.map(l => l.language_code)).toEqual(['es']);
      // Root persona applies to all locales
      expect(voice.outbound!.voice_id).toBe('Christina');
      expect(voice.languages![0].outbound).toBeUndefined();
    });

    it('emits only the default locale regardless of all_additional_locales', () => {
      const source = `
config:
  agent_name: "AllLocalesAgent"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
  all_additional_locales: True

modality voice:
  outbound:
    persona_id: "Mark"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages!.map(l => l.language_code)).toEqual(['en_US']);
    });

    it('applies language_settings to the derived default voice language', () => {
      const source = `
config:
  agent_name: "LanguageSettingsAgent"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
  all_additional_locales: True

modality voice:
  outbound:
    persona_id: "Christina"
    model:
      id: "elevenlabs"

  language_settings:
    en_US:
      outbound:
        model:
          id: "en-us-tts"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;
      const enLang = voice.languages!.find(l => l.language_code === 'en_US');

      expect(diagnostics).toHaveLength(0);
      expect(enLang!.outbound!.model!.id).toBe('en-us-tts');
      // Root persona still applies
      expect(voice.outbound!.voice_id).toBe('Christina');
    });

    it('rejects language_settings for a locale that is not the derived default', () => {
      const source = `
config:
  agent_name: "LanguageSettingsValidation"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
  all_additional_locales: True

modality voice:
  outbound:
    persona_id: "Christina"

  language_settings:
    es:
      outbound:
        model:
          id: "spanish-tts"

start_agent main:
  description: "test"
`.trimStart();

      const { diagnostics } = compile(parseSource(source));

      const hasLanguageSettingsError = diagnostics.some(d =>
        d.message.includes("Invalid voice language_settings tag 'es'")
      );
      expect(hasLanguageSettingsError).toBe(true);
    });

    it('derives only the default locale when deriving from agent language block, even with additional_locales present', () => {
      const source = `
config:
  agent_name: "InvalidLocaleAgent"

language:
  default_locale: "en_US"
  additional_locales:
    - "invalid_locale"
    - "es"
  all_additional_locales: True

modality voice:
  outbound:
    persona_id: "Mark"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      // The invalid additional_locale is still reported by the top-level language block.
      expect(voice.languages!.map(l => l.language_code)).toEqual(['en_US']);
      expect(diagnostics.length).toBeGreaterThan(0);
    });

    it('does not use fallback when voice.language block is present', () => {
      const source = `
config:
  agent_name: "ExplicitVoiceLanguage"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"

modality voice:
  language:
    default_locale: "de"
    additional_locales:
      - "fr"

  outbound:
    persona_id: "Mark"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      // Uses voice.language, not agent language
      expect(voice.languages!.map(l => l.language_code)).toEqual(['de', 'fr']);
    });

    it('returns undefined when no language is available (no agent language and no voice.language)', () => {
      const source = `
config:
  agent_name: "NoLanguageBot"

modality voice:
  outbound:
    persona_id: "Mark"

start_agent main:
  description: "test"
`.trimStart();

      const { output } = compile(parseSource(source));
      const voice = output.agent_version.modality_parameters!.voice!;

      expect(voice.voice2_config!.languages).toBeUndefined();
    });

    it('does NOT derive voice.languages from agent language when V1 voice properties present', () => {
      const source = `
config:
  agent_name: "V1VoiceAgent"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"

modality voice:
  voice_id: "voice-123"
  outbound_speed: 1.5

start_agent main:
  description: "test"
`.trimStart();

      const { output } = compile(parseSource(source));
      const voice = output.agent_version.modality_parameters!.voice!;

      // V1 properties present, so no V2 fallback
      expect(voice.voice2_config).toBeUndefined();
      // V1 config should be present
      expect(voice.voice_id).toBe('voice-123');
      expect(voice.outbound_speed).toBe(1.5);
    });

    it('reproduces the user AEACS1 script: voice.languages derived from agent language', () => {
      const source = `
config:
    agent_label: "AEACS1"
    agent_template: "EmployeeCopilot__AgentforceEmployeeAgent"
    developer_name: "AEACS1"
    agent_type: "AgentforceEmployeeAgent"
    description: "test"

model_config:
    model: "model://sfdc_ai__DefaultOpenAIGPT56Luna"

language:
    default_locale: "en_US"
    all_additional_locales: False
    additional_locales:
        - "es"

modality voice:
    outbound:
        persona_id: "a1cab32407b7"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages).toBeDefined();
      expect(voice.languages!.map(l => l.language_code)).toEqual(['en_US']);
      // Persona applies at root level
      expect(voice.outbound!.voice_id).toBe('a1cab32407b7');
      // No per-locale overrides
      expect(voice.languages![0].outbound).toBeUndefined();
    });
  });

  describe('voice language all_additional_locales fallback (V2 only)', () => {
    it('derives voice.languages from agent language when voice.language.all_additional_locales is true', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesAgent"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
    - "fr"
  all_additional_locales: True

modality voice:
  language:
    default_locale: "en_US"
    all_additional_locales: True

  outbound:
    persona_id: "Christina"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      // Explicit all_additional_locales: True expands to the agent's full locale set.
      expect(voice.languages!.map(l => l.language_code)).toEqual([
        'en_US',
        'es',
        'fr',
      ]);
      // Root persona applies to all locales
      expect(voice.outbound!.voice_id).toBe('Christina');
    });

    it('does not require voice.language.default_locale when all_additional_locales is true', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesNoDefault"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
    - "fr"
  all_additional_locales: True

modality voice:
  language:
    all_additional_locales: True

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages!.map(l => l.language_code)).toEqual([
        'en_US',
        'es',
        'fr',
      ]);
    });

    it('keeps the voice default_locale at index 0 but ignores voice additional_locales when all_additional_locales is true', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesIgnoresExplicit"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
  all_additional_locales: True

modality voice:
  language:
    default_locale: "de"
    additional_locales:
      - "fr"
    all_additional_locales: True

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      // Voice default 'de' leads; voice additional 'fr' is replaced by the agent's locales.
      expect(voice.languages!.map(l => l.language_code)).toEqual([
        'de',
        'en_US',
        'es',
      ]);
    });

    it('moves a voice default_locale that is an agent additional locale to index 0 without duplicating it', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesVoiceDefault"

language:
  default_locale: "en_US"
  additional_locales:
    - "it"
    - "es"
  all_additional_locales: True

modality voice:
  language:
    default_locale: "it"
    all_additional_locales: True

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages!.map(l => l.language_code)).toEqual([
        'it',
        'en_US',
        'es',
      ]);
    });

    it('emits only the voice default and additional locales when voice.language omits all_additional_locales, even if the agent declares more', () => {
      const source = `
config:
  agent_name: "ExplicitVoiceLocalesJa"

language:
  default_locale: "fr_CA"
  additional_locales:
    - "en_US"
    - "es_MX"
    - "ja"
    - "it"
  all_additional_locales: True

modality voice:
  language:
    default_locale: "ja"
    additional_locales:
      - "it"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages!.map(l => l.language_code)).toEqual(['ja', 'it']);
    });

    it('rejects an unsupported voice default_locale when all_additional_locales is true', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesInvalidVoiceDefault"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
  all_additional_locales: True

modality voice:
  language:
    default_locale: "invalid_locale"
    all_additional_locales: True

start_agent main:
  description: "test"
`.trimStart();

      const { diagnostics } = compile(parseSource(source));

      expect(
        diagnostics.some(d =>
          d.message.includes(
            "Invalid voice default language code 'invalid_locale'"
          )
        )
      ).toBe(true);
    });

    it('applies language_settings to a non-default locale derived via all_additional_locales', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesWithSettings"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"
  all_additional_locales: True

modality voice:
  language:
    all_additional_locales: True

  outbound:
    persona_id: "Christina"

  language_settings:
    es:
      outbound:
        model:
          id: "spanish-tts"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;
      const esLang = voice.languages!.find(l => l.language_code === 'es');

      expect(diagnostics).toHaveLength(0);
      expect(esLang!.outbound!.model!.id).toBe('spanish-tts');
      // Root persona still applies
      expect(voice.outbound!.voice_id).toBe('Christina');
    });

    it('does not derive locales when all_additional_locales is false', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesFalse"

language:
  default_locale: "en_US"
  additional_locales:
    - "es"

modality voice:
  language:
    default_locale: "en_US"
    all_additional_locales: False

  outbound:
    persona_id: "Christina"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      expect(diagnostics).toHaveLength(0);
      expect(voice.languages!.map(l => l.language_code)).toEqual(['en_US']);
    });

    it('falls back to the agent default_locale when all_additional_locales is false and voice.language omits default_locale', () => {
      const source = `
config:
  agent_name: "AllAdditionalLocalesFalseNoVoiceDefault"

language:
  default_locale: "en_US"
  additional_locales:
    - "en_GB"
  all_additional_locales: True

modality voice:
  outbound:
    persona_id: "74752e92d40e"

  language:
    all_additional_locales: False

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice =
        output.agent_version.modality_parameters!.voice!.voice2_config!;

      // No voice default_locale, so fall back to the agent's (not "Invalid voice default language code 'undefined'").
      expect(diagnostics).toHaveLength(0);
      expect(voice.languages!.map(l => l.language_code)).toEqual(['en_US']);
    });

    it('still errors on a missing default_locale when voice.language is present but empty (not all_additional_locales: False)', () => {
      // Regression: the agent default_locale fallback is scoped to all_additional_locales: False.
      const source = `
config:
  agent_name: "EmptyVoiceLanguageBlock"

language:
  default_locale: "en_US"
  additional_locales:
    - "en_GB"
  all_additional_locales: True

modality voice:
  language:

  outbound:
    persona_id: "74752e92d40e"

start_agent main:
  description: "test"
`.trimStart();

      const { diagnostics } = compile(parseSource(source));

      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0].message).toContain(
        "Invalid voice default language code 'undefined'"
      );
    });

    it('rejects a language_settings tag naming a locale the agent lacks (fallback path)', () => {
      const source = `
config:
  agent_name: "LanguageSettingsNoLanguageBlock"
  agent_type: "AgentforceServiceAgent"
  default_agent_user: "test@example.com"

language:
  default_locale: "en_US"

modality voice:
  outbound:
    persona_id: "Christina"

  language_settings:
    es:
      outbound:
        model:
          id: "spanish-tts"

start_agent main:
  description: "test"
`.trimStart();

      const { diagnostics } = compile(parseSource(source));

      const hasLanguageSettingsError = diagnostics.some(d =>
        d.message.includes("Invalid voice language_settings tag 'es'")
      );
      expect(hasLanguageSettingsError).toBe(true);
    });

    it('does not validate language_settings in the compiler when no agent language block exists either (lint owns this case)', () => {
      const source = `
config:
  agent_name: "LanguageSettingsNoLanguageBlockAtAll"
  agent_type: "AgentforceServiceAgent"
  default_agent_user: "test@example.com"

modality voice:
  outbound:
    persona_id: "Christina"

  language_settings:
    es:
      outbound:
        model:
          id: "spanish-tts"

start_agent main:
  description: "test"
`.trimStart();

      const { output, diagnostics } = compile(parseSource(source));
      const voice = output.agent_version.modality_parameters!.voice!;

      // Lint's voice-language-settings-not-declared pass flags this case.
      expect(voice.voice2_config!.languages).toBeUndefined();
      expect(
        diagnostics.some(d =>
          d.message.includes("Invalid voice language_settings tag 'es'")
        )
      ).toBe(false);
    });
  });
});
