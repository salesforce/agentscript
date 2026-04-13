/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type {
  ModalityParameters,
  LanguageConfiguration,
  VoiceConfiguration,
} from '../types.js';
import type {
  ParsedLanguage,
  ParsedAgentforce,
  ParsedVoiceModality,
} from '../parsed-types.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedBoolean,
  extractSourcedNumber,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import {
  extractStringSequence,
  extractSequenceBlocks,
} from './extract-sequence.js';

// Valid locales from the agent-dsl SupportedLocale enum.
const VALID_LOCALES = new Set([
  'ar',
  'bg',
  'ca',
  'cs',
  'da',
  'de',
  'el',
  'en_GB',
  'en_US',
  'es',
  'es_MX',
  'eu',
  'fi',
  'fr',
  'he',
  'hr',
  'hu',
  'in',
  'it',
  'ja',
  'ko',
  'nl_NL',
  'no',
  'pl',
  'pt_BR',
  'pt_PT',
  'ro',
  'ru',
  'sk',
  'sl',
  'sv',
  'th',
  'tr',
  'uk',
  'vi',
  'zh_CN',
  'zh_TW',
]);

/**
 * Compile modality parameters from the language block and modality blocks.
 * Voice configuration is extracted from modality voice: variant fields.
 */
export function compileModalityParameters(
  languageBlock: ParsedLanguage | undefined,
  modalityBlock: ParsedAgentforce['modality'],
  ctx: CompilerContext
): ModalityParameters {
  const language = compileLanguageConfiguration(languageBlock, ctx);

  // Extract voice config from modality variant
  const voiceEntry = modalityBlock?.get('voice');
  const voice = compileVoiceConfiguration(voiceEntry, ctx);

  const result: ModalityParameters = {
    language,
  };

  // Only include voice if it's not null
  if (voice !== null) {
    result.voice = voice;
  }

  return result;
}

/**
 * Compile language configuration from the language block.
 * Returns null (producing empty modality_parameters) when any locale is invalid.
 */
function compileLanguageConfiguration(
  languageBlock: ParsedLanguage | undefined,
  ctx: CompilerContext
): LanguageConfiguration | null {
  if (!languageBlock) return null;

  const defaultLocaleSourced = extractSourcedString(
    languageBlock.default_locale
  );
  const defaultLocale = extractStringValue(languageBlock.default_locale) ?? '';

  if (!defaultLocale) {
    ctx.error(
      'Language block requires a default_locale',
      languageBlock.__cst?.range
    );
    return null;
  }

  let hasValidationErrors = false;

  if (!VALID_LOCALES.has(defaultLocale)) {
    ctx.error(
      `Invalid default_locale '${defaultLocale}'. Must be a supported locale.`,
      languageBlock.__cst?.range,
      'schema-validation'
    );
    hasValidationErrors = true;
  }

  const additionalLocalesStr =
    extractStringValue(languageBlock.additional_locales) ?? '';
  const additionalLocales = additionalLocalesStr
    ? additionalLocalesStr
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : [];

  for (const locale of additionalLocales) {
    if (!VALID_LOCALES.has(locale)) {
      ctx.error(
        `Invalid additional_locale '${locale}'. Must be a supported locale.`,
        languageBlock.__cst?.range,
        'schema-validation'
      );
      hasValidationErrors = true;
    }
  }

  // Match Python: return null when any locale is invalid to prevent downstream errors
  if (hasValidationErrors) {
    return null;
  }

  const allAdditionalLocales =
    extractSourcedBoolean(languageBlock.all_additional_locales) ?? false;

  const langConfig: Sourceable<LanguageConfiguration> = {
    default_locale: (defaultLocaleSourced ??
      defaultLocale) as LanguageConfiguration['default_locale'],
    additional_locales:
      additionalLocales as LanguageConfiguration['additional_locales'],
    all_additional_locales: allAdditionalLocales,
  };

  ctx.setScriptPath(langConfig, 'language');
  return langConfig as LanguageConfiguration;
}

/**
 * Compile voice configuration from the voice config block.
 * Voice config comes from modality voice: variant fields.
 */
