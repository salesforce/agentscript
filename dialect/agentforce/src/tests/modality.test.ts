import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { parseAndLint, SequenceNode, isNamedMap } from '@agentscript/language';
import { agentforceDialect } from '../index.js';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
} from './test-utils.js';

// ============================================================================
// Modality block parsing
// ============================================================================

describe('modality block', () => {
  const fullVoiceSource = `
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

  it('parses a full voice modality', () => {
    const ast = parseDocument(fullVoiceSource);
    const modality = ast.modality!;
    expect(isNamedMap(modality)).toBe(true);
    expect(modality.has('voice')).toBe(true);

    const voice = modality.get('voice')!;
    expect(voice.__kind).toBe('ModalityBlock');

    const fillerWordsDetection = voice.inbound_filler_words_detection as Record<
      string,
      unknown
    >;
    expect(fillerWordsDetection.__kind).toBe('BooleanValue');
    expect(fillerWordsDetection.value).toBe(true);

    // Inbound keywords
    const inboundKeywords = voice.inbound_keywords as Record<string, unknown>;
    expect(inboundKeywords.__kind).toBe('InboundKeywordsBlock');
    const keywords = inboundKeywords.keywords as Record<string, unknown>;
    expect(keywords.__kind).toBe('Sequence');
    const keywordItems = (keywords as any).items;
    expect(keywordItems).toHaveLength(3);
    expect((keywordItems[0] as Record<string, unknown>).value).toBe('urgent');
    expect((keywordItems[1] as Record<string, unknown>).value).toBe(
      'emergency'
    );
    expect((keywordItems[2] as Record<string, unknown>).value).toBe('help');

    // Outbound string fields
    const voiceId = voice.voice_id as Record<string, unknown>;
    expect(voiceId.__kind).toBe('StringLiteral');
    expect(voiceId.value).toBe('EQx6HGDYjkDpcli6vorJ');

    // Number fields
    const outboundSpeed = voice.outbound_speed as Record<string, unknown>;
    expect(outboundSpeed.__kind).toBe('NumberValue');
    expect(outboundSpeed.value).toBe(1.0);

    const styleExaggeration = voice.outbound_style_exaggeration as Record<
      string,
      unknown
    >;
    expect(styleExaggeration.__kind).toBe('NumberValue');
    expect(styleExaggeration.value).toBe(0.5);

    const stability = voice.outbound_stability as Record<string, unknown>;
    expect(stability.__kind).toBe('NumberValue');
    expect(stability.value).toBe(0.5);

    const similarity = voice.outbound_similarity as Record<string, unknown>;
    expect(similarity.__kind).toBe('NumberValue');
    expect(similarity.value).toBe(0.75);

    // Additional configs
    const additionalConfigs = voice.additional_configs as Record<
      string,
      unknown
    >;
    expect(additionalConfigs).toBeDefined();
    expect(additionalConfigs.__kind).toBe('AdditionalConfigsBlock');

    const speakUpConfig = additionalConfigs.speak_up_config as Record<
      string,
      unknown
    >;
    expect(speakUpConfig).toBeDefined();
    expect(speakUpConfig.__kind).toBe('SpeakUpConfigBlock');

    const speakUpFirstWait =
      speakUpConfig.speak_up_first_wait_time_ms as Record<string, unknown>;
    expect(speakUpFirstWait.value).toBe(10000);

    const speakUpMessage = speakUpConfig.speak_up_message as Record<
      string,
      unknown
    >;
    expect(speakUpMessage.value).toBe('Are you still there?');

    const endpointingConfig = additionalConfigs.endpointing_config as Record<
      string,
      unknown
    >;
    expect(endpointingConfig).toBeDefined();
    expect(
      (endpointingConfig.max_wait_time_ms as Record<string, unknown>).value
    ).toBe(1000);

    const beepboopConfig = additionalConfigs.beepboop_config as Record<
      string,
      unknown
    >;
    expect(beepboopConfig).toBeDefined();
    expect(
      (beepboopConfig.max_wait_time_ms as Record<string, unknown>).value
    ).toBe(1000);
  });

  it('parses pronunciation_dict as a Sequence of blocks', () => {
    const ast = parseDocument(fullVoiceSource);
    const modality = ast.modality!;
    const voice = modality.get('voice')!;

    const pronunciationDict = voice.pronunciation_dict as SequenceNode;
    expect(pronunciationDict.__kind).toBe('Sequence');
    expect(pronunciationDict.items).toHaveLength(1);

    const block = pronunciationDict.items[0] as unknown as Record<
      string,
      unknown
    >;
    expect(block.__kind).toBe('PronunciationDictEntryBlock');
    expect((block.grapheme as Record<string, unknown>).value).toBe('Eliquis');
    expect((block.phoneme as Record<string, unknown>).value).toBe('ɛlɪkwɪs');
    expect((block.type as Record<string, unknown>).value).toBe('IPA');
  });

  it('produces no diagnostics for valid voice modality', () => {
    const { diagnostics } = parseWithDiagnostics(fullVoiceSource);
    // Filter out any syntax-level diagnostics that are not from our code
    const errors = diagnostics.filter(
      d => d.code !== 'unknown-block' && d.code !== 'syntax-error'
    );
    expect(errors).toHaveLength(0);
  });

  it('emits and re-parses a voice modality (roundtrip)', () => {
    const ast = parseDocument(fullVoiceSource);
    const emitted = emitDocument(ast);

    // Re-parse the emitted output
    const ast2 = parseDocument(emitted);
    const modality2 = ast2.modality!;
    expect(modality2.has('voice')).toBe(true);

    const voice2 = modality2.get('voice')!;

    // Verify key fields survive roundtrip
    expect((voice2.voice_id as Record<string, unknown>).value).toBe(
      'EQx6HGDYjkDpcli6vorJ'
    );
    expect((voice2.outbound_speed as Record<string, unknown>).value).toBe(1.0);

    const dict2 = voice2.pronunciation_dict as SequenceNode;
    expect(dict2.items).toHaveLength(1);
    expect(dict2.items[0].__kind).toBe('PronunciationDictEntryBlock');

    // Verify additional configs survived
    const additionalConfigs2 = voice2.additional_configs as Record<
      string,
      unknown
    >;
    expect(additionalConfigs2).toBeDefined();
    const speakUpConfig2 = additionalConfigs2.speak_up_config as Record<
      string,
      unknown
    >;
    expect(speakUpConfig2).toBeDefined();
  });
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
