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
  WhenStatement,
  RenderStatement,
  ShowAndReturnStatement,
  BooleanLiteral,
  AtIdentifier,
  forEachExpressionChild,
  isAstNodeLike,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  Tool,
  PostToolCall,
  HandOffAction,
  Action,
  StateUpdate,
  RenderRule,
} from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import {
  decomposeAtMemberExpression,
  decomposeAtMemberChain,
} from '@agentscript/language';
import { toRange } from '@agentscript/types';
import { compileExpression } from '../expressions/compile-expression.js';
import { compileRenderInputBindings } from './compile-render-bindings.js';
import {
  extractSourcedString,
  extractSourcedDescription,
  resolveAtReference,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import {
  STATE_UPDATE_ACTION,
  TRANSITION_TARGET_NAMESPACES,
} from '../constants.js';
import {
  allocateConditionSlot,
  conditionSnapshotAction,
  declareConditionSlot,
  joinConditions,
  withReservedConditionSlots,
} from './condition-slots.js';
import {
  compileDeterministicRunInputs,
  resolveRunTarget,
} from './compile-run-inputs.js';
import {
  compileExecutionMode,
  compileRunExecutionMode,
} from './compile-execution-mode.js';

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

  // Tool.description is an explicit *override* of the underlying
  // ActionConfiguration.description (per DSL schema). For regular actions, only
  // emit it when the author supplied `description:` — otherwise leave it unset
  // so the runtime falls back to ActionConfiguration.description. A connected
  // agent has no ActionConfiguration to fall back to, so default its supervision
  // tool's description to the connected agent's authored description (populated
  // onto the input signature in compile-agent-version).
  const description =
    extractSourcedDescription(actionDef.description) ??
    (isConnectedAgent
      ? ctx.connectedAgentInputs.get(target)?.description
      : undefined);
  const alias = extractSourcedString(actionDef.label);
  const displayName = alias ?? name;

  // Parse body: separate with clauses (bound inputs) from set clauses (state updates)
  const boundInputs: Record<string, string> = {};
  const llmInputs: string[] = [];
  const inputClauses = new Map<string, WithClause>();
  const stateUpdates: StateUpdate[] = [];
  const postActions: Action[] = [];
  const handOffActions: HandOffAction[] = [];
  const renderRules: RenderRule[] = [];
  let enabledCondition: string | undefined;
  const nonBlockingBehavior = compileExecutionMode(actionDef.execution_mode);
  const fireAndForget = nonBlockingBehavior?.value === 'fire_and_forget';
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
      const result = compilePostActionConditional(stmt, [], ctx);
      postActions.push(...result.actions);
      handOffActions.push(...result.handOffs);
    } else if (stmt instanceof WhenStatement) {
      const rule = compileWhenConnection(stmt, ctx);
      if (rule && !fireAndForget) renderRules.push(rule);
    }
  }

  // Default unbound required declared inputs to LLM-filled.
  // Skip connected agents: they have a dedicated missing-required-input
  // warning path below and do not emit llm_inputs in the compiled tool.
  if (!isConnectedAgent) {
    setDefaultLlmInputs(target, boundInputs, llmInputs, ctx);
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
    // once the Agent Graph is updated. This is in the backlog for post-TDX as of 2026-03-31.
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
    ...(description !== undefined ? { description } : {}),
    ...(renderRules.length > 0 ? { render_rules: renderRules } : {}),
  };

  if (nonBlockingBehavior) {
    tool.non_blocking_behavior = nonBlockingBehavior;
  }

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
  const targetName = resolveRunTarget(stmt, ctx);
  if (!targetName) return undefined;

  // A nested `run` lowers into a post_tool_call action, which the runtime
  // executes deterministically (no LLM call). LLM-filled inputs therefore are
  // not supported here — only on the reasoning action itself. Reject them and
  // warn on missing required inputs; `llm_inputs` stays empty (the runtime
  // drops it on hook actions anyway, so auto-filling it just hid the problem).
  const { boundInputs, stateUpdates } = compileDeterministicRunInputs(
    stmt,
    targetName,
    ctx,
    ['variables', 'outputs']
  );

  const action: Sourceable<Action> = {
    type: 'action',
    target: targetName,
    bound_inputs: Object.keys(boundInputs).length > 0 ? boundInputs : {},
    llm_inputs: [],
    state_updates: stateUpdates,
  };
  const nonBlockingBehavior = compileRunExecutionMode(stmt, ctx);
  if (nonBlockingBehavior) action.non_blocking_behavior = nonBlockingBehavior;
  return ctx.track<Action>(action);
}

