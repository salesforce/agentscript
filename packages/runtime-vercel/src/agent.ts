/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Runtime,
  ToolRegistry,
  CostTracker,
  CostTrackingDriver,
  type Checkpoint,
  type RuntimeEvent,
  type LlmDriver,
  type TurnResult,
  type TurnOptions,
  type UsageStats,
  type ModelPrice,
  type Middleware,
  type ParallelDispatchOptions,
  type BackgroundTaskManager,
  type SwarmOptions,
} from '@agentscript/runtime';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import type { DelegationResult } from '@agentscript/runtime';
import {
  resolveMemory,
  type AgentMemoryConfig,
  type ResolvedMemory,
} from '@agentscript/memory';

import { VercelAiSdkDriver, type VercelDriverOptions } from './driver.js';

/**
 * Typed stream parts, modeled on the Vercel AI SDK `fullStream` shape.
 *
 * We use kebab-case `type` discriminators to match `streamText`'s
 * conventions (text-delta, tool-call, tool-result, start-step, finish-step,
 * finish, error). AgentScript-specific parts are added as additional
 * variants (node-enter, state-change, turn-end). Consumers switch on
 * `part.type` exactly as they would with `ai`'s `fullStream`.
 */
export type AgentStreamPart =
  | { type: 'start-step'; node: string }
  | { type: 'finish-step'; node: string; to?: string }
  | {
      type: 'phase-start';
      node: string;
      phase:
        | 'before_reasoning'
        | 'before_reasoning_iteration'
        | 'reasoning'
        | 'pre_tool_call'
        | 'post_tool_call'
        | 'after_all_tool_calls'
        | 'after_reasoning';
    }
  | {
      type: 'phase-end';
      node: string;
      phase:
        | 'before_reasoning'
        | 'before_reasoning_iteration'
        | 'reasoning'
        | 'pre_tool_call'
        | 'post_tool_call'
        | 'after_all_tool_calls'
        | 'after_reasoning';
    }
  | { type: 'text-delta'; text: string }
  | {
      type: 'tool-call';
      toolName: string;
      args: Record<string, unknown>;
    }
  | { type: 'tool-result'; toolName: string; result: unknown }
  | { type: 'tool-error'; toolName: string; error: string }
  | {
      type: 'state-change';
      name: string;
      before: unknown;
      after: unknown;
    }
  | { type: 'abort'; reason?: unknown }
  | { type: 'usage'; usage: UsageStats }
  // AgentScript-specific lifecycle parts (no `ai` fullStream analog). Guardrail
  // validation, subagent delegation, parallel dispatch, and session control.
  | { type: 'guardrail-pass'; name: string }
  | { type: 'guardrail-fail'; name: string; error: string; attempt: number }
  | {
      type: 'guardrail-exhausted';
      name: string;
      error: string;
      attempts: number;
    }
  | {
      type: 'delegation-start';
      parentNode: string;
      childNode: string;
      depth: number;
    }
  | {
      type: 'delegation-end';
      parentNode: string;
      childNode: string;
      result: DelegationResult;
    }
  | {
      type: 'delegation-error';
      parentNode: string;
      childNode: string;
      error: string;
    }
  | { type: 'parallel-dispatch-start'; node: string; toolNames: string[] }
  | { type: 'parallel-dispatch-end'; node: string; toolNames: string[] }
  | {
      type: 'parallel-delegation-start';
      parentNode: string;
      childNodes: string[];
    }
  | {
      type: 'parallel-delegation-end';
      parentNode: string;
      childNodes: string[];
      results: Array<{ finalNode: string; steps: number; error?: string }>;
    }
  | { type: 'tool-limit-reached'; toolName: string; limit: number }
  | { type: 'step-limit-reached'; node: string; limit: number }
  | { type: 'action-skipped'; name: string; reason: string }
  | { type: 'end-session' }
  | {
      type: 'finish';
      finalNode: string;
      assistantText: string;
      usage?: UsageStats;
    }
  | { type: 'error'; error: unknown };

/**
 * Result of `agent.run()` — both the final turn payload and a set of
 * lifecycle callbacks fired during execution. Shape mirrors what Vercel's
 * `generateText` returns: a plain value you can await and use.
 */
