/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

// High-level, Vercel-idiomatic API. Start here.
export { createAgent, AgentScriptAgent } from './agent.js';
export type {
  CreateAgentOptions,
  AgentRunOptions,
  AgentRunResult,
  AgentStepInfo,
  AgentStream,
  AgentStreamPart,
} from './agent.js';

// Low-level driver — exposed for users who want to plug directly into
// `@agentscript/runtime` without going through `createAgent`.
export { VercelAiSdkDriver } from './driver.js';
export type {
  VercelDriverOptions,
  AiSdkModelLike,
  GenerateTextFn,
  StreamTextFn,
  StreamTextPart,
  UsageLike,
} from './driver.js';

// Usage/cost types are surfaced on `AgentRunResult.usage` and `agent.usage()`.
// Re-exported here so consumers don't need a direct `@agentscript/runtime`
// import just to type the usage payload.
export type { UsageStats, ModelUsage, ModelPrice } from '@agentscript/runtime';

// Payload type carried by the `delegation-end` stream part.
export type { DelegationResult } from '@agentscript/runtime';

// Checkpoint surface — capture/restore an agent's runtime state between turns.
// Re-exported so consumers that persist or resume sessions (e.g. the ACP
// bridge's `session/load`) don't need a direct `@agentscript/runtime` import
// just to type or store a snapshot.
export {
  CHECKPOINT_SCHEMA_VERSION,
  MemoryCheckpointStore,
  FileCheckpointStore,
} from '@agentscript/runtime';
export type { Checkpoint, CheckpointStore } from '@agentscript/runtime';
export {
  CheckpointVersionError,
  CheckpointIncompatibleError,
} from '@agentscript/runtime';

// Bridge for exposing MCP servers configured via `server.mcp` as Vercel AI
// SDK tools. Pair with `createMcpAdapter()` from `@sf-agentscript/server`.
export { mcpToolsForVercel } from './mcp-tools.js';
export type { VercelToolFactories } from './mcp-tools.js';

/**
 * Re-export the compile pipeline so consumers of this package don't need to
 * separately depend on @agentscript/agentforce. We intentionally narrow the
 * surface to just the entry point most adapter users need.
 *
 * **Dialect note:** `compileSource` uses the Agentforce dialect exclusively.
 * This is intentional — the majority of runtime-vercel consumers target
 * Agentforce agents. If you need a different dialect (e.g.
 * `@agentscript/agentscript-dialect` or `@agentscript/agentfabric-dialect`),
 * compile your source separately using `@agentscript/compiler`'s `compile()`
 * and pass the resulting `AgentDSLAuthoring` directly to `createAgent({ doc })`.
 * The runtime is dialect-agnostic — only the compile step is dialect-specific.
 */
export { compileSource } from '@agentscript/agentforce';
export type { AgentforceCompileResult } from '@agentscript/agentforce';
