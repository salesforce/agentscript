/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DelegationResult } from '../delegation/types.js';

/**
 * Named lifecycle phases emitted around each subagent execution. Hosts can
 * use these to group events in a timeline or to show which hook produced a
 * given side-effect.
 */
type Phase =
  | 'before_reasoning'
  | 'before_reasoning_iteration'
  | 'reasoning'
  | 'pre_tool_call'
  | 'post_tool_call'
  | 'after_all_tool_calls'
  | 'after_reasoning';

export type RuntimeEvent =
  | { kind: 'turn-start'; node: string }
  | { kind: 'turn-end'; node: string }
  | { kind: 'node-enter'; node: string }
  | { kind: 'node-exit'; node: string; to?: string }
  | { kind: 'phase-start'; node: string; phase: Phase }
  | { kind: 'phase-end'; node: string; phase: Phase }
  | { kind: 'state-change'; name: string; before: unknown; after: unknown }
  | { kind: 'tool-call'; name: string; args: Record<string, unknown> }
  | { kind: 'tool-result'; name: string; result: unknown }
  | { kind: 'tool-error'; name: string; error: string }
  | { kind: 'llm-text'; text: string }
  // Emitted when a strict provider rejected the request as structurally
  // malformed and the runtime is resending once with a wire-compliant rebuild
  // (see buildMessagesStrict). `error` is the provider's rejection message.
  | { kind: 'llm-structural-repair'; error: string }
  // Emitted when a provider rejected the request because the message array
  // exceeded the model's context window. The runtime responds by forcing a
  // compaction pass (beforeLlmStep with overflow=true) and resending once.
  // `error` is the provider's rejection message.
  | { kind: 'llm-context-overflow'; error: string }
  | { kind: 'action-skipped'; name: string; reason: string }
  | { kind: 'abort'; reason?: unknown }
  | { kind: 'tool-limit-reached'; name: string; limit: number }
  // Emitted when a turn is truncated because its step count exceeded the
  // per-turn cap (`maxStepsPerTurn`). Mirrors `tool-limit-reached`: the loop
  // exits immediately after, so hosts can surface that the turn was cut short
  // rather than completing naturally. `limit` is the ceiling that was hit.
  | { kind: 'step-limit-reached'; node: string; limit: number }
  | { kind: 'end-session' }
  | { kind: 'guardrail-pass'; name: string }
  | { kind: 'guardrail-fail'; name: string; error: string; attempt: number }
  | {
      kind: 'guardrail-exhausted';
      name: string;
      error: string;
      attempts: number;
    }
  | {
      kind: 'delegation-start';
      parentNode: string;
      childNode: string;
      depth: number;
      /**
       * Stable id from the {@link AgentRegistry}. Present when the runtime
       * has a registry wired (always in normal use); older/embedded callers
       * that construct events directly may omit it.
       */
      agentId?: string;
      /** Parent handle id, if this delegation is nested inside another. */
      parentAgentId?: string;
    }
  | {
      kind: 'delegation-end';
      parentNode: string;
      childNode: string;
      result: DelegationResult;
      agentId?: string;
    }
  | {
      kind: 'delegation-error';
      parentNode: string;
      childNode: string;
      error: string;
      agentId?: string;
    }
  | {
      kind: 'parallel-dispatch-start';
      node: string;
      toolNames: string[];
    }
  | {
      kind: 'parallel-dispatch-end';
      node: string;
      toolNames: string[];
    }
  | {
      kind: 'parallel-delegation-start';
      parentNode: string;
      childNodes: string[];
    }
  | {
      kind: 'parallel-delegation-end';
      parentNode: string;
      childNodes: string[];
      results: Array<{ finalNode: string; steps: number; error?: string }>;
    }
  // Background subagents — a child launched with `run_in_background: true`.
  // `background-start` fires when the detached child is admitted and begins;
  // `background-end` fires when it reaches any terminal status. `taskId` is the
  // manager's id; `agentId` is the subagent identity (separate namespaces).
  | {
      kind: 'background-start';
      parentNode: string;
      childNode: string;
      taskId: string;
      agentId: string;
    }
  | {
      kind: 'background-end';
      parentNode: string;
      childNode: string;
      taskId: string;
      agentId: string;
      status: string;
      error?: string;
    }
  // Swarm fan-out — one parent tool call expands into N isolated child runs
  // that execute bounded-concurrently and aggregate into a single result.
  // `swarm-start` fires once expansion succeeds (carrying the batch size);
  // `swarm-end` fires when every child has settled (carrying the outcome
  // tallies). Individual child lifecycles ride the AgentRegistry handles.
  | {
      kind: 'swarm-start';
      parentNode: string;
      childNode: string;
      count: number;
    }
  | {
      kind: 'swarm-end';
      parentNode: string;
      childNode: string;
      count: number;
      completed: number;
      failed: number;
      aborted: number;
    }
  // The same `(toolName, args)` call has been issued consecutively. `streak` is
  // the run length; `action` names the escalation applied to the result
  // ('r1'/'r2'/'r3' reminders or 'stop' at the force-stop ceiling). A loop
  // escape hatch — mirrors the reference agent's `tool_call_repeat` telemetry.
  | {
      kind: 'tool-call-repeat';
      name: string;
      streak: number;
      action: 'r1' | 'r2' | 'r3' | 'stop';
    }
  | {
      kind: 'span-start';
      traceId: string;
      spanId: string;
      name: string;
      parentSpanId?: string;
    }
  | {
      kind: 'span-end';
      traceId: string;
      spanId: string;
      name: string;
      status: string;
    };

export type EventListener = (event: RuntimeEvent) => void;

export class EventBus {
  private listeners = new Set<EventListener>();

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: RuntimeEvent): void {
    for (const l of this.listeners) l(event);
  }
}
