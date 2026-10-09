/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export { Runtime } from './turn/runtime.js';
export type {
  RuntimeOptions,
  TurnOptions,
  TurnResult,
  ToolUsageLimit,
} from './turn/runtime.js';

export { AbortError } from './errors.js';

export { StateStore } from './state/store.js';
export type { StateVarSpec } from './state/store.js';

export { EventBus } from './events/types.js';
export type { RuntimeEvent, EventListener } from './events/types.js';

export { ToolRegistry, STATE_UPDATE_TARGET } from './tools/registry.js';
export type {
  ToolAdapter,
  ToolAdapterInvocation,
  ToolRegistryOptions,
} from './tools/registry.js';
export { truncateToolResult, MAX_TOOL_RESULT_CHARS } from './tools/truncate.js';
export type { TruncateOptions } from './tools/truncate.js';
export { FnAdapter } from './tools/fn-adapter.js';
export type { FnHandler } from './tools/fn-adapter.js';
export { HttpAdapter } from './tools/http-adapter.js';
export type { HttpAdapterOptions } from './tools/http-adapter.js';
export { MockToolAdapter } from './tools/mock-adapter.js';
export { McpAdapter, parseMcpTarget } from './tools/mcp-adapter.js';
export type {
  McpServerSettings,
  McpServerHttpSettings,
  McpServerStdioSettings,
  McpServerSseSettings,
  McpToolDef,
} from './tools/mcp-types.js';
export { MCP_DEFAULT_TIMEOUT_MS } from './tools/mcp-types.js';

export type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  TokenUsage,
  Msg,
  TextMsg,
  ToolCallMsg,
  ToolResultMsg,
  ToolCall,
  ToolDef,
} from './llm/types.js';

export {
  FallbackDriver,
  retryAll,
  CostTrackingDriver,
  CostTracker,
} from './routing/index.js';
export type {
  NamedDriver,
  FallbackDriverOptions,
  ModelPrice,
  UsageStats,
  ModelUsage,
} from './routing/index.js';

export type {
  Middleware,
  BeforeTurnContext,
  BeforeTurnResult,
  AfterTurnContext,
  AfterTurnResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeLlmStepContext,
  BeforeLlmStepResult,
  AfterLlmStepContext,
  AfterLlmStepResult,
  OnErrorContext,
  OnErrorResult,
  OnStopContext,
  OnStopResult,
  OnSubagentStartContext,
  OnSubagentStopContext,
  OnInterruptContext,
} from './middleware/types.js';

export {
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
} from './checkpoint/types.js';
export type { Checkpoint, CheckpointStore } from './checkpoint/types.js';
export { MemoryCheckpointStore } from './checkpoint/memory-store.js';
export { FileCheckpointStore } from './checkpoint/fs-store.js';
export {
  CheckpointVersionError,
  CheckpointIncompatibleError,
} from './checkpoint/errors.js';

export { GuardrailExhaustionError } from './guardrails/types.js';
export type {
  Guardrail,
  GuardrailInput,
  GuardrailContext,
  GuardrailResult,
  GuardrailError,
  GuardrailTarget,
  ExhaustionPolicy,
} from './guardrails/types.js';
export {
  jsonSchemaGuardrail,
  regexGuardrail,
  contentPolicyGuardrail,
  customGuardrail,
  composeGuardrails,
} from './guardrails/validators.js';

export {
  Logger,
  NOOP_LOGGER,
  ConsoleLogTransport,
  MemoryLogTransport,
  LOG_LEVELS,
  LOG_LEVEL_SEVERITY,
  redact,
  installCrashHandlers,
  uninstallCrashHandlers,
  type LogLevel,
  type LogRecord,
  type LogTransport,
  type LoggerOptions,
  type LogContext,
  type MemoryLogTransportOptions,
  type LogQuery,
  type CrashHandlerOptions,
} from './logger/index.js';

export { TracingContext } from './tracing/context.js';
export { generateTraceId, generateSpanId } from './tracing/ids.js';
export type {
  Span,
  SpanExporter,
  SpanStatus,
  SpanEvent,
} from './tracing/types.js';
export { MultiSpanExporter } from './tracing/types.js';
export { InMemorySpanExporter } from './tracing/exporters/memory.js';
export { ConsoleSpanExporter } from './tracing/exporters/console.js';
export {
  OtlpJsonSpanExporter,
  type OtlpJsonSpanExporterOptions,
} from './tracing/exporters/otlp-json.js';
export type { TracingOptions } from './turn/runtime.js';

