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
import { AgentFabricSchema, AgentFabricSchemaInfo } from './schema.js';
import { defaultRules } from './lint/passes/index.js';
import { DIALECT_NAME, DIALECT_VERSION } from './pkg-meta.js';

// ── Schema re-exports ───────────────────────────────────────────────

export {
  SystemBlock,
  VariablesBlock,
  AFConfigBlock,
  LLMEntryBlock,
  LLMBlock,
  ActionDefBlock,
  ActionDefinitionsBlock,
  TriggerBlock,
  TriggersBlock,
  OutputPropertyBlock,
  OutputStructureBlock,
  NodeActionsBlock,
  OrchestratorBlock,
  SubagentBlock,
  GeneratorBlock,
  ExecutorBlock,
  RouterRouteBlock,
  RouterOtherwiseBlock,
  RouterBlock,
  EchoBlock,
  AgentFabricSchema,
  AgentFabricSchemaAliases,
  AgentFabricSchemaInfo,
  agentFabricSchemaContext,
} from './schema.js';

// ── Parsed types derived from schema ────────────────────────────────

import type {
  AFConfigBlock,
  LLMEntryBlock,
  ActionDefBlock,
  TriggerBlock,
  OrchestratorBlock,
  SubagentBlock,
  GeneratorBlock,
  ExecutorBlock,
  RouterRouteBlock,
  RouterOtherwiseBlock,
  RouterBlock,
  EchoBlock,
} from './schema.js';

export type ParsedDocumentFields = InferFields<typeof AgentFabricSchema>;
export type ParsedDocument = Parsed<ParsedDocumentFields>;
export type ParsedConfig = InferFieldType<typeof AFConfigBlock>;
export type ParsedLLMEntry = InferFieldType<typeof LLMEntryBlock>;
export type ParsedActionDef = InferFieldType<typeof ActionDefBlock>;
export type ParsedTrigger = InferFieldType<typeof TriggerBlock>;
export type ParsedOrchestrator = InferFieldType<typeof OrchestratorBlock>;
export type ParsedSubagent = InferFieldType<typeof SubagentBlock>;
export type ParsedGenerator = InferFieldType<typeof GeneratorBlock>;
export type ParsedExecutor = InferFieldType<typeof ExecutorBlock>;
export type ParsedRouterRoute = InferFieldType<typeof RouterRouteBlock>;
export type ParsedRouterOtherwise = InferFieldType<typeof RouterOtherwiseBlock>;
export type ParsedRouter = InferFieldType<typeof RouterBlock>;
export type ParsedEcho = InferFieldType<typeof EchoBlock>;

// Re-export base dialect parsed types
export type {
  ParsedSystem,
  ParsedLanguage,
} from '@agentscript/agentscript-dialect';

// ── Lint re-exports ─────────────────────────────────────────────────

export { defaultRules } from './lint/passes/index.js';
export { createLintEngine } from './lint/index.js';

// ── Dialect config ──────────────────────────────────────────────────

export const agentfabricDialect: DialectConfig = {
  name: DIALECT_NAME,
  displayName: 'AgentFabric',
  description: 'AgentFabric dialect for workflow-based agent definitions',
  version: DIALECT_VERSION,
  schemaInfo: AgentFabricSchemaInfo,
  createRules: defaultRules,
  source: 'agentfabric-lint',
};
