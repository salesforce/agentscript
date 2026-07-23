/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { parseAndLint, SequenceNode, isNamedMap } from '@agentscript/language';
import { agentforceDialect } from '../index.js';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
} from './test-utils.js';

/**
 * For properties that exist in both Voice V1 and V2, this data structure maps the JSON-like paths to each property for each schema version.
 * This allows for parameterized tests across both schema versions without hard coding the paths in the tests themselves.
 * Index 0: VoiceSchemas.V1
 * Index 1: VoiceSchemas.V2
 */
const Schema_Paths = {
  keywords: [
    ['inbound_keywords', 'keywords'],
    ['inbound', 'keywords'],
  ],
  personaId: [['voice_id'], ['outbound', 'persona_id']],
  pronunciations: [['pronunciation_dict'], ['outbound', 'pronunciations']],
};

enum VoiceSchemas {
  V1,
  V2,
}

/**
 * Helper function to dynamically walk different schema paths to get a property value
 */
function getProperty(obj: unknown, path: string[]): unknown {
  return path.reduce(
    (cur: unknown, key) =>
      cur != null && typeof cur === 'object'
        ? (cur as Record<string, unknown>)[key]
        : undefined,
    obj
  );
}

// ============================================================================
// Modality block parsing
// ============================================================================

