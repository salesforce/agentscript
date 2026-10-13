/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isAction } from '../types.js';
import type { Action, HandOffAction, StateUpdate } from '../types.js';
import type { DirectiveOptions } from './compile-directives.js';
import {
  STATE_UPDATE_ACTION,
  AGENT_INSTRUCTIONS_VARIABLE,
  RUNTIME_CONDITION_VARIABLE,
} from '../constants.js';

/**
 * The subset of `DirectiveOptions` the optimization pipeline reads. Declared as
 * a `Pick` so that adding an input the pipeline needs later widens this one type
 * instead of churning `optimizeDirectiveActions`'s signature and every caller.
 */
export type OptimizeDirectiveOptions = Pick<
  DirectiveOptions,
  'agentInstructionsVariable'
>;

/**
 * Directive-action optimization pipeline.
 *
 * `compileDeterministicDirectives` (in `compile-directives.ts`) emits one
 * `Action`/`HandOffAction` per directive, in source order. This module fuses
 * that flat sequence into fewer runtime envelopes without changing observable
 * behavior. `optimizeDirectiveActions` is the single entry point and fixes the
 * ordering contract — callers must not reorder or partially apply these
 * passes:
 *
 *   1. Instruction appends are fused: adjacent same-gate appends to the
 *      agent-instructions template variable (e.g. consecutive top-level
 *      `| ...` lines) collapse into one state update
 *      (`mergeAdjacentInstructionAppends`).
 *   2. The per-turn instruction reset (`var → ''`) is folded into the first
 *      unconditional append that survives step 1, saving one envelope per turn
 *      (`withInstructionReset` — the instruction-reset fold).
 *   3. Optimization 4a: adjacent state-update envelopes that share the same
 *      `enabled` gate are fused into one envelope carrying the concatenated
 *      `state_updates` (`mergeAdjacentStateUpdates`). This step runs
 *      unconditionally, not just on the instruction-injection path. Two kinds
 *      of entries are treated as hard merge boundaries and never fuse across:
 *      envelopes that write a runtime condition slot
 *      (`AgentScriptInternal_condition_<idx>`), and a later entry whose RHS
 *      reads `state.<key>` for a key an earlier (would-be-fused) entry writes
 *      — fusing that pair would turn a previously-safe read of committed state
 *      into an intra-envelope read-after-write. The shared `enabled` gate
 *      counts as such a read: a fused envelope evaluates it once, before any
 *      of its writes.
 *
 * Steps 1 and 2 only run when an `agentInstructionsVariable` is supplied —
 * its presence is exactly the signal that directives are appending to the
 * agent-instructions template. Step 3 always runs.
 *
 * This pass always optimizes; the caller decides whether to run it at all (see
 * `compileDeterministicDirectives`, which emits the pre-optimization graph
 * directly when optimization is disabled).
 */