export type {
  DelegationOptions,
  DelegationFrame,
  DelegationResult,
  DelegationSummaryPolicy,
  DelegationHookContext,
  OnWillDelegate,
  OnDidDelegate,
} from './delegation/types.js';
export {
  DelegationTimeoutError,
  DelegationDepthError,
  StateConflictError,
} from './delegation/errors.js';
export {
  AgentRegistry,
  type AgentHandle,
  type AgentRegistryEvent,
  type AgentRegistryListener,
} from './delegation/registry.js';

// Background subagents — a subagent launched with `run_in_background: true`
// runs detached against an isolated clone of parent state while the parent
// keeps reasoning; the parent pulls results via the `subagent://` tools.
export {
  BackgroundTaskManager,
  BackgroundCapacityError,
  MemoryBackgroundTaskStore,
  isBackgroundTaskTerminal,
  TERMINAL_BACKGROUND_STATUSES,
} from './background/index.js';
export type {
  BackgroundTaskStatus,
  BackgroundTaskInfo,
  BackgroundChildCheckpoint,
  BackgroundTaskStore,
  BackgroundTaskManagerOptions,
  BackgroundLaunchResult,
  BackgroundRunContext,
  BackgroundSpawnRequest,
  BackgroundNotification,
  BackgroundNotificationListener,
} from './background/index.js';

// Swarm fan-out — one parent tool call (`swarm://run`) expands an `items` list
// + a `prompt_template` into N isolated child runs that execute
// bounded-concurrently and aggregate into one `<agent_swarm_result>` block.
// Ported from the reference agent's `AgentSwarm`.
export {
  SWARM_ITEM_PLACEHOLDER,
  MAX_SWARM_SUBAGENTS,
  MIN_SWARM_ITEMS,
  DEFAULT_SWARM_MAX_CONCURRENCY,
  expandSwarmItems,
  renderSwarmResults,
  SwarmExpansionError,
  runPool,
} from './swarm/index.js';
export type {
  SwarmOutcome,
  SwarmSpec,
  SwarmRunResult,
  SwarmOptions,
} from './swarm/index.js';

// Repeated-identical-tool-call guard — a loop escape hatch (ported from the reference agent's
// tool-dedup) that suffixes an escalating <system-reminder> onto a spinning
// tool result and force-stops the turn past a hard ceiling. Enabled by default;
// toggle via RuntimeOptions.toolLoopGuard.
export {
  ToolCallDeduplicator,
  canonicalArgs,
  REPEAT_REMINDER_1_START,
  REPEAT_REMINDER_2_START,
  REPEAT_REMINDER_3_START,
  REPEAT_FORCE_STOP_STREAK,
} from './turn/tool-dedup.js';
export type { DedupAction, DedupDecision } from './turn/tool-dedup.js';

export type {
  ParallelStrategy,
  FailurePolicy,
  ParallelDispatchOptions,
  ParallelDelegationOptions,
} from './parallel/types.js';

export type {
  StructuredOutputOptions,
  StructuredOutputStrategy,
  ParsedStructuredOutput,
} from './structured-output/types.js';
export {
  buildResponseFormat,
  parseStructuredOutput,
} from './structured-output/enforce.js';

export { serverBlockConfigSchema } from './server-block.js';
export {
  parseServerBlockFromSource,
  parseServerBlockValue,
  resolveServerBlockValue,
  resolveLlmConfig,
  walkEnvRefs,
} from './server-block.js';
export type {
  EnvRef,
  ServerBlockValue,
  LlmConfig,
  McpServerConfig,
  ServerBlockConfig,
  AgentDSLAuthoringWithServerBlock,
  EnvSource,
  ResolvedLlmConfig,
} from './server-block.js';

export {
  TRIGGER_EVENTS,
  REPORT_TARGETS,
  triggerSchema,
  matchTrigger,
  matchGlobList,
  buildEventContext,
  renderPrompt,
  parseTriggerBlockFromSource,
  TriggerParseError,
} from './trigger-block.js';
export type {
  TriggerEvent,
  ReportTarget,
  TriggerOnEntry,
  TriggerSpec,
  GitEvent,
  TriggerMatch,
} from './trigger-block.js';

export {
  IR_MANIFEST_FILENAME,
  IR_MANIFEST_VERSION,
  parseIrManifest,
} from './bundle/ir-manifest.js';
export type { AgentIrEntry, AgentIrManifest } from './bundle/ir-manifest.js';