describe('modality block', () => {
  const fullVoiceSourceV1 = `
modality voice:
    inbound_filler_words_detection: True
    inbound_keywords:
        keywords:
            - "urgent"
            - "emergency"
            - "help"
    voice_id: "EQx6HGDYjkDpcli6vorJ"
    outbound_speed: 1.0
    outbound_style_exaggeration: 0.5
    outbound_stability: 0.5
    outbound_similarity: 0.75
    pronunciation_dict:
        - grapheme: "Eliquis"
          phoneme: "ɛlɪkwɪs"
          type: "IPA"
    outbound_filler_sentences:
        - "Let me look into it..."
        - "Give me a moment..."
    additional_configs:
        speak_up_config:
            speak_up_first_wait_time_ms: 10000
            speak_up_follow_up_wait_time_ms: 10000
            speak_up_message: "Are you still there?"
        endpointing_config:
            max_wait_time_ms: 1000
        beepboop_config:
            max_wait_time_ms: 1000
`.trimStart();

  const fullVoiceSourceV2 = `
language:
    default_locale: "fr_CA"
    additional_locales: "de,it"

modality voice:
    session_language_switching: "Multilingual"

    inbound:
        keywords:
            - "urgent"
            - "emergency"
            - "help"
        model:
            id: "0VMx123456789yz"
            parameters:
                prompt: "Try two passes"

    outbound:
        model:
            id: "SalesforceInternal"
            parameters:
              speed: 0.8
              stability: 1.0
              prompt: "Use an average speed voice with large variances of tonality."

        persona_id: "0VPx123456789ab"

        pronunciations:
            - grapheme: "whatwhat"
              phoneme: "whætwhæt"
              type: "IPA"

            - grapheme: "Eliquis"
              phoneme: "ɛlɪkwɪs"
              type: "IPA"

    languages:

        fr_CA:
            is_default: True

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

  it.each([
    {
      source: fullVoiceSourceV1,
      schemaVersion: VoiceSchemas.V1,
      expectedKeywords: ['urgent', 'emergency', 'help'],
      expectedFillerWordsKind: 'BooleanValue',
      expectedFillerWordsValue: true,
      expectedVoiceIdKind: 'StringLiteral',
      expectedVoiceId: 'EQx6HGDYjkDpcli6vorJ',
      expectedOutboundSpeedKind: 'NumberValue',
      expectedOutboundSpeed: 1.0,
      expectedStyleExaggerationKind: 'NumberValue',
      expectedStyleExaggeration: 0.5,
      expectedStabilityKind: 'NumberValue',
      expectedStability: 0.5,
      expectedSimilarityKind: 'NumberValue',
      expectedSimilarity: 0.75,
      expectedAdditionalConfigsKind: 'AdditionalConfigsBlock',
      expectedSpeakUpConfigKind: 'SpeakUpConfigBlock',
      expectedSpeakUpFirstWait: 10000,
      expectedSpeakUpMessage: 'Are you still there?',
      expectedEndpointingMaxWait: 1000,
      expectedBeepboopMaxWait: 1000,
      expectedAutoHangupKind: undefined,
      expectedAutoHangup: undefined,
      expectedModelIdKind: undefined,
      expectedModelId: undefined,
      expectedModelParametersKind: undefined,
      expectedInboundModelIdKind: undefined,
      expectedInboundModelId: undefined,
      expectedPersonaIdKind: undefined,
      expectedPersonaId: undefined,
      expectedSessionLanguageSwitchingKind: undefined,
      expectedSessionLanguageSwitching: undefined,
      expectedLanguagesIsNamedMap: undefined,
    },
    {
      source: fullVoiceSourceV2,
      schemaVersion: VoiceSchemas.V2, // Voice V2
      expectedKeywords: ['urgent', 'emergency', 'help'],
      expectedFillerWordsKind: undefined,
      expectedFillerWordsValue: undefined,
      expectedVoiceIdKind: 'StringLiteral',
      expectedVoiceId: '0VPx123456789ab',
      expectedOutboundSpeedKind: undefined,
      expectedOutboundSpeed: undefined,
      expectedStyleExaggerationKind: undefined,
      expectedStyleExaggeration: undefined,
      expectedStabilityKind: undefined,
      expectedStability: undefined,
      expectedSimilarityKind: undefined,
      expectedSimilarity: undefined,
      expectedAdditionalConfigsKind: undefined,
      expectedSpeakUpConfigKind: undefined,
      expectedSpeakUpFirstWait: undefined,
      expectedSpeakUpMessage: undefined,
      expectedEndpointingMaxWait: undefined,
      expectedBeepboopMaxWait: undefined,
      expectedAllLanguagesKind: 'BooleanValue',
      expectedAllLanguages: true,
      expectedAutoHangupKind: 'BooleanValue',
      expectedAutoHangup: true,
      expectedModelIdKind: 'StringLiteral',
      expectedModelId: 'SalesforceInternal',
      expectedModelParametersKind: 'VoiceModelParametersBlock',
      expectedInboundModelIdKind: 'StringLiteral',
      expectedInboundModelId: '0VMx123456789yz',
      expectedPersonaIdKind: 'StringLiteral',
      expectedPersonaId: '0VPx123456789ab',
      expectedSessionLanguageSwitchingKind: 'StringLiteral',
      expectedSessionLanguageSwitching: 'Multilingual',
      expectedLanguagesIsNamedMap: true,
    },
  ])(
    'parses a full voice modality (VoiceSchema $schemaVersion)',
    ({
      source,
      schemaVersion,
      expectedKeywords,
      expectedFillerWordsKind,
      expectedFillerWordsValue,
      expectedVoiceIdKind,
      expectedVoiceId,
      expectedOutboundSpeedKind,
      expectedOutboundSpeed,
      expectedStyleExaggerationKind,
      expectedStyleExaggeration,
      expectedStabilityKind,
      expectedStability,
      expectedSimilarityKind,
      expectedSimilarity,
      expectedAdditionalConfigsKind,
      expectedSpeakUpConfigKind,
      expectedSpeakUpFirstWait,
      expectedSpeakUpMessage,
      expectedEndpointingMaxWait,
      expectedBeepboopMaxWait,
      expectedModelIdKind,
      expectedModelId,
      expectedModelParametersKind,
      expectedInboundModelIdKind,
      expectedInboundModelId,
      expectedPersonaIdKind,
      expectedPersonaId,
      expectedSessionLanguageSwitchingKind,
      expectedSessionLanguageSwitching,
      expectedLanguagesIsNamedMap,
    }) => {
      const ast = parseDocument(source);
      const modality = ast.modality!;
      expect(isNamedMap(modality)).toBe(true);
      expect(modality.has('voice')).toBe(true);

      const voice = modality.get('voice')!;
      expect(voice.__kind).toBe('ModalityBlock');

      // Inbound keywords
      // handles different paths for V1/V2 dynamically
      const keywords = getProperty(
        voice,
        Schema_Paths.keywords[schemaVersion]
      ) as Record<string, unknown>;

      expect(keywords.__kind).toBe('Sequence');
      const keywordItems = (keywords as unknown as SequenceNode).items;
      expect(keywordItems).toHaveLength(expectedKeywords.length);
      expectedKeywords.forEach((expectedKeyword, index) => {
        expect((keywordItems[index] as Record<string, unknown>).value).toBe(
          expectedKeyword
        );
      });

      // Filler words detection
      const fillerWordsDetection = voice.inbound_filler_words_detection as
        | Record<string, unknown>
        | undefined;
      expect(fillerWordsDetection?.__kind).toBe(expectedFillerWordsKind);
      expect(fillerWordsDetection?.value).toBe(expectedFillerWordsValue);

      // Voice ID
      // handles different paths for V1/V2 dynamically
      const voiceId = getProperty(
        voice,
        Schema_Paths.personaId[schemaVersion]
      ) as Record<string, unknown> | undefined;
      expect(voiceId?.__kind).toBe(expectedVoiceIdKind);
      expect(voiceId?.value).toBe(expectedVoiceId);

      // Outbound speed
      const outboundSpeed = voice.outbound_speed as
        | Record<string, unknown>
        | undefined;
      expect(outboundSpeed?.__kind).toBe(expectedOutboundSpeedKind);
      expect(outboundSpeed?.value).toBe(expectedOutboundSpeed);

      // Style exaggeration
      const styleExaggeration = voice.outbound_style_exaggeration as
        | Record<string, unknown>
        | undefined;
      expect(styleExaggeration?.__kind).toBe(expectedStyleExaggerationKind);
      expect(styleExaggeration?.value).toBe(expectedStyleExaggeration);

      // Stability
      const stability = voice.outbound_stability as
        | Record<string, unknown>
        | undefined;
      expect(stability?.__kind).toBe(expectedStabilityKind);
      expect(stability?.value).toBe(expectedStability);

      // Similarity
      const similarity = voice.outbound_similarity as
        | Record<string, unknown>
        | undefined;
      expect(similarity?.__kind).toBe(expectedSimilarityKind);
      expect(similarity?.value).toBe(expectedSimilarity);

      // Additional configs
      const additionalConfigs = voice.additional_configs as
        | Record<string, unknown>
        | undefined;
      expect(additionalConfigs?.__kind).toBe(expectedAdditionalConfigsKind);

      const speakUpConfig = additionalConfigs?.speak_up_config as
        | Record<string, unknown>
        | undefined;
      expect(speakUpConfig?.__kind).toBe(expectedSpeakUpConfigKind);

      const speakUpFirstWait = speakUpConfig?.speak_up_first_wait_time_ms as
        | Record<string, unknown>
        | undefined;
      expect(speakUpFirstWait?.value).toBe(expectedSpeakUpFirstWait);

      const speakUpMessage = speakUpConfig?.speak_up_message as
        | Record<string, unknown>
        | undefined;
      expect(speakUpMessage?.value).toBe(expectedSpeakUpMessage);

      const endpointingConfig = additionalConfigs?.endpointing_config as
        | Record<string, unknown>
        | undefined;
      const endpointingMaxWait = endpointingConfig?.max_wait_time_ms as
        | Record<string, unknown>
        | undefined;
      expect(endpointingMaxWait?.value).toBe(expectedEndpointingMaxWait);

      const beepboopConfig = additionalConfigs?.beepboop_config as
        | Record<string, unknown>
        | undefined;
      const beepboopMaxWait = beepboopConfig?.max_wait_time_ms as
        | Record<string, unknown>
        | undefined;
      expect(beepboopMaxWait?.value).toBe(expectedBeepboopMaxWait);

      // V2-specific fields
      const modelId = voice.outbound?.model?.id as
        | Record<string, unknown>
        | undefined;
      expect(modelId?.__kind).toBe(expectedModelIdKind);
      expect(modelId?.value).toBe(expectedModelId);

      const modelParameters = voice.outbound?.model?.parameters as
        | Record<string, unknown>
        | undefined;
      expect(modelParameters?.__kind).toBe(expectedModelParametersKind);

      const inboundModelId = voice.inbound?.model?.id as
        | Record<string, unknown>
        | undefined;
      expect(inboundModelId?.__kind).toBe(expectedInboundModelIdKind);
      expect(inboundModelId?.value).toBe(expectedInboundModelId);

      const personaId = voice.outbound?.persona_id as
        | Record<string, unknown>
        | undefined;
      expect(personaId?.__kind).toBe(expectedPersonaIdKind);
      expect(personaId?.value).toBe(expectedPersonaId);

      const sessionLanguageSwitching = voice.session_language_switching as
        | Record<string, unknown>
        | undefined;
      expect(sessionLanguageSwitching?.__kind).toBe(
        expectedSessionLanguageSwitchingKind
      );
      expect(sessionLanguageSwitching?.value).toBe(
        expectedSessionLanguageSwitching
      );

      const languages = voice.languages as Record<string, unknown> | undefined;
      expect(languages !== undefined ? isNamedMap(languages) : undefined).toBe(
        expectedLanguagesIsNamedMap
      );
    }
  );

  it.each([
    {
      source: fullVoiceSourceV1,
      schemaVersion: VoiceSchemas.V1, // Voice V1
      expectedDictCount: 1,
      expectedFirstGrapheme: 'Eliquis',
      expectedFirstPhoneme: 'ɛlɪkwɪs',
      expectedFirstType: 'IPA',
    },
    {
      source: fullVoiceSourceV2,
      schemaVersion: VoiceSchemas.V2, // Voice V2
      expectedDictCount: 2,
      expectedFirstGrapheme: 'whatwhat',
      expectedFirstPhoneme: 'whætwhæt',
      expectedFirstType: 'IPA',
    },
  ])(
    'parses pronunciation_dict as a Sequence of blocks (VoiceSchema $schemaVersion)',
    ({
      source,
      schemaVersion,
      expectedDictCount,
      expectedFirstGrapheme,
      expectedFirstPhoneme,
      expectedFirstType,
    }) => {
      const ast = parseDocument(source);
      const modality = ast.modality!;
      const voice = modality.get('voice')!;

      const pronunciationDict = getProperty(
        voice,
        Schema_Paths.pronunciations[schemaVersion]
      ) as SequenceNode;

      expect(pronunciationDict.__kind).toBe('Sequence');
      expect(pronunciationDict.items).toHaveLength(expectedDictCount);

      const block = pronunciationDict.items[0] as unknown as Record<
        string,
        unknown
      >;
      expect(block.__kind).toBe('PronunciationDictEntryBlock');
      expect((block.grapheme as Record<string, unknown>).value).toBe(
        expectedFirstGrapheme
      );
      expect((block.phoneme as Record<string, unknown>).value).toBe(
        expectedFirstPhoneme
      );
      expect((block.type as Record<string, unknown>).value).toBe(
        expectedFirstType
      );
    }
  );

  it.each([
    {
      schemaVersion: VoiceSchemas.V1,
      source: fullVoiceSourceV1,
      expectedErrorCount: 0,
    },
    {
      schemaVersion: VoiceSchemas.V2,
      source: fullVoiceSourceV2,
      expectedErrorCount: 0,
    },
  ])(
    'produces no diagnostics for valid voice modality (VoiceSchema $schemaVersion)',
    ({ source, expectedErrorCount }) => {
      const { diagnostics } = parseWithDiagnostics(source);
      const errors = diagnostics.filter(
        d =>
          d.code !== 'unknown-block' &&
          d.code !== 'syntax-error' &&
          d.code !== 'deprecated-field'
      );
      expect(errors).toHaveLength(expectedErrorCount);
    }
  );

  it.each([
    {
      schemaVersion: VoiceSchemas.V1,
      source: fullVoiceSourceV1,
      expectedVoiceId: 'EQx6HGDYjkDpcli6vorJ',
      expectedOutboundSpeed: 1.0,
      expectedDictCount: 1,
      expectedAdditionalConfigsDefined: true,
      expectedSpeakUpConfigDefined: true,
      expectedModelId: undefined,
      expectedPersonaId: undefined,
      expectedLanguagesIsNamedMap: undefined,
    },
    {
      schemaVersion: VoiceSchemas.V2,
      source: fullVoiceSourceV2,
      expectedVoiceId: undefined,
      expectedOutboundSpeed: undefined,
      expectedDictCount: 2,
      expectedAdditionalConfigsDefined: undefined,
      expectedSpeakUpConfigDefined: undefined,
      expectedModelId: 'SalesforceInternal',
      expectedPersonaId: '0VPx123456789ab',
      expectedLanguagesIsNamedMap: true,
    },
  ])(
    'emits and re-parses a voice modality (roundtrip) (VoiceSchema $schemaVersion)',
    ({
      schemaVersion,
      source,
      expectedVoiceId,
      expectedOutboundSpeed,
      expectedDictCount,
      expectedAdditionalConfigsDefined,
      expectedSpeakUpConfigDefined,
      expectedModelId,
      expectedPersonaId,
      expectedLanguagesIsNamedMap,
    }) => {
      const ast = parseDocument(source);
      const emitted = emitDocument(ast);

      // Re-parse the emitted output
      const ast2 = parseDocument(emitted);
      const modality2 = ast2.modality!;
      expect(modality2.has('voice')).toBe(true);

      const voice2 = modality2.get('voice')!;

      // Verify key fields survive roundtrip
      const voiceId2 = voice2.voice_id as Record<string, unknown> | undefined;
      expect(voiceId2?.value).toBe(expectedVoiceId);

      const outboundSpeed2 = voice2.outbound_speed as
        | Record<string, unknown>
        | undefined;
      expect(outboundSpeed2?.value).toBe(expectedOutboundSpeed);

      const modelId2 = voice2.outbound?.model?.id as
        | Record<string, unknown>
        | undefined;
      expect(modelId2?.value).toBe(expectedModelId);

      const personaId2 = voice2.outbound?.persona_id as
        | Record<string, unknown>
        | undefined;
      expect(personaId2?.value).toBe(expectedPersonaId);

      const dict2 = getProperty(
        voice2,
        Schema_Paths.pronunciations[schemaVersion]
      ) as SequenceNode;

      expect(dict2.items).toHaveLength(expectedDictCount);
      expect(dict2.items[0].__kind).toBe('PronunciationDictEntryBlock');

      const additionalConfigs2 = voice2.additional_configs as
        | Record<string, unknown>
        | undefined;
      expect(additionalConfigs2 !== undefined ? true : undefined).toBe(
        expectedAdditionalConfigsDefined
      );

      const speakUpConfig2 = additionalConfigs2?.speak_up_config as
        | Record<string, unknown>
        | undefined;
      expect(speakUpConfig2 !== undefined ? true : undefined).toBe(
        expectedSpeakUpConfigDefined
      );

      const languages2 = voice2.languages as
        | Record<string, unknown>
        | undefined;
      expect(
        languages2 !== undefined ? isNamedMap(languages2) : undefined
      ).toBe(expectedLanguagesIsNamedMap);
    }
  );
});

// ============================================================================
// Unknown variant diagnostics
// ============================================================================

describe('modality variant diagnostics', () => {
  it('produces an error diagnostic for an unknown modality name', () => {
    const source = `
modality chat:
    voice_id: "test123"
`;
    const { diagnostics } = parseWithDiagnostics(source);
    const variantErrors = diagnostics.filter(d => d.code === 'unknown-variant');
    expect(variantErrors).toHaveLength(1);
    expect(variantErrors[0].message).toContain('chat');
    expect(variantErrors[0].message).toContain('voice');
  });

  it('creates block entry for unknown variant but skips field parsing', () => {
    const source = `
modality chat:
    voice_id: "test123"
`;
    const { value, diagnostics } = parseWithDiagnostics(source);
    const modality = value.modality!;

    // Block entry still exists (error recovery)
    expect(modality.has('chat')).toBe(true);

    // Only the variant diagnostic — no cascading unknown-field noise
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('unknown-variant');
  });
});

// ============================================================================
// Minimal modality
// ============================================================================

describe('minimal modality', () => {
  it('parses a voice modality with a single field', () => {
    const source = `
modality voice:
    voice_id: "test123"
`;
    const ast = parseDocument(source);
    const modality = ast.modality!;
    const voice = modality.get('voice')!;
    expect((voice.voice_id as Record<string, unknown>).value).toBe('test123');
  });

  it('parses empty voice modality (no fields)', () => {
    const source = 'modality voice:\n';
    const ast = parseDocument(source);
    const modality = ast.modality!;
    expect(modality.has('voice')).toBe(true);
  });
});

// ============================================================================
// Voice range validation (during parse/lint)
// ============================================================================

describe('voice range validation', () => {
  function parseAndLintSource(source: string) {
    const { rootNode } = parse(source);
    const mappingNode =
      rootNode.namedChildren.find(n => n.type === 'mapping') ?? rootNode;
    return parseAndLint(mappingNode, agentforceDialect);
  }

  it('reports error when speak_up_follow_up_wait_time_ms is below minimum', () => {
    const source = `
config:
    agent_name: "TestBot"

modality voice:
    voice_id: "test"
    additional_configs:
        speak_up_config:
            speak_up_first_wait_time_ms: 10000
            speak_up_follow_up_wait_time_ms: 5000

start_agent main:
    description: "test"
`;
    const { diagnostics } = parseAndLintSource(source);
    const rangeErrors = diagnostics.filter(
      d =>
        d.code === 'constraint-minimum' &&
        d.message.includes('speak_up_follow_up_wait_time_ms')
    );
    expect(rangeErrors).toHaveLength(1);
    expect(rangeErrors[0].message).toContain('must be >= 10000');
    expect(rangeErrors[0].message).toContain('5000');
  });

  it('reports error when outbound_speed is above maximum', () => {
    const source = `
config:
    agent_name: "TestBot"

modality voice:
    voice_id: "test"
    outbound_speed: 3.0

start_agent main:
    description: "test"
`;
    const { diagnostics } = parseAndLintSource(source);
    const rangeErrors = diagnostics.filter(
      d =>
        d.code === 'constraint-maximum' && d.message.includes('outbound_speed')
    );
    expect(rangeErrors).toHaveLength(1);
    expect(rangeErrors[0].message).toContain('must be <= 2');
  });

  it('reports error when endpointing max_wait_time_ms is below minimum', () => {
    const source = `
config:
    agent_name: "TestBot"

modality voice:
    voice_id: "test"
    additional_configs:
        endpointing_config:
            max_wait_time_ms: 100

start_agent main:
    description: "test"
`;
    const { diagnostics } = parseAndLintSource(source);
    const rangeErrors = diagnostics.filter(
      d =>
        d.code === 'constraint-minimum' &&
        d.message.includes('max_wait_time_ms')
    );
    expect(rangeErrors).toHaveLength(1);
    expect(rangeErrors[0].message).toContain('must be >= 500');
  });

  it('reports error when pronunciation_dict entry has invalid structure (missing grapheme/phoneme/type)', () => {
    const source = `
config:
    agent_name: "TestBot"

modality voice:
    voice_id: "test"
    pronunciation_dict:
        - grapheme: "OK"
          phoneme: "oʊ keɪ"
          type: "IPA"
        - a: "b"

start_agent main:
    description: "test"
`;
    const { diagnostics } = parseAndLintSource(source);
    const missingFieldErrors = diagnostics.filter(
      d => d.code === 'missing-required-field'
    );
    expect(missingFieldErrors.length).toBeGreaterThanOrEqual(1);
    const pronunciationErrors = missingFieldErrors.filter(
      d =>
        d.message.includes('grapheme') ||
        d.message.includes('phoneme') ||
        d.message.includes('type')
    );
    expect(pronunciationErrors.length).toBeGreaterThanOrEqual(1);
  });
});