function compileVoiceConfiguration(
  voiceBlock: ParsedVoiceModality | undefined,
  ctx: CompilerContext
): VoiceConfiguration | null {
  if (!voiceBlock) return null;

  const voiceConfig: Sourceable<VoiceConfiguration> = {};

  // Extract inbound configuration
  const inboundFillerWordsDetection = extractSourcedBoolean(
    voiceBlock.inbound_filler_words_detection
  );
  if (inboundFillerWordsDetection !== undefined) {
    voiceConfig.inbound_filler_words_detection = inboundFillerWordsDetection;
  }

  // Extract inbound keywords
  if (voiceBlock.inbound_keywords) {
    const keywordsBlock = voiceBlock.inbound_keywords as Record<
      string,
      unknown
    >;
    if (keywordsBlock.keywords) {
      const keywordsList = extractStringSequence(
        keywordsBlock.keywords,
        'inbound_keywords.keywords',
        ctx
      );
      if (keywordsList.length > 0) {
        const inboundKeywords = { keywords: keywordsList };
        (voiceConfig as Record<string, unknown>).inbound_keywords =
          inboundKeywords;
      }
    }
  }

  // Extract outbound configuration
  const voiceId = extractSourcedString(voiceBlock.voice_id);
  if (voiceId !== undefined) {
    (voiceConfig as Record<string, unknown>).voice_id = voiceId;
  }

  const outboundSpeed = extractSourcedNumber(voiceBlock.outbound_speed);
  if (outboundSpeed !== undefined) {
    voiceConfig.outbound_speed = outboundSpeed;
  }

  const outboundStyleExaggeration = extractSourcedNumber(
    voiceBlock.outbound_style_exaggeration
  );
  if (outboundStyleExaggeration !== undefined) {
    voiceConfig.outbound_style_exaggeration = outboundStyleExaggeration;
  }

  const outboundStability = extractSourcedNumber(voiceBlock.outbound_stability);
  if (outboundStability !== undefined) {
    (voiceConfig as Record<string, unknown>).outbound_stability =
      outboundStability;
  }

  const outboundSimilarity = extractSourcedNumber(
    voiceBlock.outbound_similarity
  );
  if (outboundSimilarity !== undefined) {
    (voiceConfig as Record<string, unknown>).outbound_similarity =
      outboundSimilarity;
  }

  // Extract pronunciation dictionary
  if (voiceBlock.pronunciation_dict) {
    const pronunciations: Record<string, unknown>[] = [];
    const entries = extractSequenceBlocks<Record<string, unknown>>(
      voiceBlock.pronunciation_dict
    );

    for (const entry of entries) {
      const grapheme = extractSourcedString(entry.grapheme);
      const phoneme = extractSourcedString(entry.phoneme);
      const type = extractSourcedString(entry.type);
      if (grapheme && phoneme && type) {
        pronunciations.push({ grapheme, phoneme, type });
      }
    }

    if (pronunciations.length > 0) {
      const pronunciationDict = { pronunciations };
      (voiceConfig as Record<string, unknown>).pronunciation_dict =
        pronunciationDict;
    }
  }

  // Extract outbound filler sentences
  if (voiceBlock.outbound_filler_sentences) {
    const fillerSentences: Record<string, unknown>[] = [];
    const entries = extractSequenceBlocks<Record<string, unknown>>(
      voiceBlock.outbound_filler_sentences
    );

    for (const entry of entries) {
      // FillerSentenceBlock has waiting field which is an ExpressionSequence
      const waitingSequence = entry.waiting;
      if (waitingSequence) {
        const waiting = extractStringSequence(
          waitingSequence,
          'outbound_filler_sentences.waiting',
          ctx
        );

        if (waiting.length > 0) {
          // Wrap in { filler_sentences: { waiting: [...] } } per OpenAPI schema
          fillerSentences.push({ filler_sentences: { waiting } });
        }
      }
    }

    if (fillerSentences.length > 0) {
      (voiceConfig as Record<string, unknown>).outbound_filler_sentences =
        fillerSentences;
    }
  }

  // Extract additional configs
  if (voiceBlock.additional_configs) {
    const additionalConfigs: Record<string, unknown> = {};
    const configsBlock = voiceBlock.additional_configs as Record<
      string,
      unknown
    >;

    // Speak up config
    if (configsBlock.speak_up_config) {
      const speakUpConfig: Record<string, unknown> = {};
      const speakUpBlock = configsBlock.speak_up_config as Record<
        string,
        unknown
      >;
      const firstWait = extractSourcedNumber(
        speakUpBlock.speak_up_first_wait_time_ms
      );
      const followUpWait = extractSourcedNumber(
        speakUpBlock.speak_up_follow_up_wait_time_ms
      );
      const message = extractSourcedString(speakUpBlock.speak_up_message);
      if (firstWait !== undefined) {
        speakUpConfig.speak_up_first_wait_time_ms = firstWait;
      }
      if (followUpWait !== undefined) {
        speakUpConfig.speak_up_follow_up_wait_time_ms = followUpWait;
      }
      if (message !== undefined) {
        speakUpConfig.speak_up_message = message;
      }
      if (Object.keys(speakUpConfig).length > 0) {
        additionalConfigs.speak_up_config = speakUpConfig;
      }
    }

    // Endpointing config
    if (configsBlock.endpointing_config) {
      const endpointingConfig: Record<string, unknown> = {};
      const endpointingBlock = configsBlock.endpointing_config as Record<
        string,
        unknown
      >;
      const maxWait = extractSourcedNumber(endpointingBlock.max_wait_time_ms);
      if (maxWait !== undefined) {
        endpointingConfig.max_wait_time_ms = maxWait;
      }
      if (Object.keys(endpointingConfig).length > 0) {
        additionalConfigs.endpointing_config = endpointingConfig;
      }
    }

    // Beepboop config
    if (configsBlock.beepboop_config) {
      const beepboopConfig: Record<string, unknown> = {};
      const beepboopBlock = configsBlock.beepboop_config as Record<
        string,
        unknown
      >;
      const maxWait = extractSourcedNumber(beepboopBlock.max_wait_time_ms);
      if (maxWait !== undefined) {
        beepboopConfig.max_wait_time_ms = maxWait;
      }
      if (Object.keys(beepboopConfig).length > 0) {
        additionalConfigs.beepboop_config = beepboopConfig;
      }
    }

    if (Object.keys(additionalConfigs).length > 0) {
      (voiceConfig as Record<string, unknown>).additional_configs =
        additionalConfigs;
    }
  }

  ctx.setScriptPath(voiceConfig, 'voice');

  return voiceConfig as VoiceConfiguration;
}
