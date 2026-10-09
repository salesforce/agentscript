/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  AgentDSLAuthoring,
  SubAgentNode,
  PostToolCall,
  Action,
} from '@agentscript/compiler';
import { loadGraph, type LoadedGraph } from '../graph/load.js';
import { StateStore } from '../state/store.js';
import {
  EventBus,
  type EventListener,
  type RuntimeEvent,
} from '../events/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { validateToolArgs } from '../tools/args-validator.js';
import {
  runSteps,
  makeScope,
  evalBoundValue,
  isEnabled,
  type Step,
  type StepRunOptions,
} from '../steps/run-steps.js';
import { renderTemplate } from '../template/render.js';
import { ToolCallDeduplicator } from './tool-dedup.js';
import type {
  LlmDriver,
  LlmStepInput,
  Msg,
  ToolCall,
  ToolDef,
} from '../llm/types.js';
import { withRetry, type RetryOptions } from '../llm/retry.js';
import {
  buildMessagesStrict,
  isContextOverflowError,
  isRecoverableRequestStructureError,
} from '../llm/messages-strict.js';
import { AbortError } from '../errors.js';
import { MiddlewarePipeline } from '../middleware/pipeline.js';
import type { Middleware } from '../middleware/types.js';
import {
  CHECKPOINT_SCHEMA_VERSION,
  migrateCheckpoint,
  type Checkpoint,
} from '../checkpoint/types.js';
import { CheckpointVersionError } from '../checkpoint/errors.js';
import type { BackgroundTaskManager } from '../background/index.js';
import {
  isBackgroundTaskTerminal,
  type BackgroundTaskInfo,
} from '../background/types.js';
import {
  expandSwarmItems,
  renderSwarmResults,
  runPool,
  SwarmExpansionError,
  DEFAULT_SWARM_MAX_CONCURRENCY,
  type SwarmOptions,
  type SwarmRunResult,
} from '../swarm/index.js';
import { TracingContext } from '../tracing/context.js';
import type { SpanExporter } from '../tracing/types.js';
import type { Guardrail, ExhaustionPolicy } from '../guardrails/types.js';
import { GuardrailExhaustionError } from '../guardrails/types.js';
import { jsonSchemaGuardrail } from '../guardrails/validators.js';
import type {
  DelegationOptions,
  DelegationFrame,
  DelegationResult,
  DelegationHookContext,
} from '../delegation/types.js';
import {
  DelegationTimeoutError,
  DelegationDepthError,
  StateConflictError,
} from '../delegation/errors.js';
import { AgentRegistry } from '../delegation/registry.js';
import type {
  ParallelDelegationOptions,
  ParallelDispatchOptions,
} from '../parallel/types.js';
import type {
  StructuredOutputOptions,
  ParsedStructuredOutput,
} from '../structured-output/types.js';
import {
  buildResponseFormat,
  parseStructuredOutput,
} from '../structured-output/enforce.js';

export interface ToolUsageLimit {
  /** Maximum number of times this tool may be invoked per scope. */
  maxCalls: number;
  /** If true, counter resets at the start of each turn(). Default: false (per-session). */
  resetPerTurn?: boolean;
}

export interface TracingOptions {
  /** Enable tracing instrumentation. Default: false. */
  enabled: boolean;
  /** Span exporter to receive completed spans. */
  exporter?: SpanExporter;
  /** Sample rate between 0 and 1. 0 = never trace, 1 = always trace. Default: 1. */
  sampleRate?: number;
}

export interface RuntimeOptions {
  doc: AgentDSLAuthoring;
  llm: LlmDriver;
  tools: ToolRegistry;
  /** Seed values for linked (Context) variables. */
  context?: Record<string, unknown>;
  /** Guard against infinite tool-call/handoff loops. */
  maxStepsPerTurn?: number;
  /** Default abort signal applied to every turn unless overridden. */
  signal?: AbortSignal;
  /** Per-tool invocation budgets, keyed by tool name (as exposed to the LLM). */
  toolLimits?: Record<string, ToolUsageLimit>;
  /** Middleware stack. Applied in priority order. */
  middleware?: Middleware[];
  /** Guardrails to validate LLM output before acting on it. */
  guardrails?: Guardrail[];
  /** What to do when guardrail retries are exhausted. Default: 'throw'. */
  exhaustionPolicy?: ExhaustionPolicy;
  /** Tracing / observability configuration. */
  tracing?: TracingOptions;
  /** Default options for delegations. */
  delegation?: DelegationOptions;
  /**
   * Background-subagent manager. When supplied, a delegation tool called with
   * `run_in_background: true` launches the child DETACHED (against an isolated
   * clone of parent state) instead of blocking the parent turn, and the
   * `subagent://` Task tools (list/output/stop/result/resume) become live.
   * The host creates + shares this so the harness injectors can surface
   * completions — exactly how the {@link AgentRegistry} is shared. Absent = the
   * `run_in_background` flag is ignored (the delegation runs in the foreground).
   */
  background?: BackgroundTaskManager;
  /** Structured output enforcement configuration. */
  structuredOutput?: StructuredOutputOptions;
  /** Parallel tool dispatch configuration. */
  parallel?: ParallelDispatchOptions;
  /**
   * Swarm fan-out configuration. A `swarm://run` tool call expands a
   * `prompt_template` + `items` into N subagent tasks that run concurrently
   * (bounded by {@link SwarmOptions.maxConcurrency}) against isolated clones of
   * parent state, and aggregates their results into one XML tool result.
   * Absent = the bundled defaults (concurrency 8, delegation `maxSteps`).
   */
  swarm?: SwarmOptions;
  /**
   * Repeated-identical-tool-call guard. When the model issues the exact same
   * `(toolName, args)` call consecutively, the tool result is suffixed with an
   * escalating <system-reminder> (from streak 3), and past a hard ceiling
   * (streak 12) the turn is force-stopped. A loop escape hatch ported from
   * the reference agent's tool-dedup. Default: `true`. Set `false` to disable entirely.
   */
  toolLoopGuard?: boolean;
}

export interface TurnOptions {
  /** Abort signal for this specific turn. Overrides the runtime-level signal. */
  signal?: AbortSignal;
}

export interface TurnResult {
  /** Accumulated assistant text for this turn. */
  assistantText: string;
  /** The node the agent ended the turn on. */
  finalNode: string;
  /** All events emitted during the turn (also streamed via `on`). */
  events: RuntimeEvent[];
  /** Parsed structured output (populated when structuredOutput is configured). */
  parsed?: ParsedStructuredOutput;
}

export class Runtime {
  readonly graph: LoadedGraph;
  readonly state: StateStore;
  readonly bus = new EventBus();
  /**
   * Session-scoped registry of every delegation this Runtime has spawned.
   * Populated automatically by {@link delegate} and {@link delegateMultiple}
   * so hosts (TUI, tests) can look up any child by a stable id — critical
   * for expandable transcripts and for telling two sibling delegations to
   * the same child node apart.
   */
  readonly agents = new AgentRegistry();
  private readonly history: Msg[] = [];
  private currentNode: string;
  private readonly maxSteps: number;
  private readonly toolCallCounts = new Map<string, number>();
  /**
   * Detects consecutive identical tool calls within a turn (loop escape hatch,
   * ported from the reference agent). Reset at the start of each turn; consulted after every
   * dispatched registry/sentinel tool result. Inert when `toolLoopGuard` is
   * disabled — `note()` is simply never called.
   */
  private readonly toolDedup = new ToolCallDeduplicator();
  private readonly pipeline: MiddlewarePipeline;
  private _inTurn = false;
  private _tracingCtx: TracingContext | null = null;
  private delegationStack: DelegationFrame[] = [];
  /**
   * Stack of the currently-running delegation ids. Push when a delegation
   * starts, pop when it settles. Peek returns the parent agentId for a
   * newly-started child; empty means the next delegation is top-level.
   */
  private agentIdStack: string[] = [];
  /**
   * Mid-turn steering (#8): user input typed while a turn is running is queued
   * here and drained into history at the next clean step boundary, without
   * aborting the turn or starting a competing one.
   */
  private steeringQueue: string[] = [];

  constructor(private readonly opts: RuntimeOptions) {
    this.graph = loadGraph(opts.doc);
    this.state = new StateStore(
      this.graph.stateVars,
      opts.context ?? {},
      this.bus
    );
    this.currentNode = this.graph.initialNode;
    this.maxSteps = opts.maxStepsPerTurn ?? 8;
    this.pipeline = new MiddlewarePipeline(opts.middleware);
  }

  /**
   * Announce that the per-turn step budget was exhausted. Emitted just before
   * the reasoning loop bails via `break outer`, so consumers can tell a
   * truncated turn ("hit the step cap, more work remains") apart from a natural
   * stop (the model produced a final message with no tool calls). Without this
   * the turn would end abruptly and silently — the UI symptom the coder showed.
   */
  private emitStepLimit(): void {
    this.bus.emit({
      kind: 'step-limit-reached',
      node: this.currentNode,
      limit: this.maxSteps,
    });
  }

  /** Whether tracing is active for this turn. */
  private shouldTrace(): boolean {
    const t = this.opts.tracing;
    if (!t || !t.enabled) return false;
    const rate = t.sampleRate ?? 1;
    if (rate <= 0) return false;
    if (rate >= 1) return true;
    return Math.random() < rate;
  }

  private traceStart(name: string, attributes?: Record<string, unknown>): void {
    if (!this._tracingCtx) return;
    const span = this._tracingCtx.startSpan(name, attributes);
    this.bus.emit({
      kind: 'span-start',
      traceId: span.traceId,
      spanId: span.spanId,
      name: span.name,
      parentSpanId: span.parentSpanId,
    });
  }

  private traceEnd(status?: 'ok' | 'error' | 'unset'): void {
    if (!this._tracingCtx) return;
    const span = this._tracingCtx.endSpan(status);
    if (span) {
      this.bus.emit({
        kind: 'span-end',
        traceId: span.traceId,
        spanId: span.spanId,
        name: span.name,
        status: span.status,
      });
    }
  }

  on(listener: EventListener): () => void {
    return this.bus.on(listener);
  }

  get currentNodeName(): string {
    return this.currentNode;
  }

  get delegationDepth(): number {
    return this.delegationStack.length;
  }

  /** Reset usage counters. Pass a tool name to reset one, or omit to reset all. */
  resetToolUsage(toolName?: string): void {
    if (toolName) {
      this.toolCallCounts.delete(toolName);
    } else {
      this.toolCallCounts.clear();
    }
  }

  /**
   * Enqueue a steering message to be injected at the next step boundary.
   * If called while a turn is active, the message is buffered and injected
   * before the next LLM step (after tool results are appended). If called
   * when no turn is active, the message is buffered and becomes part of the
   * next turn's initial prompt. This allows mid-turn user input without
   * aborting the current turn.
   */
  enqueueSteering(message: string): void {
    this.steeringQueue.push(message);
  }

  /**
   * Flush all queued steering messages into the history as user messages.
   * Called at step boundaries (after tool results, before the next LLM call)
   * to inject mid-turn user input. Returns true if any messages were flushed.
   */
  private flushSteeringQueue(): boolean {
    if (this.steeringQueue.length === 0) return false;
    const messages = [...this.steeringQueue];
    this.steeringQueue.length = 0;
    for (const msg of messages) {
      this.history.push({ role: 'user', content: msg });
    }
    return true;
  }

  /**
   * Resolve the effective signal for a turn — per-turn takes precedence over
   * runtime-level, returning `undefined` when neither is set.
   */
  private resolveSignal(turnSignal?: AbortSignal): AbortSignal | undefined {
    return turnSignal ?? this.opts.signal;
  }

