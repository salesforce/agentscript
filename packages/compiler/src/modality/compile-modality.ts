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
  VoiceV2Config,
  VoiceInboundModel,
  VoiceOutboundModel,
  VoiceLanguageConfig,
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
  iterateNamedMap,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { Sourced } from '../sourced.js';
import { supportedLocale } from '../generated/agent-dsl.js';
import {
  extractStringSequence,
  extractSequenceBlocks,
} from './extract-sequence.js';

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
 * Returns null (producing empty modality_parameters) when any locale is invalid,
 * matching Python compiler behavior.
 */
function compileLanguageConfiguration(
  languageBlock: ParsedLanguage | undefined,
  ctx: CompilerContext
): LanguageConfiguration | null {
  if (!languageBlock) return null;

  const adaptiveSourced = extractSourcedBoolean(languageBlock.adaptive);
  const adaptive = adaptiveSourced?.value ?? false;

  const defaultLocaleSourced = extractSourcedString(
    languageBlock.default_locale
  );
  const defaultLocale = extractStringValue(languageBlock.default_locale) ?? '';

  if (!defaultLocale && !adaptive) {
    ctx.error(
      'Language block requires a default_locale',
      languageBlock.__cst?.range
    );
    return null;
  }

  if (defaultLocale && !supportedLocale.safeParse(defaultLocale).success) {
    ctx.warning(
      `Invalid default_locale '${defaultLocale}'. Must be a supported locale.`,
      languageBlock.__cst?.range,
      'schema-validation'
    );
  }

  const additionalLocales = extractStringSequence(
    languageBlock.additional_locales,
    'language.additional_locales',
    ctx
  );

  for (const locale of additionalLocales) {
    if (!supportedLocale.safeParse(locale).success) {
      ctx.warning(
        `Invalid additional_locale '${locale}'. Must be a supported locale.`,
        languageBlock.__cst?.range,
        'schema-validation'
      );
    }
  }

  const allAdditionalLocales =
    extractSourcedBoolean(languageBlock.all_additional_locales) ?? false;

  const langConfig: Sourceable<LanguageConfiguration> = {
    default_locale:
      adaptive && !defaultLocale
        ? undefined
        : ((defaultLocaleSourced ??
            defaultLocale) as LanguageConfiguration['default_locale']),
    additional_locales:
      additionalLocales as LanguageConfiguration['additional_locales'],
    all_additional_locales: allAdditionalLocales,
  };

  if (adaptiveSourced !== undefined) {
    langConfig.adaptive = adaptiveSourced;
  }

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
  const voiceV2Config: Sourceable<VoiceV2Config> = {};

  const hasV1 = compileVoiceV1(voiceBlock, voiceConfig, ctx);

  // Extract session_language_switching
  const sessionLangSwitching = extractSourcedString(
    voiceBlock.session_language_switching
  );
  if (sessionLangSwitching !== undefined) {
    voiceV2Config.mode = sessionLangSwitching;
  }

  // Extract inbound direction
  const inbound = extractInboundDirection(voiceBlock.inbound, ctx);
  if (inbound !== undefined) {
    voiceV2Config.inbound = inbound;
  }

  // Extract outbound direction
  const outbound = extractOutboundDirection(voiceBlock.outbound, ctx);
  if (outbound !== undefined) {
    voiceV2Config.outbound = outbound;
  }

  // Extract V2 languages
  const languages = compileVoiceLanguages(voiceBlock, ctx);
  if (languages !== undefined) {
    voiceV2Config.languages = languages;
  }

  // ensure V1 & V2 aren't being used simultaneously
  if (Object.keys(voiceV2Config)?.length > 0 && hasV1) {
    ctx.error(
      `Invalid modality voice configuration. Both Voice schema versions were detected, use only one at a time.`
    );
    return null;
  }

  if (!hasV1) {
    voiceConfig.voice2_config = voiceV2Config;
    if (voiceConfig.additional_configs) {
      // additional_configs is shared between V1 and V2. But if we are here, it only belongs in V2
      voiceV2Config.additional_configs = voiceConfig.additional_configs;
      delete voiceConfig.additional_configs;
    }
  }
  ctx.setScriptPath(voiceConfig, 'voice');

  return voiceConfig as VoiceConfiguration;
}