/**
 * Push every required declared input on `target`'s action_definition that is
 * neither bound nor already LLM-marked into `llmInputs`. Mirrors the slot-fill
 * default in the AgentFabric dialect compiler (build-nodes.ts), but limited to
 * required inputs so authors aren't forced to have the LLM fabricate values
 * for optional fields they didn't reference.
 */
export function setDefaultLlmInputs(
  target: string,
  boundInputs: Record<string, string>,
  llmInputs: string[],
  ctx: CompilerContext
): void {
  // Fall back to the preserved top-level action signatures: a node's own
  // `compileActionDefinitions` clears `actionInputSignatures`, so a reasoning
  // tool referencing an inherited `@actions.X` top-level action would otherwise
  // find no signature and emit empty `llm_inputs`.
  const sig =
    ctx.actionInputSignatures.get(target) ??
    ctx.topLevelActionSignatures.get(target);
  if (!sig) return;
  for (const name of sig.requiredInputs) {
    if (Object.prototype.hasOwnProperty.call(boundInputs, name)) continue;
    if (llmInputs.includes(name)) continue;
    llmInputs.push(name);
  }
}

/**
 * Compile a `when @connection.<surface>` block into a single RenderRule.
 *
 * Returns `undefined` when the block has no `render:` clause (also reported
 * as a lint error) or when a body clause fails validation.
 */
function compileWhenConnection(
  stmt: WhenStatement,
  ctx: CompilerContext
): RenderRule | undefined {
  if (!stmt.subject) return undefined;
  const surface = resolveAtReference(
    stmt.subject,
    'connection',
    ctx,
    'surface name'
  );
  if (!surface) return undefined;

  const renderStmts = stmt.body.filter(
    (s): s is RenderStatement => s instanceof RenderStatement
  );
  if (renderStmts.length === 0) {
    ctx.error(
      `'when @connection.${surface}' block requires a 'render:' clause`,
      stmt.__cst?.range
    );
    return undefined;
  }
  if (renderStmts.length > 1) {
    ctx.error(
      `'when @connection.${surface}' block has multiple 'render:' clauses; only one is allowed per connection block`,
      renderStmts[1].__cst?.range
    );
    return undefined;
  }

  const renderStmt = renderStmts[0];
  const renderValue = renderStmt.value;
  if (!renderValue) return undefined;
  const rendererName = resolveRendererRef(renderValue, ctx);
  if (!rendererName) return undefined;

  const showAndReturnStmts = renderStmt.body.filter(
    (s): s is ShowAndReturnStatement => s instanceof ShowAndReturnStatement
  );
  // The `show_and_return:` script keyword lowers to the DSL's `end_turn` field —
  // the compiler output intentionally keeps the original AgentJSON name.
  let endTurn = false;
  if (showAndReturnStmts.length > 0) {
    const v = showAndReturnStmts[showAndReturnStmts.length - 1].value;
    if (v instanceof BooleanLiteral) {
      endTurn = v.value;
    } else if (v) {
      ctx.error(
        "'show_and_return:' must be a Boolean literal (True or False)",
        v.__cst?.range
      );
    }
  }

  const rule: RenderRule = {
    surface_type: surface,
    response_format_name: rendererName,
    end_turn: endTurn,
  };
  // compile the renderRule bindings
  const inputBindings = compileRenderInputBindings(
    renderStmt,
    surface,
    rendererName,
    ctx
  );
  if (inputBindings) rule.input_bindings = inputBindings;
  return rule;
}

/**
 * Resolve a `render:` value against the `@response_formats.<name>` or
 * `@connection.<surface>.response_formats.<name>` shapes, returning the bare
 * name. Emits a compiler error if the expression is neither.
 *
 * `<name>` is either a reserved built-in (currently `json`) or a
 * user-declared format on the enclosing connection. The dialect lint pass
 * performs ownership, shape, and reserved-name checks; the compiler only
 * extracts the name here.
 */
function resolveRendererRef(
  expr: Expression,
  ctx: CompilerContext
): string | undefined {
  const decomposed = decomposeAtMemberExpression(expr);
  if (decomposed && decomposed.namespace === 'response_formats') {
    return decomposed.property;
  }
  const chain = decomposeAtMemberChain(expr);
  if (
    chain &&
    chain.namespace === 'connection' &&
    chain.path.length === 3 &&
    chain.path[1] === 'response_formats'
  ) {
    return chain.path[2];
  }
  ctx.error(
    "'render:' value must reference '@response_formats.<name>' or '@connection.<surface>.response_formats.<name>'",
    expr.__cst?.range
  );
  return undefined;
}