  /** Throw an AbortError if the signal is already aborted. */
  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new AbortError(signal.reason);
    }
  }

  /** Drive one user turn through the ReAct loop. */
  async turn(userInput: string, options?: TurnOptions): Promise<TurnResult> {
    const signal = this.resolveSignal(options?.signal);
    const collected: RuntimeEvent[] = [];
    const off = this.bus.on(e => collected.push(e));

    // Reset per-turn tool counters
    if (this.opts.toolLimits) {
      for (const [name, limit] of Object.entries(this.opts.toolLimits)) {
        if (limit.resetPerTurn) this.toolCallCounts.delete(name);
      }
    }

    // Reset the repeated-tool-call streak so a spin in one turn doesn't leak
    // its count into the next.
    this.toolDedup.reset();

    try {
      this._inTurn = true;

      // Initialize tracing context for this turn if sampling says yes.
      if (this.shouldTrace()) {
        this._tracingCtx = new TracingContext({
          exporter: this.opts.tracing?.exporter,
        });
      } else {
        this._tracingCtx = null;
      }

      // CP-1: Check abort before committing to the turn.
      this.throwIfAborted(signal);

      // Root "turn" span
      this.traceStart('turn');

      // Flush any leftover steering messages from a previous turn before
      // pushing the new user input. This ensures leftover queued input
      // becomes part of the next turn's prompt.
      this.flushSteeringQueue();

      this.history.push({ role: 'user', content: userInput });

      if (!this.pipeline.isEmpty) {
        const beforeResult = await this.pipeline.runBeforeTurn({
          userInput,
          node: this.currentNode,
          state: this.state.snapshot(),
        });
        if (beforeResult?.abort) {
          this.bus.emit({ kind: 'turn-start', node: this.currentNode });
          this.bus.emit({ kind: 'turn-end', node: this.currentNode });
          return {
            assistantText: beforeResult.abort.assistantText,
            finalNode: this.currentNode,
            events: collected,
          };
        }
        if (beforeResult?.userInput !== undefined) {
          userInput = beforeResult.userInput;
          this.history[this.history.length - 1] = {
            role: 'user',
            content: userInput,
          };
        }
      }

      this.bus.emit({ kind: 'turn-start', node: this.currentNode });

      let assistantText = '';
      let steps = 0;
      // The Stop hook (middleware `onStop`) gets at most one continuation per
      // turn — a returned continuation string forces one more reasoning round
      // instead of ending the turn. Mirrors the reference agent's single stop-hook continuation.
      let stopHookUsed = false;

      // Outer loop: one iteration per node-entry. A handoff (from
      // before_reasoning, after_all_tool_calls, after_reasoning, or an
      // after_reasoning transition) swaps `currentNode` and continues.
      outer: while (true) {
        // CP-2: Check abort at top of outer loop.
        this.throwIfAborted(signal);
        const node = this.requireNode(this.currentNode);
        this.traceStart('node', { 'node.name': node.developer_name });
        this.bus.emit({ kind: 'node-enter', node: node.developer_name });

        // Per-node resolution of tools + action refs (compiled IR stores tool
        // targets as action developer_names; the full `scheme://name` URI lives
        // on the matching action_definition). Hook steps and tool-slot bindings
        // both route through this resolver.
        const actionUris = buildActionUriMap(node);
        const nodeTools = this.buildToolDefs(node, actionUris);
        const toolHooks = buildToolHookMaps(node);
        const resolveTarget = (ref: string): string => {
          if (ref.includes('://') || ref === '__state_update_action__')
            return ref;
          return actionUris.get(ref) ?? ref;
        };
        const baseStepOpts = {
          state: this.state,
          tools: this.opts.tools,
          bus: this.bus,
          resolveTarget,
        };

        // 1. before_reasoning (runs once per node entry)
        const preSteps = node.before_reasoning as Step[] | null;
        if (preSteps && preSteps.length > 0) {
          this.traceStart('phase:before_reasoning', {
            'node.name': node.developer_name,
          });
          this.bus.emit({
            kind: 'phase-start',
            node: node.developer_name,
            phase: 'before_reasoning',
          });
        }
        const preOutcome = await runSteps(preSteps, baseStepOpts);
        if (preSteps && preSteps.length > 0) {
          this.bus.emit({
            kind: 'phase-end',
            node: node.developer_name,
            phase: 'before_reasoning',
          });
          this.traceEnd('ok');
        }
        if (preOutcome.handoffTo) {
          this.traceEnd('ok'); // end node span
          this.currentNode = preOutcome.handoffTo;
          if (++steps > this.maxSteps) {
            this.emitStepLimit();
            break;
          }
          continue;
        }

        // 2. Reasoning loop: LLM step -> (tool calls? dispatch then loop)
        //                              -> (no tool calls? done, run after_*)
        let loopHandoff: string | undefined;
        reasoning: while (true) {
          // CP-3: Check abort at top of reasoning loop.
          this.throwIfAborted(signal);

          // Flush queued steering messages at the top of each reasoning iteration,
          // before the LLM sees the messages. This ensures mid-turn user input is
          // injected at a clean boundary (after tool results from the previous step,
          // before the next LLM call), preserving tool_calls / tool_result pairing.
          this.flushSteeringQueue();

          // before_reasoning_iteration — runs at the top of each LLM iteration
          const iterSteps = node.before_reasoning_iteration as Step[] | null;
          if (iterSteps && iterSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-start',
              node: node.developer_name,
              phase: 'before_reasoning_iteration',
            });
          }
          await runSteps(iterSteps, baseStepOpts);
          if (iterSteps && iterSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-end',
              node: node.developer_name,
              phase: 'before_reasoning_iteration',
            });
          }

          const system = this.buildSystemPrompt(node);
          // Filter tools by their `enabled` guard (the compiler's
          // `available when` clause). This is what prevents the LLM from
          // seeing, e.g., a transition whose preconditions aren't met yet.
          const enableScope = makeScope(this.state);
          const visibleTools = nodeTools
            .filter(t => isEnabled(t.enabled, enableScope))
            .filter(t => {
              if (!this.opts.toolLimits) return true;
              const limit = this.opts.toolLimits[t.name];
              if (!limit) return true;
              return (this.toolCallCounts.get(t.name) ?? 0) < limit.maxCalls;
            });
          for (const skipped of nodeTools) {
            if (!isEnabled(skipped.enabled, enableScope)) {
              this.bus.emit({
                kind: 'action-skipped',
                name: skipped.name,
                reason: `available-when guard failed: ${String(skipped.enabled)}`,
              });
            }
          }
          // Every tool slot — including `__state_update_action__`-backed
          // transitions and setVariables — must be exposed to the LLM.
          // That sentinel tells the runtime "no real adapter call, apply
          // state_updates inline", NOT "hide from the model". The LLM has
          // to see these tools to emit the tool-call that fires them.
          const baseTools: ToolDef[] = visibleTools.map(stripInternal);
          let applied = await this.applyBeforeLlmStep(system, baseTools, false);

          this.traceStart('llm-step', { 'node.name': node.developer_name });
          this.bus.emit({
            kind: 'phase-start',
            node: node.developer_name,
            phase: 'reasoning',
          });
          let turn: Awaited<ReturnType<Runtime['runLlmStepWithGuardrails']>>;
          try {
            turn = await this.runLlmStepWithGuardrails(
              applied.system,
              applied.tools,
              signal,
              applied.guardrails
            );
          } catch (error) {
            // Reactive context-overflow recovery: the provider refused the
            // request because the message array exceeded the model's window
            // (proactive compaction either isn't configured or under-counted).
            // Re-run beforeLlmStep with `overflow: true` — which forces the
            // compaction middleware to compact regardless of its token budget —
            // then resend ONCE. If it wasn't an overflow, no middleware can
            // help, or the retry also fails, the error propagates.
            if (
              isContextOverflowError(error) &&
              !this.pipeline.isEmpty &&
              !applied.overflowHandled
            ) {
              this.throwIfAborted(signal);
              this.bus.emit({
                kind: 'llm-context-overflow',
                error: error instanceof Error ? error.message : String(error),
              });
              const before = this.history.length;
              applied = await this.applyBeforeLlmStep(system, baseTools, true);
              // If nothing actually compacted the history, retrying would just
              // hit the same wall — surface the original overflow instead.
              if (this.history.length >= before && !applied.compacted) {
                throw error;
              }
              turn = await this.runLlmStepWithGuardrails(
                applied.system,
                applied.tools,
                signal,
                applied.guardrails
              );
            } else {
              throw error;
            }
          }
          this.bus.emit({
            kind: 'phase-end',
            node: node.developer_name,
            phase: 'reasoning',
          });
          this.traceEnd('ok');

          if (!this.pipeline.isEmpty) {
            const afterLlm = await this.pipeline.runAfterLlmStep({
              node: this.currentNode,
              state: this.state.snapshot(),
              text: turn.text,
              toolCalls: turn.toolCalls,
            });
            if (afterLlm) {
              if (afterLlm.text !== undefined) turn.text = afterLlm.text;
              if (afterLlm.toolCalls) turn.toolCalls = afterLlm.toolCalls;
            }
          }

          assistantText += turn.text;

          if (turn.toolCalls.length === 0) {
            // LLM is done talking -> push a plain assistant message.
            if (turn.text)
              this.history.push({ role: 'assistant', content: turn.text });

            // Stop hook (BLOCKING): give a middleware one chance to force the
            // turn to continue. A returned continuation is appended as a user
            // message and the reasoning loop runs again; granted at most once
            // per turn. Skipped when the pipeline is empty (common case).
            if (!this.pipeline.isEmpty && !stopHookUsed) {
              this.throwIfAborted(signal);
              const stop = await this.pipeline.runOnStop({
                node: this.currentNode,
                state: this.state.snapshot(),
                assistantText,
                stopHookActive: stopHookUsed,
              });
              this.throwIfAborted(signal);
              if (stop?.continuation) {
                stopHookUsed = true;
                this.history.push({
                  role: 'user',
                  content: stop.continuation,
                });
                if (++steps > this.maxSteps) {
                  this.emitStepLimit();
                  break outer;
                }
                continue reasoning;
              }
            }
            break reasoning;
          }

          // The model emitted tool calls. Push a single assistant message
          // that carries both the text (if any) and the tool_calls, so the
          // provider sees a valid tool_calls -> tool_result handshake.
          this.history.push({
            role: 'assistant',
            content: '',
            tool_calls: turn.toolCalls,
          });

          // Check if the model response was truncated while tool calls were
          // present. If so, emit synthetic error results for all tool calls
          // instead of dispatching them — their arguments may be incomplete.
          const isTruncated =
            turn.finishReason === 'length' || turn.finishReason === 'other';
          if (isTruncated && turn.toolCalls.length > 0) {
            const truncationMessage =
              'This tool call was not executed: the model response was truncated before tool ' +
              'execution could start (finish reason: ' +
              (turn.finishReason ?? 'unknown') +
              '). Do not assume the tool ran — try again with a simpler request or split the work.';
            for (const call of turn.toolCalls) {
              this.history.push({
                role: 'tool',
                tool_call_id: call.id,
                tool_name: call.name,
                content: JSON.stringify({ error: truncationMessage }),
                is_error: true,
              });
              this.bus.emit({
                kind: 'tool-result',
                name: call.name,
                result: { error: truncationMessage },
              });
            }
            // Skip normal dispatch and continue the reasoning loop so the
            // model sees the synthetic results.
            continue;
          }

          // Preflight: reject tool calls whose arguments are malformed BEFORE
          // they execute. A call is rejected when its JSON arguments failed to
          // parse (truncated / non-object) or when they violate the tool's
          // input schema (missing required field, wrong type). Rejected calls
          // get a precise synthetic error result the model can self-correct
          // from; the surviving calls dispatch normally. This mirrors the reference agent's
          // preflight gate (loop/tool-call.ts) and is a loop escape hatch —
          // without it, bad args reach the tool and can wedge the turn.
          const preflight = this.preflightToolCalls(turn, nodeTools);
          if (preflight.rejected.length > 0) {
            for (const { call, reason } of preflight.rejected) {
              this.history.push({
                role: 'tool',
                tool_call_id: call.id,
                tool_name: call.name,
                content: JSON.stringify({ error: reason }),
                is_error: true,
              });
              this.bus.emit({
                kind: 'tool-error',
                name: call.name,
                error: reason,
              });
            }
            // Only the surviving calls proceed to dispatch this step.
            turn.toolCalls = preflight.valid;
            if (turn.toolCalls.length === 0) {
              // Every call was rejected — loop back so the model sees the
              // errors and retries, without an empty dispatch pass.
              if (++steps > this.maxSteps) {
                this.emitStepLimit();
                break outer;
              }
              continue;
            }
          }

          let sessionEnded = false;
          if (this.shouldDispatchParallel(turn.toolCalls, nodeTools)) {
            this.throwIfAborted(signal);
            const parallel = await this.dispatchToolCallsParallel(
              turn.toolCalls,
              nodeTools,
              toolHooks,
              baseStepOpts,
              signal
            );
            steps += parallel.steps;
            sessionEnded = parallel.endSession;
            if (parallel.handoffTo) {
              loopHandoff = parallel.handoffTo;
            }
            if (steps > this.maxSteps) {
              this.emitStepLimit();
              break outer;
            }
          } else {
            let stepLimitHit = false;
            for (let ci = 0; ci < turn.toolCalls.length; ci += 1) {
              const call = turn.toolCalls[ci]!;
              // CP-4: Check abort before each tool dispatch.
              this.throwIfAborted(signal);
              this.traceStart(`tool-call:${call.name}`, {
                'tool.name': call.name,
              });
              const outcome = await this.dispatchToolCall(
                call,
                nodeTools,
                toolHooks,
                signal,
                baseStepOpts
              );
              this.traceEnd('ok');
              if (outcome.endSession) {
                sessionEnded = true;
                // Every emitted tool_call needs a paired tool result or the
                // provider rejects the next request ("no tool output found").
                this.flushUndispatchedToolResults(
                  turn.toolCalls,
                  ci + 1,
                  'Not executed: the turn ended (a prior tool call in this batch stopped the session).'
                );
                break;
              }
              if (outcome.forceStop) {
                // Repeated-tool-call ceiling hit (streak >= 12). A hard backstop
                // matching the reference agent's `stopTurn`: end the turn now so the loop can't
                // keep spinning on the same call. The escalating r1/r2/r3
                // reminders on the prior streaks are what nudge the model toward
                // a final response before it ever reaches this ceiling.
                sessionEnded = true;
                this.flushUndispatchedToolResults(
                  turn.toolCalls,
                  ci + 1,
                  'Not executed: the turn was force-stopped by the repeated-tool-call guard.'
                );
                break;
              }
              if (outcome.handoffTo) {
                // A pre/post_tool_call hook handed off — treat it like an
                // after_all_tool_calls handoff, just triggered mid-batch.
                // Abandon remaining calls in this batch (paired below).
                loopHandoff = outcome.handoffTo;
                this.flushUndispatchedToolResults(
                  turn.toolCalls,
                  ci + 1,
                  'Not executed: a pre/post_tool_call hook triggered a handoff earlier in this batch.'
                );
                break;
              }
              if (++steps > this.maxSteps) {
                // The step ceiling can fall in the MIDDLE of a multi-call
                // assistant message. Pair every remaining call before we bail so
                // the history stays a valid tool_calls -> tool_result handshake
                // (a dangling call poisons the NEXT turn's first request).
                this.flushUndispatchedToolResults(
                  turn.toolCalls,
                  ci + 1,
                  'Not executed: the per-turn step limit was reached before this tool call ran.'
                );
                stepLimitHit = true;
                break;
              }
            }
            if (stepLimitHit) {
              this.emitStepLimit();
              break outer;
            }
          }
          if (loopHandoff) break reasoning;
          if (sessionEnded) {
            // @utils.end_session fired — stop everything for this turn.
            break outer;
          }

          // Escalation: @utils.escalate sets AgentScriptInternal_next_topic
          // to '__human__'. Surface as a terminal event and stop the turn.
          if (
            this.state.get('AgentScriptInternal_next_topic') === '__human__'
          ) {
            this.bus.emit({ kind: 'end-session' });
            break outer;
          }

          // after_all_tool_calls fires after each tool-call round. A handoff
          // here preempts further reasoning on this node.
          const afterAllSteps = node.after_all_tool_calls as Step[] | null;
          if (afterAllSteps && afterAllSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-start',
              node: node.developer_name,
              phase: 'after_all_tool_calls',
            });
          }
          const afterAll = await runSteps(afterAllSteps, baseStepOpts);
          if (afterAllSteps && afterAllSteps.length > 0) {
            this.bus.emit({
              kind: 'phase-end',
              node: node.developer_name,
              phase: 'after_all_tool_calls',
            });
          }
          if (afterAll.handoffTo) {
            loopHandoff = afterAll.handoffTo;
            break reasoning;
          }

          if (++steps > this.maxSteps) {
            this.emitStepLimit();
            break outer;
          }
          // Otherwise: loop back into the LLM so it can observe the tool
          // results in chat history and produce the final response.
        }

        if (loopHandoff) {
          this.traceEnd('ok'); // end node span
          this.currentNode = loopHandoff;
          if (++steps > this.maxSteps) {
            this.emitStepLimit();
            break outer;
          }
          continue;
        }

        // 3. after_reasoning (runs once per node exit)
        const afterSteps = node.after_reasoning as Step[] | null;
        if (afterSteps && afterSteps.length > 0) {
          this.bus.emit({
            kind: 'phase-start',
            node: node.developer_name,
            phase: 'after_reasoning',
          });
        }
        const after = await runSteps(afterSteps, baseStepOpts);
        if (afterSteps && afterSteps.length > 0) {
          this.bus.emit({
            kind: 'phase-end',
            node: node.developer_name,
            phase: 'after_reasoning',
          });
        }
        if (after.handoffTo) {
          this.traceEnd('ok'); // end node span
          this.currentNode = after.handoffTo;
          if (++steps > this.maxSteps) {
            this.emitStepLimit();
            break outer;
          }
          continue;
        }

        // No handoff -> turn ends on this node.
        this.traceEnd('ok'); // end node span
        break outer;
      }

      this.bus.emit({ kind: 'turn-end', node: this.currentNode });

      // End root "turn" span
      this.traceEnd('ok');

      // Flush tracing spans to exporter
      if (this._tracingCtx) {
        await this._tracingCtx.flush();
      }

      if (!this.pipeline.isEmpty) {
        const afterResult = await this.pipeline.runAfterTurn({
          assistantText,
          finalNode: this.currentNode,
          state: this.state.snapshot(),
          events: collected,
        });
        if (afterResult?.assistantText !== undefined) {
          assistantText = afterResult.assistantText;
        }
      }

      // Parse structured output if configured
      let parsed: ParsedStructuredOutput | undefined;
      if (this.opts.structuredOutput && assistantText) {
        parsed = parseStructuredOutput(
          assistantText,
          this.opts.structuredOutput.schema
        );
      }

      return {
        assistantText,
        finalNode: this.currentNode,
        events: collected,
        parsed,
      };
    } catch (err) {
      const isAbort = err instanceof AbortError;
      if (isAbort) {
        // Drain unclosed spans with error status
        if (this._tracingCtx) {
          this._tracingCtx.drainAll('error');
          await this._tracingCtx.flush();
        }
        this.bus.emit({ kind: 'abort', reason: err.reason });
      }
      // Interrupt seam (notification): fires for both a user/programmatic abort
      // and an unhandled error, so external tooling that tracks status can
      // observe the abnormal turn end. Seam for the reference agent's Interrupt / StopFailure
      // hooks. Best-effort — a broken observer must not mask the real error.
      if (!this.pipeline.isEmpty) {
        await this.pipeline
          .runOnInterrupt({
            node: this.currentNode,
            reason: isAbort ? 'aborted' : 'error',
            error: err,
          })
          .catch(() => undefined);
      }
      throw err;
    } finally {
      this._inTurn = false;
      off();
    }
  }

  // -----------------------------------------------------------------------
  // Checkpoint / Restore
  // -----------------------------------------------------------------------

  checkpoint(opts?: {
    id?: string;
    metadata?: Record<string, unknown>;
  }): Checkpoint {
    if (this._inTurn) {
      throw new Error(
        'Cannot checkpoint mid-turn. Wait for turn() to resolve.'
      );
    }
    return {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      id: opts?.id ?? crypto.randomUUID(),
      currentNode: this.currentNode,
      history: structuredClone(this.history),
      stateValues: this.state.snapshot(),
      metadata: opts?.metadata,
      // Persist the background-task table (records only). Absent when no
      // manager is wired — a session with no background subagents.
      backgroundTasks: this.opts.background?.list(),
    };
  }

  static fromCheckpoint(opts: RuntimeOptions, checkpoint: Checkpoint): Runtime {
    // Reject only a FUTURE version we can't understand; older versions are
    // folded forward by migrateCheckpoint (v1 → v2 = empty background table).
    if (checkpoint.schemaVersion > CHECKPOINT_SCHEMA_VERSION) {
      throw new CheckpointVersionError(
        checkpoint.schemaVersion,
        CHECKPOINT_SCHEMA_VERSION
      );
    }
    const migrated = migrateCheckpoint(checkpoint);
    const rt = new Runtime(opts);
    rt.currentNode = migrated.currentNode;
    rt.history.length = 0;
    rt.history.push(...structuredClone(migrated.history));
    for (const [key, value] of Object.entries(migrated.stateValues)) {
      rt.state._restoreValue(key, value);
    }
    // Adopt the persisted background-task table into the manager's store so a
    // caller can reconcile it (still-running tasks → `lost`). We seed the store
    // rather than the live table because these records have no live handles;
    // `background.reconcile()` (async) is the caller's next step.
    if (migrated.backgroundTasks?.length && opts.background) {
      rt._pendingBackgroundRestore = migrated.backgroundTasks;
    }
    return rt;
  }

  /**
   * Records carried from a checkpoint, awaiting `reconcileBackgroundTasks()`.
   * Held rather than eagerly adopted because reconcile is async (it reads the
   * store) and `fromCheckpoint` is sync.
   */
  private _pendingBackgroundRestore?: BackgroundTaskInfo[];

  /**
   * Reconcile background tasks after a `fromCheckpoint` restore. Seeds the
   * manager's store with the checkpoint's records, then runs the manager's
   * reconcile so any task still marked `running` (its process died) becomes
   * `lost` and is re-announced once. Safe to call when there's nothing to do.
   */
  async reconcileBackgroundTasks(): Promise<BackgroundTaskInfo[]> {
    const mgr = this.opts.background;
    if (!mgr) return [];
    const pending = this._pendingBackgroundRestore;
    this._pendingBackgroundRestore = undefined;
    return mgr.reconcile(pending);
  }

  // -----------------------------------------------------------------------

  private requireNode(name: string): SubAgentNode {
    const node = this.graph.nodes.get(name);
    if (!node) throw new Error(`Subagent "${name}" not found`);
    return node;
  }

  private buildSystemPrompt(node: SubAgentNode): string {
    const scope = makeScope(this.state);
    const pieces: string[] = [];
    if (node.instructions) pieces.push(node.instructions);
    if (node.focus_prompt)
      pieces.push(renderTemplate(node.focus_prompt, scope));
    return pieces.filter(Boolean).join('\n\n');
  }

  private buildToolDefs(
    node: SubAgentNode,
    actionUris: Map<string, string>
  ): Array<
    ToolDef & {
      /** Raw target as written in the IR tool slot — usually an action developer_name. */
      actionRef: string;
      /** Fully-resolved `scheme://name` URI (or sentinel for state-update). */
      target: string;
      /** Raw `enabled` guard expression; evaluated each turn to gate the tool. */
      enabled?: unknown;
      bound?: Record<string, unknown>;
      stateUpdates?: Array<Record<string, unknown>> | null;
      /** From the matching action_definition's require_user_confirmation flag. */
      requireConfirmation?: boolean;
    }
  > {
    const tools = node.tools ?? [];
    // Action definition inputs (for schema).
    const inputs = new Map<string, unknown[] | undefined>();
    const requireConfirmation = new Map<string, boolean>();
    for (const def of node.action_definitions ?? []) {
      const d = def as unknown as {
        developer_name: string;
        input_type?: unknown[];
        require_user_confirmation?: boolean;
      };
      inputs.set(d.developer_name, d.input_type);
      requireConfirmation.set(
        d.developer_name,
        d.require_user_confirmation ?? false
      );
    }
    return tools.map(t => {
      const asTool = t as unknown as {
        name?: string;
        description?: string;
        target: string;
        enabled?: unknown;
        input_parameters?: unknown[];
        bound_inputs?: Record<string, unknown> | null;
        state_updates?: Array<Record<string, unknown>> | null;
      };
      const name = asTool.name ?? asTool.target;
      // `target` in a tool slot is the action's developer_name, unless it's
      // the state-update sentinel or already has a scheme (handoff, etc.).
      const resolvedTarget =
        asTool.target.includes('://') ||
        asTool.target === '__state_update_action__'
          ? asTool.target
          : (actionUris.get(asTool.target) ?? asTool.target);
      const inputParams = asTool.input_parameters ?? inputs.get(asTool.target);
      return {
        name,
        description: asTool.description ?? '',
        inputSchema: inputSchemaFromParams(inputParams),
        actionRef: asTool.target,
        target: resolvedTarget,
        enabled: asTool.enabled,
        bound: asTool.bound_inputs ?? undefined,
        stateUpdates: asTool.state_updates,
        requireConfirmation: requireConfirmation.get(asTool.target) ?? false,
      };
    });
  }

  /**
   * Run the `beforeLlmStep` middleware pass and apply its results to the live
   * conversation state, returning the effective system prompt, tools, and
   * guardrails for the imminent LLM call. Factored out of the reasoning loop so
   * it can run a second time with `overflow: true` after a context-overflow
   * rejection (forcing a compaction that the normal budget-gated pass skipped).
   *
   * `compacted` reports whether any middleware returned `replaceMessages` this
   * pass — the overflow-recovery path uses it to decide whether resending is
   * worthwhile. `overflowHandled` echoes the input flag so the caller can avoid
   * a second recovery attempt in the same step.
   */
  private async applyBeforeLlmStep(
    system: string,
    baseTools: ToolDef[],
    overflow: boolean
  ): Promise<{
    system: string;
    tools: ToolDef[];
    guardrails: Guardrail[] | undefined;
    compacted: boolean;
    overflowHandled: boolean;
  }> {
    let effectiveSystem = system;
    let effectiveTools = baseTools;
    let guardrails: Guardrail[] | undefined;
    let compacted = false;

    if (!this.pipeline.isEmpty) {
      const beforeLlm = await this.pipeline.runBeforeLlmStep({
        node: this.currentNode,
        state: this.state.snapshot(),
        system,
        messages: [...this.history],
        tools: effectiveTools,
        overflow,
      });
      if (beforeLlm) {
        if (beforeLlm.system !== undefined) effectiveSystem = beforeLlm.system;
        if (beforeLlm.tools) effectiveTools = beforeLlm.tools;
        // replaceMessages authoritatively swaps the persisted history in place
        // (compaction seam). It runs BEFORE appendMessages so the note/appended
        // messages land after the compacted set. The LLM request below reads
        // messages fresh from `this.history` (see runLlmStep), so the
        // replacement takes effect for THIS step and persists for later turns.
        if (beforeLlm.replaceMessages) {
          this.history.length = 0;
          for (const m of beforeLlm.replaceMessages) this.history.push(m);
          compacted = true;
        }
        if (beforeLlm.appendMessages) {
          for (const m of beforeLlm.appendMessages) this.history.push(m);
        }
        if (beforeLlm.guardrails) guardrails = beforeLlm.guardrails;
      }
    }

    return {
      system: effectiveSystem,
      tools: effectiveTools,
      guardrails,
      compacted,
      overflowHandled: overflow,
    };
  }

  private async runLlmStep(
    system: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    responseFormat?: LlmStepInput['responseFormat'],
    extraMessages?: ReadonlyArray<Msg>
  ): Promise<{
    text: string;
    toolCalls: ToolCall[];
    finishReason?: string;
    toolCallsWithFlags: Array<{ call: ToolCall; parseFailed: boolean }>;
  }> {
    // Wrap the LLM step in a retry loop for transient errors (#2). Retry only
    // applies when no output has been emitted yet — once streaming begins the
    // partial output is committed, so a mid-stream failure cannot be retried
    // cleanly (it would re-emit the same prefix / duplicate tool calls).
    const retryOptions: RetryOptions = {
      maxAttempts: 3, // initial + 2 retries
      baseDelayMs: 500,
      factor: 2,
      maxDelayMs: 30_000,
    };

    const baseMessages = extraMessages
      ? [...this.history, ...extraMessages]
      : [...this.history];

    // One streaming attempt over a given message array. Wrapped in withRetry
    // for transient errors; a mid-stream failure is marked non-retryable.
    const attempt = (messages: Msg[]) =>
      withRetry(
        async () => {
          const input: LlmStepInput = {
            system,
            messages,
            tools,
            signal,
          };
          if (responseFormat) {
            input.responseFormat = responseFormat;
          }
          const iter = this.opts.llm.step(input);
          let text = '';
          const toolCalls: ToolCall[] = [];
          const toolCallsWithFlags: Array<{
            call: ToolCall;
            parseFailed: boolean;
          }> = [];
          let finishReason: string | undefined;
          let hasEmittedOutput = false;

          try {
            for await (const ev of iter) {
              // CP-5: Check abort after each streamed event.
              this.throwIfAborted(signal);
              if (ev.kind === 'text-delta') {
                text += ev.text;
                this.bus.emit({ kind: 'llm-text', text: ev.text });
                hasEmittedOutput = true;
              } else if (ev.kind === 'tool-call') {
                toolCalls.push(ev.call);
                toolCallsWithFlags.push({
                  call: ev.call,
                  parseFailed: ev.parseFailed ?? false,
                });
                hasEmittedOutput = true;
              } else if (ev.kind === 'finish') {
                finishReason = ev.reason;
              }
            }
            return { text, toolCalls, finishReason, toolCallsWithFlags };
          } catch (error) {
            // Always preserve abort errors — never wrap them.
            if (
              error instanceof AbortError ||
              (error instanceof Error && error.name === 'AbortError')
            ) {
              throw error;
            }
            // Once output was emitted, the stream is partially committed; mark the
            // failure non-retryable so withRetry does not re-emit the same prefix.
            if (hasEmittedOutput) {
              const nonRetryable = new Error(
                'LLM step failed mid-stream (partial output emitted)'
              );
              (nonRetryable as { cause?: unknown }).cause = error;
              throw nonRetryable;
            }
            throw error;
          }
        },
        retryOptions,
        signal
      );

    try {
      return await attempt(baseMessages);
    } catch (error) {
      // Structural request-repair escape hatch: a strict provider rejected the
      // message array as malformed (e.g. an assistant tool_calls left without
      // results by a mid-dispatch abort). Because the same history re-sends
      // every turn, this would wedge the session forever. Resend ONCE with a
      // guaranteed wire-compliant rebuild. Any other error propagates.
      if (isRecoverableRequestStructureError(error)) {
        this.throwIfAborted(signal);
        this.bus.emit({
          kind: 'llm-structural-repair',
          error: error instanceof Error ? error.message : String(error),
        });
        const strict = buildMessagesStrict(baseMessages);
        return await attempt(strict);
      }
      throw error;
    }
  }

  /**
   * Run an LLM step with guardrail validation and retry logic.
   * If no guardrails are configured, delegates directly to runLlmStep.
   */
  private async runLlmStepWithGuardrails(
    system: string,
    tools: ToolDef[],
    signal?: AbortSignal,
    middlewareGuardrails?: Guardrail[]
  ): Promise<{
    text: string;
    toolCalls: ToolCall[];
    finishReason?: string;
    toolCallsWithFlags: Array<{ call: ToolCall; parseFailed: boolean }>;
  }> {
    // Determine responseFormat and additional guardrails from structured output config
    let responseFormat: LlmStepInput['responseFormat'] | undefined;
    const structuredGuardrails: Guardrail[] = [];
    if (this.opts.structuredOutput) {
      const strategy = this.opts.structuredOutput.strategy ?? 'auto';
      if (strategy === 'native' || strategy === 'auto') {
        responseFormat = buildResponseFormat(this.opts.structuredOutput);
      }
      if (strategy === 'guardrail' || strategy === 'auto') {
        structuredGuardrails.push(
          jsonSchemaGuardrail({
            schema: this.opts.structuredOutput.schema,
            name: 'structured-output',
            maxRetries: this.opts.structuredOutput.maxRetries ?? 2,
          })
        );
      }
    }

    const guardrails = this.getActiveGuardrails(
      middlewareGuardrails,
      structuredGuardrails
    );
    if (guardrails.length === 0) {
      return this.runLlmStep(system, tools, signal, responseFormat);
    }

    const DEFAULT_FEEDBACK =
      'Your response failed validation: {error}. Please try again.';

    // Retry context lives in a scratch buffer instead of this.history. If
    // the outer turn throws (or guardrails exhaust under throw policy), the
    // canonical history is untouched — rejected attempts don't persist.
    const retryMessages: Msg[] = [];

    let lastResult = await this.runLlmStep(
      system,
      tools,
      signal,
      responseFormat,
      retryMessages
    );

    for (const guardrail of guardrails) {
      const maxRetries = guardrail.maxRetries ?? 2;
      let attempt = 0;
      let lastError = '';

      while (true) {
        this.throwIfAborted(signal);

        // Determine if this guardrail should fire based on target filtering
        const target = guardrail.target ?? 'both';
        const hasText = lastResult.text.length > 0;
        const hasToolCalls = lastResult.toolCalls.length > 0;

        if (target === 'text' && !hasText && hasToolCalls) {
          // text-only guardrail, but LLM returned only tool calls — skip
          this.bus.emit({ kind: 'guardrail-pass', name: guardrail.name });
          break;
        }
        if (target === 'tool-calls' && !hasToolCalls && hasText) {
          // tool-calls-only guardrail, but LLM returned only text — skip
          this.bus.emit({ kind: 'guardrail-pass', name: guardrail.name });
          break;
        }

        const validationResult = await guardrail.validate(
          { text: lastResult.text, toolCalls: lastResult.toolCalls },
          {
            node: this.currentNode,
            state: this.state.snapshot(),
            attempt,
            maxRetries,
            messages: [...this.history, ...retryMessages],
          }
        );

        if (validationResult.valid) {
          this.bus.emit({ kind: 'guardrail-pass', name: guardrail.name });
          break;
        }

        // Validation failed
        lastError = validationResult.reason ?? 'validation failed';
        attempt++;
        this.bus.emit({
          kind: 'guardrail-fail',
          name: guardrail.name,
          error: lastError,
          attempt,
        });

        if (attempt > maxRetries) {
          // Exhausted retries
          this.bus.emit({
            kind: 'guardrail-exhausted',
            name: guardrail.name,
            error: lastError,
            attempts: attempt,
          });

          const policy = this.opts.exhaustionPolicy ?? 'throw';
          if (policy === 'throw') {
            throw new GuardrailExhaustionError(
              guardrail.name,
              lastError,
              attempt
            );
          }
          // 'last-response' policy: return the last (invalid) response
          break;
        }

        // Stage the failed response + feedback in the scratch buffer so the
        // next LLM call sees them, but never write them to this.history.
        const template = guardrail.feedbackTemplate ?? DEFAULT_FEEDBACK;
        const feedback = template.replace('{error}', lastError);

        if (lastResult.text) {
          retryMessages.push({
            role: 'assistant',
            content: lastResult.text,
          });
        }
        retryMessages.push({ role: 'user', content: feedback });

        // Retry the LLM step with scratch buffer appended
        lastResult = await this.runLlmStep(
          system,
          tools,
          signal,
          responseFormat,
          retryMessages
        );
      }
    }

    return lastResult;
  }

  /**
   * Get the active guardrails — combines static guardrails from options
   * with structured output guardrails and any dynamically added via middleware.
   */
  private getActiveGuardrails(
    middlewareGuardrails?: Guardrail[],
    structuredGuardrails?: Guardrail[]
  ): Guardrail[] {
    const base = this.opts.guardrails ?? [];
    const structured = structuredGuardrails ?? [];
    const middleware = middlewareGuardrails ?? [];
    if (structured.length === 0 && middleware.length === 0) {
      return base;
    }
    return [...structured, ...base, ...middleware];
  }

  /**
   * Delegate control to a child node. The child runs a separate reasoning loop
   * and returns its result. State IS shared (child mutations are visible to parent),
   * but conversation history is isolated.
   */
  private async delegate(
    childNodeName: string,
    context?: string,
    signal?: AbortSignal
  ): Promise<DelegationResult> {
    // 1. Resolve the child node
    const childNode = this.graph.nodes.get(childNodeName);
    if (!childNode) {
      throw new Error(`Delegation target node "${childNodeName}" not found`);
    }

    // 2. Check depth limit
    const defaultOpts = this.opts.delegation ?? {};
    const maxDepth = defaultOpts.maxDepth ?? 5;
    if (this.delegationStack.length >= maxDepth) {
      throw new DelegationDepthError(this.delegationStack.length, maxDepth);
    }

    // 3. Create frame
    const maxSteps = defaultOpts.maxSteps ?? 10;
    const shareHistory = defaultOpts.shareHistory ?? false;
    const effectiveContext = context ?? defaultOpts.context ?? '';
    const summaryPolicy = defaultOpts.summaryPolicy;
    const onWillDelegate = defaultOpts.onWillDelegate;
    const onDidDelegate = defaultOpts.onDidDelegate;
    const frame: DelegationFrame = {
      parentNode: this.currentNode,
      childNode: childNodeName,
      parentHistory: Object.freeze([...this.history]),
      depth: this.delegationStack.length + 1,
      options: {
        maxSteps,
        maxDepth,
        context: effectiveContext,
        shareHistory,
        summaryPolicy,
        onWillDelegate,
        onDidDelegate,
      },
    };

    // 3a. onWillDelegate — throw to abort BEFORE any state swap.
    // Runs before the frame is pushed / `delegation-start` fires, so a
    // rejected delegation is invisible from the outside (no bracket, no
    // stack change). The reference agent's onWillStartAgentTask hook slot.
    const parentAgentId = this.agentIdStack[this.agentIdStack.length - 1];
    const hookCtx: DelegationHookContext = {
      parentNode: this.currentNode,
      childNode: childNodeName,
      depth: this.delegationStack.length + 1,
      context: effectiveContext || undefined,
      shareHistory,
      signal,
      parentAgentId,
    };
    if (onWillDelegate) {
      await onWillDelegate(hookCtx);
    }

    // 4. Push frame + register a fresh agent handle. Both the event and the
    // hook context carry the new agentId so hosts can key transcripts on it.
    this.delegationStack.push(frame);
    const handle = this.agents.register({
      parentAgentId,
      parentNode: frame.parentNode,
      childNode: childNodeName,
      depth: frame.depth,
      parallel: false,
    });
    this.agentIdStack.push(handle.agentId);
    hookCtx.agentId = handle.agentId;

    // 5. Emit delegation-start (with agentId so listeners can dedupe if two
    //    sibling delegations pick the same child node in a single turn).
    this.bus.emit({
      kind: 'delegation-start',
      parentNode: frame.parentNode,
      childNode: childNodeName,
      depth: frame.depth,
      agentId: handle.agentId,
      parentAgentId,
    });

    // SubagentStart seam (notification): fires once the child frame is pushed
    // and its handle registered. Seam for the reference agent's SubagentStart hook.
    if (!this.pipeline.isEmpty) {
      await this.pipeline.runOnSubagentStart({
        parentNode: frame.parentNode,
        childNode: childNodeName,
        depth: frame.depth,
        agentId: handle.agentId,
        context: effectiveContext || undefined,
        parallel: false,
      });
    }

    // Save parent state
    const savedNode = this.currentNode;
    const savedHistory = [...this.history];

    // Take a state snapshot before delegation to compute changes afterwards
    const stateBefore = this.state.snapshot();

    try {
      // 6. Swap to child context
      this.currentNode = childNodeName;
      this.history.length = 0;
      if (shareHistory) {
        this.history.push(...savedHistory);
      }
      if (context) {
        this.history.push({
          role: 'user',
          content: `[Delegation context: ${context}]`,
        });
      }

      // 7. Mini reasoning loop for the child
      this.traceStart(`delegation:${childNodeName}`, {
        'delegation.child': childNodeName,
        'delegation.depth': frame.depth,
      });

      let assistantText = '';
      let steps = 0;

      const node = this.requireNode(this.currentNode);
      const actionUris = buildActionUriMap(node);
      const nodeTools = this.buildToolDefs(node, actionUris);
      const toolHooks = buildToolHookMaps(node);
      const resolveTarget = (ref: string): string => {
        if (ref.includes('://') || ref === '__state_update_action__')
          return ref;
        return actionUris.get(ref) ?? ref;
      };
      const baseStepOpts = {
        state: this.state,
        tools: this.opts.tools,
        bus: this.bus,
        resolveTarget,
      };

      // Run before_reasoning for the child node
      const preSteps = node.before_reasoning as Step[] | null;
      await runSteps(preSteps, baseStepOpts);

      // Reasoning loop
      while (true) {
        this.throwIfAborted(signal);

        if (steps >= maxSteps) {
          throw new DelegationTimeoutError(childNodeName, maxSteps, steps);
        }

        const system = this.buildSystemPrompt(node);
        const enableScope = makeScope(this.state);
        const visibleTools = nodeTools
          .filter(t => isEnabled(t.enabled, enableScope))
          .filter(t => {
            if (!this.opts.toolLimits) return true;
            const limit = this.opts.toolLimits[t.name];
            if (!limit) return true;
            return (this.toolCallCounts.get(t.name) ?? 0) < limit.maxCalls;
          });
        const effectiveTools: ToolDef[] = visibleTools.map(stripInternal);

        const turn = await this.runLlmStep(system, effectiveTools, signal);
        steps++;

        assistantText += turn.text;

        if (turn.toolCalls.length === 0) {
          // Child is done — text-only response
          if (turn.text) {
            this.history.push({ role: 'assistant', content: turn.text });
          }
          break;
        }

        // Process tool calls
        this.history.push({
          role: 'assistant',
          content: '',
          tool_calls: turn.toolCalls,
        });

        let sessionEnded = false;
        let hookHandoff = false;
        for (const call of turn.toolCalls) {
          this.throwIfAborted(signal);
          const outcome = await this.dispatchToolCall(
            call,
            nodeTools,
            toolHooks,
            signal,
            baseStepOpts
          );
          if (outcome.endSession) {
            sessionEnded = true;
            break;
          }
          if (outcome.handoffTo) {
            // A pre/post_tool_call hook handed off mid-delegation. There's no
            // established "switch node and keep reasoning" mechanism inside a
            // call-return delegation, so end the child here with the new node
            // as its final state (mirrors how finalNode already reports
            // this.currentNode below).
            this.currentNode = outcome.handoffTo;
            hookHandoff = true;
            break;
          }
        }
        if (sessionEnded || hookHandoff) {
          break;
        }

        // Escalation: @utils.escalate sets AgentScriptInternal_next_topic
        // to '__human__'. Surface as a terminal event and stop the child loop.
        if (this.state.get('AgentScriptInternal_next_topic') === '__human__') {
          this.bus.emit({ kind: 'end-session' });
          break;
        }
      }

      // 7a. Summary distillation — if the child returned less than
      // `summaryPolicy.minChars` of text, coax it with a continuation prompt
      // and run one more reasoning step. Bounded by `retries` so a stubborn
      // child can't loop forever. The reference agent's AgentProfileSummaryPolicy.
      let continuations = 0;
      if (
        summaryPolicy?.minChars &&
        assistantText.trim().length < summaryPolicy.minChars
      ) {
        const maxRetries = summaryPolicy.retries ?? 1;
        const continuationPrompt =
          summaryPolicy.continuationPrompt ??
          'Please provide a complete answer with all relevant details.';
        while (
          continuations < maxRetries &&
          assistantText.trim().length < summaryPolicy.minChars &&
          steps < maxSteps
        ) {
          this.throwIfAborted(signal);
          this.history.push({ role: 'user', content: continuationPrompt });
          const system = this.buildSystemPrompt(node);
          const enableScope = makeScope(this.state);
          const visibleTools = nodeTools
            .filter(t => isEnabled(t.enabled, enableScope))
            .map(stripInternal);
          const turn = await this.runLlmStep(system, visibleTools, signal);
          steps++;
          continuations++;
          assistantText += (assistantText ? '\n\n' : '') + turn.text;
          if (turn.text) {
            this.history.push({ role: 'assistant', content: turn.text });
          }
          // If the child chose to call tools in the continuation, that's
          // fine — treat it like any other step, but don't force another
          // continuation on top; break to the after_reasoning phase.
          if (turn.toolCalls.length > 0) break;
        }
      }

      // Run after_reasoning for the child node
      const afterSteps = node.after_reasoning as Step[] | null;
      await runSteps(afterSteps, baseStepOpts);

      this.traceEnd('ok');

      // 8. Collect state changes
      const stateAfter = this.state.snapshot();
      const stateChanges: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(stateAfter)) {
        if (stateBefore[key] !== value) {
          stateChanges[key] = value;
        }
      }

      const result: DelegationResult = {
        assistantText,
        stateChanges,
        finalNode: this.currentNode,
        steps,
        ...(continuations > 0 ? { continuations } : {}),
      };

      // 9. Pop frame + settle the registry handle in lockstep.
      this.delegationStack.pop();
      this.agentIdStack.pop();
      this.agents.settle(handle.agentId, { kind: 'ok', result });

      // 10. Restore parent
      this.currentNode = savedNode;
      this.history.length = 0;
      this.history.push(...savedHistory);

      // 11. Emit delegation-end
      this.bus.emit({
        kind: 'delegation-end',
        parentNode: savedNode,
        childNode: childNodeName,
        result,
        agentId: handle.agentId,
      });

      // 11a. onDidDelegate — swallowed errors here so a broken observer can't
      // break the parent turn (this is the same defensive posture the reference agent
      // takes with its post-run hooks). Runs AFTER parent restoration so
      // observers see the final state.
      if (onDidDelegate) {
        await Promise.resolve(
          onDidDelegate(hookCtx, { kind: 'ok', result })
        ).catch(hookErr => {
          console.warn('[runtime] onDidDelegate threw; swallowed:', hookErr);
        });
      }

      // 11b. SubagentStop seam (notification): fires after parent restoration,
      // like onDidDelegate. Seam for the reference agent's SubagentStop hook. Best-effort.
      if (!this.pipeline.isEmpty) {
        await this.pipeline
          .runOnSubagentStop({
            parentNode: savedNode,
            childNode: childNodeName,
            depth: frame.depth,
            agentId: handle.agentId,
            context: effectiveContext || undefined,
            parallel: false,
            ok: true,
            assistantText: result.assistantText,
          })
          .catch(() => undefined);
      }

      // 12. Return result
      return result;
    } catch (err) {
      // Emit delegation-error, restore parent state, re-throw
      this.traceEnd('error');
      this.delegationStack.pop();
      this.agentIdStack.pop();
      this.agents.settle(handle.agentId, { kind: 'error', error: String(err) });
      this.currentNode = savedNode;
      this.history.length = 0;
      this.history.push(...savedHistory);
      this.bus.emit({
        kind: 'delegation-error',
        parentNode: savedNode,
        childNode: childNodeName,
        error: String(err),
        agentId: handle.agentId,
      });
      // onDidDelegate on failure — same defensive posture as success path.
      if (onDidDelegate) {
        await Promise.resolve(
          onDidDelegate(hookCtx, { kind: 'error', error: err })
        ).catch(hookErr => {
          console.warn(
            '[runtime] onDidDelegate (error path) threw; swallowed:',
            hookErr
          );
        });
      }
      // SubagentStop seam on failure — same defensive posture as success path.
      if (!this.pipeline.isEmpty) {
        await this.pipeline
          .runOnSubagentStop({
            parentNode: savedNode,
            childNode: childNodeName,
            depth: frame.depth,
            agentId: handle.agentId,
            context: effectiveContext || undefined,
            parallel: false,
            ok: false,
            error: err,
          })
          .catch(() => undefined);
      }
      throw err;
    }
  }

  /**
   * Launch a subagent in the BACKGROUND. Unlike {@link delegate} (which blocks
   * the parent turn until the child settles), this returns immediately with a
   * `{ task_id, agent_id, status: 'running' }` handle and runs the child
   * DETACHED. The parent keeps reasoning and later pulls the result via the
   * `subagent://` tools; the harness injectors surface the completion back into
   * the parent's context.
   *
   * STATE ISOLATION (the user's chosen "isolated snapshot, result-only"
   * semantics): the child runs against a fresh {@link Runtime} reconstructed
   * from a checkpoint of the parent — a deep CLONE of parent state + an empty
   * history positioned on the child node. The child cannot see or mutate parent
   * state; the parent receives ONLY the child's text/output. This reuses the
   * whole turn machinery (via `child.turn(context)`) and the checkpoint infra
   * (so a completed child can be truly resumed later).
   */
  private spawnBackground(
    childNodeName: string,
    context: string | undefined,
    parentSignal?: AbortSignal
  ): { task_id: string; agent_id: string; status: string } {
    const mgr = this.opts.background;
    if (!mgr) {
      throw new Error(
        'Background subagents are not enabled (no BackgroundTaskManager was ' +
          'wired into RuntimeOptions.background).'
      );
    }
    const childNode = this.graph.nodes.get(childNodeName);
    if (!childNode) {
      throw new Error(`Delegation target node "${childNodeName}" not found`);
    }

    const defaultOpts = this.opts.delegation ?? {};
    const maxSteps = defaultOpts.maxSteps ?? 10;
    const agentId = childNodeName;
    const parentNode = this.currentNode;

    // Snapshot parent state NOW (at spawn time) so the clone reflects what the
    // parent saw when it launched the task — not some later, racy value.
    const stateSnapshot = this.state.snapshot();

    const info = mgr.spawn({
      childNode: childNodeName,
      agentId,
      description: context ?? `background subagent on node "${childNodeName}"`,
      run: async ({ taskId, signal, emit }) => {
        // Chain the manager's stop/timeout signal with the parent turn's
        // signal so aborting the parent also tears the child down.
        const linked = linkSignals(signal, parentSignal);

        // Build the isolated child from a synthetic checkpoint: a deep clone of
        // parent state, an empty history, positioned on the child node.
        const child = Runtime.fromCheckpoint(
          { ...this.opts, background: undefined, signal: linked },
          {
            schemaVersion: CHECKPOINT_SCHEMA_VERSION,
            createdAt: new Date().toISOString(),
            id: `bg-${taskId}`,
            currentNode: childNodeName,
            history: [],
            stateValues: stateSnapshot,
          }
        );

        // Stream the child's assistant text into the task's output log.
        const offText = child.on(e => {
          if (e.kind === 'llm-text' && e.text) emit(e.text);
        });

        try {
          const result = await child.turn(
            context ?? 'Begin your background task.',
            { signal: linked }
          );
          return {
            assistantText: result.assistantText,
            steps: maxSteps, // step count isn't surfaced by turn(); cap is the bound
            // Checkpoint the finished child so `subagent://resume` can continue
            // its conversation later (true resume, not a fresh respawn).
            checkpoint: child.checkpoint({ id: `bg-${taskId}` }),
          };
        } finally {
          offText();
        }
      },
    });

    this.bus.emit({
      kind: 'background-start',
      parentNode,
      childNode: childNodeName,
      taskId: info.taskId,
      agentId,
    });

    // Bridge the manager's terminal notification to a runtime event once.
    const offNotify = mgr.onNotify(evt => {
      if (evt.info.taskId !== info.taskId) return;
      this.bus.emit({
        kind: 'background-end',
        parentNode,
        childNode: childNodeName,
        taskId: info.taskId,
        agentId,
        status: evt.info.status,
        error: evt.info.error,
      });
      offNotify();
    });

    return { task_id: info.taskId, agent_id: agentId, status: info.status };
  }

  /**
   * Run a SWARM: expand `args.items` + `args.prompt_template` into N isolated
   * child runs on `childNodeName`, execute them bounded-concurrently, and
   * aggregate their settled outcomes into one `<agent_swarm_result>` XML block.
   *
   * This is the batch analogue of {@link spawnBackground}: each child runs
   * against a deep CLONE of parent state with an empty history (result-only
   * isolation), so N concurrent children can't corrupt each other or the
   * parent. Unlike a background launch, a swarm BLOCKS the parent turn until
   * every child settles, then hands back the aggregated report.
   *
   * Ported from the reference agent's `AgentSwarm`. Expansion/validation lives in
   * {@link expandSwarmItems} (throws {@link SwarmExpansionError} — surfaced to
   * the model by the caller); the bounded fan-out lives in {@link runPool};
   * the XML shape lives in {@link renderSwarmResults}.
   */
  private async runSwarm(
    childNodeName: string,
    args: Record<string, unknown>,
    parentSignal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const childNode = this.graph.nodes.get(childNodeName);
    if (!childNode) {
      throw new Error(`Swarm target node "${childNodeName}" not found`);
    }

    // Items may arrive as a real array or — because the generated tool schema
    // types them as a scalar string — as a JSON-encoded array string. Accept
    // both, then coerce every element to a string.
    let rawItems = args.items;
    if (typeof rawItems === 'string') {
      const trimmed = rawItems.trim();
      if (trimmed.startsWith('[')) {
        try {
          rawItems = JSON.parse(trimmed);
        } catch {
          // fall through — a non-array string is a validation error below.
        }
      }
    }
    if (!Array.isArray(rawItems)) {
      throw new SwarmExpansionError(
        'A swarm requires an `items` array of strings (or a JSON array string).'
      );
    }
    const items = rawItems.map(item => String(item));
    const promptTemplate = String(args.prompt_template ?? '');

    // Expand + validate BEFORE any child runs (throws SwarmExpansionError).
    const specs = expandSwarmItems(items, promptTemplate);

    const swarmOpts: SwarmOptions = this.opts.swarm ?? {};
    const maxConcurrency =
      swarmOpts.maxConcurrency ?? DEFAULT_SWARM_MAX_CONCURRENCY;
    const maxSteps = swarmOpts.maxSteps ?? this.opts.delegation?.maxSteps ?? 10;
    const parentNode = this.currentNode;
    const parentAgentId = this.agentIdStack[this.agentIdStack.length - 1];

    // Snapshot parent state ONCE so every child clones the same starting point.
    const stateSnapshot = this.state.snapshot();

    this.bus.emit({
      kind: 'swarm-start',
      parentNode,
      childNode: childNodeName,
      count: specs.length,
    });

    const settled = await runPool(
      specs,
      maxConcurrency,
      async (spec): Promise<SwarmRunResult> => {
        // Register a handle so hosts can inspect each swarm child by a stable
        // id, exactly like a delegation.
        const handle = this.agents.register({
          parentAgentId,
          parentNode,
          childNode: childNodeName,
          depth: this.delegationStack.length + 1,
          parallel: true,
        });
        const linked = linkSignals(parentSignal);
        try {
          // Isolated child: deep clone of parent state, empty history, on the
          // child node — mirrors spawnBackground's checkpoint template.
          const child = Runtime.fromCheckpoint(
            {
              ...this.opts,
              background: undefined,
              swarm: undefined,
              signal: linked,
            },
            {
              schemaVersion: CHECKPOINT_SCHEMA_VERSION,
              createdAt: new Date().toISOString(),
              id: `swarm-${handle.agentId}`,
              currentNode: childNodeName,
              history: [],
              stateValues: stateSnapshot,
            }
          );
          const result = await child.turn(spec.prompt, { signal: linked });
          this.agents.settle(handle.agentId, {
            kind: 'ok',
            result: {
              finalNode: childNodeName,
              assistantText: result.assistantText,
              steps: maxSteps,
              stateChanges: {},
            },
          });
          return {
            spec,
            agentId: handle.agentId,
            status: 'completed',
            result: result.assistantText,
          };
        } catch (err) {
          const aborted = linked.aborted || parentSignal?.aborted === true;
          this.agents.settle(handle.agentId, {
            kind: 'error',
            error: String(err),
          });
          return {
            spec,
            agentId: handle.agentId,
            status: aborted ? 'aborted' : 'failed',
            error: String(err),
          };
        }
      }
    );

    // runPool never rejects — a worker throw lands as `{ error }`, but our
    // worker already catches and maps to a SwarmRunResult, so every slot is a
    // `{ value }`. Guard the `{ error }` shape anyway for total safety.
    const results: SwarmRunResult[] = settled.map((slot, i) =>
      'value' in slot
        ? slot.value
        : {
            spec: specs[i],
            status: 'failed' as const,
            error: String((slot as { error: unknown }).error),
          }
    );

    this.bus.emit({
      kind: 'swarm-end',
      parentNode,
      childNode: childNodeName,
      count: results.length,
      completed: results.filter(r => r.status === 'completed').length,
      failed: results.filter(r => r.status === 'failed').length,
      aborted: results.filter(r => r.status === 'aborted').length,
    });

    return { output: renderSwarmResults(results) };
  }

  /**
   * Handle a `subagent://<op>` sentinel call. These are the reference
   * agent's Task tools: `list` / `output` / `stop` / `result` / `resume`.
   * `spawn` is not a separate op — a background launch is a normal
   * delegation call carrying `run_in_background: true` (handled in
   * {@link dispatchToolCall}).
   */
  private async handleSubagentOp(
    op: string,
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const mgr = this.opts.background;
    if (!mgr) {
      return {
        error:
          'Background subagents are not enabled in this session (no ' +
          'BackgroundTaskManager wired).',
      };
    }
    switch (op) {
      case 'list':
        return { tasks: mgr.list() };
      case 'output': {
        const id = String(args.task_id ?? args.id ?? '');
        const task = mgr.resolve(id);
        if (!task) return { error: `Unknown background task: ${id}` };
        const since = args.since === undefined ? undefined : Number(args.since);
        const { chunk, nextCursor } = mgr.output(task.taskId, since);
        return {
          task_id: task.taskId,
          output: chunk,
          nextCursor,
          status: task.status,
        };
      }
      case 'result': {
        const id = String(args.task_id ?? args.id ?? '');
        const task = mgr.resolve(id);
        if (!task) return { error: `Unknown background task: ${id}` };
        // Mark the completion delivered so the injector won't re-announce it —
        // but ONLY once the task has actually reached a terminal state. Marking
        // a still-`running` task notified would pin `notified=true` forever
        // (settle() never clears it), so its eventual completion would be
        // silently dropped from pendingNotifications() and never announced.
        // Reading the result of a running task just returns its current status.
        if (isBackgroundTaskTerminal(task.status)) {
          mgr.markNotified(task.taskId);
        }
        return {
          task_id: task.taskId,
          agent_id: task.agentId,
          status: task.status,
          result: task.resultText,
          error: task.error,
          stopReason: task.stopReason,
          steps: task.steps,
        };
      }
      case 'stop': {
        const id = String(args.task_id ?? args.id ?? '');
        const task = mgr.resolve(id);
        if (!task) return { error: `Unknown background task: ${id}` };
        const stopped = await mgr.stop(
          task.taskId,
          args.reason ? String(args.reason) : undefined
        );
        return { task_id: stopped.taskId, status: stopped.status };
      }
      case 'resume':
        return this.resumeBackground(args, signal);
      default:
        return { error: `Unknown subagent operation: ${op}` };
    }
  }

  /**
   * Resume a completed background subagent by its `agent_id` (NOT its task_id —
   * the reference agent keeps the two namespaces apart, and resume is keyed on the agent
   * identity). Reconstructs the child from its saved checkpoint and runs one
   * more turn against the supplied message, then re-checkpoints. The result is
   * returned synchronously (a resume blocks, like a foreground delegation) —
   * the model asked for it and is waiting on the answer.
   */
  private async resumeBackground(
    args: Record<string, unknown>,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const mgr = this.opts.background!;
    const agentRef = String(args.agent_id ?? args.task_id ?? args.id ?? '');
    const message = String(args.message ?? args.prompt ?? '');
    const task = mgr.resolve(agentRef);
    if (!task) return { error: `Unknown background subagent: ${agentRef}` };
    const checkpoint = await mgr.loadCheckpoint(task.taskId);
    if (!checkpoint) {
      return {
        error:
          `Background subagent "${agentRef}" has no saved state to resume ` +
          `(status: ${task.status}).`,
      };
    }
    const child = Runtime.fromCheckpoint(
      { ...this.opts, background: undefined, signal },
      checkpoint
    );
    const result = await child.turn(message || 'Continue.', { signal });
    return {
      agent_id: task.agentId,
      task_id: task.taskId,
      result: result.assistantText,
      finalNode: result.finalNode,
    };
  }

  /**
   * Delegate to multiple child nodes in parallel. Each child runs an isolated
   * reasoning loop. State changes are merged after all children settle.
   */
  async delegateMultiple(
    children: Array<{ nodeName: string; context?: string }>,
    signal?: AbortSignal
  ): Promise<DelegationResult[]> {
    const parallelOpts: ParallelDelegationOptions =
      this.opts.delegation?.parallel ?? {};
    const failurePolicy = parallelOpts.failurePolicy ?? 'wait-all';
    const stateMerge = parallelOpts.stateMerge ?? 'last-wins';

    // Pre-validate: check all child nodes exist and depth is within limit
    const defaultOpts = this.opts.delegation ?? {};
    const maxDepth = defaultOpts.maxDepth ?? 5;
    if (this.delegationStack.length >= maxDepth) {
      throw new DelegationDepthError(this.delegationStack.length, maxDepth);
    }
    for (const child of children) {
      if (!this.graph.nodes.get(child.nodeName)) {
        throw new Error(`Delegation target node "${child.nodeName}" not found`);
      }
    }

    this.bus.emit({
      kind: 'parallel-delegation-start',
      parentNode: this.currentNode,
      childNodes: children.map(c => c.nodeName),
    });

    const childController = new AbortController();
    const onParentAbort = () => childController.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const promises = children.map(child =>
        this.runIsolatedDelegation(
          child.nodeName,
          child.context,
          childController.signal
        )
      );

      const settled = await Promise.allSettled(promises);

      const delegationResults: DelegationResult[] = [];
      const allChanges: Array<Record<string, unknown>> = [];

      for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i];
        if (outcome.status === 'fulfilled') {
          delegationResults.push(outcome.value);
          allChanges.push(outcome.value.stateChanges);
        } else {
          if (failurePolicy === 'fail-fast') {
            childController.abort();
            throw outcome.reason;
          }
          delegationResults.push({
            assistantText: '',
            stateChanges: {},
            finalNode: children[i].nodeName,
            steps: 0,
          });
          allChanges.push({});
        }
      }

      // Merge state changes
      const merged = this.mergeStateChanges(
        allChanges,
        stateMerge,
        parallelOpts.mergeFn
      );
      for (const [key, value] of Object.entries(merged)) {
        this.state.set(key, value);
      }

      this.bus.emit({
        kind: 'parallel-delegation-end',
        parentNode: this.currentNode,
        childNodes: children.map(c => c.nodeName),
        results: delegationResults.map(r => ({
          finalNode: r.finalNode,
          steps: r.steps,
        })),
      });

      return delegationResults;
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private async runIsolatedDelegation(
    childNodeName: string,
    context: string | undefined,
    signal?: AbortSignal
  ): Promise<DelegationResult> {
    const childNode = this.graph.nodes.get(childNodeName);
    if (!childNode) {
      throw new Error(`Delegation target node "${childNodeName}" not found`);
    }

    const defaultOpts = this.opts.delegation ?? {};
    const maxDepth = defaultOpts.maxDepth ?? 5;
    if (this.delegationStack.length >= maxDepth) {
      throw new DelegationDepthError(this.delegationStack.length, maxDepth);
    }

    const maxSteps = defaultOpts.maxSteps ?? 10;
    const shareHistory = defaultOpts.shareHistory ?? false;

    const frame: DelegationFrame = {
      parentNode: this.currentNode,
      childNode: childNodeName,
      parentHistory: Object.freeze([...this.history]),
      depth: this.delegationStack.length + 1,
      options: {
        maxSteps,
        maxDepth,
        context: context ?? defaultOpts.context ?? '',
        shareHistory,
      },
    };

    // Register a handle for this parallel child. Parallel children share the
    // parent-turn's parentAgentId (they run under the same delegator) — read
    // it from the top of the stack. We deliberately don't push the parallel
    // handle onto agentIdStack: siblings run concurrently, and mutating the
    // stack from many promises at once produces meaningless ordering.
    const parentAgentId = this.agentIdStack[this.agentIdStack.length - 1];
    const handle = this.agents.register({
      parentAgentId,
      parentNode: frame.parentNode,
      childNode: childNodeName,
      depth: frame.depth,
      parallel: true,
    });

    this.bus.emit({
      kind: 'delegation-start',
      parentNode: frame.parentNode,
      childNode: childNodeName,
      depth: frame.depth,
      agentId: handle.agentId,
      parentAgentId,
    });

    // Each parallel child gets its own isolated history
    const childHistory: Msg[] = [];
    if (shareHistory) {
      childHistory.push(...this.history);
    }
    if (context) {
      childHistory.push({
        role: 'user',
        content: `[Delegation context: ${context}]`,
      });
    }

    this.traceStart(`delegation:${childNodeName}`, {
      'delegation.child': childNodeName,
      'delegation.depth': frame.depth,
      'delegation.parallel': true,
    });

    let assistantText = '';
    let steps = 0;

    const node = this.requireNode(childNodeName);
    const actionUris = buildActionUriMap(node);
    const nodeTools = this.buildToolDefs(node, actionUris);
    const resolveTarget = (ref: string): string => {
      if (ref.includes('://') || ref === '__state_update_action__') return ref;
      return actionUris.get(ref) ?? ref;
    };
    const baseStepOpts = {
      state: this.state,
      tools: this.opts.tools,
      bus: this.bus,
      resolveTarget,
    };

    try {
      const preSteps = node.before_reasoning as Step[] | null;
      await runSteps(preSteps, baseStepOpts);

      // Take a per-child snapshot right before reasoning to track this child's mutations
      const childStateBefore = this.state.snapshot();

      while (true) {
        if (signal?.aborted) {
          throw new AbortError(signal.reason);
        }
        if (steps >= maxSteps) {
          throw new DelegationTimeoutError(childNodeName, maxSteps, steps);
        }

        const system = this.buildSystemPrompt(node);
        const enableScope = makeScope(this.state);
        const visibleTools = nodeTools
          .filter(t => isEnabled(t.enabled, enableScope))
          .filter(t => {
            if (!this.opts.toolLimits) return true;
            const limit = this.opts.toolLimits[t.name];
            if (!limit) return true;
            return (this.toolCallCounts.get(t.name) ?? 0) < limit.maxCalls;
          });
        const effectiveTools: ToolDef[] = visibleTools.map(stripInternal);

        // Use child's isolated history for the LLM step
        const stepInput: LlmStepInput = {
          system,
          messages: childHistory,
          tools: effectiveTools,
        };
        const turn = await this.collectLlmStep(stepInput, signal);
        steps++;

        assistantText += turn.text;

        if (turn.toolCalls.length === 0) {
          if (turn.text) {
            childHistory.push({ role: 'assistant', content: turn.text });
          }
          break;
        }

        childHistory.push({
          role: 'assistant',
          content: '',
          tool_calls: turn.toolCalls,
        });

        let sessionEnded = false;
        for (const call of turn.toolCalls) {
          if (signal?.aborted) throw new AbortError(signal.reason);
          const outcome = await this.dispatchToolCallForHistory(
            call,
            nodeTools,
            childHistory,
            signal
          );
          if (outcome.endSession) {
            sessionEnded = true;
            break;
          }
        }
        if (sessionEnded) break;

        if (this.state.get('AgentScriptInternal_next_topic') === '__human__') {
          break;
        }
      }

      const afterSteps = node.after_reasoning as Step[] | null;
      await runSteps(afterSteps, baseStepOpts);

      this.traceEnd('ok');

      // Compute state changes relative to this child's pre-reasoning snapshot
      const stateAfter = this.state.snapshot();
      const stateChanges: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(stateAfter)) {
        if (childStateBefore[key] !== value) {
          stateChanges[key] = value;
        }
      }

      const result: DelegationResult = {
        assistantText,
        stateChanges,
        finalNode: childNodeName,
        steps,
      };

      this.agents.settle(handle.agentId, { kind: 'ok', result });
      this.bus.emit({
        kind: 'delegation-end',
        parentNode: this.currentNode,
        childNode: childNodeName,
        result,
        agentId: handle.agentId,
      });

      return result;
    } catch (err) {
      this.traceEnd('error');
      this.agents.settle(handle.agentId, { kind: 'error', error: String(err) });
      this.bus.emit({
        kind: 'delegation-error',
        parentNode: this.currentNode,
        childNode: childNodeName,
        error: String(err),
        agentId: handle.agentId,
      });
      throw err;
    }
  }

  /**
   * Run an LLM step and collect the full turn result (text + tool calls).
   * Similar to runLlmStep but separated for parallel delegation use.
   */
  private async collectLlmStep(
    input: LlmStepInput,
    signal?: AbortSignal
  ): Promise<{ text: string; toolCalls: ToolCall[] }> {
    let text = '';
    const toolCalls: ToolCall[] = [];
    for await (const event of this.opts.llm.step(input)) {
      if (signal?.aborted) throw new AbortError(signal.reason);
      if (event.kind === 'text-delta') text += event.text;
      else if (event.kind === 'tool-call') toolCalls.push(event.call);
      else if (event.kind === 'finish') break;
    }
    return { text, toolCalls };
  }

  /**
   * Dispatch a single tool call and push the result to the provided history
   * array (instead of this.history). Used by parallel delegation.
   */
  private async dispatchToolCallForHistory(
    call: ToolCall,
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >,
    history: Msg[],
    signal?: AbortSignal
  ): Promise<{ endSession: boolean }> {
    const def = tools.find(t => t.name === call.name);
    if (!def) {
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        tool_name: call.name,
        content: JSON.stringify({ error: 'unknown tool' }),
        is_error: true,
      });
      return { endSession: false };
    }

    const scope = makeScope(this.state);
    const boundEvaluated: Record<string, unknown> = {};
    if (def.bound) {
      for (const [k, raw] of Object.entries(def.bound)) {
        boundEvaluated[k] = evalBoundValue(raw, scope);
      }
    }
    const args = { ...boundEvaluated, ...call.arguments };

    let result: Record<string, unknown>;
    let endSession = false;

    if (def.target === '__state_update_action__') {
      result = args;
    } else if (def.target === '__end_session_action__') {
      result = args;
      endSession = true;
    } else {
      try {
        result = await this.opts.tools.invoke(def.target, args, { signal });
      } catch (err) {
        history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify({ error: String(err) }),
          is_error: true,
        });
        return { endSession: false };
      }
    }

    // Apply state_updates
    if (def.stateUpdates) {
      const resultScope = makeScope(this.state, result!);
      for (const entry of def.stateUpdates) {
        for (const [name, raw] of Object.entries(entry)) {
          this.state.set(name, evalBoundValue(raw, resultScope));
        }
      }
    }

    history.push({
      role: 'tool',
      tool_call_id: call.id,
      tool_name: call.name,
      content: JSON.stringify(result),
    });

    if (endSession) {
      this.bus.emit({ kind: 'end-session' });
    }
    return { endSession };
  }

  private mergeStateChanges(
    changes: Array<Record<string, unknown>>,
    strategy: 'last-wins' | 'error-on-conflict' | 'custom',
    mergeFn?: (
      changes: Array<Record<string, unknown>>
    ) => Record<string, unknown>
  ): Record<string, unknown> {
    if (strategy === 'custom') {
      if (!mergeFn)
        throw new Error('mergeFn required when stateMerge is "custom"');
      return mergeFn(changes);
    }

    if (strategy === 'error-on-conflict') {
      const merged: Record<string, unknown> = {};
      const seen = new Map<string, number>();
      for (let i = 0; i < changes.length; i++) {
        for (const [key, value] of Object.entries(changes[i])) {
          if (seen.has(key)) {
            const prevIdx = seen.get(key)!;
            if (changes[prevIdx][key] !== value) {
              throw new StateConflictError(key, prevIdx, i);
            }
          }
          seen.set(key, i);
          merged[key] = value;
        }
      }
      return merged;
    }

    // 'last-wins'
    const merged: Record<string, unknown> = {};
    for (const change of changes) {
      Object.assign(merged, change);
    }
    return merged;
  }

  private shouldDispatchParallel(
    calls: ToolCall[],
    tools: Array<
      ToolDef & {
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
      }
    >
  ): boolean {
    const strategy = this.opts.parallel?.strategy ?? 'auto';
    if (strategy === 'never') return false;
    if (strategy === 'always') return calls.length > 1;
    // 'auto': parallel only when safe
    if (calls.length <= 1) return false;
    const sequential = new Set(this.opts.parallel?.sequentialTools ?? []);
    for (const call of calls) {
      if (sequential.has(call.name)) return false;
      const def = tools.find(t => t.name === call.name);
      if (!def) continue;
      if (
        def.target === '__state_update_action__' ||
        def.target === '__end_session_action__' ||
        def.target.startsWith('delegate://') ||
        def.target === '__delegate_action__' ||
        // A swarm drives its own bounded fan-out of child loops; letting the
        // tool-dispatch layer also parallelize it would double-govern (and
        // mutate history out of order). Keep it on the sequential path.
        def.target.startsWith('swarm://')
      ) {
        return false;
      }
    }
    return true;
  }

  private async dispatchToolCallsParallel(
    calls: ToolCall[],
    tools: Array<
      ToolDef & {
        actionRef: string;
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
        requireConfirmation?: boolean;
      }
    >,
    hooks: ToolHookMaps,
    baseStepOpts: StepRunOptions | undefined,
    signal?: AbortSignal
  ): Promise<{ endSession: boolean; steps: number; handoffTo?: string }> {
    const failurePolicy = this.opts.parallel?.failurePolicy ?? 'wait-all';

    this.bus.emit({
      kind: 'parallel-dispatch-start',
      node: this.currentNode,
      toolNames: calls.map(c => c.name),
    });

    // Start a parent tracing span for the parallel batch
    let parentSpanId: string | undefined;
    if (this._tracingCtx) {
      const parentSpan = this._tracingCtx.startSpan('parallel-tool-dispatch', {
        'parallel.count': calls.length,
      });
      parentSpanId = parentSpan.spanId;
    }

    // Pre-check tool limits for all calls before dispatching any
    const limitChecked: Array<{ call: ToolCall; blocked: boolean }> = [];
    for (const call of calls) {
      let blocked = false;
      if (this.opts.toolLimits) {
        const limit = this.opts.toolLimits[call.name];
        if (limit) {
          const count = this.toolCallCounts.get(call.name) ?? 0;
          if (count >= limit.maxCalls) {
            blocked = true;
          }
        }
      }
      limitChecked.push({ call, blocked });
    }

    // Create a child abort controller linked to the parent
    const childController = new AbortController();
    const onParentAbort = () => childController.abort();
    signal?.addEventListener('abort', onParentAbort, { once: true });

    try {
      const promises = limitChecked.map(({ call, blocked }) => {
        if (blocked) {
          this.bus.emit({
            kind: 'tool-limit-reached',
            name: call.name,
            limit: this.opts.toolLimits![call.name].maxCalls,
          });
          return Promise.resolve({
            call,
            endSession: false,
            historyEntry: {
              role: 'tool' as const,
              tool_call_id: call.id,
              tool_name: call.name,
              content: JSON.stringify({
                error: `Tool "${call.name}" has reached its usage limit. Choose a different approach.`,
              }),
              is_error: true,
            },
            stateWrites: [] as Array<[string, unknown]>,
            error: false,
            handoffTo: undefined as string | undefined,
          });
        }
        return this.dispatchToolCallIsolated(
          call,
          tools,
          hooks,
          baseStepOpts,
          childController.signal,
          parentSpanId
        );
      });

      const results = await Promise.allSettled(promises);

      let endSession = false;
      let stepCount = 0;
      // First in submitted-call order wins, applied only after the whole
      // batch settles — there's no way to abort an in-flight sibling once
      // one call's hook decides to hand off.
      let firstHandoffTo: string | undefined;

      // Apply results in order for deterministic history
      for (let i = 0; i < results.length; i++) {
        const settled = results[i];
        stepCount++;
        if (settled.status === 'rejected') {
          const call = calls[i];
          this.bus.emit({
            kind: 'tool-error',
            name: call.name,
            error: String(settled.reason),
          });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: call.name,
            content: JSON.stringify({ error: String(settled.reason) }),
          });
          if (failurePolicy === 'fail-fast') {
            childController.abort();
            // Pair the calls we're about to skip (i+1..n) so history stays a
            // valid tool_calls -> tool_result handshake — a dangling call would
            // poison the next request.
            this.flushUndispatchedToolResults(
              calls,
              i + 1,
              'Not executed: a sibling tool call failed under the fail-fast policy.'
            );
            break;
          }
        } else {
          const outcome = settled.value;
          // Apply state writes in order
          for (const [key, value] of outcome.stateWrites) {
            this.state.set(key, value);
          }
          this.history.push(outcome.historyEntry as Msg);
          // Increment tool usage counter
          if (!outcome.error) {
            this.toolCallCounts.set(
              outcome.call.name,
              (this.toolCallCounts.get(outcome.call.name) ?? 0) + 1
            );
          }
          if (outcome.endSession) {
            endSession = true;
            this.bus.emit({ kind: 'end-session' });
          }
          if (outcome.handoffTo && !firstHandoffTo) {
            firstHandoffTo = outcome.handoffTo;
          }
        }
      }

      // End parent tracing span. Use endSpanById because children may have
      // been started off-stack (parallel) — the parent is no longer guaranteed
      // to be at the top of the stack.
      if (this._tracingCtx && parentSpanId) {
        this._tracingCtx.endSpanById(parentSpanId, 'ok');
      }

      this.bus.emit({
        kind: 'parallel-dispatch-end',
        node: this.currentNode,
        toolNames: calls.map(c => c.name),
      });

      return { endSession, steps: stepCount, handoffTo: firstHandoffTo };
    } finally {
      signal?.removeEventListener('abort', onParentAbort);
    }
  }

  private async dispatchToolCallIsolated(
    call: ToolCall,
    tools: Array<
      ToolDef & {
        actionRef: string;
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
        requireConfirmation?: boolean;
      }
    >,
    hooks: ToolHookMaps,
    baseStepOpts: StepRunOptions | undefined,
    signal?: AbortSignal,
    parentSpanId?: string
  ): Promise<{
    call: ToolCall;
    endSession: boolean;
    historyEntry: {
      role: string;
      tool_call_id: string;
      tool_name: string;
      content: string;
      is_error?: boolean;
    };
    stateWrites: Array<[string, unknown]>;
    error: boolean;
    handoffTo?: string;
  }> {
    // Start an off-stack child span for this tool call. Off-stack so that
    // concurrent siblings (this method runs under Promise.allSettled in
    // dispatchToolCallsParallel) don't interleave LIFO pops. Track the spanId
    // so we close the right one in makeResult.
    let childSpanId: string | undefined;
    if (this._tracingCtx && parentSpanId) {
      const childSpan = this._tracingCtx.startChildSpan(
        parentSpanId,
        `tool-call:${call.name}`,
        { 'tool.name': call.name }
      );
      childSpanId = childSpan.spanId;
    }

    const makeResult = (
      endSession: boolean,
      content: string,
      stateWrites: Array<[string, unknown]> = [],
      isError = false,
      handoffTo?: string
    ) => {
      if (this._tracingCtx && childSpanId) {
        this._tracingCtx.endSpanById(childSpanId, isError ? 'error' : 'ok');
      }
      return {
        call,
        endSession,
        historyEntry: {
          role: 'tool' as const,
          tool_call_id: call.id,
          tool_name: call.name,
          content,
          ...(isError ? { is_error: true } : {}),
        },
        stateWrites,
        error: isError,
        ...(handoffTo ? { handoffTo } : {}),
      };
    };

    const def = tools.find(t => t.name === call.name);
    if (!def) {
      this.bus.emit({
        kind: 'tool-error',
        name: call.name,
        error: 'unknown tool',
      });
      return makeResult(
        false,
        JSON.stringify({ error: 'unknown tool' }),
        [],
        true
      );
    }

    // --- pre_tool_call hook ---
    // Runs before beforeToolCall middleware; a handoff here pre-empts the
    // tool invocation and middleware entirely (same ordering as the
    // sequential dispatchToolCall path).
    const preEntry = hooks.pre.get(def.actionRef);
    if (preEntry && preEntry.actions.length > 0 && baseStepOpts) {
      this.bus.emit({
        kind: 'phase-start',
        node: this.currentNode,
        phase: 'pre_tool_call',
      });
      const preOutcome = await runSteps(
        preEntry.actions as unknown as Step[],
        baseStepOpts
      );
      this.bus.emit({
        kind: 'phase-end',
        node: this.currentNode,
        phase: 'pre_tool_call',
      });
      if (preOutcome.handoffTo) {
        return makeResult(
          false,
          JSON.stringify({}),
          [],
          false,
          preOutcome.handoffTo
        );
      }
    }

    // Merge compiler-bound args with LLM-provided args
    const scope = makeScope(this.state);
    const boundEvaluated: Record<string, unknown> = {};
    if (def.bound) {
      for (const [k, raw] of Object.entries(def.bound)) {
        boundEvaluated[k] = evalBoundValue(raw, scope);
      }
    }
    const args = { ...boundEvaluated, ...call.arguments };

    // beforeToolCall middleware
    if (!this.pipeline.isEmpty) {
      const beforeTc = await this.pipeline.runBeforeToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args: { ...args },
        toolCall: call,
        requireConfirmation: def.requireConfirmation,
      });
      if (beforeTc?.skip) return makeResult(false, JSON.stringify({}));
      if (beforeTc?.abort) {
        return makeResult(false, JSON.stringify(beforeTc.abort.result));
      }
      if (beforeTc?.args) Object.assign(args, beforeTc.args);
    }

    this.bus.emit({ kind: 'tool-call', name: def.target, args });

    let result: Record<string, unknown>;
    const endSession = false;

    // For isolated dispatch, we don't handle sentinels (they're filtered out
    // by shouldDispatchParallel), but handle external tools
    try {
      result = await this.opts.tools.invoke(def.target, args, { signal });
    } catch (err) {
      if (!this.pipeline.isEmpty) {
        const errorResult = await this.pipeline.runOnError({
          node: this.currentNode,
          state: this.state.snapshot(),
          error: err,
          phase: 'tool-call',
          toolName: call.name,
          target: def.target,
        });
        if (errorResult?.suppress && errorResult.fallbackResult) {
          result = errorResult.fallbackResult;
        } else if (errorResult?.suppress) {
          return makeResult(false, JSON.stringify({}));
        } else {
          this.bus.emit({
            kind: 'tool-error',
            name: def.target,
            error: String(err),
          });
          return makeResult(
            false,
            JSON.stringify({ error: String(err) }),
            [],
            true
          );
        }
      } else {
        this.bus.emit({
          kind: 'tool-error',
          name: def.target,
          error: String(err),
        });
        return makeResult(
          false,
          JSON.stringify({ error: String(err) }),
          [],
          true
        );
      }
    }

    // afterToolCall middleware
    if (!this.pipeline.isEmpty) {
      const afterTc = await this.pipeline.runAfterToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args,
        result: result!,
      });
      if (afterTc?.result) result = afterTc.result;
    }

    this.bus.emit({ kind: 'tool-result', name: def.target, result: result! });

    // --- post_tool_call hook ---
    let hookHandoffTo: string | undefined;
    const postEntry = hooks.post.get(def.actionRef);
    if (postEntry && postEntry.actions.length > 0 && baseStepOpts) {
      this.bus.emit({
        kind: 'phase-start',
        node: this.currentNode,
        phase: 'post_tool_call',
      });
      const postOutcome = await runSteps(
        postEntry.actions as unknown as Step[],
        {
          ...baseStepOpts,
          toolResult: result!,
        }
      );
      this.bus.emit({
        kind: 'phase-end',
        node: this.currentNode,
        phase: 'post_tool_call',
      });
      if (postOutcome.handoffTo) hookHandoffTo = postOutcome.handoffTo;
    }

    // Collect state writes (deferred)
    const stateWrites: Array<[string, unknown]> = [];
    if (def.stateUpdates) {
      const resultScope = makeScope(this.state, result!);
      for (const entry of def.stateUpdates) {
        for (const [name, raw] of Object.entries(entry)) {
          stateWrites.push([name, evalBoundValue(raw, resultScope)]);
        }
      }
    }

    return makeResult(
      endSession,
      JSON.stringify(result),
      stateWrites,
      false,
      hookHandoffTo
    );
  }

  /**
   * Preflight a step's tool calls: partition them into `valid` (dispatch as
   * usual) and `rejected` (emit a synthetic error, do not run). A call is
   * rejected when its arguments failed to parse from the model's raw output
   * (`parseFailed` — typically truncated JSON that collapsed to `{}`) or when
   * they violate the tool's input schema. Unknown tools are left for
   * `dispatchToolCall` to report, so its existing "unknown tool" path and the
   * describe-missing behavior stay in one place.
   */
  private preflightToolCalls(
    turn: {
      toolCalls: ToolCall[];
      toolCallsWithFlags: Array<{ call: ToolCall; parseFailed: boolean }>;
    },
    tools: Array<ToolDef & { target: string; bound?: Record<string, unknown> }>
  ): {
    valid: ToolCall[];
    rejected: Array<{ call: ToolCall; reason: string }>;
  } {
    const parseFailedFor = new Map<ToolCall, boolean>();
    for (const { call, parseFailed } of turn.toolCallsWithFlags) {
      parseFailedFor.set(call, parseFailed);
    }

    const valid: ToolCall[] = [];
    const rejected: Array<{ call: ToolCall; reason: string }> = [];
    for (const call of turn.toolCalls) {
      if (parseFailedFor.get(call)) {
        rejected.push({
          call,
          reason:
            `The arguments for tool "${call.name}" could not be parsed as JSON ` +
            '(they may have been truncated). Re-issue the call with complete, ' +
            'valid JSON arguments.',
        });
        continue;
      }
      const def = tools.find(t => t.name === call.name);
      // Leave unknown tools to dispatchToolCall's own handling.
      if (def?.inputSchema) {
        // Compiler-bound inputs are supplied by the runtime, not the model, so
        // they must not count as "missing" — drop them from `required` before
        // validating the model's arguments.
        const schema = this.schemaWithoutBound(def.inputSchema, def.bound);
        const problem = validateToolArgs(schema, call.arguments);
        if (problem) {
          rejected.push({
            call,
            reason: `Invalid arguments for tool "${call.name}": ${problem}`,
          });
          continue;
        }
      }
      valid.push(call);
    }
    return { valid, rejected };
  }

  /**
   * Return a copy of `schema` with any compiler-bound parameter names removed
   * from its `required` list. Those inputs are filled by the runtime from
   * `bound_inputs`, so the model is not expected to provide them and their
   * absence from the model's arguments must not fail validation.
   */
  private schemaWithoutBound(
    schema: unknown,
    bound?: Record<string, unknown>
  ): unknown {
    if (!bound || Object.keys(bound).length === 0) return schema;
    if (!schema || typeof schema !== 'object') return schema;
    const s = schema as { required?: string[] };
    if (!Array.isArray(s.required)) return schema;
    const boundKeys = new Set(Object.keys(bound));
    const required = s.required.filter(k => !boundKeys.has(k));
    return { ...s, required };
  }

  private async dispatchToolCall(
    call: ToolCall,
    tools: Array<
      ToolDef & {
        actionRef: string;
        target: string;
        bound?: Record<string, unknown>;
        stateUpdates?: Array<Record<string, unknown>> | null;
        requireConfirmation?: boolean;
      }
    >,
    hooks: ToolHookMaps,
    signal?: AbortSignal,
    baseStepOpts?: StepRunOptions
  ): Promise<{ endSession: boolean; forceStop?: boolean; handoffTo?: string }> {
    const def = tools.find(t => t.name === call.name);
    if (!def) {
      this.bus.emit({
        kind: 'tool-error',
        name: call.name,
        error: 'unknown tool',
      });
      this.history.push({
        role: 'tool',
        tool_call_id: call.id,
        tool_name: call.name,
        content: JSON.stringify({ error: 'unknown tool' }),
      });
      return { endSession: false };
    }

    // Per-tool usage limit check
    if (this.opts.toolLimits) {
      const limit = this.opts.toolLimits[call.name];
      if (limit) {
        const count = this.toolCallCounts.get(call.name) ?? 0;
        if (count >= limit.maxCalls) {
          this.bus.emit({
            kind: 'tool-limit-reached',
            name: call.name,
            limit: limit.maxCalls,
          });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: call.name,
            content: JSON.stringify({
              error: `Tool "${call.name}" has reached its usage limit of ${limit.maxCalls} calls. Choose a different approach.`,
            }),
          });
          return { endSession: false };
        }
      }
    }

    // --- pre_tool_call hook ---
    // Agent-authored IR-level intent, same family as before_reasoning: runs
    // before beforeToolCall middleware ever sees this call, so a handoff here
    // pre-empts both the tool invocation and host policy/middleware entirely.
    const preEntry = hooks.pre.get(def.actionRef);
    if (preEntry && preEntry.actions.length > 0 && baseStepOpts) {
      this.bus.emit({
        kind: 'phase-start',
        node: this.currentNode,
        phase: 'pre_tool_call',
      });
      const preOutcome = await runSteps(
        preEntry.actions as unknown as Step[],
        baseStepOpts
      );
      this.bus.emit({
        kind: 'phase-end',
        node: this.currentNode,
        phase: 'pre_tool_call',
      });
      if (preOutcome.handoffTo) {
        return { endSession: false, handoffTo: preOutcome.handoffTo };
      }
    }

    // Merge compiler-bound args (expression strings that need evaluating)
    // with LLM-provided args (already literal). Only the bound half goes
    // through the expression evaluator.
    const scope = makeScope(this.state);
    const boundEvaluated: Record<string, unknown> = {};
    if (def.bound) {
      for (const [k, raw] of Object.entries(def.bound)) {
        boundEvaluated[k] = evalBoundValue(raw, scope);
      }
    }
    const args = { ...boundEvaluated, ...call.arguments };

    // --- beforeToolCall middleware hook ---
    if (!this.pipeline.isEmpty) {
      const beforeTc = await this.pipeline.runBeforeToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args: { ...args },
        toolCall: call,
        requireConfirmation: def.requireConfirmation,
      });
      if (beforeTc?.skip) return { endSession: false };
      if (beforeTc?.abort) {
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify(beforeTc.abort.result),
        });
        return { endSession: false };
      }
      if (beforeTc?.args) Object.assign(args, beforeTc.args);
    }

    this.bus.emit({ kind: 'tool-call', name: def.target, args });

    // Compiler-emitted sentinel targets:
    // - __state_update_action__    @utils.setVariables, transitions, if/set
    // - __end_session_action__     @utils.end_session
    // For these the LLM's arguments ARE the payload (there's no adapter
    // to call), and `end_session` additionally signals turn termination.
    let result: Record<string, unknown>;
    let endSession = false;
    if (def.target === '__state_update_action__') {
      result = args;
    } else if (def.target === '__end_session_action__') {
      result = args;
      endSession = true;
    } else if (def.target.startsWith('subagent://')) {
      // Background-subagent Task tools: list / output / stop / result / resume.
      // (A background *launch* is a normal delegate call with run_in_background;
      // see the delegate branch below.)
      const op = def.target.slice('subagent://'.length);
      result = await this.handleSubagentOp(op, args, signal);
    } else if (def.target.startsWith('swarm://')) {
      // Swarm fan-out: expand items+template into N isolated child runs, run
      // them bounded-concurrently, aggregate into one XML result. A runtime
      // sentinel (like delegate://) because it drives child loops.
      const swarmTarget = def.target.slice('swarm://'.length);
      try {
        result = await this.runSwarm(swarmTarget, args, signal);
      } catch (err) {
        // Expansion errors (bad items/template) are the model's to fix — hand
        // the message back as a tool result rather than aborting the turn.
        this.bus.emit({
          kind: 'tool-error',
          name: def.target,
          error: String(err),
        });
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify({
            error:
              err instanceof SwarmExpansionError ? err.message : String(err),
          }),
        });
        return { endSession: false };
      }
    } else if (
      def.target.startsWith('delegate://') ||
      def.target === '__delegate_action__'
    ) {
      // Delegation: call-return to a child node
      const nodeName = def.target.startsWith('delegate://')
        ? def.target.slice('delegate://'.length)
        : (args.node as string);
      const delegationContext = (args.context as string) ?? undefined;
      // A truthy `run_in_background` flag launches the child DETACHED (returning
      // a task handle immediately) instead of blocking the parent turn. Ignored
      // when no BackgroundTaskManager is wired — the delegation runs foreground.
      const wantsBackground =
        this.opts.background !== undefined && isTruthy(args.run_in_background);
      try {
        if (wantsBackground) {
          result = this.spawnBackground(
            nodeName,
            delegationContext,
            signal
          ) as unknown as Record<string, unknown>;
        } else {
          const delegationResult = await this.delegate(
            nodeName,
            delegationContext,
            signal
          );
          result = delegationResult as unknown as Record<string, unknown>;
        }
      } catch (err) {
        this.bus.emit({
          kind: 'tool-error',
          name: def.target,
          error: String(err),
        });
        this.history.push({
          role: 'tool',
          tool_call_id: call.id,
          tool_name: call.name,
          content: JSON.stringify({ error: String(err) }),
        });
        return { endSession: false };
      }
    } else {
      try {
        result = await this.opts.tools.invoke(def.target, args, { signal });
      } catch (err) {
        if (!this.pipeline.isEmpty) {
          const errorResult = await this.pipeline.runOnError({
            node: this.currentNode,
            state: this.state.snapshot(),
            error: err,
            phase: 'tool-call',
            toolName: call.name,
            target: def.target,
          });
          if (errorResult?.suppress && errorResult.fallbackResult) {
            result = errorResult.fallbackResult;
          } else if (errorResult?.suppress) {
            this.history.push({
              role: 'tool',
              tool_call_id: call.id,
              tool_name: call.name,
              content: JSON.stringify({}),
            });
            return { endSession: false };
          } else {
            this.bus.emit({
              kind: 'tool-error',
              name: def.target,
              error: String(err),
            });
            this.history.push({
              role: 'tool',
              tool_call_id: call.id,
              tool_name: call.name,
              content: JSON.stringify({ error: String(err) }),
            });
            return { endSession: false };
          }
        } else {
          this.bus.emit({
            kind: 'tool-error',
            name: def.target,
            error: String(err),
          });
          this.history.push({
            role: 'tool',
            tool_call_id: call.id,
            tool_name: call.name,
            content: JSON.stringify({ error: String(err) }),
          });
          return { endSession: false };
        }
      }
    }

    // --- afterToolCall middleware hook ---
    if (!this.pipeline.isEmpty) {
      const afterTc = await this.pipeline.runAfterToolCall({
        node: this.currentNode,
        state: this.state.snapshot(),
        target: def.target,
        toolName: call.name,
        args,
        result: result!,
      });
      if (afterTc?.result) result = afterTc.result;
    }

    this.bus.emit({ kind: 'tool-result', name: def.target, result: result! });

    // Increment per-tool usage counter after successful invocation
    this.toolCallCounts.set(
      call.name,
      (this.toolCallCounts.get(call.name) ?? 0) + 1
    );

    // --- post_tool_call hook ---
    // Runs after the tool result and afterToolCall middleware, before the
    // outer tool's own state_updates — `result.*` in the hook's actions
    // resolves against this call's result, same mechanism as the outer
    // tool's own state_updates below.
    let hookHandoffTo: string | undefined;
    const postEntry = hooks.post.get(def.actionRef);
    if (postEntry && postEntry.actions.length > 0 && baseStepOpts) {
      this.bus.emit({
        kind: 'phase-start',
        node: this.currentNode,
        phase: 'post_tool_call',
      });
      const postOutcome = await runSteps(
        postEntry.actions as unknown as Step[],
        {
          ...baseStepOpts,
          toolResult: result!,
        }
      );
      this.bus.emit({
        kind: 'phase-end',
        node: this.currentNode,
        phase: 'post_tool_call',
      });
      if (postOutcome.handoffTo) hookHandoffTo = postOutcome.handoffTo;
    }

    // Apply state_updates against the result (so `result.*` refs resolve).
    if (def.stateUpdates) {
      const resultScope = makeScope(this.state, result!);
      for (const entry of def.stateUpdates) {
        for (const [name, raw] of Object.entries(entry)) {
          this.state.set(name, evalBoundValue(raw, resultScope));
        }
      }
    }

    // Repeated-identical-tool-call guard (loop escape hatch, ported from the reference agent).
    // When the model keeps issuing the SAME (name, args) call, suffix the tool
    // result with an escalating <system-reminder>; past the ceiling, force the
    // turn to stop. Disabled via `toolLoopGuard: false`. State-update /
    // end-session sentinels are exempt — they are control flow, not a spin.
    let content = JSON.stringify(result);
    let forceStop = false;
    const guardEnabled = this.opts.toolLoopGuard !== false;
    const isControlSentinel =
      def.target === '__state_update_action__' ||
      def.target === '__end_session_action__';
    if (guardEnabled && !isControlSentinel) {
      const decision = this.toolDedup.note(call.name, args);
      if (decision.reminder !== null) {
        content += decision.reminder;
      }
      if (decision.action !== 'none') {
        this.bus.emit({
          kind: 'tool-call-repeat',
          name: call.name,
          streak: decision.streak,
          action: decision.action,
        });
      }
      forceStop = decision.forceStop;
    }

    this.history.push({
      role: 'tool',
      tool_call_id: call.id,
      tool_name: call.name,
      content,
    });

    if (endSession) {
      this.bus.emit({ kind: 'end-session' });
    }
    return { endSession, forceStop, handoffTo: hookHandoffTo };
  }

  /**
   * Pair every tool call from `from` onward with a synthetic error result, so a
   * multi-call assistant message that we abandon mid-batch (step-limit hit,
   * session ended, or force-stopped) still leaves a valid tool_calls ->
   * tool_result handshake in history. Without this, the trailing undispatched
   * calls are dangling `tool_call`s the provider rejects on the NEXT request
   * ("No tool output found for function call ...").
   */
  private flushUndispatchedToolResults(
    calls: ToolCall[],
    from: number,
    reason: string
  ): void {
    for (let i = from; i < calls.length; i += 1) {
      const call = calls[i]!;
      this.history.push({
        role: 'tool',
        tool_call_id: call.id,
        tool_name: call.name,
        content: JSON.stringify({ error: reason }),
        is_error: true,
      });
      this.bus.emit({
        kind: 'tool-result',
        name: call.name,
        result: { error: reason },
      });
    }
  }
}

