/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  Block,
  BooleanValue,
  ExpressionSequence,
  ExpressionValue,
  NumberValue,
  Sequence,
  StringValue,
  TypedMap,
} from '@agentscript/language';

export const PronunciationDictEntryBlock = Block(
  'PronunciationDictEntryBlock',
  {
    grapheme: StringValue.required(),
    phoneme: StringValue.required(),
    type: StringValue.enum(['IPA', 'CMU']),
  }
);

export const InboundKeywordsBlock = Block('InboundKeywordsBlock', {
  keywords: ExpressionSequence().describe(
    'List of keywords for inbound speech detection.'
  ),
}).describe('Keyword detection configuration for inbound speech.');

export const SpeakUpConfigBlock = Block('SpeakUpConfigBlock', {
  speak_up_first_wait_time_ms: NumberValue.describe(
    'Time in milliseconds before first speak-up prompt.'
  )
    .min(10000)
    .max(300000),
  speak_up_follow_up_wait_time_ms: NumberValue.describe(
    'Time in milliseconds before follow-up speak-up prompts.'
  )
    .min(10000)
    .max(300000),
  speak_up_message: StringValue.describe(
    'Message to speak when prompting the user to speak up.'
  ),
}).describe('Configuration for speak-up behavior.');

export const EndpointingConfigBlock = Block('EndpointingConfigBlock', {
  max_wait_time_ms: NumberValue.describe(
    'Maximum wait time in milliseconds for endpointing detection.'
  )
    .min(500)
    .max(60000),
}).describe('Configuration for endpointing detection.');

export const BeepBoopConfigBlock = Block('BeepBoopConfigBlock', {
  max_wait_time_ms: NumberValue.describe(
    'Maximum wait time in milliseconds for beep-boop detection.'
  )
    .min(500)
    .max(60000),
}).describe('Configuration for beep-boop detection.');

export const AdditionalConfigsBlock = Block('AdditionalConfigsBlock', {
  speak_up_config: SpeakUpConfigBlock.describe(
    'Configuration for speak-up prompts.'
  ),
  endpointing_config: EndpointingConfigBlock.describe(
    'Configuration for endpointing detection.'
  ),
  beepboop_config: BeepBoopConfigBlock.describe(
    'Configuration for beep-boop detection.'
  ),
}).describe('Additional voice-related configurations.');

const FillerSentenceBlock = Block('FillerSentenceBlock', {
  waiting: ExpressionSequence().describe(
    'List of waiting messages for this filler sentence entry.'
  ),
}).describe('A filler sentence configuration entry.');

/** Common data structure for Voice Models (ASR, TTS, S2S, etc) */
const VoiceModelBlock = Block('VoiceModelBlock', {
  id: StringValue.describe(
    'Use a specific model, e.g. if version X and X+1 are simultaneously supported (GA, Beta).'
  ),
  parameters: Block(
    'VoiceModelParametersBlock',
    {},
    {
      wildcardPrefixes: [{ prefix: '', fieldType: ExpressionValue }],
    }
  ).describe(
    'Model-specific parameters. Any name-value pairs; values must be strings, booleans, or numbers. Passed through to the model at runtime.'
  ),
});

const DirectionSchema = {
  model: VoiceModelBlock.describe('The model settings for this direction'),
};

const InboundDirectionBlock = Block('VoiceInboundDirectionBlock', {
  ...DirectionSchema,
  filler_words_detection: BooleanValue.describe(
    'Whether to enable detection of filler words in inbound speech.'
  ),
  // do not use InboundKeywordsBlock as that was v1 defintion, with an extra nested child "keywords" property
  keywords: ExpressionSequence().describe(
    'Keyword detection configuration for inbound speech with boost values.'
  ),
});

const OutboundDirectionBlock = Block('VoiceOutboundDirectionBlock', {
  ...DirectionSchema,
  persona_id: StringValue.describe(
    'Unique identifier for the voice persona (e.g., "EQx6HGDYjkDpcli6vorJ").'
  ),
  filler_sentences: Sequence(FillerSentenceBlock).describe(
    'List of filler sentence entries to use during outbound speech pauses.'
  ),
  pronunciations: Sequence(PronunciationDictEntryBlock).describe(
    'List of pronunciation dictionary entries for custom word pronunciations.'
  ),
});

/** Common data structure for all Voice Languages */
const VoiceLanguageSchema = {
  is_default: BooleanValue.describe(
    'When True, this is the default voice language of the agent. Defaults to False.'
  ),
  inbound: InboundDirectionBlock,
  outbound: OutboundDirectionBlock,
};

/**
 * "modality voice" and all of its content.
 */
export const VoiceModalitySchema = {
  inbound: InboundDirectionBlock,
  outbound: OutboundDirectionBlock,
  session_language_switching: StringValue.enum([
    'Monolingual',
    'Multilingual',
  ]).describe(
    'When multilingual, any language can be used on any turn. Defaults to monolingual (one language per session).'
  ),
  languages: TypedMap(
    'VoiceLanguageMap',
    Block('VoiceLanguageBlock', VoiceLanguageSchema),
    { allowTypelessEntries: true } // this is what allows the user to enter any string as a child property, e.g. BCP 47 lang tags. Validation happens in linter/compiler.
  ).describe(
    'A list of language tags with all voice settings for each language. By default, every language will use the agent-level setting. Use this for a language-specific override.'
  ),
  // ================ DO NOT ADD ANY V2 PROPERTIES OR BLOCKS BELOW THIS LINE  =====================================================
  // ================ All V1 fields (below). Deprecation TBD, linter/compiler catches any mixing of V1 and V2 for now ==============
  inbound_keywords: InboundKeywordsBlock.describe(
    'Keyword detection configuration for inbound speech with boost values.'
  ),
  inbound_filler_words_detection: BooleanValue.describe(
    'Whether to enable detection of filler words in inbound speech.'
  ),
  voice_id: StringValue.describe(
    'Unique identifier for the voice (e.g., "EQx6HGDYjkDpcli6vorJ").'
  ),
  outbound_speed: NumberValue.describe(
    'Speech speed for outbound voice (e.g., 1.0 for normal speed).'
  )
    .min(0.5)
    .max(2),
  outbound_style_exaggeration: NumberValue.describe(
    'Style exaggeration level for outbound voice (0.0 to 1.0).'
  )
    .min(0)
    .max(1),
  outbound_stability: NumberValue.describe(
    'Deprecated. Voice stability for outbound speech.'
  ),
  outbound_similarity: NumberValue.describe(
    'Deprecated. Voice similarity level for outbound speech.'
  ),
  outbound_filler_sentences: Sequence(FillerSentenceBlock).describe(
    'List of filler sentence entries to use during outbound speech pauses.'
  ),
  pronunciation_dict: Sequence(PronunciationDictEntryBlock).describe(
    'List of pronunciation dictionary entries for custom word pronunciations.'
  ),
  additional_configs: AdditionalConfigsBlock.describe(
    'Additional voice-related configurations.'
  ),
} as const;
