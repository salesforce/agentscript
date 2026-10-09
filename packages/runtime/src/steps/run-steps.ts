/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { StateStore } from '../state/store.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { EventBus } from '../events/types.js';
import { evalExpr, type EvalScope } from '../expr/eval.js';
import { isTemplate, renderTemplate } from '../template/render.js';

/**
 * Runtime representation of a single step from the IR. Mirrors the Zod
 * schemas for `action` and `handOffAction` but keeps only what the runtime
 * actually reads.
 */
interface ActionStep {
  type?: 'action';
  target: string;
  enabled?: unknown;
  bound_inputs?: Record<string, unknown> | null;
  state_updates?: Array<Record<string, unknown>> | null;
}

interface HandoffStep {
  type: 'handoff';
  target: string;
  enabled?: unknown;
  state_updates?: Array<Record<string, unknown>> | null;
}

export type Step = ActionStep | HandoffStep;

export interface StepRunOptions {
  state: StateStore;
  tools: ToolRegistry;
  bus: EventBus;
  /** Optional tool result to expose under `result.*` during state_updates. */
  toolResult?: Record<string, unknown>;
  /**
   * Resolves an action reference (developer_name, or already-schemed URI) to a
   * full `scheme://name` target for the tool registry. The compiler emits
   * tool-slot targets as developer_names; `action_definitions` carry the real
   * scheme. Hook-invoked actions go through the same resolver.
   */
  resolveTarget?: (ref: string) => string;
}

export interface StepRunOutcome {
  /** Set when a handoff fires — caller should transition. */
  handoffTo?: string;
  /** True when a handoff short-circuits remaining steps. */
  stopped: boolean;
}

/** Evaluate an `enabled` guard; missing/undefined guards are treated as true. */
export function isEnabled(enabled: unknown, scope: EvalScope): boolean {
  if (enabled === undefined || enabled === null || enabled === '') return true;
  if (typeof enabled === 'boolean') return enabled;
  if (typeof enabled === 'string') {
    const trimmed = enabled.trim();
    if (trimmed === 'True' || trimmed === 'true') return true;
    if (trimmed === 'False' || trimmed === 'false') return false;
    return Boolean(evalExpr(trimmed, scope));
  }
  return Boolean(enabled);
}

/** Build an eval scope that exposes state and (optionally) tool result. */
export function makeScope(
  state: StateStore,
  toolResult?: Record<string, unknown>
): EvalScope {
  return {
    resolve(name: string): unknown {
      if (name === 'state') return proxyState(state);
      if (name === 'result') return toolResult ?? {};
      return undefined;
    },
  };
}

function proxyState(state: StateStore): Record<string, unknown> {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop !== 'string') return undefined;
        return state.get(prop);
      },
      has(_t, prop) {
        return typeof prop === 'string' && state.snapshot()[prop] !== undefined;
      },
    }
  ) as Record<string, unknown>;
}

/**
 * Evaluate a bound-input or state-update payload value.
 *
 * The compiler emits these as **strings** that can be one of:
 *   - a template (`template::foo {{state.x}}`)
 *   - a quoted string literal (`"__EMPTY__"`, `'default'`)
 *   - a bare expression (`state.x`, `result.y`, `5 + 3`)
 *   - the empty string
 *
 * Non-string values (already-literal numbers/booleans/objects) pass through.
 */
export function evalBoundValue(raw: unknown, scope: EvalScope): unknown {
  if (typeof raw !== 'string') return raw;
  if (isTemplate(raw)) return renderTemplate(raw, scope);
  const trimmed = raw.trim();
  if (trimmed === '') return '';
  // Quoted string literal: unwrap directly.
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  try {
    return evalExpr(trimmed, scope);
  } catch {
    return raw;
  }
}

function applyStateUpdates(
  updates: Array<Record<string, unknown>> | null | undefined,
  opts: StepRunOptions,
  scope: EvalScope
): void {
  if (!updates) return;
  for (const entry of updates) {
    for (const [name, raw] of Object.entries(entry)) {
      opts.state.set(name, evalBoundValue(raw, scope));
    }
  }
}

/** Run one step. Used by ReAct loop for before_reasoning / post_tool_call / after_all_tool_calls. */
async function runStep(
  step: Step,
  opts: StepRunOptions
): Promise<StepRunOutcome> {
  const scope = makeScope(opts.state, opts.toolResult);

  if (!isEnabled(step.enabled, scope)) {
    return { stopped: false };
  }

  if (step.type === 'handoff') {
    applyStateUpdates(step.state_updates, opts, scope);
    opts.bus.emit({ kind: 'node-exit', node: '<current>', to: step.target });
    return { handoffTo: step.target, stopped: true };
  }

  // action step
  if (step.target === '__state_update_action__') {
    applyStateUpdates(step.state_updates, opts, scope);
    return { stopped: false };
  }

  // Resolve developer_name → full URI (if a resolver is provided); leaves
  // already-schemed targets untouched.
  const target = opts.resolveTarget
    ? opts.resolveTarget(step.target)
    : step.target;

  // Resolve bound_inputs against current scope (e.g. `state.loan_record_id`).
  const args: Record<string, unknown> = {};
  if (step.bound_inputs) {
    for (const [key, raw] of Object.entries(step.bound_inputs)) {
      args[key] = evalBoundValue(raw, scope);
    }
  }

  opts.bus.emit({ kind: 'tool-call', name: target, args });
  let result: Record<string, unknown>;
  try {
    result = await opts.tools.invoke(target, args);
  } catch (err) {
    opts.bus.emit({
      kind: 'tool-error',
      name: target,
      error: String(err),
    });
    throw err;
  }
  opts.bus.emit({ kind: 'tool-result', name: target, result });

  // State updates can reference `result.*` now.
  const resultScope = makeScope(opts.state, result);
  applyStateUpdates(step.state_updates, { ...opts }, resultScope);

  return { stopped: false };
}

/** Run a list of steps sequentially, honoring handoff short-circuit semantics. */
export async function runSteps(
  steps: Step[] | null | undefined,
  opts: StepRunOptions
): Promise<StepRunOutcome> {
  if (!steps) return { stopped: false };
  for (const step of steps) {
    const outcome = await runStep(step, opts);
    if (outcome.stopped) return outcome;
  }
  return { stopped: false };
}