/**
 * Coerce an LLM-supplied flag to a boolean. Models pass `true`, `"true"`, or
 * `1` interchangeably; treat any of them (case-insensitively) as truthy.
 */
function isTruthy(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return /^(true|1|yes)$/i.test(v.trim());
  return false;
}

/**
 * Combine one or more abort signals into a single derived signal that aborts as
 * soon as ANY input does. Used to chain a background task's stop/timeout signal
 * with the parent turn's signal (aborting the parent tears the child down too).
 * Ignores `undefined` inputs.
 */
function linkSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const live = signals.filter((s): s is AbortSignal => s !== undefined);
  const controller = new AbortController();
  for (const s of live) {
    if (s.aborted) {
      controller.abort(s.reason);
      return controller.signal;
    }
    s.addEventListener('abort', () => controller.abort(s.reason), {
      once: true,
    });
  }
  return controller.signal;
}

/**
 * Build `developer_name -> scheme://name` map from a node's action_definitions.
 * Same resolution logic used for tool-slot bindings and hook-invoked actions.
 */
function buildActionUriMap(node: SubAgentNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const def of node.action_definitions ?? []) {
    const d = def as unknown as {
      developer_name: string;
      invocation_target_type?: string;
      invocation_target_name?: string;
    };
    const scheme = d.invocation_target_type ?? 'fn';
    const path = d.invocation_target_name ?? d.developer_name;
    out.set(d.developer_name, `${scheme}://${path}`);
  }
  return out;
}

