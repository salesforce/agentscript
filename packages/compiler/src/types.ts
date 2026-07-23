/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * AgentDSLAuthoring output types — derived from the OpenAPI zod schema.
 *
 * All types are inferred from the generated zod schemas in ./generated/agent-dsl.ts.
 * The generator + post-processing script produces snake_case property names
 * matching the AgentJSON output format.
 *
 * We use `z.input<>` rather than `z.infer<>` because the compiler emits the
 * pre-validation shape (before Zod applies `.default()` etc). Using `z.input`
 * keeps fields like `LanguageConfiguration.adaptive` optional in TypeScript,
 * matching what the compiler actually writes.
 */

import { z } from 'zod';
import * as schema from './generated/agent-dsl.js';
import { recommendedPromptsConfiguration as _recommendedPromptsConfigurationBase } from './generated/agent-dsl.js';

// ---------------------------------------------------------------------------
// Re-export zod schemas (for runtime validation)
// ---------------------------------------------------------------------------

export {
  agentDslAuthoring,
  globalAgentConfiguration as globalAgentConfigurationSchema,
  agentVersion as agentVersionSchema,
  contextVariable as contextVariableSchema,
  contextConfiguration as contextConfigurationSchema,
  memoryConfiguration as memoryConfigurationSchema,
  userProfileConfiguration as userProfileConfigurationSchema,
  pastConversationsConfiguration as pastConversationsConfigurationSchema,
  stateVariable as stateVariableSchema,
  subAgentNode as subAgentNodeSchema,
  routerNode as routerNodeSchema,
  actionConfiguration as actionConfigurationSchema,
  tool as toolSchema,
  action as actionSchema,
  handOffAction as handOffActionSchema,
  systemMessage as systemMessageSchema,
  modalityParameters as modalityParametersSchema,
  surface as surfaceSchema,
  inputParameter as inputParameterSchema,
  outputParameter as outputParameterSchema,
  byonNode as byonNodeSchema,
  byoClientConfig as byoClientConfigSchema,
  responseFormat as responseFormatSchema,
  responseAction as responseActionSchema,
  skill as skillSchema,
} from './generated/agent-dsl.js';

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

// -- Top-level --
export type AgentDSLAuthoring = z.input<typeof schema.agentDslAuthoring>;

// -- Global Configuration --
export type GlobalAgentConfiguration = z.input<
  typeof schema.globalAgentConfiguration
>;
export type ContextVariable = z.input<typeof schema.contextVariable>;

// -- Context Configuration --
export type ContextConfiguration = z.input<typeof schema.contextConfiguration>;
export type MemoryConfiguration = z.input<typeof schema.memoryConfiguration>;
export type UserProfileConfiguration = z.input<
  typeof schema.userProfileConfiguration
>;
export type PastConversationsConfiguration = z.input<
  typeof schema.pastConversationsConfiguration
>;

// -- Recommended Prompts Configuration --
//
// NOTE: max-entries (20) and per-string-length (1-50) limits are NOT
// duplicated here — they already live on the OpenAPI-generated
// `recommendedPromptsConfiguration` schema (see ./generated/agent-dsl.ts).
// `safeParse()` against that base schema enforces them; friendly messages
// for those specific Zod issues are derived at the call site
// (compile-agent-version.ts) instead of being hardcoded a second time here.
//
// Only refinements for rules that are NOT expressible in the OpenAPI spec
// belong here.
export const recommendedPromptsConfigurationSchema =
  _recommendedPromptsConfigurationBase
    .refine(data => !data.starter_prompts || data.welcome_screen, {
      message: 'starter_prompts can only be set when welcome_screen is True',
    })
    .refine(data => !data.starter_prompts || data.starter_prompts.length >= 3, {
      message: 'starter_prompts must contain at least 3 entries',
    });

export type RecommendedPromptsConfiguration = z.input<
  typeof schema.recommendedPromptsConfiguration
>;

// -- Agent Version --
export type AgentVersion = z.input<typeof schema.agentVersion>;

// -- System Messages --
export type SystemMessage = z.input<typeof schema.systemMessage>;

// -- Modality --
export type ModalityParameters = z.input<typeof schema.modalityParameters>;
export type LanguageConfiguration = z.input<
  typeof schema.languageConfiguration
>;
export type VoiceConfiguration = z.input<typeof schema.voiceConfiguration>;

// -- State Variables --
export type StateVariable = z.input<typeof schema.stateVariable>;

// -- Nodes --
export type SubAgentNode = z.input<typeof schema.subAgentNode>;
export type RouterNode = z.input<typeof schema.routerNode>;
export type RelatedAgentNode = z.input<typeof schema.relatedAgentNode>;
export type BYONNode = z.input<typeof schema.byonNode>;
export type BYOClientConfig = z.input<typeof schema.byoClientConfig>;
export type AgentNode = SubAgentNode | RouterNode | RelatedAgentNode | BYONNode;

// -- Actions & Tools --
// `type` is `.optional()` in the upstream schema (no `.default()` since the
// switch to `enum: [action]` discriminants in agent-dsl), so `z.input` produces
// `type?: 'action' | 'handoff' | undefined`. The downstream union types
// (`actionOrHandoff`, `actionOrSupervision`) require the literal-narrowed
// branch, and the compiler always emits an explicit `type` — narrow it here.
export type Action = z.input<typeof schema.action> & { type: 'action' };
export type HandOffAction = z.input<typeof schema.handOffAction> & {
  type: 'handoff';
};
export type Tool = z.input<typeof schema.tool> & { type: 'action' };
export type SupervisionTool = z.input<typeof schema.supervisionTool> & {
  type: 'supervision';
};
export type PostToolCall = z.input<typeof schema.postToolCall>;
export type RouterTool = z.input<typeof schema.nodeReference>;

// -- Action Definitions --
export type ActionDefinition = z.input<typeof schema.actionConfiguration>;
export type InputParameter = z.input<typeof schema.inputParameter>;
export type OutputParameter = z.input<typeof schema.outputParameter>;
export type Skill = z.input<typeof schema.skill>;

// -- Surfaces --
export type Surface = z.input<typeof schema.surface>;
export type OutboundRouteConfig = z.input<typeof schema.outboundRouteConfig>;

export type SurfaceInputParameter = z.input<
  typeof schema.surfaceInputParameter
>;

// -- Surface Response Formats --
export type ResponseFormat = z.input<typeof schema.responseFormat>;
export type ResponseAction = z.input<typeof schema.responseAction>;

// -- Model Configuration --
export type ModelConfiguration = z.input<typeof schema.modelConfig>;

// -- Security Configuration --
export type SecurityConfiguration = z.input<
  typeof schema.securityConfiguration
>;

// -- Runtime Configuration --
export type RuntimeConfiguration = z.input<typeof schema.runtimeConfiguration>;

// ---------------------------------------------------------------------------
// Additional types not in the OpenAPI schema (compiler-specific)
// ---------------------------------------------------------------------------

/**
 * additional_parameters is typed as Record<string, unknown> in the schema,
 * but we use known keys for the compiler output. The index signature allows
 * arbitrary additional_parameter__* fields from the schema.
 */
export interface AdditionalParameters {
  reset_to_initial_node?: boolean;
  rag_feature_config_id?: string;
  system_messages?: string;
  DISABLE_GROUNDEDNESS?: boolean;
  debug?: boolean;
  max_tokens?: number;
  temperature?: number;
  [key: string]: boolean | string | number | undefined;
}

/** A single state_updates entry: { variable_name: expression } */
export type StateUpdate = Record<string, string>;
