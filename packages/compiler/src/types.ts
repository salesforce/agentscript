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
  searchConfiguration as searchConfigurationSchema,
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
  fileReference as fileReferenceSchema,
  skill as skillSchema,
  bundle as bundleSchema,
  nodeBundleReference as nodeBundleReferenceSchema,
  workflow as workflowSchema,
  trigger as triggerSchema,
  salesforceConfiguration as salesforceConfigurationSchema,
  dataCloudConfiguration as dataCloudConfigurationSchema,
  orchestratorNode as orchestratorNodeSchema,
  workflowNode as workflowNodeSchema,
  workflowStep as workflowStepSchema,
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
export type SearchConfiguration = z.input<typeof schema.searchConfiguration>;
export type SalesforceConfiguration = z.input<
  typeof schema.salesforceConfiguration
>;
export type DataCloudConfiguration = z.input<
  typeof schema.dataCloudConfiguration
>;

// -- Recommended Prompts Configuration --
//
// Value validation (welcome_screen gating, min-3 / max-20 entries, per-string
// length) lives in the dialect lint pass `recommended-prompts-validation.ts`
// so authors get live editor feedback.
export type RecommendedPromptsConfiguration = z.input<
  typeof schema.recommendedPromptsConfiguration
>;

// -- Agent Version --
export type AgentVersion = z.input<typeof schema.agentVersion>;

// -- GBA constructs (bundles / workflows / triggers) --
export type Bundle = z.input<typeof schema.bundle>;
export type NodeBundleReference = z.input<typeof schema.nodeBundleReference>;
export type NodeSkillReference = z.input<typeof schema.nodeSkillReference>;
export type Workflow = z.input<typeof schema.workflow>;
export type Trigger = z.input<typeof schema.trigger>;

// -- System Messages --
export type SystemMessage = z.input<typeof schema.systemMessage>;

// -- Modality --
export type ModalityParameters = z.input<typeof schema.modalityParameters>;
export type LanguageConfiguration = z.input<
  typeof schema.languageConfiguration
>;
export type VoiceConfiguration = z.input<typeof schema.voiceConfiguration>;
export type VoiceV2Config = z.input<typeof schema.voiceV2Config>;
export type VoiceLanguageConfig = z.input<typeof schema.voiceLanguageConfig>;
export type VoiceInboundModel = z.input<typeof schema.voiceInboundModel>;
export type VoiceOutboundModel = z.input<typeof schema.voiceOutboundModel>;

// -- State Variables --
export type StateVariable = z.input<typeof schema.stateVariable>;

// -- Nodes --
// Every generated node schema shares one optional `type` enum, so `z.input`
// gives each variant `type?: 'byon' | 'orchestrator' | ...` and `AgentNode`
// can't narrow on it. The compiler always emits the matching literal — narrow
// each variant here so `node.type === 'router'` narrows natively.
export type SubAgentNode = z.input<typeof schema.subAgentNode> & {
  type: 'subagent';
};
export type RouterNode = z.input<typeof schema.routerNode> & {
  type: 'router';
};
export type RelatedAgentNode = z.input<typeof schema.relatedAgentNode> & {
  type: 'related_agent';
};
export type BYONNode = z.input<typeof schema.byonNode> & { type: 'byon' };
export type BYOClientConfig = z.input<typeof schema.byoClientConfig>;
export type OrchestratorNode = z.input<typeof schema.orchestratorNode> & {
  type: 'orchestrator';
};
export type WorkflowNode = z.input<typeof schema.workflowNode> & {
  type: 'workflow';
};
export type WorkflowStep = z.input<typeof schema.workflowStep>;
export type AgentNode =
  | SubAgentNode
  | RouterNode
  | RelatedAgentNode
  | BYONNode
  | OrchestratorNode
  | WorkflowNode;

// -- Workflow directives --
// Like Action/HandOffAction below, `type` is optional upstream; the compiler
// always emits it, so narrow each branch to its literal discriminant.
export type WorkflowAction = z.input<typeof schema.workflowAction> & {
  type: 'action';
};
export type WorkflowHandoff = z.input<typeof schema.workflowHandoff> & {
  type: 'handoff';
};
export type SayAction = z.input<typeof schema.sayAction> & { type: 'say' };
export type AskForAction = z.input<typeof schema.askForAction> & {
  type: 'ask_for';
};
export type WorkflowDirective =
  | WorkflowAction
  | WorkflowHandoff
  | SayAction
  | AskForAction;

// -- File references (MANAGED file-upload) --
// One compiler-emitted `@system_variables.uploaded_files` descriptor: exactly
// one selector (all/index/slice) plus an optional compiled `enabled` condition.
export type FileReference = z.input<typeof schema.fileReference>;

// -- Actions & Tools --
// `type` is `.optional()` in the upstream schema (no `.default()` since the
// switch to `enum: [action]` discriminants in agent-dsl), so `z.input` produces
// `type?: 'action' | 'handoff' | undefined`. The downstream union types
// (`actionOrHandoff`, `actionOrSupervision`) require the literal-narrowed
// branch, and the compiler always emits an explicit `type` — narrow it here.
export type Action = z.input<typeof schema.action> & {
  type: 'action';
};
export type HandOffAction = z.input<typeof schema.handOffAction> & {
  type: 'handoff';
};

// Guards for the lifecycle `(Action | HandOffAction)[]` lists; they narrow
// because of the literal `type` intersections above.
export function isAction(a: Action | HandOffAction): a is Action {
  return a.type === 'action';
}
export function isHandOffAction(a: Action | HandOffAction): a is HandOffAction {
  return a.type === 'handoff';
}
export type Tool = z.input<typeof schema.tool> & {
  type: 'action';
};

export type RenderRule = z.input<typeof schema.renderRule>;
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
