/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement } from '@agentscript/language';
import {
  WithClause,
  SetClause,
  ToClause,
  RunStatement,
  IfStatement,
  TransitionStatement,
  CollectClause,
  Template,
  UnknownStatement,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Action, HandOffAction, StateUpdate } from '../types.js';
import {
  STATE_UPDATE_ACTION,
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  NEXT_TOPIC_EMPTY_CONDITION,
  AGENT_INSTRUCTIONS_VARIABLE,
  TRANSITION_TARGET_NAMESPACES,
  chainConditionVariableName,
} from '../constants.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { resolveAtReference } from '../ast-helpers.js';
import {
  captureActionName,
  collectMessageText,
  resolveCollectTarget,
  joinRightAssociated,
  collectStepsFromStatements,
  buildPriorGuardByTarget,
} from './compile-collect.js';
import { isElseIfChainHead, walkElseIfChain } from './else-if-chain.js';

/**
 * Compile a list of deterministic directives (before_reasoning, after_reasoning)
 * into Action[] and HandOffAction[].
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
  };

  for (const directive of directives) {
    const actions = compileDirective(directive, ctx, dctx);
    result.push(...actions);
  }

  // On the instruction-injection path, fuse adjacent same-gate instruction
  // appends (e.g. consecutive top-level `| ...` lines) into one state update.
  // The presence of `agentInstructionsVariable` is exactly the signal that
  // directives are appending to the agent-instructions template.
  if (agentInstructionsVariable) {
    return mergeAdjacentInstructionAppends(result, agentInstructionsVariable);
  }

  return result;
}

interface DirectiveOptions {
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
}

interface DirectiveContext {
  conditionStack: ConditionStack;
  gateOnNextTopicEmpty: boolean;
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
}

function compileDirective(
  stmt: Statement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  if (stmt instanceof RunStatement) {
    return compileRunDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof SetClause) {
    return compileSetDirective(stmt, ctx, dctx);
  }
  if (stmt instanceof TransitionStatement) {
    return compileTransitionDirective(stmt, ctx, dctx);
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
): (Action | HandOffAction)[] {
  const target = resolveAtReference(
    stmt.target,
    'actions',
    ctx,
    'action target'
  );
  if (!target) return [];

  const boundInputs: Record<string, string> = {};
  const stateUpdates: StateUpdate[] = [];

  for (const child of stmt.body) {
    if (child instanceof WithClause) {
      const compiledValue = compileExpression(child.value, ctx, {
        expressionContext: "'with' clause",
      });
      boundInputs[child.param] = compiledValue;
    } else if (child instanceof SetClause) {
      const varName = resolveAtReference(
        child.target,
        'variables',
        ctx,
        'variable name'
      );
      if (varName) {
        const compiledValue = compileExpression(child.value, ctx, {
          expressionContext: "'set' clause",
        });
        stateUpdates.push({ [varName]: compiledValue });
      }
    }
  }

  const enabled = buildEnabledCondition(dctx);

  const action: Action = {
    type: 'action',
    target,
    bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    llm_inputs: [],
    state_updates: stateUpdates,
  };
  if (enabled) {
    action.enabled = enabled;
  }

  return [action];
}

// ---------------------------------------------------------------------------
// Set clause (variable assignment)
// ---------------------------------------------------------------------------

function compileSetDirective(
  stmt: SetClause,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
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
// Collect statement (gather one field at a time)
// ---------------------------------------------------------------------------

function compileCollectDirective(
  stmt: CollectClause,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const varName = resolveCollectTarget(stmt, ctx);
  if (!varName) return [];

  const message = collectMessageText(stmt);
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

  // Gather prose: ask the user using the verbatim message, then capture.
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
    `Ask the user for ${varName}. ` +
    `Use exactly this message: "${message}" ` +
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

function compileIfDirective(
  stmt: IfStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  // Plain `if/else` (no chain links): use the shared
  // AgentScriptInternal_condition variable. Sequential plain ifs reuse the
  // same variable since each one writes before its body runs.
  if (!isElseIfChainHead(stmt)) {
    return compilePlainIfDirective(stmt, ctx, dctx);
  }

  // Chain (`if / else if [/ else if ...] [/ else]`): each link gets its own
  // suffixed variable (condition_1, condition_2, ...) so prior links'
  // negations stay stable when later links overwrite their own slots.
  return compileChainIfDirective(stmt, ctx, dctx);
}

/**
 * Compile a non-chain `if [/ else]`. Writes the compiled condition into
 * `AgentScriptInternal_condition_1` and gates the body / else off it.
 *
 * Sequential plain ifs reuse slot 1: each one writes before its body
 * executes and no later read crosses the boundary.
 */
