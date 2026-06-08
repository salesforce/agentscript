import { describe, it, expect } from 'vitest';
import { compile } from '../../src/compile.js';
import { parseSource } from '../../test/test-utils.js';
import type { VoiceConfiguration } from '../../src/types.js';

/**
 * Comprehensive compiler integration tests for voice modality configuration.
 *
 * Tests verify that:
 * 1. Voice-only modality works without language block
 * 2. Output structure matches schema contracts
 * 3. Edge cases are handled correctly
 * 4. Nested structures are properly mapped
 */

describe('voice modality compilation', () => {
  // =========================================================================
  // 1. Voice-Only Modality (No Language Block)
  // =========================================================================

  describe('voice-only modality behavior', () => {
    it('should emit modality_parameters when only voice is present (no language)', () => {
      const source = `
config:
    agent_name: "VoiceOnlyBot"

modality voice:
    voice_id: "test123"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const modalityParams = output.agent_version.modality_parameters;

      // Should NOT be empty
      expect(modalityParams).toBeDefined();
      expect(Object.keys(modalityParams).length).toBeGreaterThan(0);

      // Language should be null (not present)
      expect(modalityParams.language).toBeNull();

      // Voice should be present
      expect(modalityParams.voice).toBeDefined();
      expect(modalityParams.voice?.voice_id).toBe('test123');
    });

    it('should emit empty modality_parameters when neither voice nor language present', () => {
      const source = `
config:
    agent_name: "NoModalityBot"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const modalityParams = output.agent_version.modality_parameters;
      expect(modalityParams).toEqual({});
    });

    it('should emit modality_parameters with both language and voice when both present', () => {
      const source = `
config:
    agent_name: "BothModalitiesBot"

language:
    default_locale: "en_US"

modality voice:
    voice_id: "test456"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const modalityParams = output.agent_version.modality_parameters;

      expect(modalityParams.language).toBeDefined();
      expect(modalityParams.language?.default_locale).toBe('en_US');
      expect(modalityParams.voice).toBeDefined();
      expect(modalityParams.voice?.voice_id).toBe('test456');
    });

    it('should emit modality_parameters with language only when voice absent', () => {
      const source = `
config:
    agent_name: "LanguageOnlyBot"

language:
    default_locale: "fr"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const modalityParams = output.agent_version.modality_parameters;

      expect(modalityParams.language).toBeDefined();
      expect(modalityParams.language?.default_locale).toBe('fr');
      expect(modalityParams.voice).toBeUndefined();
    });
  });

  // =========================================================================
  // 2. Inbound Keywords (Changed from Map to Array)
  // =========================================================================

  describe('inbound_keywords output mapping', () => {
    it('should compile inbound_keywords as array of strings', () => {
      const source = `
config:
    agent_name: "KeywordsBot"

modality voice:
    inbound_keywords:
        keywords:
            - "urgent"
            - "emergency"
            - "help"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.inbound_keywords).toBeDefined();
      expect(voice?.inbound_keywords?.keywords).toEqual([
        'urgent',
        'emergency',
        'help',
      ]);
    });

    it('should handle empty keywords array', () => {
      const source = `
config:
    agent_name: "EmptyKeywordsBot"

modality voice:
    inbound_keywords:
        keywords: []

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      // Empty array should not produce inbound_keywords at all
      expect(voice?.inbound_keywords).toBeUndefined();
    });

    it('should handle single keyword', () => {
      const source = `
config:
    agent_name: "SingleKeywordBot"

modality voice:
    inbound_keywords:
        keywords:
            - "urgent"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.inbound_keywords?.keywords).toEqual(['urgent']);
    });

    it('should preserve keyword order', () => {
      const source = `
config:
    agent_name: "OrderedKeywordsBot"

modality voice:
    inbound_keywords:
        keywords:
            - "first"
            - "second"
            - "third"
            - "fourth"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.inbound_keywords?.keywords).toEqual([
        'first',
        'second',
        'third',
        'fourth',
      ]);
    });
  });

  // =========================================================================
  // 3. Outbound Filler Sentences Structure
  // =========================================================================

  describe('outbound_filler_sentences output mapping', () => {
    it('should compile outbound_filler_sentences with correct nested structure', () => {
      const source = `
config:
    agent_name: "FillerSentencesBot"

modality voice:
    outbound_filler_sentences:
        - waiting: ["Let me check that for you..."]

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.outbound_filler_sentences).toBeDefined();
      expect(Array.isArray(voice?.outbound_filler_sentences)).toBe(true);
      expect(voice?.outbound_filler_sentences?.length).toBe(1);

      const firstEntry = voice?.outbound_filler_sentences?.[0];
      expect(firstEntry).toHaveProperty('filler_sentences');
      expect(firstEntry?.filler_sentences?.waiting).toEqual([
        'Let me check that for you...',
      ]);
    });

    it('should handle multiple filler sentence entries', () => {
      const source = `
config:
    agent_name: "MultipleFillerBot"

modality voice:
    outbound_filler_sentences:
        - waiting: ["First message..."]
        - waiting: ["Second message..."]
        - waiting: ["Third message..."]

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.outbound_filler_sentences?.length).toBe(3);

      expect(
        voice?.outbound_filler_sentences?.[0]?.filler_sentences?.waiting
      ).toEqual(['First message...']);
      expect(
        voice?.outbound_filler_sentences?.[1]?.filler_sentences?.waiting
      ).toEqual(['Second message...']);
      expect(
        voice?.outbound_filler_sentences?.[2]?.filler_sentences?.waiting
      ).toEqual(['Third message...']);
    });

    it('should handle multiple waiting messages in single entry', () => {
      const source = `
config:
    agent_name: "MultiWaitingBot"

modality voice:
    outbound_filler_sentences:
        - waiting: [
            "Let me check that...",
            "Just a moment...",
            "Looking that up..."
          ]

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.outbound_filler_sentences?.length).toBe(1);
      expect(
        voice?.outbound_filler_sentences?.[0]?.filler_sentences?.waiting
      ).toEqual([
        'Let me check that...',
        'Just a moment...',
        'Looking that up...',
      ]);
    });
  });

  // =========================================================================
  // 4. Nested Additional Configs Structure
  // =========================================================================

  describe('additional_configs nested structure', () => {
    it('should compile speak_up_config with all fields', () => {
      const source = `
config:
    agent_name: "SpeakUpBot"

modality voice:
    additional_configs:
        speak_up_config:
            speak_up_first_wait_time_ms: 10000
            speak_up_follow_up_wait_time_ms: 5000
            speak_up_message: "Are you still there?"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      const speakUpConfig = voice?.additional_configs?.speak_up_config;

      expect(speakUpConfig).toBeDefined();
      expect(speakUpConfig?.speak_up_first_wait_time_ms).toBe(10000);
      expect(speakUpConfig?.speak_up_follow_up_wait_time_ms).toBe(5000);
      expect(speakUpConfig?.speak_up_message).toBe('Are you still there?');
    });

    it('should compile endpointing_config', () => {
      const source = `
config:
    agent_name: "EndpointingBot"

modality voice:
    additional_configs:
        endpointing_config:
            max_wait_time_ms: 1500

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      const endpointingConfig = voice?.additional_configs?.endpointing_config;

      expect(endpointingConfig).toBeDefined();
      expect(endpointingConfig?.max_wait_time_ms).toBe(1500);
    });

    it('should compile beepboop_config', () => {
      const source = `
config:
    agent_name: "BeepBoopBot"

modality voice:
    additional_configs:
        beepboop_config:
            max_wait_time_ms: 1200

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      const beepboopConfig = voice?.additional_configs?.beepboop_config;

      expect(beepboopConfig).toBeDefined();
      expect(beepboopConfig?.max_wait_time_ms).toBe(1200);
    });

    it('should compile all three additional_configs together', () => {
      const source = `
config:
    agent_name: "AllConfigsBot"

modality voice:
    additional_configs:
        speak_up_config:
            speak_up_first_wait_time_ms: 10000
            speak_up_follow_up_wait_time_ms: 6000
            speak_up_message: "Hello?"
        endpointing_config:
            max_wait_time_ms: 2000
        beepboop_config:
            max_wait_time_ms: 1800

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      const additionalConfigs = voice?.additional_configs;

      expect(additionalConfigs).toBeDefined();
      expect(additionalConfigs?.speak_up_config).toBeDefined();
      expect(additionalConfigs?.endpointing_config).toBeDefined();
      expect(additionalConfigs?.beepboop_config).toBeDefined();

      expect(
        additionalConfigs?.speak_up_config?.speak_up_first_wait_time_ms
      ).toBe(10000);
      expect(additionalConfigs?.endpointing_config?.max_wait_time_ms).toBe(
        2000
      );
      expect(additionalConfigs?.beepboop_config?.max_wait_time_ms).toBe(1800);
    });

    it('should handle partial speak_up_config (only some fields)', () => {
      const source = `
config:
    agent_name: "PartialSpeakUpBot"

modality voice:
    additional_configs:
        speak_up_config:
            speak_up_message: "Hello?"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      const speakUpConfig = voice?.additional_configs?.speak_up_config;

      expect(speakUpConfig).toBeDefined();
      expect(speakUpConfig?.speak_up_message).toBe('Hello?');
      expect(speakUpConfig?.speak_up_first_wait_time_ms).toBeUndefined();
      expect(speakUpConfig?.speak_up_follow_up_wait_time_ms).toBeUndefined();
    });
  });

  // =========================================================================
  // 5. Pronunciation Dictionary
  // =========================================================================

  describe('pronunciation_dict output mapping', () => {
    it('should compile pronunciation dictionary entries', () => {
      const source = `
config:
    agent_name: "PronunciationBot"

modality voice:
    pronunciation_dict:
        - grapheme: "Eliquis"
          phoneme: "ɛlɪkwɪs"
          type: "IPA"
        - grapheme: "API"
          phoneme: "eɪ pi aɪ"
          type: "IPA"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.pronunciation_dict).toBeDefined();
      expect(voice?.pronunciation_dict?.pronunciations).toEqual([
        {
          grapheme: 'Eliquis',
          phoneme: 'ɛlɪkwɪs',
          type: 'IPA',
        },
        {
          grapheme: 'API',
          phoneme: 'eɪ pi aɪ',
          type: 'IPA',
        },
      ]);
    });

    it('should handle single pronunciation entry', () => {
      const source = `
config:
    agent_name: "SinglePronunciationBot"

modality voice:
    pronunciation_dict:
        - grapheme: "SQL"
          phoneme: "ɛs kju ɛl"
          type: "IPA"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.pronunciation_dict?.pronunciations?.length).toBe(1);
      expect(voice?.pronunciation_dict?.pronunciations?.[0]).toEqual({
        grapheme: 'SQL',
        phoneme: 'ɛs kju ɛl',
        type: 'IPA',
      });
    });

    it('skips invalid pronunciation entries (missing grapheme/phoneme/type); validation at parse time', () => {
      const source = `
config:
    agent_name: "InvalidEntryBot"

modality voice:
    pronunciation_dict:
        - grapheme: "OK"
          phoneme: "oʊ keɪ"
          type: "IPA"
        - a: "b"

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.pronunciation_dict?.pronunciations?.length).toBe(1);
      expect(voice?.pronunciation_dict?.pronunciations?.[0]).toEqual({
        grapheme: 'OK',
        phoneme: 'oʊ keɪ',
        type: 'IPA',
      });
    });
  });

  // =========================================================================
  // 6. Basic Voice Fields
  // =========================================================================

  describe('basic voice configuration fields', () => {
    it('should compile all inbound fields', () => {
      const source = `
config:
    agent_name: "InboundBot"

modality voice:
    inbound_filler_words_detection: True

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.inbound_filler_words_detection).toBe(true);
    });

    it('should compile all outbound fields', () => {
      const source = `
config:
    agent_name: "OutboundBot"

modality voice:
    voice_id: "EQx6HGDYjkDpcli6vorJ"
    outbound_speed: 1.5
    outbound_style_exaggeration: 0.75
    outbound_stability: 0.85
    outbound_similarity: 0.9

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.voice_id).toBe('EQx6HGDYjkDpcli6vorJ');
      expect(voice?.outbound_speed).toBe(1.5);
      expect(voice?.outbound_style_exaggeration).toBe(0.75);
      expect(voice?.outbound_stability).toBe(0.85);
      expect(voice?.outbound_similarity).toBe(0.9);
    });

    it('should handle speed boundary values', () => {
      const source = `
config:
    agent_name: "SpeedBoundaryBot"

modality voice:
    outbound_speed: 0.5

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.outbound_speed).toBe(0.5);
    });

    it('should handle style/stability/similarity at boundaries', () => {
      const source = `
config:
    agent_name: "BoundaryValuesBot"

modality voice:
    outbound_style_exaggeration: 0.0
    outbound_stability: 1.0
    outbound_similarity: 0.5

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output } = compile(ast);

      const voice = output.agent_version.modality_parameters.voice;
      expect(voice?.outbound_style_exaggeration).toBe(0.0);
      expect(voice?.outbound_stability).toBe(1.0);
      expect(voice?.outbound_similarity).toBe(0.5);
    });
  });

  // =========================================================================
  // 7. Comprehensive Integration Test
  // =========================================================================

  describe('comprehensive voice configuration', () => {
    it('should compile all voice fields together correctly', () => {
      const source = `
config:
    agent_name: "CompleteVoiceBot"

modality voice:
    inbound_filler_words_detection: True
    inbound_keywords:
        keywords:
            - "urgent"
            - "emergency"
    voice_id: "test_voice_123"
    outbound_speed: 1.0
    outbound_style_exaggeration: 0.5
    outbound_stability: 0.75
    outbound_similarity: 0.8
    pronunciation_dict:
        - grapheme: "Eliquis"
          phoneme: "ɛlɪkwɪs"
          type: "IPA"
    outbound_filler_sentences:
        - waiting: ["Please wait..."]
    additional_configs:
        speak_up_config:
            speak_up_first_wait_time_ms: 10000
            speak_up_message: "Are you there?"
        endpointing_config:
            max_wait_time_ms: 1500
        beepboop_config:
            max_wait_time_ms: 1200

start_agent main:
    description: "test"
`;
      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);

      // Should have no diagnostics
      expect(diagnostics).toHaveLength(0);

      const voice = output.agent_version.modality_parameters
        .voice as VoiceConfiguration;

      // Verify all fields are present and correct
      expect(voice.inbound_filler_words_detection).toBe(true);
      expect(voice.inbound_keywords?.keywords).toEqual(['urgent', 'emergency']);
      expect(voice.voice_id).toBe('test_voice_123');
      expect(voice.outbound_speed).toBe(1.0);
      expect(voice.outbound_style_exaggeration).toBe(0.5);
      expect(voice.outbound_stability).toBe(0.75);
      expect(voice.outbound_similarity).toBe(0.8);
      expect(voice.pronunciation_dict?.pronunciations).toHaveLength(1);
      expect(voice.outbound_filler_sentences).toHaveLength(1);
      expect(voice.additional_configs?.speak_up_config).toBeDefined();
      expect(voice.additional_configs?.endpointing_config).toBeDefined();
      expect(voice.additional_configs?.beepboop_config).toBeDefined();
    });
  });
});
