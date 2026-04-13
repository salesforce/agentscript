/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  DialectConfig,
  InferFields,
  InferFieldType,
  Parsed,
} from '@agentscript/language';
import { AgentScriptSchema, AgentScriptSchemaInfo } from './schema.js';
import { defaultRules } from './lint/passes/index.js';
import { DIALECT_NAME, DIALECT_VERSION } from './pkg-meta.js';

export {
  MessagesBlock,
  SystemBlock,
  ConfigBlock,
  LanguageBlock,
  ReasoningBlock,
  SubagentBlock,
  StartAgentBlock,
  ConnectedSubagentBlock,
  VariablePropertiesBlock,
  InputPropertiesBlock,
  OutputPropertiesBlock,
  VariablesBlock,
  InputsBlock,
  OutputsBlock,
  ActionBlock,
  ActionsBlock,
  ReasoningActionBlock,
  ReasoningActionsBlock,
  VARIABLE_MODIFIERS,
  AGENTSCRIPT_PRIMITIVE_TYPES,
  AgentScriptSchema,
  AgentScriptSchemaAliases,
  AgentScriptSchemaInfo,
  agentScriptSchemaContext,
  baseSubagentFields,
} from './schema.js';

export type { AgentScriptSchema as AgentScriptSchemaType } from './schema.js';

// Parsed types derived from schema via InferFields (replaces codegen)
import type {
  MessagesBlock,
  SystemBlock,
  ConfigBlock,
  LanguageBlock,
  ReasoningBlock,
  SubagentBlock,
  StartAgentBlock,
  ConnectedSubagentBlock,
} from './schema.js';

import type { ActionBlock, ReasoningActionBlock } from '@agentscript/language';

export type ParsedDocumentFields = InferFields<typeof AgentScriptSchema>;
export type ParsedDocument = Parsed<ParsedDocumentFields>;
export type ParsedSystem = InferFieldType<typeof SystemBlock>;
export type ParsedConfig = InferFieldType<typeof ConfigBlock>;
export type ParsedLanguage = InferFieldType<typeof LanguageBlock>;
export type ParsedSubagent = InferFieldType<typeof SubagentBlock>;
export type ParsedStartAgent = InferFieldType<typeof StartAgentBlock>;
export type ParsedAction = InferFieldType<typeof ActionBlock>;
export type ParsedReasoning = InferFieldType<typeof ReasoningBlock>;
export type ParsedReasoningAction = InferFieldType<typeof ReasoningActionBlock>;
export type ParsedMessages = InferFieldType<typeof MessagesBlock>;
export type ParsedConnectedAgent = InferFieldType<
  typeof ConnectedSubagentBlock
>;

export type { VariableModifier, AgentScriptPrimitiveType } from './schema.js';

export {
  defaultRules,
  typeMapAnalyzer,
  typeMapKey,
  reasoningActionsAnalyzer,
  reasoningActionsKey,
  actionIoRule,
  actionTypeCheckRule,
} from './lint/passes/index.js';

export type {
  TypeMap,
  VariableTypeInfo,
  ParamInfo,
  OutputParamInfo,
  BooleanField,
  StringField,
  ActionSignature,
  ConnectedAgentInfo,
  ConnectedAgentInputInfo,
  ReasoningActionEntry,
} from './lint/passes/index.js';

export { createLintEngine } from './lint/index.js';

export const agentscriptDialect: DialectConfig = {
  name: DIALECT_NAME,
  displayName: 'AgentScript',
  description: 'Standard AgentScript dialect',
  version: DIALECT_VERSION,
  schemaInfo: AgentScriptSchemaInfo,
  createRules: defaultRules,
  source: 'agentscript-lint',
};