function compilePlainIfDirective(
  stmt: IfStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const result: (Action | HandOffAction)[] = [];

  const condition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' condition",
  });

  const slotName = chainConditionVariableName(1);
  ctx.maxChainConditionSlot = Math.max(ctx.maxChainConditionSlot ?? 0, 1);

  const condEnabled =
    buildEnabledCondition(dctx) ??
    (dctx.agentInstructionsVariable ? 'True' : null);
  result.push(
    createStateUpdateAction([{ [slotName]: condition }], condEnabled)
  );

  // Warn about nested if+else — slot 1 is shared across plain ifs, so a real
  // nested if/else would overwrite the outer if's value before the outer's
  // else body reads it.
  if (dctx.conditionStack.depth > 0 && stmt.orelse.length > 0) {
    const range = stmt.condition.__cst?.range ?? stmt.__cst?.range;
    ctx.warning(
      'Nested if/else is not fully supported: the runtime uses a single condition variable, ' +
        'so the else branch may not evaluate correctly',
      range
    );
  }

  const condRef = `state.${slotName}`;
  dctx.conditionStack.push(condRef, 'positive');
  for (const child of stmt.body) {
    result.push(...compileDirective(child, ctx, dctx));
  }
  dctx.conditionStack.pop();

  if (stmt.orelse.length > 0) {
    dctx.conditionStack.push(condRef, 'negative');
    for (const child of stmt.orelse) {
      result.push(...compileDirective(child, ctx, dctx));
    }
    dctx.conditionStack.pop();
  }

  return result;
}

/**
 * Compile an `if [/ else if ...] [/ else]` chain. Each branch's condition is
 * stored into its own slot variable (`AgentScriptInternal_condition_1` for
 * the head, `_2`, `_3`, ... for chain links). This avoids the
 * single-variable overwrite problem: when later branches gate on prior
 * branches' negations, those reads still resolve to the original truth value.
 *
 * Slot indices reset to 1 at the start of each chain — multiple chains in
 * the same node reuse the same slots, which is safe because chains execute
 * sequentially. The compiler tracks the max index used across the agent so
 * the agent_version assembly can declare exactly the slots needed.
 */
