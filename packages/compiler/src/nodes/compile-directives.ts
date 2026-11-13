/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement } from '@agentscript/language';
import {
  SetClause,
  ToClause,
  RunStatement,
  IfStatement,
  TransitionStatement,
  EscalateStatement,
  EndSessionStatement,
  CollectClause,
  Template,
  UnknownStatement,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Action, HandOffAction } from '../types.js';
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  NEXT_TOPIC_EMPTY_CONDITION,
  AGENT_INSTRUCTIONS_VARIABLE,
  TRANSITION_TARGET_NAMESPACES,
  EMPTY_ESCALATION_NODE_VALUE,
  ESCALATION_TARGET,
  END_SESSION_TARGET,
} from '../constants.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { resolveAtReference } from '../ast-helpers.js';
import {
  captureActionName,
  collectInstructionsText,
  resolveCollectTarget,
  joinRightAssociated,
  collectStepsFromStatements,
  buildPriorGuardByTarget,
} from './compile-collect.js';
import {
  allocateConditionSlot,
  declareConditionSlot,
  advanceConditionSlotBaseIfFileGated,
  withReservedConditionSlots,
} from './condition-slots.js';
import {
  optimizeDirectiveActions,
  instructionAppendValue,
  createStateUpdateAction,
  createInstructionResetAction,
} from './optimize-actions.js';
import {
  compileDeterministicRunInputs,
  resolveRunTarget,
} from './compile-run-inputs.js';
import { compileRunExecutionMode } from './compile-execution-mode.js';
import type { Sourceable } from '../sourced.js';

/**
 * Compile a list of deterministic directives (before_reasoning, after_reasoning,
 * procedural instructions) into one ordered list. Most directives emit only
 * Actions; `transition`, `escalate`, and `end_session` also emit a HandOffAction,
 * so the result genuinely mixes both kinds in source order.
 */
