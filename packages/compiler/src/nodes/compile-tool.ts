/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement, Expression } from '@agentscript/language';
import {
  WithClause,
  SetClause,
  RunStatement,
  AvailableWhen,
  Ellipsis,
  IfStatement,
  TransitionStatement,
  ToClause,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  Tool,
  PostToolCall,
  HandOffAction,
  Action,
  StateUpdate,
} from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import { decomposeAtMemberExpression } from '@agentscript/language';
import { toRange } from '@agentscript/types';
import { compileExpression } from '../expressions/compile-expression.js';
import {
  extractSourcedString,
  extractSourcedDescription,
  resolveAtReference,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { normalizeDeveloperName } from '../utils.js';
import { TRANSITION_TARGET_NAMESPACES } from '../constants.js';
import { warnIfConnectedAgentTransition } from './compile-utils.js';

/**
 * Compile a single reasoning action (tool) from a topic's reasoning block.
 *
 * Returns: [Tool, optional PostToolCall, list of HandOffActions]
 */
export function compileTool(
  name: string,
  actionDef: ParsedTool,
  body: Statement[],
  ctx: CompilerContext
): CompileToolResult {
  // Resolve the target: if value is @actions.xxx or @connected_subagent.xxx,
  // use the referenced name as the tool target.
  let target = name;
  let isConnectedAgent = false;
  if (actionDef.value) {
    const decomposed = decomposeAtMemberExpression(actionDef.value);
    if (
      decomposed &&
      (decomposed.namespace === 'actions' ||
        decomposed.namespace === 'connected_subagent')
    ) {
      target = decomposed.property;
      isConnectedAgent = decomposed.namespace === 'connected_subagent';
    }
  }

  const description =
    extractSourcedDescription(actionDef.description) ??
    normalizeDeveloperName(name);
  const alias = extractSourcedString(actionDef.label);
  const displayName = alias ?? name;

  // Parse body: separate with clauses (bound inputs) from set clauses (state updates)
  const boundInputs: Record<string, string> = {};
  const llmInputs: string[] = [];
  const inputClauses = new Map<string, WithClause>();
  const stateUpdates: StateUpdate[] = [];
  const postActions: Action[] = [];
  const handOffActions: HandOffAction[] = [];
  let enabledCondition: string | undefined;
  for (const stmt of body) {
    if (stmt instanceof WithClause) {
      const compiledValue = compileExpression(stmt.value, ctx, {
        expressionContext: "'with' clause",
      });

      // Check if value is an ellipsis (means LLM fills it in)
      if (stmt.value instanceof Ellipsis) {
        llmInputs.push(stmt.param);
      } else {
        boundInputs[stmt.param] = compiledValue;
      }
      inputClauses.set(stmt.param, stmt);
    } else if (stmt instanceof SetClause) {
      const varName = resolveAtReference(
        stmt.target,
        ['variables', 'outputs'],
        ctx,
        'variable name'
      );
      if (varName) {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'set' clause",
        });
        stateUpdates.push({ [varName]: compiledValue });
      }
    } else if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause",
      });
    } else if (stmt instanceof RunStatement) {
      // Nested run statement becomes post-tool-call action
      const postAction = compilePostToolAction(stmt, ctx);
      if (postAction) {
        postActions.push(postAction);
      }
    } else if (stmt instanceof IfStatement) {
      // Post-action conditional - compile into post-tool-call actions
      const result = compilePostActionConditional(stmt, ctx);
      postActions.push(...result.actions);
      handOffActions.push(...result.handOffs);
    }
  }

  // Validate with clauses against connected agent input signatures
  if (actionDef.value) {
    const decomposed2 = decomposeAtMemberExpression(actionDef.value);
    if (decomposed2 && decomposed2.namespace === 'connected_subagent') {
      const sig = ctx.connectedAgentInputs.get(target);
      if (sig) {
        const providedInputs = new Set([
          ...Object.keys(boundInputs),
          ...llmInputs,
        ]);

        // Check for unknown inputs
        for (const inputName of providedInputs) {
          if (!sig.allInputs.has(inputName)) {
            // Point to the specific with clause that has the unknown input
            const clause = inputClauses.get(inputName);
            const range =
              (clause?.__paramCstNode
                ? toRange(clause.__paramCstNode)
                : clause?.__cst?.range) ?? actionDef.__cst?.range;
            ctx.warning(
              `Unknown input "${inputName}" on connected agent "${target}". Available inputs: ${[...sig.allInputs].join(', ') || '(none)'}`,
              range
            );
          }
        }

        // Check for missing required inputs (no default, not provided)
        for (const inputName of sig.allInputs) {
          if (
            !sig.inputsWithDefaults.has(inputName) &&
            !providedInputs.has(inputName)
          ) {
            // Point to the @connected_subagent.X reference, not the whole block
            const valueExpr = actionDef.value as Expression | undefined;
            const range = valueExpr?.__cst?.range ?? actionDef.__cst?.range;
            ctx.warning(
              `Missing required input "${inputName}" on connected agent "${target}". Provide it via a "with" clause or "..." for LLM-filled`,
              range
            );
          }
        }
      }
    }
  }

  const tool: Sourceable<Tool> = {
    type: isConnectedAgent ? 'supervision' : 'action',
    target,
    // TODO: Add connected agent tools to have bound_inputs/llm_inputs in the supervision definition
    // once the runtime specification supports it.
    // bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    // llm_inputs: llmInputs,
    // Only include bound_inputs and llm_inputs for non-connected-agent tools
    ...(isConnectedAgent
      ? {}
      : {
          bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
          llm_inputs: llmInputs,
        }),
    state_updates: stateUpdates,
    name: displayName,
    description,
  };

  if (enabledCondition) {
    tool.enabled = enabledCondition;
  }

  const postToolCall: PostToolCall | undefined =
    postActions.length > 0 ? { target, actions: postActions } : undefined;

  return {
    tool: tool as Tool,
    postToolCall,
    handOffActions,
  };
}

