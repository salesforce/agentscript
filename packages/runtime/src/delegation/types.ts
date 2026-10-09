/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg } from '../llm/types.js';
import type { ParallelDelegationOptions } from '../parallel/types.js';

/**
 * When the child's `assistantText` is shorter than expected, follow-up prompts
 * can be injected to coax a more complete answer. Modeled on the reference agent's
 * AgentProfileSummaryPolicy: guarantees the parent gets an actionable result
 * instead of a terse one-liner from a child that stopped too early.
 */
export interface DelegationSummaryPolicy {
  /**
   * Minimum acceptable character count for `assistantText`. When the child
   * returns shorter output, a continuation prompt is enqueued and one more
   * reasoning step runs, up to `retries` times. Default: no minimum.
   */
  minChars?: number;
  /**
   * Prompt injected as a user turn when the summary is inadequate. Default:
   * "Please provide a complete answer with all relevant details."
   */
  continuationPrompt?: string;
  /** Maximum retries before returning whatever the child produced. Default: 1. */
  retries?: number;
}

/**
 * Called before a delegation swaps context to the child. May throw to abort
 * (the caller's `delegate` invocation rejects; no `delegation-start` fires).
 * Enables approval gates, telemetry, and per-delegation policy overrides.
 */
export type OnWillDelegate = (
  ctx: DelegationHookContext
) => void | Promise<void>;

/**
 * Called after a delegation completes (success or error). Runs after the
 * parent context has been restored; observers get the final result or error.
 * Never throws into the parent's control flow — errors here are swallowed
 * with a `console.warn` so instrumentation can't break a running turn.
 */
export type OnDidDelegate = (
  ctx: DelegationHookContext,
  outcome:
    | { kind: 'ok'; result: DelegationResult }
    | { kind: 'error'; error: unknown }
) => void | Promise<void>;

/** Passed to onWillDelegate/onDidDelegate — everything a hook may need. */
export interface DelegationHookContext {
  /** Node the parent was on when it delegated. */
  parentNode: string;
  /** Node the child will run. */
  childNode: string;
  /** Depth of this delegation (1 = top-level, 2 = nested, etc). */
  depth: number;
  /** Extra context passed to the child's history, if any. */
  context?: string;
  /** Whether the child sees the parent's history. */
  shareHistory: boolean;
  /** Abort signal — hooks that fire long-running side effects can bail on abort. */
  signal?: AbortSignal;
  /**
   * Stable id from the Runtime's {@link AgentRegistry}. Only set on
   * `onDidDelegate` — the `onWillDelegate` hook fires BEFORE the handle is
   * registered, so its `agentId` field is `undefined`. Hooks that need to
   * key state by agentId should read it in `onDidDelegate`.
   */
  agentId?: string;
  /** Parent handle's id, if this delegation is nested. */
  parentAgentId?: string;
}

export interface DelegationOptions {
  /** Max LLM steps the delegated node may take before timeout. Default: 10 */
  maxSteps?: number;
  /** Max delegation depth (prevent infinite recursive delegation). Default: 5 */
  maxDepth?: number;
  /** Additional context/instructions passed to the child's system prompt */
  context?: string;
  /** Whether to share the parent's conversation history with the child. Default: false */
  shareHistory?: boolean;
  /** Parallel delegation configuration. */
  parallel?: ParallelDelegationOptions;
  /**
   * Ensure the child's `assistantText` clears a length threshold, retrying
   * with a continuation prompt otherwise. Off by default (a terse child is
   * legitimate for many tasks); opt in when the parent needs a full report.
   */
  summaryPolicy?: DelegationSummaryPolicy;
  /**
   * Called before the delegation swaps to the child context. Throwing aborts
   * the delegation (no `delegation-start` fires). Useful for approval gates.
   */
  onWillDelegate?: OnWillDelegate;
  /**
   * Called after the delegation completes (success or error). Errors thrown
   * here are swallowed so instrumentation never breaks the parent turn.
   */
  onDidDelegate?: OnDidDelegate;
}

export interface DelegationFrame {
  /** The parent node that initiated the delegation */
  parentNode: string;
  /** The child node being delegated to */
  childNode: string;
  /** Parent's message history at the point of delegation (frozen snapshot) */
  parentHistory: readonly Msg[];
  /** Current depth in the delegation stack */
  depth: number;
  /** Options passed to this delegation */
  options: Required<
    Omit<
      DelegationOptions,
      'parallel' | 'summaryPolicy' | 'onWillDelegate' | 'onDidDelegate'
    >
  > & {
    parallel?: ParallelDelegationOptions;
    summaryPolicy?: DelegationSummaryPolicy;
    onWillDelegate?: OnWillDelegate;
    onDidDelegate?: OnDidDelegate;
  };
}

export interface DelegationResult {
  /** The text response produced by the child node */
  assistantText: string;
  /** State changes made by the child (key-value snapshot of mutations) */
  stateChanges: Record<string, unknown>;
  /** Which node the child ended on (could differ if child did handoffs internally) */
  finalNode: string;
  /** Number of LLM steps the child took */
  steps: number;
  /**
   * When a summaryPolicy fired, how many continuation prompts were injected
   * to reach the min-chars threshold. 0 means the first pass was adequate.
   */
  continuations?: number;
}