export interface AgentRunResult {
  /** Accumulated assistant text for this turn. */
  assistantText: string;
  /** Node the agent ended the turn on. */
  finalNode: string;
  /** Raw runtime events, in order. */
  events: RuntimeEvent[];
  /**
   * Token usage + estimated cost for this turn, aggregated across every LLM
   * step. Populated whenever the model reports usage. `costUsd` is only
   * meaningful when a matching entry exists in `modelPricing` (see
   * {@link CreateAgentOptions.modelPricing}); unpriced models contribute
   * tokens but zero cost.
   */
  usage?: UsageStats;
}

export interface AgentStepInfo {
  node: string;
  /** Assistant text produced at this node, if any. */
  text?: string;
  /** Destination node if this step ended in a handoff. */
  handoffTo?: string;
}

export interface AgentRunOptions {
  /** Abort signal for this turn. */
  signal?: AbortSignal;
  /** Fired once per node entry/exit. */
  onStepFinish?: (step: AgentStepInfo) => void | Promise<void>;
  /** Fired when the entire turn completes (success or swallowed error). */
  onFinish?: (result: AgentRunResult) => void | Promise<void>;
  /** Fired on uncaught errors during the turn. */
  onError?: (error: unknown) => void | Promise<void>;
}

/**
 * Stream returned by `agent.stream()`. Provides two async-iterable views
 * (Vercel idiom): `fullStream` for typed parts, `textStream` for text only.
 * Awaiting `.result` yields the final turn payload after the stream drains.
 */
export interface AgentStream {
  fullStream: AsyncIterable<AgentStreamPart>;
  textStream: AsyncIterable<string>;
  /** Resolves once streaming completes. */
  result: Promise<AgentRunResult>;
}

export interface CreateAgentOptions {
  /** Compiled AgentDSL — produced by `compileSource(agentSource).output`. */
  doc: AgentDSLAuthoring;
  /** Vercel AI SDK model + `generateText` injection. */
  llm: VercelDriverOptions;
  /** Scheme-keyed tool registry. Pre-populate with `FnAdapter`/`HttpAdapter`/etc. */
  tools?: ToolRegistry;
  /**
   * Middleware stack, applied in priority order around turns, tool calls, and
   * LLM steps. This is the seam the harness uses to inject permission gating
   * and context compaction; see `@sf-agentscript/harness`.
   */
  middleware?: Middleware[];
  /** Seed values for linked (Context) variables. */
  context?: Record<string, unknown>;
  /** Guard against runaway tool-call / handoff loops. */
  maxStepsPerTurn?: number;
  /**
   * Parallel tool-dispatch policy. Defaults to `'auto'` in the runtime (dispatch
   * 2+ independent tool calls concurrently). Set `{ strategy: 'never' }` when the
   * consumer's tool-call / result correlation or approval UI is single-slot and
   * cannot handle concurrent escalations.
   */
  parallel?: ParallelDispatchOptions;
  /**
   * Background-subagent manager. When supplied, a delegation tool called with
   * `run_in_background: true` launches the child detached (against an isolated
   * clone of parent state) and the parent keeps reasoning; the parent pulls
   * results via the `subagent://` tools. Omit to run delegations only in the
   * foreground. The harness builds and wires one for you (see
   * `createCodingHarness().services.background`).
   */
  background?: BackgroundTaskManager;
  /**
   * Swarm fan-out policy. A `swarm://run` tool call expands an `items` list +
   * a `prompt_template` into N isolated child runs that execute
   * bounded-concurrently (default cap 8) and aggregate into one result. Tune
   * the concurrency cap / per-child step budget here. Omit for the defaults.
   */
  swarm?: SwarmOptions;
  /**
   * Repeated-identical-tool-call guard. When the model keeps issuing the exact
   * same `(tool, args)` call, the runtime suffixes an escalating
   * <system-reminder> onto the result and force-stops the turn past a hard
   * ceiling — a loop escape hatch. Enabled by default; set `false` to disable.
   */
  toolLoopGuard?: boolean;
  /**
   * Per-model price table (USD per 1K tokens), keyed by model id. When
   * provided, each turn's {@link AgentRunResult.usage} carries a `costUsd`
   * estimate. Models absent from the table still accrue token counts but
   * contribute zero cost.
   */
  modelPricing?: Record<string, ModelPrice>;
  /**
   * Long-term memory. When set, the agent gains thread-scoped semantic recall
   * (relevant prior turns injected before each LLM step) and working memory,
   * persisting each turn automatically — no manual glue in the `.agent`.
   *
   * Pass `true` for the fully-offline default (HashEmbedder + in-process vector
   * store; no API key, no external service), or an {@link AgentMemoryConfig} to
   * supply a live embedder, a durable vector store (e.g. pgvector), and the
   * thread/resource scope. The resolved memory middleware is appended to
   * {@link middleware} at priority 450 (after injection, before compaction).
   * Inspect the live stores via {@link AgentScriptAgent.memoryServices}.
   */
  memory?: boolean | AgentMemoryConfig;
}