export interface CompileToolResult {
  tool: Tool;
  postToolCall?: PostToolCall;
  handOffActions: HandOffAction[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compilePostToolAction(
  stmt: RunStatement,
  ctx: CompilerContext
): Action | undefined {
  const targetName = resolveAtReference(
    stmt.target,
    'actions',
    ctx,
    'action target'
  );
  if (!targetName) return undefined;

  const boundInputs: Record<string, string> = {};
  const llmInputs: string[] = [];
  const stateUpdates: StateUpdate[] = [];

  for (const child of stmt.body) {
    if (child instanceof WithClause) {
      if (child.value instanceof Ellipsis) {
        llmInputs.push(child.param);
      } else {
        boundInputs[child.param] = compileExpression(child.value, ctx, {
          expressionContext: "'with' clause",
        });
      }
    } else if (child instanceof SetClause) {
      const varName = resolveAtReference(
        child.target,
        ['variables', 'outputs'],
        ctx,
        'variable name'
      );
      if (varName) {
        stateUpdates.push({
          [varName]: compileExpression(child.value, ctx, {
            expressionContext: "'set' clause",
          }),
        });
      }
    }
  }

  const action: Action = {
    type: 'action',
    target: targetName,
    bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    llm_inputs: llmInputs,
    state_updates: stateUpdates,
  };
  return action;
}

/**
 * Compile a post-action conditional (if statement) into post-tool-call actions.
 *
 * Pattern:
 * 1. Action to evaluate condition and store in AgentScriptInternal_condition
 * 2. Action to conditionally execute body, gated by AgentScriptInternal_condition
 * 3. If body contains transition, set AgentScriptInternal_next_topic and create handoff
 */
function compilePostActionConditional(
  stmt: IfStatement,
  ctx: CompilerContext
): { actions: Action[]; handOffs: HandOffAction[] } {
  const actions: Action[] = [];
  const handOffs: HandOffAction[] = [];

  // Compile the condition expression
  const compiledCondition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' statement condition",
  });

