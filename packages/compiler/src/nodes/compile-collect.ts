/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement } from '@agentscript/language';
import { CollectClause, IfStatement } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Tool, HandOffAction, StateUpdate } from '../types.js';
import {
  STATE_UPDATE_ACTION,
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  NEXT_TOPIC_EMPTY_CONDITION,
} from '../constants.js';
import { resolveAtReference, extractStringValue } from '../ast-helpers.js';
import { stateVarToParameterDataType } from '../variables/variable-utils.js';
import type { Sourceable } from '../sourced.js';

/**
 * `collect` lowering helpers.
 *
 * A `collect @variables.X` + `message: M` statement inside reasoning.instructions
 * gathers field X from the user, one field at a time, resuming the subagent
 * across turns until every collected field is filled.
 *
 * Lowering, modeled on the design doc's desugared form, produces:
 *   1. Gather instruction — a guarded `if X is None`-style prompt (emitted by
 *      compile-directives.ts as instruction-append actions).
 *   2. Capture action — a single `@utils.setVariables`-style tool that writes
 *      the collected fields from the user's reply.
 *   3. Auto-resume handoff — a self-targeted, `end_turn_first` handoff gated so
 *      it only fires while the gather is incomplete (some field still None).
 */

/** The reasoning-action name of the synthesized capture tool for a subagent. */
export function captureActionName(topicName: string): string {
  return `capture_${topicName}_fields`;
}

/**
 * The reasoning-action name of the synthesized CANCEL tool for a subagent —
 * the mid-gather "change your mind / cancel / never mind" escape hatch.
 *
 * Mid-gather the user may abandon their original intent ("actually never mind",
 * "cancel", "forget it", "let's do X instead"). Without an escape the gather is
 * a trap: the resume handoff (see {@link buildResumeHandoff}) is a same-node
 * `end_turn_first` handoff gated purely on a field still being unfilled, so on
 * the deployed HTA reasoner it re-arms the SAME collecting node every turn and
 * overrides `reset_to_initial_node` — the user can never leave until every
 * field is filled. This tool lets the model break that loop by routing back to
 * the graph's initial node (the router), exactly as a normal
 * `@utils.transition` does (it writes `next_topic`), so the new request is then
 * handled normally.
 */
export function cancelActionName(topicName: string): string {
  return `cancel_${topicName}_collect`;
}

/** Extract the variable name a collect statement targets (e.g. `patient_city`). */
export function resolveCollectTarget(
  stmt: CollectClause,
  ctx: CompilerContext
): string | undefined {
  return resolveAtReference(stmt.target, 'variables', ctx, 'collect target');
}

/**
 * The verbatim prompt text from a collect statement's `message:` field.
 *
 * Handles both a quoted string literal (`message: "…"`) and a `|` pipe
 * template (`message: |` with indented multi-line content). Template values
 * are already dedented and cleaned at parse time, so `extractStringValue`
 * returns their content directly.
 */
export function collectMessageText(stmt: CollectClause): string {
  return extractStringValue(stmt.message) ?? '';
}

/**
 * A single step in a subagent's collect gather sequence.
 *
 * - A top-level `collect` (not wrapped in an `if`) is its own step with a single
 *   target and `branch === false`.
 * - A run of consecutive if-wrapped `collect`s forms one BRANCH-GROUP step
 *   (`branch === true`) whose `targets` are sibling branches. Branch siblings
 *   are mutually exclusive at runtime, so a branch step is "complete" once ANY
 *   of its targets is filled and "incomplete" only while ALL are unfilled.
 */
export interface CollectStep {
  targets: string[];
  branch: boolean;
}

/**
 * Walk reasoning instructions in source order and group `collect` statements
 * into ordered gather steps with branch structure (see {@link CollectStep}).
 *
 * Top-level collects become single-target steps; consecutive `if`-wrapped
 * collects coalesce into one branch-group step (e.g. `if pref=="email": collect
 * email` followed by `if pref=="phone": collect phone` → one branch group with
 * targets `[email, phone]`). This model is the single source of truth shared by
 * the gather-prose guards, the capture tool, and the auto-resume gate so the
 * three always agree on the field set.
 */