/**
 * Compiler schema for `pre_tool_call` — no `PreToolCall` type is exported by
 * `@agentscript/compiler` (only `PostToolCall` is), so this mirrors the
 * `{ target, actions }` shape locally. Compiler-dead today: no `.agent`
 * construct populates `pre_tool_call` yet.
 */
interface PreToolCallEntry {
  target: string;
  actions: Action[];
}

/** Per-node-entry lookup maps for pre_tool_call/post_tool_call hooks. */
interface ToolHookMaps {
  pre: Map<string, PreToolCallEntry>;
  post: Map<string, PostToolCall>;
}

/**
 * Build `target -> hook entry` map from a node's pre_tool_call/post_tool_call
 * list. `target` matches the tool's pre-resolution developer_name/actionRef
 * (same key space as buildActionUriMap's input side), not the resolved URI.
 */
function buildToolHookMap<T extends { target: string }>(
  entries: T[] | null | undefined
): Map<string, T> {
  const out = new Map<string, T>();
  for (const entry of entries ?? []) out.set(entry.target, entry);
  return out;
}

function buildToolHookMaps(node: SubAgentNode): ToolHookMaps {
  return {
    pre: buildToolHookMap(
      node.pre_tool_call as PreToolCallEntry[] | null | undefined
    ),
    post: buildToolHookMap(node.post_tool_call as PostToolCall[] | undefined),
  };
}

function stripInternal<T extends { target?: string }>(t: T): T {
  // Strip runtime-only fields before handing to the LLM driver.
  const { target: _target, ...rest } = t as unknown as {
    target?: string;
  } & Record<string, unknown>;
  void _target;
  return rest as T;
}

function inputSchemaFromParams(params: unknown): Record<string, unknown> {
  if (!Array.isArray(params)) return { type: 'object', properties: {} };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const raw of params) {
    const p = raw as {
      developer_name?: string;
      description?: string;
      data_type?: string;
      required?: boolean;
    };
    if (!p.developer_name) continue;
    const field: Record<string, unknown> = {
      type: dataTypeToJsonType(p.data_type),
    };
    if (p.description !== undefined) {
      field.description = p.description;
    }
    properties[p.developer_name] = field;
    if (p.required) required.push(p.developer_name);
  }
  return required.length
    ? { type: 'object', properties, required }
    : { type: 'object', properties };
}

function dataTypeToJsonType(t?: string): string {
  switch ((t ?? '').toLowerCase()) {
    case 'boolean':
      return 'boolean';
    case 'integer':
    case 'long':
      return 'integer';
    case 'double':
    case 'number':
      return 'number';
    default:
      return 'string';
  }
}