  // Action 1: Evaluate and store the condition
  const condAction: Action = {
    type: 'action',
    target: '__state_update_action__',
    enabled: 'True',
    state_updates: [
      {
        AgentScriptInternal_condition: compiledCondition,
      },
    ],
  };
  actions.push(condAction);

  // Process the body to find transitions and other statements
  const bodyResult = compileConditionalBody(
    stmt.body,
    'state.AgentScriptInternal_condition',
    ctx
  );
  actions.push(...bodyResult.actions);
  handOffs.push(...bodyResult.handOffs);

  // Handle else/elif branches
  if (stmt.orelse.length > 0) {
    const elseResult = compileConditionalBody(
      stmt.orelse,
      `not state.AgentScriptInternal_condition`,
      ctx
    );
    actions.push(...elseResult.actions);
    handOffs.push(...elseResult.handOffs);
  }

  return { actions, handOffs };
}

/**
 * Compile the body of a conditional statement.
 */
function compileConditionalBody(
  body: Statement[],
  enabledCondition: string,
  ctx: CompilerContext
): { actions: Action[]; handOffs: HandOffAction[] } {
  const actions: Action[] = [];
  const handOffs: HandOffAction[] = [];

  for (const stmt of body) {
    if (stmt instanceof TransitionStatement) {
      // Extract transition target
      const result = compileTransitionInConditional(
        stmt,
        enabledCondition,
        ctx
      );
      if (result) {
        actions.push(result.action);
        handOffs.push(result.handOff);
      }
    } else if (stmt instanceof SetClause) {
      // State update in conditional
      const varName = resolveAtReference(
        stmt.target,
        ['variables', 'outputs'],
        ctx,
        'variable name'
      );
      if (varName) {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'set' clause",
        });
        const setAction: Action = {
          type: 'action',
          target: '__state_update_action__',
          enabled: enabledCondition,
          state_updates: [{ [varName]: compiledValue }],
        };
        actions.push(setAction);
      }
    } else if (stmt instanceof RunStatement) {
      // Nested action call in conditional
      const postAction = compilePostToolAction(stmt, ctx);
      if (postAction) {
        const gatedAction: Action = {
          ...postAction,
          enabled: enabledCondition,
        };
        actions.push(gatedAction);
      }
    } else if (stmt instanceof IfStatement) {
      // Nested if statement - recursively compile
      const nestedResult = compilePostActionConditional(stmt, ctx);
      // Combine the nested condition with the parent condition
      const combinedActions = nestedResult.actions.map(action => ({
        ...action,
        enabled: action.enabled
          ? `(${enabledCondition}) and (${action.enabled})`
          : enabledCondition,
      }));
      actions.push(...combinedActions);
      handOffs.push(...nestedResult.handOffs);
    }
  }

  return { actions, handOffs };
}

/**
 * Compile a transition statement within a conditional.
 */
function compileTransitionInConditional(
  stmt: TransitionStatement,
  enabledCondition: string,
  ctx: CompilerContext
): { action: Action; handOff: HandOffAction } | undefined {
  // Extract the target topic from the transition statement
  // TransitionStatement contains clauses which should include ToClause
  for (const clause of stmt.clauses) {
    if (clause instanceof ToClause) {
      if (warnIfConnectedAgentTransition(clause.target, ctx)) continue;
      const targetTopicName = resolveAtReference(
        clause.target,
        TRANSITION_TARGET_NAMESPACES,
        ctx,
        'transition target'
      );
      if (!targetTopicName) continue;

      // Action: Set AgentScriptInternal_next_topic
      const action: Action = {
        type: 'action',
        target: '__state_update_action__',
        enabled: enabledCondition,
        state_updates: [
          {
            AgentScriptInternal_next_topic: `"${targetTopicName}"`,
          },
        ],
      };

      // HandOff: Perform the transition after all tools
      const handOff: HandOffAction = {
        type: 'handoff',
        target: targetTopicName,
        enabled: `state.AgentScriptInternal_next_topic=="${targetTopicName}"`,
        state_updates: [
          {
            AgentScriptInternal_next_topic: '"__EMPTY__"',
          },
        ],
      };

      return { action, handOff };
    }
  }

  return undefined;
}