export function optimizeDirectiveActions(
  actions: (Action | HandOffAction)[],
  options: OptimizeDirectiveOptions
): (Action | HandOffAction)[] {
  const { agentInstructionsVariable } = options;
  const appendMerged = agentInstructionsVariable
    ? withInstructionReset(
        mergeAdjacentInstructionAppends(actions, agentInstructionsVariable),
        agentInstructionsVariable
      )
    : actions;
  return mergeAdjacentStateUpdates(appendMerged);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wire format for an instruction-append state update: the running template
 * variable, a newline, then the appended `text`. Appends concatenate onto the
 * previous value each turn. Defined here once so the directive constructors and
 * the merge pass stay in sync.
 */
function instructionAppendPrefix(varName: string): string {
  return `template::{{state.${varName}}}\n`;
}

export function instructionAppendValue(varName: string, text: string): string {
  return `${instructionAppendPrefix(varName)}${text}`;
}

/**
 * The append value with the `{{state.<var>}}` self-reference dropped, leaving
 * `template::\n<text>`. Used when an unconditional reset (`var → ''`) directly
 * precedes the append: the reference is then known to be empty, so the reset and
 * append fold into one assignment. The leading newline is kept so the result
 * renders the same as the separate reset+append pair.
 */
export function instructionResetAppendValue(text: string): string {
  return `template::\n${text}`;
}

/**
 * If `action` is a single-key instruction append to `varName` (value shaped
 * `template::{{state.<var>}}\n<text>`), return the appended `<text>`; otherwise
 * null. Shared by the merge and fold passes so both recognize appends the same
 * way.
 */
function instructionAppendText(
  action: Action | HandOffAction,
  varName: string
): string | null {
  // Every STATE_UPDATE_ACTION entry is emitted with `type: 'action'`.
  if (!isAction(action) || action.target !== STATE_UPDATE_ACTION) return null;
  const updates = action.state_updates;
  if (!updates || updates.length !== 1) return null;
  const update = updates[0];
  const keys = Object.keys(update);
  if (keys.length !== 1 || keys[0] !== varName) return null;
  const value = update[varName];
  const prefix = instructionAppendPrefix(varName);
  if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
  return value.slice(prefix.length);
}

/** True when an action always runs — no gate, or the literal `'True'` gate. */
function isUnconditional(action: Action | HandOffAction): boolean {
  const enabled = action.enabled;
  return enabled === undefined || enabled === 'True';
}

/**
 * Prepend the per-turn instruction reset. When the first action is an
 * unconditional append, fold the reset into it instead: a reset (`var → ''`)
 * followed by an unconditional append (`var → template::{{state.var}}\n<text>`)
 * is equivalent to the single assignment `var → template::\n<text>`, saving one
 * Agent Graph envelope per turn.
 *
 * The fold only applies to an unconditional head. If the first append is gated
 * (or the head is not an append, or the list is empty), the standalone reset is
 * kept — it keeps the variable `''` on turns when the gate is false.
 */
function withInstructionReset(
  actions: (Action | HandOffAction)[],
  varName: string
): (Action | HandOffAction)[] {
  const head = actions[0];
  if (head && isUnconditional(head)) {
    const text = instructionAppendText(head, varName);
    if (text !== null) {
      const folded = createStateUpdateAction(
        [{ [varName]: instructionResetAppendValue(text) }],
        'True'
      );
      return [folded, ...actions.slice(1)];
    }
  }
  return [createInstructionResetAction(varName), ...actions];
}

/**
 * Merge adjacent instruction appends that share the same `enabled` gate, so N
 * consecutive same-gate `| ...` lines produce one state update instead of N.
 *
 * Only same-gate appends to `varName` are fused. Everything else — the reset,
 * condition sets, transitions, and oppositely-gated if/else bodies — is a merge
 * boundary and passes through untouched. Fusing is safe because each append
 * concatenates onto the running value, so joining the texts under one prefix
 * produces the same final state.
 */
function mergeAdjacentInstructionAppends(
  actions: (Action | HandOffAction)[],
  varName: string
): (Action | HandOffAction)[] {
  const merged: (Action | HandOffAction)[] = [];
  let prevText: string | null = null;
  for (const action of actions) {
    const prev = merged[merged.length - 1];
    const text = instructionAppendText(action, varName);
    // Same gate? (`isAction(prev)` always holds when prevText is set.)
    if (
      prev &&
      isAction(prev) &&
      text !== null &&
      prevText !== null &&
      (prev.enabled ?? undefined) === (action.enabled ?? undefined)
    ) {
      prevText = `${prevText}\n${text}`;
      prev.state_updates = [
        { [varName]: instructionAppendValue(varName, prevText) },
      ];
      continue;
    }
    merged.push(action);
    prevText = text;
  }
  return merged;
}

/**
 * Escape a string for literal use inside a `RegExp` constructor.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The set of variable names written by `updates`, i.e. the union of
 * `Object.keys()` across every entry.
 */
function writtenKeys(updates: StateUpdate[]): Set<string> {
  return new Set(updates.flatMap(update => Object.keys(update)));
}

/**
 * True if `updates` writes any runtime condition slot
 * (`AgentScriptInternal_condition_<idx>`). 4a treats any slot-writing envelope
 * as a hard merge boundary.
 *
 * NOTE: this is a deliberate conservatism, not a correctness requirement.
 * Fusing a slot write into a neighbouring same-gate envelope produces the
 * identical computed result on the happy path — the slot is committed before
 * the gated branch envelopes evaluate `state.<slot>` in both the fused and
 * unfused shapes (the RHS guard already rules out a fused sibling reading it).
 * We exclude slots for three weaker-but-real reasons:
 *   1. Contract stability — condition-slot evaluation is emitted as its own
 *      action and downstream consumers (and tests) rely on that shape.
 *   2. Failure isolation — keeping the slot separate stops a throwing gate
 *      expression from also taking down a co-located state write (the same
 *      per-envelope isolation caveat documented on `mergeAdjacentStateUpdates`,
 *      and observable only under the runtime's error semantics).
 *   3. Scope discipline — 4a exists to collapse redundant user state-updates,
 *      not control-flow scaffolding, for which the step saving is negligible.
 */
function writesConditionSlot(updates: StateUpdate[]): boolean {
  const prefix = `${RUNTIME_CONDITION_VARIABLE}_`;
  return [...writtenKeys(updates)].some(key => key.startsWith(prefix));
}

/**
 * True if any of `values` references `state.<key>` for one of `keys`, as a
 * whole identifier (so `state.counter` does not match a check for `counter2`).
 * `values` are expression or template strings: RHS values of state updates, or
 * an `enabled` gate. `StateUpdate` values are always strings, but non-string
 * values are skipped rather than assumed safe.
 *
 * INVARIANT: this detects a read only because the expression emitter always
 * renders a variable read in dot form — `state.<name>`, and `state.<name>[i]`
 * for subscripts (the trailing `\b` still anchors on the name). See
 * `compileExpression` in `expressions/compile-expression.ts`; the sole
 * `state[<expr>]` bracket form there is an unreachable error fallback. If the
 * emitter ever produced `state["<name>"]`, this guard would silently stop
 * detecting the read and 4a would wrongly fuse a read-after-write — so the
 * dot-form emission is pinned by a test in `expressions.test.ts`
 * ("read-after-write guard invariant").
 *
 * The `keys` are combined into one precompiled alternation regex per call
 * rather than one regex per (entry × value × key).
 */
function referencesAnyKey(
  values: Iterable<unknown>,
  keys: Set<string>
): boolean {
  if (keys.size === 0) return false;
  const pattern = new RegExp(
    `\\bstate\\.(?:${[...keys].map(escapeRegExp).join('|')})\\b`
  );
  for (const value of values) {
    if (typeof value === 'string' && pattern.test(value)) return true;
  }
  return false;
}

/**
 * Optimization 4a — fuse adjacent state-update envelopes that share the same
 * `enabled` gate into one envelope carrying the concatenated `state_updates`.
 *
 * Each enabled `__state_update_action__` is one runtime step, dispatched through
 * the async tool engine (a real thread-pool hand-off) before its variables are
 * written. The cost is per envelope, not per variable, so collapsing N adjacent
 * same-gate envelopes into one removes N-1 of those hand-offs.
 *
 * Fusing is only safe when the entries being combined are independent. If a
 * later entry's RHS reads `state.<K>` for a key `K` that an earlier entry in
 * the same (fused) envelope writes, concatenating them would turn a
 * previously-safe read of committed state (separate envelopes = separate
 * runtime steps with state committed between them) into an intra-envelope
 * read-after-write, whose result depends on `evaluate_state_updates` applying
 * entries left-to-right against live state rather than the prior committed
 * state. Rather than assume the runtime does that, this pass PREVENTS the
 * situation from arising: before fusing `action` into `prev`, it checks
 * whether any RHS in `action.state_updates` references a key already written
 * by `prev.state_updates` (recomputed each iteration, since `prev` may have
 * already absorbed earlier fusions). If so, `action` becomes a merge boundary
 * and is pushed separately instead. Independent updates fuse exactly as
 * before.
 *
 * The same check covers the shared gate. A fused envelope evaluates its gate
 * once, before any of its writes, whereas unfused the later envelope's gate is
 * re-evaluated after the earlier envelope commits. So if the gate reads
 * `state.<K>` for a key `K` that `prev` writes, `action` is a merge boundary
 * too.
 *
 * Only `__state_update_action__` actions fuse, and only when their gate strings
 * compare equal (both absent, or identical). A differing gate, a handoff (its
 * `target` is the destination node, not the synthetic action), an envelope that
 * writes a runtime condition slot (see `writesConditionSlot`), or any other
 * action is a boundary. Gates are NOT normalized — `'True'` is deliberately not
 * treated as equal to an absent gate — so output stays byte-compatible with the
 * shapes the individual emitters already produce.
 *
 * CAVEAT — behavioral change to confirm against the runtime: merging removes
 * per-envelope failure isolation. Today a `TypeError` in one envelope's
 * expression raises `StateUpdateEvalError` for that envelope only; once fused, a
 * bad expression also takes down the sibling updates merged with it. This is
 * only observable if the runtime continues to subsequent envelopes after a
 * `StateUpdateEvalError` rather than aborting the turn/node — a code path that
 * lives in the runtime repo and should be verified against the runtime before
 * relying on this in production.
 */
function mergeAdjacentStateUpdates(
  actions: (Action | HandOffAction)[]
): (Action | HandOffAction)[] {
  const merged: (Action | HandOffAction)[] = [];
  for (const action of actions) {
    const prev = merged[merged.length - 1];
    const prevWrites =
      prev?.state_updates && writtenKeys(prev.state_updates as StateUpdate[]);
    if (
      prev &&
      prev.target === STATE_UPDATE_ACTION &&
      action.target === STATE_UPDATE_ACTION &&
      (prev.enabled ?? undefined) === (action.enabled ?? undefined) &&
      prev.state_updates &&
      action.state_updates &&
      !writesConditionSlot(prev.state_updates as StateUpdate[]) &&
      !writesConditionSlot(action.state_updates as StateUpdate[]) &&
      prevWrites &&
      !referencesAnyKey(
        (action.state_updates as StateUpdate[]).flatMap(update =>
          Object.values(update)
        ),
        prevWrites
      ) &&
      !referencesAnyKey([action.enabled], prevWrites)
    ) {
      prev.state_updates = [
        ...(prev.state_updates as StateUpdate[]),
        ...(action.state_updates as StateUpdate[]),
      ];
      continue;
    }
    merged.push(action);
  }
  return merged;
}

/**
 * The per-turn reset that clears the agent-instructions template variable back
 * to `''` before appends re-accumulate it. Always enabled.
 */
export function createInstructionResetAction(
  varName: string = AGENT_INSTRUCTIONS_VARIABLE
): Action {
  return createStateUpdateAction([{ [varName]: "''" }], 'True');
}

export function createStateUpdateAction(
  stateUpdates: StateUpdate[],
  enabled?: string | null
): Action {
  const action: Action = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    enabled: enabled ?? undefined,
    state_updates: stateUpdates,
  };
  if (action.enabled === undefined) {
    delete action.enabled;
  }
  return action;
}