/**
 * High-level AgentScript agent, Vercel-style.
 *
 * ```ts
 * const agent = createAgent({
 *   doc: compileSource(src).output,
 *   llm: { model: anthropic('claude-haiku-4-5'), generateText },
 *   tools,
 * });
 *
 * // Promise-style
 * const { assistantText } = await agent.run('hello', {
 *   onStepFinish: step => console.log(step.node),
 * });
 *
 * // Stream-style
 * const stream = agent.stream('hello');
 * for await (const part of stream.fullStream) {
 *   if (part.type === 'text-delta') process.stdout.write(part.text);
 * }
 * const { assistantText } = await stream.result;
 * ```
 */
export class AgentScriptAgent {
  private readonly runtime: Runtime;
  /**
   * Observes every `usage` event emitted by the driver so we can attach a
   * per-turn {@link UsageStats} snapshot to run/stream results. `snapshot()`
   * is diffed across a turn to isolate that turn's usage from the lifetime
   * total.
   */
  private readonly costTracker: CostTracker;
  /** Resolved memory stack (semantic + working stores), when memory is enabled. */
  private readonly memory?: ResolvedMemory;

  constructor(opts: CreateAgentOptions, checkpoint?: Checkpoint) {
    this.costTracker = new CostTracker(opts.modelPricing ?? {});
    const driver: LlmDriver = new CostTrackingDriver(
      new VercelAiSdkDriver(opts.llm),
      this.costTracker,
      opts.llm.model.modelId
    );

    // Resolve long-term memory (if requested) and append its middleware so
    // recall/persistence wrap every turn. Offline-by-default via resolveMemory.
    this.memory = opts.memory ? resolveMemory(opts.memory) : undefined;
    const middleware = this.memory
      ? [...(opts.middleware ?? []), this.memory.middleware]
      : opts.middleware;

    const runtimeOpts = {
      doc: opts.doc,
      llm: driver,
      tools: opts.tools ?? new ToolRegistry(),
      middleware,
      context: opts.context,
      maxStepsPerTurn: opts.maxStepsPerTurn,
      parallel: opts.parallel,
      ...(opts.background ? { background: opts.background } : {}),
      ...(opts.swarm ? { swarm: opts.swarm } : {}),
      ...(opts.toolLoopGuard === false ? { toolLoopGuard: false } : {}),
    };
    this.runtime = checkpoint
      ? Runtime.fromCheckpoint(runtimeOpts, checkpoint)
      : new Runtime(runtimeOpts);
  }

  /** Direct read access to runtime state — useful for introspection between turns. */
  get state() {
    return this.runtime.state;
  }

  /**
   * The live memory stores (semantic recall + working memory) and their
   * thread/resource scope, or `undefined` when memory was not enabled. Lets a
   * caller seed facts, inspect recall, or clear a thread outside the turn loop.
   */
  get memoryServices(): ResolvedMemory | undefined {
    return this.memory;
  }

  /**
   * Queue a mid-turn steering message. If a turn is running, the text is
   * injected into the conversation at the next clean step boundary without
   * aborting the turn; if idle, it is buffered into the next turn's prompt.
   * Passthrough to {@link Runtime.enqueueSteering}.
   */
  enqueueSteering(message: string): void {
    this.runtime.enqueueSteering(message);
  }

  /**
   * Capture a serializable snapshot of the agent's runtime state. Must be
   * called between turns (will throw if called mid-turn).
   */
  checkpoint(opts?: {
    id?: string;
    metadata?: Record<string, unknown>;
  }): Checkpoint {
    return this.runtime.checkpoint(opts);
  }