export function compileDeterministicDirectives(
  directives: Statement[],
  ctx: CompilerContext,
  options: DirectiveOptions = {}
): (Action | HandOffAction)[] {
  const {
    addNextTopicResetAction = true,
    gateOnNextTopicEmpty = true,
    agentInstructionsVariable,
    toolNames,
    actionDefinitionNames,
    endTurnFirst = false,
    topicName,
    handoffsDisallowedIn,
    enabled,
  } = options;

  const conditionStack = new ConditionStack();
  // Branch-aware "prior complete" guard per collect target. Built once from the
  // whole directive list so each collect's gather prompt gates on every PRIOR
  // STEP being satisfied — where sibling if-wrapped collects form one branch
  // group (a branch step is complete once ANY sibling is filled). This keeps the
  // gather-prose guards in agreement with the capture/resume side.
  const collectPriorGuards = buildPriorGuardByTarget(
    collectStepsFromStatements(directives, ctx)
  );
  const result: (Action | HandOffAction)[] = [];

  // Reset next_topic at the start if requested
  if (addNextTopicResetAction) {
    const resetAction = createStateUpdateAction(
      [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
      'True'
    );
    result.push(resetAction);
  }

  const dctx: DirectiveContext = {
    conditionStack,
    gateOnNextTopicEmpty,
    agentInstructionsVariable,
    toolNames,
    actionDefinitionNames,
    endTurnFirst,
    topicName,
    collectPriorGuards,
    handoffsDisallowedIn,
    enabled,
  };

  for (const directive of directives) {
    const actions = compileDirective(directive, ctx, dctx);
    result.push(...actions);
  }

  // When optimization is disabled, emit the pre-optimization graph: one action
  // per directive. The per-turn instruction reset is still REQUIRED lowering —
  // without it the agent-instructions template accumulates text across turns
  // instead of rebuilding each turn — so a standalone reset is still prepended
  // when directives append to the template.
  if (!ctx.optimize) {
    return agentInstructionsVariable
      ? [createInstructionResetAction(agentInstructionsVariable), ...result]
      : result;
  }

  // Otherwise (when enabled) inline single-read condition slots (optimization
  // 4b), fuse instruction appends, fold the per-turn reset into the first
  // unconditional append, and fuse adjacent same-gate state-update envelopes
  // (optimization 4a). See optimize-actions.ts for the full ordering contract.
  return optimizeDirectiveActions(result, {
    agentInstructionsVariable,
    inlineConditionSlots: ctx.inlineConditionSlots,
    fileReferenceGates: ctx.fileCapture.gates,
  });
}

export interface DirectiveOptions {
  addNextTopicResetAction?: boolean;
  gateOnNextTopicEmpty?: boolean;
  agentInstructionsVariable?: string;
  toolNames?: Set<string>;
  actionDefinitionNames?: Set<string>;
  /**
   * When true, transition directives emit handoffs with `end_turn_first` set so
   * the runtime ends the current turn and resumes at the target on the next user
   * message. Defaults to false, leaving handoffs unchanged.
   */
  endTurnFirst?: boolean;
  /** Owning subagent name — used to name a collect's capture action. */
  topicName?: string;
  /**
   * Set for procedures that can only hold actions (e.g. a custom subagent's
   * `on_exit`); names the procedure in diagnostics. Transition, escalate, and
   * end_session directives are then dropped whole — handoff and companion
   * state-update/end-session action alike — each with a warning. Dropping only
   * the handoff would leave the companion writing a stale `next_topic` or
   * ending the session.
   */
  handoffsDisallowedIn?: string;
  /** Condition ANDed into every action's `enabled`. */
  enabled?: string;
}

interface DirectiveContext {
  conditionStack: ConditionStack;
  gateOnNextTopicEmpty: boolean;
  enabled?: string;
  agentInstructionsVariable?: string;
  toolNames?: Set<string>;
  actionDefinitionNames?: Set<string>;
  endTurnFirst: boolean;
  topicName?: string;
  /**
   * Branch-aware "prior complete" predicates per collect target (one term per
   * prior gather STEP). Each collect gates its gather prompt on every prior step
   * being satisfied; sibling if-wrapped collects share the same prior list (the
   * steps before their branch group) so a branch never gates on a
   * mutually-exclusive sibling.
   */
  collectPriorGuards?: Map<string, string[]>;
  handoffsDisallowedIn?: string;
}

/** Keyword of a directive that compiles to a handoff, if `stmt` is one. */
function handoffKeyword(stmt: Statement): string | undefined {
  if (stmt instanceof TransitionStatement) return 'transition';
  if (stmt instanceof EscalateStatement) return 'escalate';
  if (stmt instanceof EndSessionStatement) return 'end_session';
  return undefined;
}

function compileDirective(
  stmt: Statement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const keyword = dctx.handoffsDisallowedIn && handoffKeyword(stmt);
  if (keyword) {
    ctx.warning(
      `\`${keyword}\` in ${dctx.handoffsDisallowedIn} was dropped: it only runs actions.`,
      stmt.__cst?.range,
      'dropped-handoff'
    );
    return [];
  }
  if (stmt instanceof RunStatement) {
    return compileRunDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof SetClause) {
    return compileSetDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof TransitionStatement) {
    return compileTransitionDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof EscalateStatement) {
    return compileEscalateDirective(dctx);
  }
  if (stmt instanceof EndSessionStatement) {
    return compileEndSessionDirective(ctx, dctx);
  }
  if (stmt instanceof CollectClause) {
    return compileCollectDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof IfStatement) {
    return compileIfDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof Template) {
    return compileTemplateDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof UnknownStatement) {
    // Already reported as a parse-time diagnostic — skip silently.
    return [];
  }

  ctx.warning(`Unsupported directive kind: ${stmt.__kind}`, stmt.__cst?.range);
  return [];
}

// ---------------------------------------------------------------------------
// Run statement (action call)
// ---------------------------------------------------------------------------

function compileRunDirective(
  stmt: RunStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): Action[] {
  const target = resolveRunTarget(stmt, ctx);
  if (!target) return [];

  // Deterministic run: reject LLM-filled inputs (they would land as a literal
  // `...` in bound_inputs and fail at runtime) and warn on missing required
  // inputs. `llm_inputs` stays empty — these runs never call the LLM.
  const { boundInputs, stateUpdates } = compileDeterministicRunInputs(
    stmt,
    target,
    ctx,
    'variables'
  );

  const enabled = buildEnabledCondition(dctx);

  const action: Sourceable<Action> = {
    type: 'action',
    target,
    bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    llm_inputs: [],
    state_updates: stateUpdates,
  };
  const nonBlockingBehavior = compileRunExecutionMode(stmt, ctx);
  if (nonBlockingBehavior) action.non_blocking_behavior = nonBlockingBehavior;
  if (enabled) {
    action.enabled = enabled;
  }

  return [ctx.track<Action>(action)];
}

// ---------------------------------------------------------------------------
// Set clause (variable assignment)
// ---------------------------------------------------------------------------

function compileSetDirective(
  stmt: SetClause,
  ctx: CompilerContext,
  dctx: DirectiveContext
): Action[] {
  const varName = resolveAtReference(
    stmt.target,
    'variables',
    ctx,
    'variable name'
  );
  if (!varName) return [];

  const compiledValue = compileExpression(stmt.value, ctx, {
    expressionContext: "'set' clause",
  });
  const enabled = buildEnabledCondition(dctx);

  const action = createStateUpdateAction(
    [{ [varName]: compiledValue }],
    enabled
  );
  return [action];
}

// ---------------------------------------------------------------------------
// Transition statement
// ---------------------------------------------------------------------------

function compileTransitionDirective(
  stmt: TransitionStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const result: (Action | HandOffAction)[] = [];

  for (const clause of stmt.clauses) {
    if (clause instanceof ToClause) {
      const targetName = resolveAtReference(
        clause.target,
        TRANSITION_TARGET_NAMESPACES,
        ctx,
        'transition target'
      );
      if (!targetName) continue;

      const enabled = buildEnabledCondition(dctx);

      // State update to set next_topic
      const stateAction = createStateUpdateAction(
        [{ [NEXT_TOPIC_VARIABLE]: `"${targetName}"` }],
        enabled
      );
      result.push(stateAction);

      // Handoff action
      const handoff: HandOffAction = {
        type: 'handoff',
        target: targetName,
        enabled: `state.${NEXT_TOPIC_VARIABLE}=="${targetName}"`,
        state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
      };
      if (dctx.endTurnFirst) {
        handoff.end_turn_first = true;
      }
      result.push(handoff);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Escalate statement
// ---------------------------------------------------------------------------

function compileEscalateDirective(
  dctx: DirectiveContext
): [Action, HandOffAction] {
  const enabled = buildEnabledCondition(dctx);
  return [
    createStateUpdateAction(
      [{ [NEXT_TOPIC_VARIABLE]: EMPTY_ESCALATION_NODE_VALUE }],
      enabled
    ),
    {
      type: 'handoff',
      target: ESCALATION_TARGET,
      enabled: `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`,
      state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
    },
  ];
}

// ---------------------------------------------------------------------------
// End session statement
// ---------------------------------------------------------------------------

/**
 * Compile a deterministic `end_session` statement.
 *
 * Emits two actions, mirroring the shape agreed with the runtime team:
 *
 *   1. An action targeting `__end_session_action__` — shaped like a state update
 *      but carrying only the synthetic target (no state_updates). This ends the
 *      session. `end_turn_first` is NOT a field on `action` in the agent-dsl
 *      schema, so it is not set here.
 *   2. A handoff with `end_turn_first: true` so a deterministic hook finishes the
 *      current turn and the session "just ends". The handoff target must be a
 *      valid node but is otherwise irrelevant (the session ends before the
 *      handoff resolves), so we use the current node, falling back to the start
 *      agent.
 *
 * When inside an `if` (or gated on next_topic being empty) the surrounding
 * condition is applied to both via `enabled`.
 */
function compileEndSessionDirective(
  ctx: CompilerContext,
  dctx: DirectiveContext
): [Action, HandOffAction] {
  const enabled = buildEnabledCondition(dctx);

  const action: Action = {
    type: 'action',
    target: END_SESSION_TARGET,
  };
  if (enabled) {
    action.enabled = enabled;
  }

  const handoff: HandOffAction = {
    type: 'handoff',
    target: dctx.topicName || ctx.initialNode || '',
    end_turn_first: true,
  };
  if (enabled) {
    handoff.enabled = enabled;
  }

  return [action, handoff];
}

// ---------------------------------------------------------------------------
// Collect statement (gather one field at a time)
// ---------------------------------------------------------------------------

function compileCollectDirective(
  stmt: CollectClause,
  ctx: CompilerContext,
  dctx: DirectiveContext
): Action[] {
  const varName = resolveCollectTarget(stmt, ctx);
  if (!varName) return [];

  const instructions = collectInstructionsText(stmt);
  const captureName = captureActionName(dctx.topicName ?? '');

  // Gate: ask for this field only once every PRIOR STEP is satisfied (chained
  // gather, branch-aware) and this field is still unset — idempotent re-entry.
  // The wrapping `if` predicate (if any) is AND-ed in separately via the
  // condition stack in buildEnabledCondition below.
  const priorGuards = dctx.collectPriorGuards?.get(varName) ?? [];
  const guardParts = [...priorGuards];
  guardParts.push(`state.${varName} is None`);
  // Right-associate for 3+ operands (`A and (B and C)`) per the runtime
  // evaluator's parenthesization requirement; 1-2 operands stay flat.
  const collectCondition = joinRightAssociated(guardParts, 'and');

  // Combine with any surrounding gate (e.g. next_topic-empty) the directive
  // context already requires.
  const baseEnabled = buildEnabledCondition(dctx);
  const enabled = baseEnabled
    ? `(${baseEnabled}) and (${collectCondition})`
    : collectCondition;

  // Gather prose: ask the user for the field using the author's instructions as
  // paraphrasable guidance (the agent composes the wording naturally — it is
  // NOT reproduced verbatim), then capture.
  // The capture tool is referenced by its BARE name, not the `{!@actions.X}`
  // AgentScript reference syntax. This prose is injected into a dynamic
  // `template::{{state.<agent_instructions>}}` state-update, which the runtime
  // only renders for `{{state.X}}` placeholders — it does NOT run the
  // action-reference resolver that the static `instructions` path uses. A
  // literal `{!@actions.X}` therefore reaches the LLM verbatim and confuses it
  // about which tool to call, causing it to skip the capture and re-ask the
  // same field (the "double-ask" loop). The bare name matches what the LLM
  // sees for the tool and resolves the double-ask.
  const prose =
    `Ask the user for ${varName}. ${instructions} ` +
    `When they answer, call ${captureName} with ${varName}.`;

  const varNameOut =
    dctx.agentInstructionsVariable ?? AGENT_INSTRUCTIONS_VARIABLE;
  const action = createStateUpdateAction(
    [{ [varNameOut]: instructionAppendValue(varNameOut, prose) }],
    enabled
  );

  return [action];
}

// ---------------------------------------------------------------------------
// If statement (conditional)
// ---------------------------------------------------------------------------

/**
 * Lower `if C: <body> else: <orelse>`, following the workflow lowering.
 *
 * `C` is stored once, before either branch, in the condition slot for this
 * `if`'s nesting depth, and both branches gate on the slot, so a branch that
 * changes a variable `C` reads cannot switch branches. An `else if` is an
 * `if` inside `orelse`: it takes the next slot, and its snapshot is gated on
 * the earlier conditions being false, so it is only evaluated when reached.
 *
 * The snapshot writes `C` directly in `state_updates`, unlike the workflow and
 * post-tool snapshots, which evaluate it as a bound input. Lifecycle-hook bound
 * inputs read missing keys as None, so moving `C` there would not make missing
 * keys stop execution.
 *
 * An `if` whose branches produce no actions emits no snapshot.
 */
function compileIfDirective(
  stmt: IfStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const fileRefCountBefore = ctx.fileCapture.count;
  const condition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' condition",
  });
  const slot = allocateConditionSlot(ctx);
  const slotRef = `state.${slot.name}`;

  const branches = withReservedConditionSlots(ctx, slot.index, () => [
    ...compileGatedDirectives(stmt.body, slotRef, 'positive', ctx, dctx),
    ...compileGatedDirectives(stmt.orelse, slotRef, 'negative', ctx, dctx),
  ]);
  advanceConditionSlotBaseIfFileGated(ctx, fileRefCountBefore, slot.index);
  // Nothing reads the slot when neither branch produced an action.
  if (branches.length === 0) return [];

  declareConditionSlot(ctx, slot);
  const snapshotEnabled =
    buildEnabledCondition(dctx) ??
    (dctx.agentInstructionsVariable ? 'True' : null);
  return [
    createStateUpdateAction([{ [slot.name]: condition }], snapshotEnabled),
    ...branches,
  ];
}

/** Compile `stmts` with `slotRef` pushed onto the condition stack as `type`. */
function compileGatedDirectives(
  stmts: Statement[],
  slotRef: string,
  type: ConditionType,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  if (stmts.length === 0) return [];
  dctx.conditionStack.push(slotRef, type);
  const result = stmts.flatMap(child => compileDirective(child, ctx, dctx));
  dctx.conditionStack.pop();
  return result;
}

// ---------------------------------------------------------------------------
// Template concatenation (instructions append)
// ---------------------------------------------------------------------------

function compileTemplateDirective(
  stmt: Template,
  ctx: CompilerContext,
  dctx: DirectiveContext
): Action[] {
  const enabled = buildEnabledCondition(dctx);
  ctx.fileCapture.pushCondition(enabled ?? undefined);
  const content = compileTemplateValue(stmt, ctx, {
    allowActionReferences: true,
  });
  ctx.fileCapture.popCondition();
  if (!content) return [];

  const varName = dctx.agentInstructionsVariable ?? AGENT_INSTRUCTIONS_VARIABLE;

  const action = createStateUpdateAction(
    [{ [varName]: instructionAppendValue(varName, content) }],
    enabled
  );
  return [action];
}

// ---------------------------------------------------------------------------
// Condition Stack
// ---------------------------------------------------------------------------

type ConditionType = 'positive' | 'negative';

/**
 * A single branch's gate component. The `expression` is the condition slot
 * read (e.g. `state.AgentScriptInternal_condition_1`); `type` decides whether
 * it's used directly (`if` body) or negated (`else`, including `else if`).
 */
interface ConditionEntry {
  type: ConditionType;
  expression: string;
}

class ConditionStack {
  private stack: ConditionEntry[] = [];

  push(expression: string, type: ConditionType): void {
    this.stack.push({ type, expression });
  }

  pop(): void {
    this.stack.pop();
  }

  get depth(): number {
    return this.stack.length;
  }

  /**
   * Get the combined current condition expression.
   * Returns undefined if no conditions are active.
   */
  get currentCondition(): string | undefined {
    if (this.stack.length === 0) return undefined;

    const parts = this.stack.map(entry =>
      entry.type === 'positive' ? entry.expression : `not (${entry.expression})`
    );

    if (parts.length === 1) return parts[0];
    return parts.map(p => `(${p})`).join(' and ');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildEnabledCondition(dctx: DirectiveContext): string | null {
  const parts: string[] = [];

  if (dctx.gateOnNextTopicEmpty) {
    parts.push(NEXT_TOPIC_EMPTY_CONDITION);
  }
  if (dctx.enabled) {
    parts.push(dctx.enabled);
  }

  const stackCondition = dctx.conditionStack.currentCondition;
  if (stackCondition) {
    parts.push(stackCondition);
  }

  if (parts.length === 0) {
    return null;
  }
  if (parts.length === 1) return parts[0];
  return parts.map(p => `(${p})`).join(' and ');
}
