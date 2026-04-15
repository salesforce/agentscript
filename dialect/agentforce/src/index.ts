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
  SecurityBlock,
  AFActionsBlock,
  ContextBlock,
  AgentforceSchema,
  AgentforceKindToSchemaKey,
  AgentforceSchemaAliases,
  AgentforceSchemaInfo,
  agentforceSchemaContext,
  InboundKeywordsBlock,
  PronunciationDictEntryBlock,
} from './schema.js';

export { COMMERCE_SHOPPER_SCHEMA } from './variants/commerce-cloud-shopper.js';

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
  SecurityBlock,
  ModalityBlock,
  VoiceModalitySchema,
  AdditionalConfigsBlock,
  SpeakUpConfigBlock,
  EndpointingConfigBlock,
  BeepBoopConfigBlock,
  ContextBlock,
} from './schema.js';

export type ParsedConfig = InferFieldType<typeof AgentforceSchema.config>;
export type ParsedTopic = InferFieldType<typeof AFTopicBlock>;
export type ParsedSubagent = InferFieldType<typeof AFSubagentBlock>;
export type ParsedStartAgent = InferFieldType<typeof AFStartAgentBlock>;
export type ParsedKnowledge = InferFieldType<typeof KnowledgeBlock>;
export type ParsedConnection = InferFieldType<typeof ConnectionBlock>;
export type ParsedSecurity = InferFieldType<typeof SecurityBlock>;
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
