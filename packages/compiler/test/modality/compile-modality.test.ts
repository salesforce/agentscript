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
    const voiceOutput = output.agent_version.modality_parameters.voice;
    expect(voiceOutput.voice2_config.outbound.voice_id).toBe('0VPx123456789ab');
    expect(voiceOutput.voice2_config.mode).toBe('Multilingual');
    const deLang = voiceOutput.voice2_config.languages.find(
      lang => lang.language_code === 'de'
    );
    expect(deLang.inbound.model.id).toBe('0VMx123456789yx');
    expect(voiceOutput.voice2_config.languages[0].language_code).toBe('de');
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
        output.agent_version.modality_parameters.voice.voice2_config.languages;

      expect(languages.map(language => language.language_code)).toEqual([
        'en_US',
        ...expected,
      ]);
      expect(diagnostics).toHaveLength(0);
    }
  );
});
