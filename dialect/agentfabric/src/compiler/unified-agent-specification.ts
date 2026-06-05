/**
 * TypeScript types derived from the Pydantic UnifiedAgentSpecification model
 * in docs/schemas/spec.py. Field names use kebab-case to match the
 * KebabCaseModel alias convention used in the Python runtime.
 */

// ── Expression type aliases ─────────────────────────────────────────

export type Expr = string | number | boolean;
export type StateUpdateExpr = Expr | null;
export type BoundInputsExpr = Expr | null;

// ── Enums ───────────────────────────────────────────────────────────

export enum ObjectTypes {
  ACTION = 'action',
  AGENT = 'agent',
  EXTERNAL_AGENT = 'external-agent',
  HANDOFF = 'handoff',
  ROUTER = 'router',
  MCP_ACTION = 'mcp-action',
}

export enum SubgraphPersistence {
  EPHEMERAL = 'ephemeral',
  PERSISTENT = 'persistent',
}

export enum SubgraphInitStateMode {
  COPY_PARENT = 'copy_parent',
  BLANK_SLATE = 'blank_slate',
}

export enum SubgraphInitMemoryMode {
  COPY_PARENT = 'copy_parent',
  BLANK_SLATE = 'blank_slate',
}

export enum SubgraphResultMode {
  TOOL_RESULT = 'tool_result',
  FINAL_RESULT = 'final_result',
}

export enum SubgraphStateApplyMode {
  NONE = 'none',
  ALL = 'all',
  ALLOWLIST = 'allowlist',
}

// ── Subgraph configuration ──────────────────────────────────────────

export interface SubgraphToolConfiguration {
  'state-mode'?: SubgraphInitStateMode;
  'memory-mode'?: SubgraphInitMemoryMode;
  'result-mode'?: SubgraphResultMode;
  persistence?: SubgraphPersistence;
  'state-apply-mode'?: SubgraphStateApplyMode;
}

// ── Output & cache behaviors ────────────────────────────────────────

export interface OutputBehavior {
  name: string;
  'emit-in-response': boolean;
  'add-to-chat-history': boolean;
}

export interface CacheBehavior {
  enabled?: boolean;
  ttl?: number;
}

export interface ActionBehavior {
  'require-user-confirmation': boolean;
  'include-in-progress-indicator': boolean;
  'progress-indicator-message'?: string | null;
  outputs?: OutputBehavior[] | null;
  cache?: CacheBehavior | null;
}

// ── Action definitions ──────────────────────────────────────────────

export interface ActionDefinition {
  name: string;
  type: ObjectTypes.ACTION;
  client: string;
  label: string;
  description: string;
  'invocation-target-type': string;
  'invocation-target-name': string;
  'input-schema': unknown;
  'output-schema': unknown;
  behavior?: ActionBehavior | null;
  metadata?: Record<string, unknown> | null;
}

export interface MCPActionDefinition extends Omit<ActionDefinition, 'type'> {
  type: ObjectTypes.MCP_ACTION;
  annotations?: Record<string, unknown> | null;
}

// ── Variables ───────────────────────────────────────────────────────

export interface RequestVariable {
  name: string;
  'data-type': string;
  description: string;
}

export interface StateVariable {
  name: string;
  label: string;
  'data-type': string;
  'is-list'?: boolean | null;
  description: string;
  default: unknown;
}

// ── LLM reference ───────────────────────────────────────────────────

export interface LLMRef {
  ref: string;
  configuration: Record<string, string>;
  'output-structure-ref'?: string;
}

// ── System policy ───────────────────────────────────────────────────

export interface SystemPolicy {
  name: string;
  value: unknown;
  type: 'system';
}

// ── Action callable reference ───────────────────────────────────────

export interface ActionCallableReference {
  type?: ObjectTypes.ACTION;
  target?: string | null;
  ref?: string | null;
  description?: string | null;
  'bound-inputs'?: Record<string, BoundInputsExpr> | null;
  enabled?: Expr | null;
  'state-updates'?: Array<Record<string, StateUpdateExpr>> | null;
}

// ── Tool call reference ─────────────────────────────────────────────

export interface ToolCallReference extends ActionCallableReference {
  name: string;
  'llm-inputs'?: string[] | null;
  forced?: Expr | null;
}

// ── MCP tool ────────────────────────────────────────────────────────

export interface MCPTool {
  type: 'mcp_tool';
  ref: string;
  enabled?: Expr | null;
  'bound-inputs'?: Record<string, BoundInputsExpr> | null;
  'llm-inputs'?: string[] | null;
}

// ── A2A tool ────────────────────────────────────────────────────────

export interface A2ATool {
  type: 'a2a';
  ref: string;
  enabled?: Expr | null;
  'bound-inputs'?: Record<string, BoundInputsExpr> | null;
  'llm-inputs'?: string[] | null;
}

// ── Subgraph tool ───────────────────────────────────────────────────

export interface SubgraphTool {
  type: 'subgraph';
  target: string;
  name: string;
  description: string;
  forced?: Expr | null;
  enabled?: Expr | null;
  'state-updates'?: Array<Record<string, StateUpdateExpr>> | null;
  configuration?: SubgraphToolConfiguration;
}

export type ToolUnion = ToolCallReference | SubgraphTool | MCPTool | A2ATool;

// ── Handoff action ──────────────────────────────────────────────────