export function collectStepsFromStatements(
  statements: Statement[] | undefined,
  ctx: CompilerContext
): CollectStep[] {
  const steps: CollectStep[] = [];
  if (!statements) return steps;

  // The branch group currently being accumulated from a run of consecutive
  // if-wrapped collects, or null when the previous statement was not an
  // if-wrapped collect.
  let pendingBranch: CollectStep | null = null;
  const flushBranch = (): void => {
    if (pendingBranch && pendingBranch.targets.length > 0) {
      steps.push(pendingBranch);
    }
    pendingBranch = null;
  };

  for (const stmt of statements) {
    if (stmt instanceof CollectClause) {
      flushBranch();
      const name = resolveCollectTarget(stmt, ctx);
      if (name) steps.push({ targets: [name], branch: false });
      continue;
    }
    if (stmt instanceof IfStatement) {
      const branchTargets = collectTargetsInBranch(stmt, ctx);
      if (branchTargets.length > 0) {
        if (!pendingBranch) pendingBranch = { targets: [], branch: true };
        for (const t of branchTargets) {
          if (!pendingBranch.targets.includes(t)) pendingBranch.targets.push(t);
        }
        continue;
      }
    }
    // Any other statement breaks an in-progress branch run.
    flushBranch();
  }
  flushBranch();

  return steps;
}

/** Collect (in source order) the targets of all collects directly inside an
 * if's then/else bodies. */