/**
 * Compile a post-action conditional (if [/ else if ...] [/ else]) into
 * post-tool-call actions, following the workflow lowering.
 *
 * `conditions` is the stack of enclosing `if` guards, outermost first. The
 * condition is stored once, before either branch, in the slot for this `if`'s
 * nesting depth, and both branches gate on the slot. An `else if` is an `if`
 * inside `orelse`: it takes the next slot, and its snapshot is gated on the
 * earlier conditions being false, so it is only evaluated when reached.
 *
 * The snapshot evaluates the condition as a bound input: post-tool-call
 * `state_updates` resolve `result` against the state-update action's own
 * output, so only a bound input sees the intercepted tool's `@outputs`.
 *
 * An `if` whose branches produce no actions emits no snapshot.
 */
function compilePostActionConditional(
  stmt: IfStatement,
  conditions: string[],
  ctx: CompilerContext
): { actions: Action[]; handOffs: HandOffAction[] } {
  const condition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' statement condition",
  });
  const slot = allocateConditionSlot(ctx);
  const slotRef = `state.${slot.name}`;

  const branches = withReservedConditionSlots(ctx, slot.index, () => {
    const body = compileConditionalBody(
      stmt.body,
      [...conditions, slotRef],
      ctx
    );
    const orelse = compileConditionalBody(
      stmt.orelse,
      [...conditions, `not (${slotRef})`],
      ctx
    );
    return {
      actions: [...body.actions, ...orelse.actions],
      handOffs: [...body.handOffs, ...orelse.handOffs],
    };
  });
  // Nothing reads the slot when neither branch produced an action.
  if (branches.actions.length === 0) return branches;

  declareConditionSlot(ctx, slot);
  const snapshot: Action = {
    ...conditionSnapshotAction(slot.name, condition),
    enabled: conditions.length > 0 ? joinConditions(conditions) : 'True',
  };
  return {
    actions: [snapshot, ...branches.actions],
    handOffs: branches.handOffs,
  };
}

/**
 * Compile the body of a conditional statement, gating each action on the
 * enclosing `conditions`.
 */
function compileConditionalBody(
  body: Statement[],
  conditions: string[],
  ctx: CompilerContext
): { actions: Action[]; handOffs: HandOffAction[] } {
  const actions: Action[] = [];
  const handOffs: HandOffAction[] = [];
  const enabledCondition = joinConditions(conditions);

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
        actions.push(
          compileConditionalSet(stmt, varName, enabledCondition, ctx)
        );
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
      // Nested if (including an `else if`): its actions carry the full guard.
      const nestedResult = compilePostActionConditional(stmt, conditions, ctx);
      actions.push(...nestedResult.actions);
      handOffs.push(...nestedResult.handOffs);
    }
  }

  return { actions, handOffs };
}

/**
 * Compile a `set` inside a post-tool-call conditional into its own
 * state-update action gated on `enabledCondition`.
 *
 * A value that reads `@outputs` is evaluated as a bound input, for the same
 * reason as the condition snapshot: this action's `state_updates` resolve
 * `result` against its own output, so only a bound input sees the intercepted
 * tool's result. Other values keep the direct `state_updates` form.
 */
function compileConditionalSet(
  stmt: SetClause,
  varName: string,
  enabledCondition: string,
  ctx: CompilerContext
): Action {
  const value = compileExpression(stmt.value, ctx, {
    expressionContext: "'set' clause",
  });
  if (!readsOutputs(stmt.value)) {
    return {
      type: 'action',
      target: STATE_UPDATE_ACTION,
      enabled: enabledCondition,
      state_updates: [{ [varName]: value }],
    };
  }
  return {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    enabled: enabledCondition,
    bound_inputs: { value },
    state_updates: [{ [varName]: 'result.value' }],
  };
}

/** Whether `expr` references `@outputs` anywhere. */
function readsOutputs(expr: unknown): boolean {
  if (expr instanceof AtIdentifier) return expr.name === 'outputs';
  if (!isAstNodeLike(expr)) return false;
  let found = false;
  forEachExpressionChild(expr, child => {
    found ||= readsOutputs(child);
  });
  return found;
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
