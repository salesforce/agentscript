/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg, ToolCall, ToolDef } from '../llm/types.js';
import type { RuntimeEvent } from '../events/types.js';
import type { Guardrail } from '../guardrails/types.js';

export interface Middleware {
  name: string;
  priority?: number;
  failOpen?: boolean;
  beforeTurn?(
    ctx: BeforeTurnContext
  ): Promise<BeforeTurnResult | void> | BeforeTurnResult | void;
  afterTurn?(
    ctx: AfterTurnContext
  ): Promise<AfterTurnResult | void> | AfterTurnResult | void;
  beforeToolCall?(
    ctx: BeforeToolCallContext
  ): Promise<BeforeToolCallResult | void> | BeforeToolCallResult | void;
  afterToolCall?(
    ctx: AfterToolCallContext
  ): Promise<AfterToolCallResult | void> | AfterToolCallResult | void;
  beforeLlmStep?(
    ctx: BeforeLlmStepContext
  ): Promise<BeforeLlmStepResult | void> | BeforeLlmStepResult | void;
  afterLlmStep?(
    ctx: AfterLlmStepContext
  ): Promise<AfterLlmStepResult | void> | AfterLlmStepResult | void;
  onError?(
    ctx: OnErrorContext
  ): Promise<OnErrorResult | void> | OnErrorResult | void;
  /**
   * BLOCKING. Fires when the model would naturally stop a turn (it emitted no
   * tool calls). Returning a `continuation` string injects that text as a user
   * message and resumes the reasoning loop for one more round — the runtime's
   * seam for the reference agent's `Stop` hook, which lets external tooling force the agent to
   * keep working. The runtime grants at most one continuation per turn.
   */
  onStop?(
    ctx: OnStopContext
  ): Promise<OnStopResult | void> | OnStopResult | void;
  /**
   * Notification. Fires just after a delegation (sub-agent) starts, once the
   * child frame is pushed and its handle registered. Seam for the reference agent's
   * `SubagentStart` hook.
   */
  onSubagentStart?(ctx: OnSubagentStartContext): Promise<void> | void;
  /**
   * Notification. Fires when a delegation settles (success or failure), after
   * the parent state is restored. Seam for the reference agent's `SubagentStop` hook.
   */
  onSubagentStop?(ctx: OnSubagentStopContext): Promise<void> | void;
  /**
   * Notification. Fires when a turn ends abnormally — a user/programmatic abort
   * (`reason: 'aborted'`) or an unhandled error (`reason: 'error'`). Seam for
   * the reference agent's `Interrupt` (abort) and `StopFailure` (error) hooks.
   */
  onInterrupt?(ctx: OnInterruptContext): Promise<void> | void;
}

export interface OnStopContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  assistantText: string;
  /** True once a Stop continuation has already been consumed this turn. */
  stopHookActive: boolean;
}

export interface OnStopResult {
  /**
   * When present, the turn does not stop: this text is appended as a user
   * message and the reasoning loop runs once more.
   */
  continuation?: string;
}

export interface OnSubagentStartContext {
  parentNode: string;
  childNode: string;
  depth: number;
  agentId?: string;
  context?: string;
  parallel: boolean;
}

export interface OnSubagentStopContext extends OnSubagentStartContext {
  ok: boolean;
  assistantText?: string;
  error?: unknown;
}

export interface OnInterruptContext {
  node: string;
  reason: 'aborted' | 'error';
  error?: unknown;
}

export interface BeforeTurnContext {
  userInput: string;
  node: string;
  state: Readonly<Record<string, unknown>>;
}

export interface BeforeTurnResult {
  userInput?: string;
  abort?: { assistantText: string };
}

export interface AfterTurnContext {
  assistantText: string;
  finalNode: string;
  state: Readonly<Record<string, unknown>>;
  events: readonly RuntimeEvent[];
}

export interface AfterTurnResult {
  assistantText?: string;
}

export interface BeforeToolCallContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  target: string;
  toolName: string;
  args: Record<string, unknown>;
  toolCall: Readonly<ToolCall>;
  /**
   * True when the compiled IR's action_definition for this tool has
   * `require_user_confirmation: true`. The runtime does not itself pause,
   * checkpoint, or prompt for confirmation — it only surfaces the compiled
   * intent so host middleware (e.g. a permission/elicitation layer) can act
   * on it.
   */
  requireConfirmation?: boolean;
}

export interface BeforeToolCallResult {
  args?: Record<string, unknown>;
  abort?: { result: Record<string, unknown> };
  skip?: boolean;
}

export interface AfterToolCallContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  target: string;
  toolName: string;
  args: Readonly<Record<string, unknown>>;
  result: Record<string, unknown>;
  error?: unknown;
}

export interface AfterToolCallResult {
  result?: Record<string, unknown>;
}

export interface BeforeLlmStepContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  system: string;
  messages: readonly Msg[];
  tools: readonly ToolDef[];
  /**
   * Set only on the recovery pass after a context-overflow rejection: the prior
   * LLM request was refused because the message array exceeded the model's
   * window. A compaction middleware MUST compact when this is true, regardless
   * of its normal token budget — the provider has already proven the request is
   * over the limit, so the estimator's own accounting is moot. Absent/false on
   * the normal proactive pass.
   */
  overflow?: boolean;
}

export interface BeforeLlmStepResult {
  system?: string;
  /**
   * Authoritatively REPLACE the conversation history the imminent LLM step
   * sees, and that persists going forward. Takes precedence over
   * `appendMessages`: the runtime swaps `replaceMessages` into the persisted
   * history in place before the step, then applies `appendMessages` (if also
   * present) AFTER the replacement. Use this for compaction — evicting old
   * messages, not merely annotating them. When omitted, history is untouched
   * and only `appendMessages` (if any) are added.
   */
  replaceMessages?: Msg[];
  appendMessages?: Msg[];
  tools?: ToolDef[];
  guardrails?: Guardrail[];
}

export interface AfterLlmStepContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  text: string;
  toolCalls: readonly ToolCall[];
}

export interface AfterLlmStepResult {
  text?: string;
  toolCalls?: ToolCall[];
}

export interface OnErrorContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  error: unknown;
  phase: 'tool-call' | 'llm-step' | 'turn';
  toolName?: string;
  target?: string;
}

export interface OnErrorResult {
  suppress?: boolean;
  fallbackResult?: Record<string, unknown>;
}
