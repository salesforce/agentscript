/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Swarm fan-out — ported from the reference agent's `AgentSwarm` tool.
 *
 * A swarm expands one `prompt_template` + a list of `items` into N independent
 * subagent tasks, runs them concurrently (bounded by a concurrency governor)
 * against ISOLATED clones of parent state, and aggregates their results into a
 * single XML tool result. It is the batch analogue of a single background
 * delegation: where `run_in_background` detaches ONE child, a swarm launches
 * MANY at once and blocks until they all settle.
 *
 * State isolation matches the background path: each child runs against a deep
 * clone of the parent's state with an empty history; the parent receives ONLY
 * the children's text (writes are discarded). This keeps N concurrent children
 * from corrupting each other or the parent.
 *
 * Faithful to the reference agent except:
 *  - `resume_agent_ids` is not ported — swarm children are ephemeral clones
 *    with no persisted checkpoint to resume (that is the `subagent://resume`
 *    path on a background task instead).
 *  - the `/swarm on` mode toggle (a reference-agent prompt/permission concern)
 *    is not ported; the fan-out guidance rides the tool description +
 *    reasoning instructions, and approval flows through the normal
 *    permission gate.
 */

/** The literal placeholder replaced with each item value in a prompt template. */
export const SWARM_ITEM_PLACEHOLDER = '{{item}}';

/** Hard cap on the number of subagents one swarm may fan out to. */
export const MAX_SWARM_SUBAGENTS = 128;

/** A swarm requires at least this many items (a swarm of one is a delegation). */
export const MIN_SWARM_ITEMS = 2;

/** Default ceiling on concurrently-running swarm children. */
export const DEFAULT_SWARM_MAX_CONCURRENCY = 8;

/** How a single swarm child ended. Mirrors the reference agent's per-subagent outcome. */
export type SwarmOutcome = 'completed' | 'failed' | 'aborted';

/**
 * One expanded swarm task: an item bound into a concrete prompt. The `index` is
 * 1-based (the reference agent convention) and stable across expansion → run → render.
 */
export interface SwarmSpec {
  /** 1-based position in the expanded batch. */
  index: number;
  /** The raw item value this spec was expanded from. */
  item: string;
  /** The prompt with every `{{item}}` replaced by `item`. */
  prompt: string;
}

/** The settled outcome of running one {@link SwarmSpec}. */
export interface SwarmRunResult {
  /** The spec this result corresponds to (carries item + index). */
  spec: SwarmSpec;
  /** The child's registry id (`agent-N`), when one was assigned. */
  agentId?: string;
  /** How the child ended. */
  status: SwarmOutcome;
  /** The child's final assistant text (on `completed`). */
  result?: string;
  /** Failure / abort message (on `failed` / `aborted`). */
  error?: string;
}

/** Runtime-level configuration for swarm fan-out. */
export interface SwarmOptions {
  /**
   * Max children running concurrently. Excess children queue and start as
   * slots free up. Default {@link DEFAULT_SWARM_MAX_CONCURRENCY}.
   */
  maxConcurrency?: number;
  /** Per-child LLM step budget. Defaults to the delegation `maxSteps` (10). */
  maxSteps?: number;
}