/**
 * Extract the voice model from a direction block (inbound or outbound).
 * Shared extraction logic for the model property common to both directions.
 */
function extractDirectionModel(directionBlock: Record<string, unknown>): {
  model?: { id?: string | Sourced<string>; params?: Record<string, unknown> };
} {
  const modelResult = extractVoiceModel(directionBlock.model);
  if (modelResult.id !== undefined || modelResult.params !== undefined) {
    return { model: modelResult };
  }
  return {};
}

/**
 * Extract V2 inbound direction configuration from an InboundDirectionBlock.
 * Returns the shape matching voiceInboundModel output schema.
 */
function extractInboundDirection(
  inboundBlock: unknown,
  ctx: CompilerContext
): Sourceable<VoiceInboundModel> | undefined {
  if (!inboundBlock) return undefined;

  const block = inboundBlock as Record<string, unknown>;
  const result: Sourceable<VoiceInboundModel> = {};

  // Shared: extract model
  const modelFields = extractDirectionModel(block);
  if (modelFields.model) {
    result.model = modelFields.model;
  }

  // Extract filler_words_detection
  const fillerWordsDetection = extractSourcedBoolean(
    block.filler_words_detection
  );
  if (fillerWordsDetection !== undefined) {
    result.filler_words_detection = fillerWordsDetection;
  }

  // Extract keywords (flat ExpressionSequence, NOT wrapped in InboundKeywordsBlock)
  const keywords = extractStringSequence(
    block.keywords as { items?: unknown[]; __children?: unknown[] } | undefined,
    `inbound.keywords`,
    ctx
  );
  if (keywords.length > 0) {
    result.keywords = keywords;
  }

  // Return undefined if nothing was extracted
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

/**
 * Extract V2 outbound direction configuration from an OutboundDirectionBlock.
 * Returns the shape matching voiceOutboundModel output schema.
 */
function extractOutboundDirection(
  outboundBlock: unknown,
  ctx: CompilerContext
): Sourceable<VoiceOutboundModel> | undefined {
  if (!outboundBlock) return undefined;

  const block = outboundBlock as Record<string, unknown>;
  const result: Sourceable<VoiceOutboundModel> = {};

  // Shared: extract model
  const modelFields = extractDirectionModel(block);
  if (modelFields.model) {
    result.model = modelFields.model;
  }

  // Extract persona_id → voice_id (field name mapping)
  const voiceId = extractSourcedString(block.persona_id);
  if (voiceId !== undefined) {
    result.voice_id = voiceId;
  }

  // Extract filler_sentences: Sequence(FillerSentenceBlock)
  if (block.filler_sentences) {
    const fillerSentences: Record<string, unknown>[] = [];
    const entries = extractSequenceBlocks<Record<string, unknown>>(
      block.filler_sentences
    );

    for (const entry of entries) {
      const waitingSequence = entry.waiting;
      if (waitingSequence) {
        const waiting = extractStringSequence(
          waitingSequence,
          `outbound.filler_sentences.waiting`,
          ctx
        );
        if (waiting.length > 0) {
          fillerSentences.push({ filler_sentences: { waiting } });
        }
      }
    }

    if (fillerSentences.length > 0) {
      (result as Record<string, unknown>).filler_sentences = fillerSentences;
    }
  }

  // Extract pronunciations → pronunciation_dict (field name mapping)
  const pronunciationDict = extractPronunciationDict(block.pronunciations);
  if (pronunciationDict) {
    result.pronunciation_dict = pronunciationDict;
  }

  // Return undefined if nothing was extracted
  if (Object.keys(result).length === 0) return undefined;
  return result;
}

function createVoiceLanguageConfig(lang: string, isDefault = false) {
  const langObj: Sourceable<VoiceLanguageConfig> & {
    _isDefault?: boolean;
  } = {
    language_code: lang,
  };
  langObj._isDefault = isDefault; // (for ordering, not output)
  return langObj;
}

/**
 * Compile the Voice V2 language & language_settings blocks into an array of VoiceLanguageConfig.
 * The default language is placed at index 0 of the output array.
 */
function compileVoiceLanguages(
  voiceBlock: ParsedVoiceModality | undefined,
  ctx: CompilerContext
): Array<Sourceable<VoiceLanguageConfig>> | undefined {
  if (!voiceBlock?.language) return undefined;

  const configs: Array<
    Sourceable<VoiceLanguageConfig> & { _isDefault?: boolean }
  > = [];

  // Validate default language
  const lang = extractStringValue(voiceBlock.language?.default_locale);
  if (lang === undefined || !supportedLocale.safeParse(lang).success) {
    ctx.error(
      `Invalid voice default language code '${lang}'. Must be a supported language.`
    );
    return undefined;
  }

  configs.push(createVoiceLanguageConfig(lang, true));

  // Get all additional languages
  const allLangs = extractStringSequence(
    voiceBlock.language.additional_locales,
    'voice.language.additional_locales',
    ctx
  );

  for (const lang of allLangs) {
    if (!supportedLocale.safeParse(lang).success) {
      ctx.error(
        `Invalid voice additional_locale '${lang}'. Must be a supported language.`,
        voiceBlock.language.__cst?.range,
        'schema-validation'
      );
      return undefined;
    }
    configs.push(createVoiceLanguageConfig(lang));
  }

  const languagesMap = voiceBlock.language_settings as Map<string, unknown>;
  for (const [languageCode, langBlock] of iterateNamedMap(languagesMap)) {
    const entry = langBlock as Record<string, unknown>;
    // Typeless map entries store their block body under `.properties`.
    const langBlockRecord = (entry.properties ?? entry) as Record<
      string,
      unknown
    >;

    // Validate language was explicitly declared in modality voice: language: block
    const config = configs.find(el => el.language_code === languageCode);
    if (config === undefined) {
      ctx.error(
        `Invalid voice language_settings tag '${languageCode}'. Must be a supported locale.`
      );
      return undefined;
    }

    // Extract inbound direction
    const inbound = extractInboundDirection(langBlockRecord.inbound, ctx);
    if (inbound !== undefined) {
      config.inbound = inbound;
    }

    // Extract outbound direction
    const outbound = extractOutboundDirection(langBlockRecord.outbound, ctx);
    if (outbound !== undefined) {
      config.outbound = outbound;
    }
  }

  if (configs.length === 0) return undefined;

  // Sort: is_default: True goes to index 0, others maintain their order
  configs.sort((a, b) => {
    if (a._isDefault && !b._isDefault) return -1;
    if (!a._isDefault && b._isDefault) return 1;
    return 0;
  });

  // Remove the temporary _isDefault flag
  configs.forEach(config => delete config._isDefault);

  return configs;
}

/**
 * Extract inbound_keywords configuration.
 * Returns keywords object if valid keywords are found, undefined otherwise.
 */
function extractInboundKeywords(
  inboundKeywordsBlock: unknown,
  pathPrefix: string,
  ctx: CompilerContext
): { keywords: string[] } | undefined {
  if (!inboundKeywordsBlock) return undefined;

  const keywordsBlock = inboundKeywordsBlock as Record<string, unknown>;
  if (!keywordsBlock.keywords) return undefined;

  const keywordsList = extractStringSequence(
    keywordsBlock.keywords,
    `${pathPrefix}.keywords`,
    ctx
  );

  if (keywordsList.length === 0) return undefined;

  return { keywords: keywordsList };
}

/**
 * Extract pronunciation_dict configuration.
 * Returns pronunciations object if valid entries are found, undefined otherwise.
 */
function extractPronunciationDict(pronunciationDictBlock: unknown):
  | {
      pronunciations: Array<{
        grapheme: string | Sourced<string>;
        phoneme: string | Sourced<string>;
        type: string | Sourced<string>;
      }>;
    }
  | undefined {
  if (!pronunciationDictBlock) return undefined;

  const pronunciations: Array<{
    grapheme: string | Sourced<string>;
    phoneme: string | Sourced<string>;
    type: string | Sourced<string>;
  }> = [];

  const entries = extractSequenceBlocks<Record<string, unknown>>(
    pronunciationDictBlock
  );

  for (const entry of entries) {
    const grapheme = extractSourcedString(entry.grapheme);
    const phoneme = extractSourcedString(entry.phoneme);
    const type = extractSourcedString(entry.type);
    if (grapheme && phoneme && type) {
      pronunciations.push({ grapheme, phoneme, type });
    }
  }

  if (pronunciations.length === 0) return undefined;

  return { pronunciations };
}

/**
 * Extract voice model configuration (id and parameters).
 * Used for both model and inbound_model fields.
 */
function extractVoiceModel(modelBlock: unknown): {
  id?: string | Sourced<string>;
  params?: Record<string, unknown>;
} {
  if (!modelBlock || typeof modelBlock !== 'object') {
    return {};
  }

  const block = modelBlock as Record<string, unknown>;
  const result: {
    id?: string | Sourced<string>;
    params?: Record<string, unknown>;
  } = {};

  // Extract model id
  const id = extractSourcedString(block.id);
  if (id !== undefined) {
    result.id = id;
  }

  // Extract model parameters
  if (block.parameters && typeof block.parameters === 'object') {
    const paramsBlock = block.parameters as Record<string, unknown>;
    const params: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(paramsBlock)) {
      if (key === '__cst' || key === '__kind') continue; // Skip internal properties

      // Extract parameter values (can be string, number, or boolean)
      const strVal = extractSourcedString(value);
      if (strVal !== undefined) {
        params[key] = strVal;
        continue;
      }

      const numVal = extractSourcedNumber(value);
      if (numVal !== undefined) {
        params[key] = numVal;
        continue;
      }

      const boolVal = extractSourcedBoolean(value);
      if (boolVal !== undefined) {
        params[key] = boolVal;
      }
    }

    if (Object.keys(params).length > 0) {
      result.params = params;
    }
  }

  return result;
}

