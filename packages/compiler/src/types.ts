/**
 * AgentDSLAuthoring output types — derived from the OpenAPI zod schema.
 *
 * All types are inferred from the generated zod schemas in ./generated/agent-dsl.ts.
 * The generator + post-processing script produces snake_case property names
 * matching the AgentJSON output format.
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
} from './generated/agent-dsl.js';

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

// -- Top-level --

/**
 * Base AgentDSLAuthoring type from generated OpenAPI schema.
 */
export type AgentDSLAuthoring = z.infer<typeof schema.agentDslAuthoring>;

// -- Global Configuration --
export type GlobalAgentConfiguration = z.infer<
  typeof schema.globalAgentConfiguration
>;
export type ContextVariable = z.infer<typeof schema.contextVariable>;

// -- Context Configuration --
export type ContextConfiguration = z.infer<typeof schema.contextConfiguration>;
export type MemoryConfiguration = z.infer<typeof schema.memoryConfiguration>;

// -- Agent Version --
export type AgentVersion = z.infer<typeof schema.agentVersion>;

// -- System Messages --
export type SystemMessage = z.infer<typeof schema.systemMessage>;

// -- Modality --
export type ModalityParameters = z.infer<typeof schema.modalityParameters>;
export type LanguageConfiguration = z.infer<
  typeof schema.languageConfiguration
>;
export type VoiceConfiguration = z.infer<typeof schema.voiceConfiguration>;

// -- State Variables --
export type StateVariable = z.infer<typeof schema.stateVariable>;

// -- Nodes --
export type SubAgentNode = z.infer<typeof schema.subAgentNode>;
export type RouterNode = z.infer<typeof schema.routerNode>;
export type RelatedAgentNode = z.infer<typeof schema.relatedAgentNode>;
export type BYONNode = z.infer<typeof schema.byonNode>;
export type BYOClientConfig = z.infer<typeof schema.byoClientConfig>;
export type AgentNode = SubAgentNode | RouterNode | RelatedAgentNode | BYONNode;

// -- Actions & Tools --
export type Action = z.infer<typeof schema.action>;
export type HandOffAction = z.infer<typeof schema.handOffAction>;
export type Tool = z.infer<typeof schema.tool>;
export type SupervisionTool = z.infer<typeof schema.supervisionTool>;
export type PostToolCall = z.infer<typeof schema.postToolCall>;
export type RouterTool = z.infer<typeof schema.nodeReference>;

// -- Action Definitions --
export type ActionDefinition = z.infer<typeof schema.actionConfiguration>;
export type InputParameter = z.infer<typeof schema.inputParameter>;
export type OutputParameter = z.infer<typeof schema.outputParameter>;

// -- Surfaces --
export type Surface = z.infer<typeof schema.surface>;
export type OutboundRouteConfig = z.infer<typeof schema.outboundRouteConfig>;

// -- Model Configuration --
export type ModelConfiguration = z.infer<typeof schema.modelConfig>;

// -- Security Configuration --
export type SecurityConfiguration = z.infer<
  typeof schema.securityConfiguration
>;

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

/** Response format for surfaces (not in OpenAPI schema) */
export interface ResponseFormat {
  developer_name: string;
  label: string;
  description: string;
  source?: string;
  invocation_target_type?: string;
  invocation_target_name?: string;
  input_schema?: string;
}

/** Format tool for response_formats in reasoning (not in OpenAPI schema) */
export interface FormatTool {
  type: 'format';
  target: string;
  name: string;
  description: string;
}