function compileChainIfDirective(
  head: IfStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const result: (Action | HandOffAction)[] = [];
  const { branches, elseBody } = walkElseIfChain(head, ctx, "'if' condition");

  // For each branch: emit the condition-write action, then compile the body
  // with prior branches' slots negated and this branch's slot positive.
  for (let i = 0; i < branches.length; i++) {
    const b = branches[i];

    // Action: write this branch's condition into its slot. Gated on the
    // outer enabled condition (e.g. next_topic empty), since these slot
    // writes need to respect any surrounding gates.
    const writeEnabled =
      buildEnabledCondition(dctx) ??
      (dctx.agentInstructionsVariable ? 'True' : null);
    result.push(
      createStateUpdateAction([{ [b.slotName]: b.condition }], writeEnabled)
    );

    // Push prior branches' slot refs (negated) plus this branch's (positive).
    for (let j = 0; j < i; j++) {
      dctx.conditionStack.push(`state.${branches[j].slotName}`, 'negative');
    }
    dctx.conditionStack.push(`state.${b.slotName}`, 'positive');

    for (const child of b.body) {
      result.push(...compileDirective(child, ctx, dctx));
    }

    // Pop everything we just pushed (one positive + i negatives).
    for (let j = 0; j <= i; j++) {
      dctx.conditionStack.pop();
    }
  }

  // Trailing `else:` — gate is every chain slot negated.
  if (elseBody) {
    for (const b of branches) {
      dctx.conditionStack.push(`state.${b.slotName}`, 'negative');
    }
    for (const child of elseBody) {
      result.push(...compileDirective(child, ctx, dctx));
    }
    for (let i = 0; i < branches.length; i++) {
      dctx.conditionStack.pop();
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Template concatenation (instructions append)
// ---------------------------------------------------------------------------

function compileTemplateDirective(
  stmt: Template,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const content = compileTemplateValue(stmt, ctx, {
    allowActionReferences: true,
  });
  if (!content) return [];

  const varName = dctx.agentInstructionsVariable ?? AGENT_INSTRUCTIONS_VARIABLE;
  const enabled = buildEnabledCondition(dctx);

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
 * A single branch's gate component. The `expression` is the compiled source
 * boolean (e.g. `state.x == "a"`); `type` decides whether it's used directly
 * (positive branch) or negated (else / else-if-chain prior branches).
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

/**
 * The value written by an instruction-append state update: the running template
 * variable followed by the newline-prefixed appended `text`. Because each append
 * concatenates onto the previous value, this is the one place the wire format is
 * defined — both the directive constructors and the merge post-pass derive from
 * it so they cannot drift.
 */
function instructionAppendPrefix(varName: string): string {
  return `template::{{state.${varName}}}\n`;
}

export function instructionAppendValue(varName: string, text: string): string {
  return `${instructionAppendPrefix(varName)}${text}`;
}

/**
 * Merge adjacent instruction-append actions that share the same `enabled` gate
 * into a single append, so N consecutive ungated (or identically-gated) `| ...`
 * lines produce ONE state update instead of N.
 *
 * Only actions that append to `varName` (value shaped
 * `template::{{state.<var>}}\n<text>`) with an equal gate are fused; anything
 * else — the reset, condition sets, transitions, and oppositely-gated if/else
 * bodies — is a merge boundary and passes through untouched. Because each append
 * concatenates onto the running state value, fusing `\n<textA>` and `\n<textB>`
 * under one prefix yields byte-identical final state.
 */
function mergeAdjacentInstructionAppends(
  actions: (Action | HandOffAction)[],
  varName: string
): (Action | HandOffAction)[] {
  const prefix = instructionAppendPrefix(varName);

  // Returns the appended text (portion after the prefix) if `action` is a plain
  // single-key append to `varName`, else null (making it a merge boundary).
  const appendText = (action: Action | HandOffAction): string | null => {
    if (action.target !== STATE_UPDATE_ACTION) return null;
    const updates = (action as Action).state_updates;
    if (!updates || updates.length !== 1) return null;
    const update = updates[0];
    const keys = Object.keys(update);
    if (keys.length !== 1 || keys[0] !== varName) return null;
    const value = update[varName];
    if (typeof value !== 'string' || !value.startsWith(prefix)) return null;
    return value.slice(prefix.length);
  };

  const merged: (Action | HandOffAction)[] = [];
  let prevText: string | null = null;
  for (const action of actions) {
    const prev = merged[merged.length - 1];
    const text = appendText(action);
    // Same gate? (both ungated, or identical condition string)
    if (
      prev &&
      text !== null &&
      prevText !== null &&
      ((prev as Action).enabled ?? undefined) === (action.enabled ?? undefined)
    ) {
      prevText = `${prevText}\n${text}`;
      (prev as Action).state_updates = [
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

function buildEnabledCondition(dctx: DirectiveContext): string | null {
  const parts: string[] = [];

  if (dctx.gateOnNextTopicEmpty) {
    parts.push(NEXT_TOPIC_EMPTY_CONDITION);
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
