/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  DialectConfig,
  InferFieldType,
  InferFields,
} from '@agentscript/language';
import { AgentforceSchema, AgentforceSchemaInfo } from './schema.js';
import { defaultRules } from './lint/passes/index.js';
import { DIALECT_NAME, DIALECT_VERSION } from './pkg-meta.js';

export {
  KnowledgeBlock,
  ConnectionBlock,
  ConnectionsBlock,
  ConnectionReasoningBlock,
  AvailableFormatBlock,
  AvailableFormatsBlock,
  ResponseFormatBlock,
  ResponseFormatsBlock,
  ResponseFormatInputsBlock,
  ResponseFormatInputPropertiesBlock,
  AccessBlock,
  AFActionsBlock,
  ModelConfigBlock,
  ContextBlock,
  RecommendedPromptsBlock,
  AgentforceSchema,
  AgentforceKindToSchemaKey,
  AgentforceSchemaAliases,
  AgentforceSchemaInfo,
  agentforceSchemaContext,
  InboundKeywordsBlock,
  PronunciationDictEntryBlock,
} from './schema.js';

export { COMMERCE_SHOPPER_SCHEMA } from './variants/commerce-cloud-shopper.js';
export { TABLEAU_ANALYZE_DATA_SCHEMA } from './variants/tableau-analyze-data.js';
export { BYON_SCHEMA_PREFIX } from './variants/byon.js';

export type {
  AgentforceSchema as AgentforceSchemaType,
  ParsedAgentforce,
} from './schema.js';

// Re-export base dialect parsed types
export type {
  ParsedSystem,
  ParsedLanguage,
  ParsedReasoningAction,
  ParsedMessages,
} from '@agentscript/agentscript-dialect';

import type { ReasoningBlock } from '@agentscript/agentscript-dialect';
export type ParsedTopicReasoning = InferFieldType<typeof ReasoningBlock>;

// Re-export ParsedConnectedAgent from base dialect
export type { ParsedConnectedAgent } from '@agentscript/agentscript-dialect';

// Agentforce-specific block types derived from schema
import type {
  KnowledgeBlock,
  AFTopicBlock,
  AFSubagentBlock,
  AFStartAgentBlock,
  ConnectionBlock,
  AccessBlock,
  ModalityBlock,
  VoiceModalitySchema,
  AdditionalConfigsBlock,
  SpeakUpConfigBlock,
  EndpointingConfigBlock,
  BeepBoopConfigBlock,
  ContextBlock,
  RecommendedPromptsBlock,
} from './schema.js';

export type ParsedConfig = InferFieldType<typeof AgentforceSchema.config>;
export type ParsedTopic = InferFieldType<typeof AFTopicBlock>;
export type ParsedSubagent = InferFieldType<typeof AFSubagentBlock>;
export type ParsedStartAgent = InferFieldType<typeof AFStartAgentBlock>;
export type ParsedKnowledge = InferFieldType<typeof KnowledgeBlock>;
export type ParsedConnection = InferFieldType<typeof ConnectionBlock>;
export type ParsedAccess = InferFieldType<typeof AccessBlock>;
export type ParsedModality = InferFieldType<typeof ModalityBlock>;
export type ParsedVoiceModality = InferFields<typeof VoiceModalitySchema>;
export type ParsedAdditionalConfigs = InferFieldType<
  typeof AdditionalConfigsBlock
>;
export type ParsedSpeakUpConfig = InferFieldType<typeof SpeakUpConfigBlock>;
export type ParsedEndpointingConfig = InferFieldType<
  typeof EndpointingConfigBlock
>;
export type ParsedBeepBoopConfig = InferFieldType<typeof BeepBoopConfigBlock>;
export type ParsedContext = InferFieldType<typeof ContextBlock>;
export type ParsedRecommendedPrompts = InferFieldType<
  typeof RecommendedPromptsBlock
>;

export { defaultRules } from './lint/passes/index.js';

export const agentforceDialect: DialectConfig = {
  name: DIALECT_NAME,
  displayName: 'Agentforce',
  description: 'Agentforce dialect with Salesforce-specific blocks and rules',
  version: DIALECT_VERSION,
  schemaInfo: AgentforceSchemaInfo,
  createRules: defaultRules,
  source: 'agentforce-lint',
};
