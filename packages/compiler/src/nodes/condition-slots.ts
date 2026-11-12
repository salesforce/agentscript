/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Condition-slot allocation shared by the subagent `if` lowerings:
 * deterministic directives (compile-directives.ts) and post-tool-call
 * conditionals (compile-tool.ts).
 *
 * Both follow the workflow lowering (compile-workflow-node.ts): an `if`
 * stores its condition once, before either branch, in the slot for its
 * nesting depth, and its branches gate on that slot. An `else if` is an `if`
 * nested in the `else`, so it takes the next slot and is only evaluated when
 * the earlier conditions were false. Every guard starts with its enclosing
 * guards, so a sibling `if` can reuse a slot once the previous one finished.
 */
import type { CompilerContext } from '../compiler-context.js';
import type { Action } from '../types.js';
import { STATE_UPDATE_ACTION, conditionVariableName } from '../constants.js';

/** A condition slot allocated for one `if`. */
export interface ConditionSlot {
  /** 1-based slot index within the node. */
  index: number;
  /** Runtime state variable name, e.g. `AgentScriptInternal_condition_2`. */
  name: string;
}

/**
 * Allocate the next free slot (`ctx.nodeConditionSlotBase + 1`) for an `if`.
 * Call `declareConditionSlot` once the `if` emits a snapshot that writes it.
 */
export function allocateConditionSlot(ctx: CompilerContext): ConditionSlot {
  const index = ctx.nodeConditionSlotBase + 1;
  return { index, name: conditionVariableName(index) };
}

/**
 * Record that `slot` is written, so the agent_version assembler declares
 * `AgentScriptInternal_condition_1 .. _N` up to the deepest one used.
 */
export function declareConditionSlot(
  ctx: CompilerContext,
  slot: ConditionSlot
): void {
  ctx.maxConditionSlot = Math.max(ctx.maxConditionSlot, slot.index);
}

/**
 * A snapshot that evaluates `condition` as a bound input of the identity
 * state-update action and copies the echoed `result.condition` into `slot`.
 *
 * Post-tool-call actions need this form: their `state_updates` resolve
 * `result` against the state-update action's own output, while bound inputs
 * see the intercepted tool's result, so an `@outputs` condition only reads
 * the tool's output from a bound input. Workflows use it so the ActionNode
 * evaluates the condition strictly before either branch runs.
 */
export function conditionSnapshotAction(
  slotName: string,
  condition: string
): Action {
  return {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    bound_inputs: { condition },
    state_updates: [{ [slotName]: 'result.condition' }],
  };
}

/** The conjunction of the enclosing `if` guards, outermost first. */
export function joinConditions(conditions: readonly string[]): string {
  if (conditions.length === 1) return conditions[0];
  return conditions.map(c => `(${c})`).join(' and ');
}

/**
 * Reserve a conditional's slots against sibling reuse when it captured a file
 * reference: if `ctx.fileCapture.count` grew past `fileRefCountBefore` (sampled
 * before the conditional compiled), advance the per-node base past
 * `maxSlotIndex`. File-less conditionals leave the base untouched.
 *
 * TODO(setu-shah): Clean this up and fix conditionals generally
 */
export function advanceConditionSlotBaseIfFileGated(
  ctx: CompilerContext,
  fileRefCountBefore: number,
  maxSlotIndex: number
): void {
  if (ctx.fileCapture.count > fileRefCountBefore) {
    ctx.nodeConditionSlotBase = Math.max(
      ctx.nodeConditionSlotBase,
      maxSlotIndex
    );
  }
}

/**
 * Compile a conditional's branches with its slot (up to `maxSlotIndex`)
 * reserved, so a nested conditional — including an `else if` — allocates
 * above it instead of overwriting a slot the enclosing conditional still
 * reads: later siblings in the body and the `else` gate both read it.
 *
 * The base is restored afterwards so sequential sibling conditionals keep
 * reusing low slots, unless a nested file-gated conditional advanced it past
 * the reservation (see `advanceConditionSlotBaseIfFileGated`), which is kept.
 */
export function withReservedConditionSlots<T>(
  ctx: CompilerContext,
  maxSlotIndex: number,
  compileBodies: () => T
): T {
  const savedBase = ctx.nodeConditionSlotBase;
  const reservedBase = Math.max(savedBase, maxSlotIndex);
  ctx.nodeConditionSlotBase = reservedBase;
  const result = compileBodies();
  if (ctx.nodeConditionSlotBase === reservedBase) {
    ctx.nodeConditionSlotBase = savedBase;
  }
  return result;
}