export interface HandoffAction {
  type: ObjectTypes.HANDOFF;
  target: string;
  enabled?: string | boolean | null;
  'state-updates'?: Array<Record<string, StateUpdateExpr>> | null;
}

export type HandoffActionUnion = HandoffAction | ActionCallableReference;

// ── Node reference ──────────────────────────────────────────────────

export interface NodeReference {
  target: string;
  description: string;
  enabled?: Expr | null;
  'state-updates'?: Array<Record<string, StateUpdateExpr>> | null;
}

// ── External agent metadata ─────────────────────────────────────────

export interface ExternalAgentMetadata {
  protocol: string;
}

export interface A2AExternalAgentMetadata extends ExternalAgentMetadata {
  protocol: 'a2a';
  platform: string;
  url: string;
}

// ── Node system limits ──────────────────────────────────────────────

export interface NodeSystemLimits {
  'max-reasoning-iterations'?: number;
  'max-node-tool-call-iterations'?: number;
  'max-consecutive-errors'?: number;
  'task-timeout-secs'?: number;
}

// ── Pre/Post tool call references ───────────────────────────────────

export interface PreToolCallReference {
  'target-tool-name': string;
  actions: ActionCallableReference[];
}

export interface PostToolCallReference {
  'target-tool-name': string;
  actions: ActionCallableReference[];
}

// ── Nodes ───────────────────────────────────────────────────────────

export interface AgentNode {
  name: string;
  label?: string | null;
  description?: string | null;
  type: ObjectTypes.AGENT;
  llm: LLMRef;
  'on-init'?: HandoffActionUnion[] | null;
  'before-reasoning'?: HandoffActionUnion[] | null;
  'before-reasoning-iteration'?: HandoffActionUnion[] | null;
  'system-prompt': string;
  'focus-prompt'?: string | null;
  tools?: ToolUnion[] | null;
  'pre-tool-calls'?: PreToolCallReference[] | null;
  'post-tool-calls'?: PostToolCallReference[] | null;
  'after-all-tool-calls'?: HandoffActionUnion[] | null;
  'after-reasoning'?: HandoffActionUnion[] | null;
  'on-exit'?: ActionCallableReference[] | null;
  policies?: SystemPolicy[] | null;
  'system-limits'?: NodeSystemLimits;
}

export interface LLMToolCallClassifierRef {
  type: 'llm-tool-call';
  llm?: LLMRef | null;
}

export type ClassifierRef = LLMToolCallClassifierRef;

export interface RouterNode {
  name: string;
  label?: string | null;
  description?: string | null;
  type: ObjectTypes.ROUTER;
  policies?: SystemPolicy[] | null;
  classifier?: ClassifierRef;
  'node-references': NodeReference[];
  'on-init'?: HandoffActionUnion[] | null;
  'system-prompt'?: string | null;
  'before-reasoning-iteration'?: HandoffActionUnion[] | null;
  'on-exit'?: HandoffActionUnion[] | null;
  'system-limits'?: NodeSystemLimits;
}

export interface ActionNode {
  name: string;
  type?: ObjectTypes.ACTION;
  label?: string | null;
  description?: string | null;
  'on-init'?: HandoffActionUnion[] | null;
  tools: ActionCallableReference[];
  'is-parallel'?: boolean;
  'add-tool-result-to-chat-history'?: boolean;
  'on-exit'?: HandoffActionUnion[] | null;
  'output-template'?: string | null;
  policies?: SystemPolicy[] | null;
  'system-limits'?: NodeSystemLimits;
}

export interface ExternalAgentNode {
  name: string;
  type: ObjectTypes.EXTERNAL_AGENT;
  label?: string | null;
  metadata?: ExternalAgentMetadata | null;
  ref?: string | null;
  'system-limits'?: NodeSystemLimits;
}

export type Node = AgentNode | ExternalAgentNode | RouterNode | ActionNode;

// ── Turn system limits ──────────────────────────────────────────────

export interface TurnSystemLimits {
  'max-handoff-iterations'?: number;
  'max-subgraph-depth'?: number;
  'max-turn-tool-call-counts'?: number;
}

export interface Behavior {
  'reset-to-initial-node'?: boolean;
  'disable-groundedness'?: boolean;
  'disable-error-behavior'?: boolean;
  'turn-system-limits'?: TurnSystemLimits;
}

// ── Graph config ────────────────────────────────────────────────────

export interface PluginConfig {
  type: 'plugin';
  name: string;
  kind: string;
  config: Record<string, unknown>;
}

export type GraphConfigItem = PluginConfig;

export interface GraphConfig {
  config?: GraphConfigItem[] | null;
  'request-variables'?: RequestVariable[] | null;
  'state-variables'?: StateVariable[] | null;
  'initial-node': string;
  nodes: Node[];
  behaviors?: Behavior | null;
}

// ── Definitions ─────────────────────────────────────────────────────

export type Definition =
  | ActionDefinition
  | ExternalAgentNode
  | MCPActionDefinition;

// ── Top-level specification ─────────────────────────────────────────

export interface UnifiedAgentSpecification {
  'schema-version': string;
  id: string;
  label: string;
  definitions?: Definition[] | null;
  'pre-orchestration'?: unknown | null;
  graph: GraphConfig;
  'post-orchestration'?: unknown | null;
}