  /**
   * Restore an agent from a previous checkpoint. The checkpoint must have
   * the matching schema version; throws `CheckpointVersionError` otherwise.
   */
  static fromCheckpoint(
    opts: CreateAgentOptions,
    checkpoint: Checkpoint
  ): AgentScriptAgent {
    return new AgentScriptAgent(opts, checkpoint);
  }

  /**
   * Run a single turn and return the result when complete. Lifecycle callbacks
   * fire in real time as events are emitted by the underlying runtime.
   */
  async run(
    userInput: string,
    opts: AgentRunOptions = {}
  ): Promise<AgentRunResult> {
    const stepCtx: { node: string; text: string; handoffTo?: string } = {
      node: '',
      text: '',
    };

    const unsubscribe = this.runtime.on(e => {
      if (e.kind === 'node-enter') {
        stepCtx.node = e.node;
        stepCtx.text = '';
        stepCtx.handoffTo = undefined;
      } else if (e.kind === 'llm-text') {
        stepCtx.text += e.text;
      } else if (e.kind === 'node-exit' || e.kind === 'turn-end') {
        if (e.kind === 'node-exit') stepCtx.handoffTo = e.to;
        void opts.onStepFinish?.({
          node: stepCtx.node,
          text: stepCtx.text || undefined,
          handoffTo: stepCtx.handoffTo,
        });
      }
    });

    const usageBefore = this.costTracker.snapshot();
    try {
      const turnOpts: TurnOptions | undefined = opts.signal
        ? { signal: opts.signal }
        : undefined;
      const turn: TurnResult = await this.runtime.turn(userInput, turnOpts);
      const usage = diffUsage(usageBefore, this.costTracker.snapshot());
      const result: AgentRunResult = {
        assistantText: turn.assistantText,
        finalNode: turn.finalNode,
        events: turn.events,
        ...(usage ? { usage } : {}),
      };
      await opts.onFinish?.(result);
      return result;
    } catch (err) {
      await opts.onError?.(err);
      throw err;
    } finally {
      unsubscribe();
    }
  }

  /**
   * Lifetime token usage + estimated cost across every turn this agent has
   * run, aggregated by the internal {@link CostTracker}. Per-turn usage is
   * available on each {@link AgentRunResult}; this is the running total.
   */
  usage(): UsageStats {
    return this.costTracker.snapshot();
  }

  /**
   * Stream a single turn. Returns two async iterables (`fullStream` of typed
   * parts, `textStream` of text deltas) plus a `result` promise — matching
   * the Vercel AI SDK `streamText` ergonomics.
   */
  stream(userInput: string, opts?: { signal?: AbortSignal }): AgentStream {
    // A broadcast hub: each iterator (fullStream, textStream, or the same one
    // consumed twice) registers as an independent subscriber with its OWN
    // buffer. A part is delivered to every subscriber, so the iterables can be
    // consumed concurrently without stealing parts from one another.
    const hub = new StreamHub<AgentStreamPart>();

    // Chain an internal controller onto the caller's signal so we can also
    // abort the underlying turn when the consumer abandons the stream early.
    const controller = new AbortController();
    const onExternalAbort = () =>
      controller.abort((opts?.signal as AbortSignal | undefined)?.reason);
    if (opts?.signal) {
      if (opts.signal.aborted) onExternalAbort();
      else
        opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }
    // When every subscriber has detached before the turn finished, no one is
    // listening — stop the turn instead of running (and billing) to completion.
    hub.onAllDetached(() => {
      if (!hub.closed) controller.abort(new Error('stream consumer detached'));
    });

    const unsubscribe = this.runtime.on(e => {
      const part = runtimeEventToStreamPart(e);
      if (part) hub.push(part);
    });

    let finalResult: AgentRunResult | undefined;
    let streamError: unknown;
    const usageBefore = this.costTracker.snapshot();

    const driving = (async () => {
      try {
        const turn = await this.runtime.turn(userInput, {
          signal: controller.signal,
        });
        const usage = diffUsage(usageBefore, this.costTracker.snapshot());
        if (usage) hub.push({ type: 'usage', usage });
        finalResult = {
          assistantText: turn.assistantText,
          finalNode: turn.finalNode,
          events: turn.events,
          ...(usage ? { usage } : {}),
        };
        hub.push({
          type: 'finish',
          finalNode: turn.finalNode,
          assistantText: turn.assistantText,
          ...(usage ? { usage } : {}),
        });
      } catch (err) {
        streamError = err;
        hub.push({ type: 'error', error: err });
      } finally {
        unsubscribe();
        if (opts?.signal)
          opts.signal.removeEventListener('abort', onExternalAbort);
        hub.close();
      }
    })();

    const fullStream: AsyncIterable<AgentStreamPart> = {
      [Symbol.asyncIterator]: () => hub.subscribe(),
    };

    const textStream: AsyncIterable<string> = {
      async *[Symbol.asyncIterator]() {
        for await (const part of fullStream) {
          if (part.type === 'text-delta') yield part.text;
        }
      },
    };

    const result: Promise<AgentRunResult> = (async () => {
      await driving;
      if (streamError) throw streamError;
      return finalResult!;
    })();
    // Avoid an unhandled-rejection if the caller only iterates the stream and
    // never awaits `result`.
    result.catch(() => {});

    return { fullStream, textStream, result };
  }
}