/**
 * Compiles all the old "Voice V1" properties.
 * @param voiceBlock input parsed AST for "modality voice"
 * @param voiceConfig main output data structure
 * @param ctx compiler context
 * @returns true if a V1 parameter is fouund in the input, false otherwise
 */
function compileVoiceV1(
  voiceBlock: ParsedVoiceModality,
  voiceConfig: Sourceable<VoiceConfiguration>,
  ctx: CompilerContext
): boolean {
  let hasProperty = false;

  // Extract inbound configuration
  const inboundFillerWordsDetection = extractSourcedBoolean(
    voiceBlock.inbound_filler_words_detection
  );
  if (inboundFillerWordsDetection !== undefined) {
    voiceConfig.inbound_filler_words_detection = inboundFillerWordsDetection;
    hasProperty = true;
  }

  // Extract inbound_keywords
  const inboundKeywords = extractInboundKeywords(
    voiceBlock.inbound_keywords,
    'inbound_keywords',
    ctx
  );
  if (inboundKeywords) {
    (voiceConfig as Record<string, unknown>).inbound_keywords = inboundKeywords;
    hasProperty = true;
  }

  // Extract outbound configuration
  const voiceId = extractSourcedString(voiceBlock.voice_id);
  if (voiceId !== undefined) {
    (voiceConfig as Record<string, unknown>).voice_id = voiceId;
    hasProperty = true;
  }

  const outboundSpeed = extractSourcedNumber(voiceBlock.outbound_speed);
  if (outboundSpeed !== undefined) {
    voiceConfig.outbound_speed = outboundSpeed;
    hasProperty = true;
  }

  const outboundStyleExaggeration = extractSourcedNumber(
    voiceBlock.outbound_style_exaggeration
  );
  if (outboundStyleExaggeration !== undefined) {
    voiceConfig.outbound_style_exaggeration = outboundStyleExaggeration;
    hasProperty = true;
  }

  const outboundStability = extractSourcedNumber(voiceBlock.outbound_stability);
  if (outboundStability !== undefined) {
    (voiceConfig as Record<string, unknown>).outbound_stability =
      outboundStability;
    hasProperty = true;
  }

  const outboundSimilarity = extractSourcedNumber(
    voiceBlock.outbound_similarity
  );
  if (outboundSimilarity !== undefined) {
    (voiceConfig as Record<string, unknown>).outbound_similarity =
      outboundSimilarity;
    hasProperty = true;
  }

  // Extract pronunciation_dict
  const pronunciationDict = extractPronunciationDict(
    voiceBlock.pronunciation_dict
  );
  if (pronunciationDict) {
    (voiceConfig as Record<string, unknown>).pronunciation_dict =
      pronunciationDict;
    hasProperty = true;
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
      hasProperty = true;
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
        hasProperty = true;
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
        hasProperty = true;
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
      // hasProperty is not set here as additional_configs is shared with V2
    }
  }

  return hasProperty;
}