function collectTargetsInBranch(
  stmt: IfStatement,
  ctx: CompilerContext
): string[] {
  const out: string[] = [];
  for (const child of [...stmt.body, ...stmt.orelse]) {
    if (child instanceof CollectClause) {
      const name = resolveCollectTarget(child, ctx);
      if (name && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** Flat union of every collect target (top-level AND nested), in source order
 * without duplicates. Used to build the shared capture tool. */
export function findAllCollectTargets(
  statements: Statement[] | undefined,
  ctx: CompilerContext
): string[] {
  const out: string[] = [];
  for (const step of collectStepsFromStatements(statements, ctx)) {
    for (const t of step.targets) {
      if (!out.includes(t)) out.push(t);
    }
  }
  return out;
}

/**
 * The runtime predicate that a step is COMPLETE (used as a prior-guard term).
 * Single-target steps: `state.X is not None`. Branch groups: any branch filled,
 * `(state.A is not None or state.B is not None)` — parenthesized so it composes
 * safely when AND-ed with other prior guards.
 */
function stepCompletePredicate(step: CollectStep): string {
  const terms = step.targets.map(t => `state.${t} is not None`);
  if (terms.length === 1) return terms[0];
  return `(${joinRightAssociated(terms, 'or')})`;
}

/**
 * The runtime predicate that a step is INCOMPLETE (used in the resume gate).
 * Single-target steps: `state.X is None`. Branch groups: all branches unfilled,
 * `(state.A is None and state.B is None)`.
 */
function stepIncompletePredicate(step: CollectStep): string {
  const terms = step.targets.map(t => `state.${t} is None`);
  if (terms.length === 1) return terms[0];
  return `(${joinRightAssociated(terms, 'and')})`;
}

/**
 * Build a map from each collect target to the ORDERED LIST of branch-aware
 * "prior complete" predicates — one term per step that precedes the target's
 * step. Targets in the first step (no priors) map to an empty list. Sibling
 * branch targets share the same prior list (the steps before their branch
 * group), so a branch never gates on a mutually-exclusive sibling being filled.
 *
 * The list (rather than a pre-joined string) is returned so the gather-guard
 * builder can append the target's own `is None` term and right-associate the
 * WHOLE conjunction (`A and (B and C)`) per the runtime evaluator's
 * parenthesization requirement.
 */
export function buildPriorGuardByTarget(
  steps: CollectStep[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const priorTerms: string[] = [];
  for (const step of steps) {
    const guard = [...priorTerms];
    for (const t of step.targets) {
      map.set(t, guard);
    }
    priorTerms.push(stepCompletePredicate(step));
  }
  return map;
}

/**
 * Right-associate a list of operands under a binary operator, parenthesizing
 * the tail so that 3+ operand expressions read `A OP (B OP (C OP D))`. The
 * runtime evaluator requires explicit parens for 3+ operand expressions (the
 * compiler's expression emitter never auto-parenthesizes), and this matches the
 * only existing 3-operand `enabled` condition in the golden corpus
 * (`pronto_customer_support`: `A and (B and C)`). For 1 operand the operand is
 * returned as-is; for 2 it is `A OP B` (no parens needed).
 */
export function joinRightAssociated(operands: string[], op: string): string {
  if (operands.length === 0) return '';
  if (operands.length === 1) return operands[0];
  const [head, ...rest] = operands;
  const tail =
    rest.length === 1 ? rest[0] : `(${joinRightAssociated(rest, op)})`;
  return `${head} ${op} ${tail}`;
}

/**
 * Build the runtime condition that is true while the gather is INCOMPLETE,
 * i.e. at least one not-yet-satisfied step still has unfilled fields. Used to
 * gate the auto-resume handoff so it only fires mid-gather. Branch-group steps
 * are satisfied once ANY of their branch fields is filled (their incomplete
 * term ANDs the branch fields), and steps are OR-ed together. Right-associated
 * parens are emitted for 3+ operands per the runtime evaluator's requirement.
 */
export function buildIncompleteCondition(steps: CollectStep[]): string {
  return joinRightAssociated(steps.map(stepIncompletePredicate), 'or');
}

/**
 * Build the runtime condition that is true once the gather is COMPLETE, i.e.
 * every step is satisfied. This is the logical complement of
 * {@link buildIncompleteCondition}: a single-target step is complete when its
 * field is filled, a branch-group step is complete once ANY sibling is filled
 * (reusing {@link stepCompletePredicate}, which already parenthesizes a branch
 * group's OR). The per-step complete terms are AND-ed together, right-associated
 * for 3+ operands per the runtime evaluator's parenthesization requirement.
 *
 * Used to gate the terminal-turn STOP instruction (see compile-subagent-node)
 * so it fires only when no field-ask step is active and the resume-handoff
 * incomplete-gate is False — the two conditions truly partition (exactly one
 * holds in any state).
 */
export function buildCompleteCondition(steps: CollectStep[]): string {
  return joinRightAssociated(steps.map(stepCompletePredicate), 'and');
}

/**
 * Build the capture tool for a subagent's collect fields. Mirrors
 * compileSetVariables: each field becomes an LLM-filled input that is written
 * back to its state variable.
 *
 * Unlike @utils.setVariables (where the LLM fills every `with x=...` input in a
 * single call, so the tool result always contains every state-update key), a
 * collect gathers ONE field per turn: the gather prompt asks for just the next
 * unfilled field, so the LLM calls this capture tool with only that field. A
 * plain `result.<field>` state-update therefore raises a runtime SecurityError
 * the moment it evaluates a field absent from the partial result (the agent_dsl
 * expression evaluator rejects any key not present in the result dict).
 *
 * Each state-update is made PARTIAL-SAFE with a ternary guard:
 *   `result.<field> if "<field>" in result else state.<field>`
 * When the LLM supplies the field it is captured; when it does not, the field's
 * current state value is preserved (the field stays None until a later turn
 * gathers it). Persistence still flows exclusively through `state_updates`
 * (the runtime's __state_update_action__ returns the LLM inputs as its result
 * but only writes to state via update_state_by_result(state_updates, ...)), so
 * the state-updates must stay — they just must not assume every field is
 * present.
 */
export function buildCaptureTool(
  topicName: string,
  targets: string[],
  ctx: CompilerContext
): Tool {
  const stateUpdates: StateUpdate[] = targets.map(t => ({
    [t]: `result.${t} if "${t}" in result else state.${t}`,
  }));

  const tool: Sourceable<Tool> = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    state_updates: stateUpdates,
    name: captureActionName(topicName),
    description: 'Capture fields as the user provides them.',
    bound_inputs: {},
    llm_inputs: targets,
    input_parameters: targets.map(inputName => {
      const stateVar = ctx.stateVariables.find(
        v => v.developer_name === inputName
      );
      const dataType = stateVar
        ? stateVarToParameterDataType(stateVar.data_type)
        : ('String' as const);
      return {
        developer_name: inputName,
        label: inputName,
        data_type: dataType,
      };
    }),
  };

  return tool as Tool;
}

/**
 * Build the self-targeted, end-turn-first auto-resume handoff. It is gated on
 * the gather being incomplete so it does NOT fire once every field is filled —
 * yielding normal routing (and the first-turn / complete no-op) behavior.
 *
 * The gate is ALSO conjoined with "next_topic is still EMPTY" so that the
 * cancel tool (see {@link buildCancelTool}) can switch off this resume handoff:
 * when the user changes their mind mid-gather the model calls the cancel tool,
 * which writes `next_topic` to the router. On that turn next_topic is no longer
 * EMPTY, so this resume handoff no longer re-arms the collecting node — without
 * this term the incomplete-gate would still be True (the user never filled the
 * field) and the same-node resume would re-trap the user. With the gate off and
 * NO cancel handoff emitted, the turn simply ends on the collecting node (a
 * single acknowledgement message); the user's next message resets to the router
 * via reset_to_initial_node. We deliberately do NOT emit a different-node cancel
 * handoff because the deployed HTA reasoner ignores end_turn_first and would
 * transition (and emit a second closing message) in the same turn.
 */
export function buildResumeHandoff(
  topicName: string,
  steps: CollectStep[]
): HandOffAction {
  // Incomplete AND no pending transition. The incomplete condition is
  // parenthesized so its top-level `or` composes safely under the AND.
  const incomplete = buildIncompleteCondition(steps);
  return {
    type: 'handoff',
    target: topicName,
    enabled: `(${incomplete}) and ${NEXT_TOPIC_EMPTY_CONDITION}`,
    state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
    end_turn_first: true,
  };
}

/**
 * Build the CANCEL tool — the mid-gather change-of-intent escape hatch.
 *
 * Modeled on a `@utils.transition to <initial_node>`: it is a
 * `__state_update_action__` that writes the graph's initial node (the router)
 * into `next_topic`. The LLM is told (via gather prose, see
 * compile-directives.ts) to call this tool when the user wants to cancel,
 * change their mind, or do something else instead. It takes no inputs — it only
 * flips the routing target.
 *
 * Crucially, NO handoff is paired with this tool. The deployed HTA reasoner
 * ignores `end_turn_first`, so a different-node handoff would transition to the
 * router in the SAME turn and emit a second closing message (the change-of-intent
 * "double goodbye"). Instead, writing `next_topic` gates OFF the resume handoff
 * (see {@link buildResumeHandoff}, whose `enabled` ANDs in
 * {@link NEXT_TOPIC_EMPTY_CONDITION}), so the cancel turn fires no handoff at all
 * and ends cleanly on the collecting node with a single acknowledgement message.
 * Routing back to the router happens on the user's NEXT message via
 * `reset_to_initial_node_on_every_turn`, which unconditionally resets the current
 * agent to the initial node at the start of every request (it does not read
 * `next_topic`).
 */
export function buildCancelTool(topicName: string, initialNode: string): Tool {
  const tool: Sourceable<Tool> = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    state_updates: [{ [NEXT_TOPIC_VARIABLE]: `"${initialNode}"` }],
    name: cancelActionName(topicName),
    description:
      'Stop collecting and return to the start when the user changes their ' +
      'mind, cancels, says never mind, or asks for something else instead.',
    bound_inputs: {},
    llm_inputs: [],
    input_parameters: [],
  };
  return tool as Tool;
}

/**
 * Detect whether the builder authored their OWN trailing completion handling
 * AFTER the last collect-bearing statement in reasoning.instructions. When they
 * have, the deterministic completion handoff is suppressed so the builder's
 * intent (a closing message, an if-block, a transition) is respected rather than
 * pre-empted by a same-turn route back to the router.
 *
 * Detection signal (minimal + reliable): walk the source-ordered statement list
 * and find the index of the LAST statement that contributes a collect target
 * (either a top-level `collect` or an `if` whose body/else collects a field —
 * exactly the statements {@link collectStepsFromStatements} groups into steps).
 * If ANY statement appears after that index, the builder has authored trailing
 * content and we suppress. A trailing `if` that itself contains a collect is NOT
 * trailing content (it is part of the gather) — such an `if` advances the
 * "last collect" index and so does not trigger suppression.
 *
 * This reuses the same collect-recognition predicate the step walk uses, so the
 * two never disagree about where the gather ends.
 */
export function hasTrailingCompletionAfterCollect(
  statements: Statement[] | undefined,
  ctx: CompilerContext
): boolean {
  if (!statements || statements.length === 0) return false;

  let lastCollectIndex = -1;
  statements.forEach((stmt, index) => {
    if (statementContributesCollect(stmt, ctx)) {
      lastCollectIndex = index;
    }
  });

  if (lastCollectIndex < 0) return false;
  return lastCollectIndex < statements.length - 1;
}

/** True if a statement contributes a collect target — a top-level `collect` or
 * an `if` whose then/else bodies directly collect a field. Mirrors the
 * recognition used by {@link collectStepsFromStatements}. */
function statementContributesCollect(
  stmt: Statement,
  ctx: CompilerContext
): boolean {
  if (stmt instanceof CollectClause) {
    return resolveCollectTarget(stmt, ctx) !== undefined;
  }
  if (stmt instanceof IfStatement) {
    return collectTargetsInBranch(stmt, ctx).length > 0;
  }
  return false;
}