/**
 * A replayable fan-out broadcast. Every value is appended to a shared,
 * append-only buffer; each subscriber reads from its own cursor into that
 * buffer, so a subscriber that attaches after values were already pushed
 * (e.g. because the turn emitted events synchronously before the consumer's
 * first `next()`) still replays the full stream from the start, and multiple
 * subscribers (`fullStream` + `textStream`) each see every value. A subscriber
 * detaches on `return()` (a `for await … of` `break`); when the last one
 * detaches before close, {@link onAllDetached} fires so the owner can abort.
 */
class StreamHub<T> {
  closed = false;
  private readonly buffer: T[] = [];
  private readonly subs = new Set<Subscriber<T>>();
  private everSubscribed = false;
  private allDetachedCb?: () => void;

  onAllDetached(cb: () => void): void {
    this.allDetachedCb = cb;
  }

  push(value: T): void {
    if (this.closed) return;
    this.buffer.push(value);
    for (const sub of this.subs) this.pump(sub);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const sub of this.subs) this.pump(sub);
  }

  /** Wake a subscriber's pending waiter if there's a buffered value or we've closed. */
  private pump(sub: Subscriber<T>): void {
    if (!sub.waiter) return;
    if (sub.cursor < this.buffer.length) {
      const w = sub.waiter;
      sub.waiter = undefined;
      w({ value: this.buffer[sub.cursor++]!, done: false });
    } else if (this.closed) {
      const w = sub.waiter;
      sub.waiter = undefined;
      w({ value: undefined, done: true });
    }
  }

  subscribe(): AsyncIterator<T> {
    this.everSubscribed = true;
    const sub: Subscriber<T> = { cursor: 0 };
    this.subs.add(sub);

    const detach = (): void => {
      if (!this.subs.delete(sub)) return;
      if (
        this.subs.size === 0 &&
        this.everSubscribed &&
        !this.closed &&
        this.allDetachedCb
      ) {
        this.allDetachedCb();
      }
    };

    return {
      next: (): Promise<IteratorResult<T>> => {
        if (sub.cursor < this.buffer.length) {
          return Promise.resolve({
            value: this.buffer[sub.cursor++]!,
            done: false,
          });
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined, done: true });
        }
        return new Promise(resolve => {
          sub.waiter = resolve;
        });
      },
      return: (): Promise<IteratorResult<T>> => {
        detach();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

interface Subscriber<T> {
  cursor: number;
  waiter?: (r: IteratorResult<T>) => void;
}

/**
 * Isolate a single turn's usage by subtracting the tracker snapshot taken
 * before the turn from the one taken after. Returns undefined when the turn
 * recorded no LLM steps (e.g. a pure-handoff turn), so callers only attach
 * `usage` when there's something to report.
 */
function diffUsage(
  before: UsageStats,
  after: UsageStats
): UsageStats | undefined {
  const steps = after.steps - before.steps;
  if (steps <= 0) return undefined;
  const byModel: Record<string, UsageStats['byModel'][string]> = {};
  for (const [model, a] of Object.entries(after.byModel)) {
    const b = before.byModel[model];
    const modelSteps = a.steps - (b?.steps ?? 0);
    if (modelSteps <= 0) continue;
    byModel[model] = {
      model,
      inputTokens: a.inputTokens - (b?.inputTokens ?? 0),
      outputTokens: a.outputTokens - (b?.outputTokens ?? 0),
      totalTokens: a.totalTokens - (b?.totalTokens ?? 0),
      costUsd: a.costUsd - (b?.costUsd ?? 0),
      steps: modelSteps,
    };
  }
  return {
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    totalTokens: after.totalTokens - before.totalTokens,
    costUsd: after.costUsd - before.costUsd,
    steps,
    byModel,
  };
}

/** Ergonomic factory — mirrors `createAnthropic()` / `createOpenAI()` style. */
export function createAgent(opts: CreateAgentOptions): AgentScriptAgent {
  return new AgentScriptAgent(opts);
}

// ---------------------------------------------------------------------------

/**
 * Pure mapping from a runtime event to its stream-part representation (or null
 * for events not surfaced to consumers). Exported from this module — but not
 * the package's public `index.ts` — so it can be unit-tested directly.
 * @internal
 */
export function runtimeEventToStreamPart(
  e: RuntimeEvent
): AgentStreamPart | null {
  switch (e.kind) {
    case 'node-enter':
      return { type: 'start-step', node: e.node };
    case 'node-exit':
      return { type: 'finish-step', node: e.node, to: e.to };
    case 'llm-text':
      return { type: 'text-delta', text: e.text };
    case 'tool-call':
      return { type: 'tool-call', toolName: e.name, args: e.args };
    case 'tool-result':
      return { type: 'tool-result', toolName: e.name, result: e.result };
    case 'tool-error':
      return { type: 'tool-error', toolName: e.name, error: e.error };
    case 'state-change':
      return {
        type: 'state-change',
        name: e.name,
        before: e.before,
        after: e.after,
      };
    case 'phase-start':
      return { type: 'phase-start', node: e.node, phase: e.phase };
    case 'phase-end':
      return { type: 'phase-end', node: e.node, phase: e.phase };
    case 'abort':
      return { type: 'abort', reason: e.reason };
    case 'guardrail-pass':
      return { type: 'guardrail-pass', name: e.name };
    case 'guardrail-fail':
      return {
        type: 'guardrail-fail',
        name: e.name,
        error: e.error,
        attempt: e.attempt,
      };
    case 'guardrail-exhausted':
      return {
        type: 'guardrail-exhausted',
        name: e.name,
        error: e.error,
        attempts: e.attempts,
      };
    case 'delegation-start':
      return {
        type: 'delegation-start',
        parentNode: e.parentNode,
        childNode: e.childNode,
        depth: e.depth,
      };
    case 'delegation-end':
      return {
        type: 'delegation-end',
        parentNode: e.parentNode,
        childNode: e.childNode,
        result: e.result,
      };
    case 'delegation-error':
      return {
        type: 'delegation-error',
        parentNode: e.parentNode,
        childNode: e.childNode,
        error: e.error,
      };
    case 'parallel-dispatch-start':
      return {
        type: 'parallel-dispatch-start',
        node: e.node,
        toolNames: e.toolNames,
      };
    case 'parallel-dispatch-end':
      return {
        type: 'parallel-dispatch-end',
        node: e.node,
        toolNames: e.toolNames,
      };
    case 'parallel-delegation-start':
      return {
        type: 'parallel-delegation-start',
        parentNode: e.parentNode,
        childNodes: e.childNodes,
      };
    case 'parallel-delegation-end':
      return {
        type: 'parallel-delegation-end',
        parentNode: e.parentNode,
        childNodes: e.childNodes,
        results: e.results,
      };
    case 'tool-limit-reached':
      return { type: 'tool-limit-reached', toolName: e.name, limit: e.limit };
    case 'step-limit-reached':
      return { type: 'step-limit-reached', node: e.node, limit: e.limit };
    case 'action-skipped':
      return { type: 'action-skipped', name: e.name, reason: e.reason };
    case 'end-session':
      return { type: 'end-session' };
    // turn-start, turn-end, span-start, span-end: not surfaced as stream
    // parts — internal/tracing signals; `finish` covers the end-of-turn signal.
    default:
      return null;
  }
}
