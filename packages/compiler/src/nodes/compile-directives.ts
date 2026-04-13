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
  RUNTIME_CONDITION_VARIABLE,
  TRANSITION_TARGET_NAMESPACES,
} from '../constants.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { resolveAtReference } from '../ast-helpers.js';
import { warnIfConnectedAgentTransition } from './compile-utils.js';

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
  } = options;

  const conditionStack = new ConditionStack();
  const result: (Action | HandOffAction)[] = [];

  // Reset next_topic at the start if requested
  if (addNextTopicResetAction) {
    const resetAction = createStateUpdateAction(
      [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
      'True'
    );
    result.push(resetAction);
  }

  for (const directive of directives) {
    const actions = compileDirective(directive, ctx, {
      conditionStack,
      gateOnNextTopicEmpty,
      agentInstructionsVariable,
      toolNames,
      actionDefinitionNames,
    });
    result.push(...actions);
  }

  return result;
}

interface DirectiveOptions {
  addNextTopicResetAction?: boolean;
  gateOnNextTopicEmpty?: boolean;
  agentInstructionsVariable?: string;
  toolNames?: Set<string>;
  actionDefinitionNames?: Set<string>;
}

interface DirectiveContext {
  conditionStack: ConditionStack;
  gateOnNextTopicEmpty: boolean;
  agentInstructionsVariable?: string;
  toolNames?: Set<string>;
  actionDefinitionNames?: Set<string>;
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
      if (warnIfConnectedAgentTransition(clause.target, ctx)) continue;
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
      result.push(handoff);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// If statement (conditional)
// ---------------------------------------------------------------------------

function compileIfDirective(
  stmt: IfStatement,
  ctx: CompilerContext,
  dctx: DirectiveContext
): (Action | HandOffAction)[] {
  const result: (Action | HandOffAction)[] = [];
  const condition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' condition",
  });

  // Store condition in runtime variable — always enabled (at least 'True')
  const condEnabled =
    buildEnabledCondition(dctx) ??
    (dctx.agentInstructionsVariable ? 'True' : null);
  const condAction = createStateUpdateAction(
    [{ [RUNTIME_CONDITION_VARIABLE]: condition }],
    condEnabled
  );
  result.push(condAction);

  // Warn about nested if+else — the runtime uses a single condition variable,
  // so nested conditions with else branches produce contradictory guards.
  if (dctx.conditionStack.depth > 0 && stmt.orelse.length > 0) {
    // Point to the condition expression, not the entire if block
    const range = stmt.condition.__cst?.range ?? stmt.__cst?.range;
    ctx.warning(
      'Nested if/else is not fully supported: the runtime uses a single condition variable, ' +
        'so the else branch may not evaluate correctly',
      range
    );
  }

  // Then branch
  dctx.conditionStack.push(condition, 'positive');
  for (const child of stmt.body) {
    result.push(...compileDirective(child, ctx, dctx));
  }
  dctx.conditionStack.pop();

  // Else branch
  if (stmt.orelse.length > 0) {
    dctx.conditionStack.push(condition, 'negative');
    for (const child of stmt.orelse) {
      result.push(...compileDirective(child, ctx, dctx));
    }
    dctx.conditionStack.pop();
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
    [
      {
        [varName]: `template::{{state.${varName}}}\n${content}`,
      },
    ],
    enabled
  );
  return [action];
}

// ---------------------------------------------------------------------------
// Condition Stack
// ---------------------------------------------------------------------------

type ConditionType = 'positive' | 'negative';

interface ConditionEntry {
  condition: string;
  type: ConditionType;
}

class ConditionStack {
  private stack: ConditionEntry[] = [];

  push(condition: string, type: ConditionType): void {
    this.stack.push({ condition, type });
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

    const parts = this.stack.map(entry => {
      if (entry.type === 'positive') {
        return `state.${RUNTIME_CONDITION_VARIABLE}`;
      }
      return `not (state.${RUNTIME_CONDITION_VARIABLE})`;
    });

    if (parts.length === 1) return parts[0];
    return parts.map(p => `(${p})`).join(' and ');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createStateUpdateAction(
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
