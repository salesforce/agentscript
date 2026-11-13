/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  NamedMap,
  ParameterDeclarationNode,
  Statement,
} from '@agentscript/language';
import type { Range } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import {
  RUN_UTILS_CODE,
  analyzeActionIo,
  extractActionSignature,
  resolveWorkflowAction,
  runUtilsMessage,
  workflowDoReferenceError,
  workflowUnknownActionMessage,
} from '@agentscript/agentscript-dialect';
import {
  CollectClause,
  decomposeAtMemberExpression,
  EndSessionStatement,
  EscalateStatement,
  IfStatement,
  RunStatement,
  SayStatement,
  SetClause,
  Template,
  TemplateInterpolation,
  ToClause,
  TransitionStatement,
  UnknownStatement,
  WithClause,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  Action,
  HandOffAction,
  ModelConfiguration,
  StateUpdate,
  Tool,
  WorkflowAction,
  WorkflowDirective,
  WorkflowNode,
  WorkflowStep,
} from '../types.js';
import type { Sourceable } from '../sourced.js';
import type {
  ParsedSystem,
  ParsedTopicLike,
  ParsedWorkflowProcedure,
  ParsedWorkflowStep,
} from '../parsed-types.js';
import {
  ESCALATION_TARGET,
  STATE_UPDATE_ACTION,
  SYSTEM_INSTRUCTIONS_VARIABLE,
  TRANSITION_TARGET_NAMESPACES,
  workflowConditionVariableName,
} from '../constants.js';
import {
  extractDescriptionValue,
  extractSourcedString,
  iterateNamedMap,
  resolveAtReference,
} from '../ast-helpers.js';
import { compileExpression } from '../expressions/compile-expression.js';
import {
  compileTemplate,
  compileTemplateValue,
} from '../expressions/compile-template.js';
import { normalizeDeveloperName } from '../utils.js';
import { compileActionDefinitions } from './compile-actions.js';
import { resolveCollectTarget } from './compile-collect.js';
import { conditionSnapshotAction, joinConditions } from './condition-slots.js';
import {
  extractTopicModelConfiguration,
  mergeModelConfigurations,
} from '../config/model-config.js';
import { setDefaultLlmInputs } from './compile-tool.js';
import { compileSystemInstructions } from './compile-system-instructions.js';

/** Step name used when a workflow is authored with an unnamed `steps:` block. */
export const DEFAULT_WORKFLOW_STEP_NAME = 'main';

/** Upstream limit and pattern for a directive `developer_name` (agent-dsl STATE_KEY). */
const DIRECTIVE_NAME_MAX_LENGTH = 80;
const DIRECTIVE_NAME_PATTERN = /^[A-Za-z](_?[A-Za-z0-9])*$/;

interface WorkflowCompileState {
  ctx: CompilerContext;
  /** The workflow being compiled; `run` resolves against its `actions:`. */
  block: ParsedWorkflowProcedure;
  /**
   * Template that reads the system instructions variable, prepended to each
   * LLM directive; '' when there are no system instructions to apply.
   */
  systemInstructions: string;
}

/** A directive before its positional `developer_name` is assigned. */
type UnnamedDirective = WorkflowDirective extends infer D
  ? D extends WorkflowDirective
    ? Omit<D, 'developer_name'>
    : never
  : never;

/**
 * Keeps an internal action out of the chat history. The reasoner otherwise adds
 * a tool call and result for it, which the model never made.
 */
const NO_CHAT_HISTORY = { add_to_chat_history: false } as const;

/**
 * Compile a `workflow <name>:` block into a WorkflowNode.
 *
 * Maps:
 * - block name → `developer_name`; `label:` (falling back to Title Case of the
 *   name) → `label`; `description:` → `description`
 * - `actions:` → `action_definitions` (top-level actions are not inherited)
 * - `step <name>:` blocks (or an unnamed `steps:` block, as one step named
 *   `main`) → `steps[]`, each statement lowered to a workflow directive
 * - `model_config:` (block-level, falling back to the agent-wide default) →
 *   `model_configuration`, merged the same way as subagent/orchestrator nodes
 * - global `system: instructions` → built in the system
 *   instructions state variable by `on_init`, and referenced at the start of
 *   each `say`, `ask_for` and `do` directive, since a workflow node has no
 *   instructions field of its own
 */
export function compileWorkflowNode(
  name: string,
  block: ParsedWorkflowProcedure,
  systemBlock: ParsedSystem | undefined,
  globalModelConfig: ModelConfiguration | undefined,
  ctx: CompilerContext
): Sourceable<WorkflowNode> {
  // Also scopes `ctx.actionInputSignatures` to this workflow's own actions.
  const actionDefinitions = compileActionDefinitions(block.actions, ctx);
  // A subagent compiled before this workflow can leave its tool names here.
  ctx.actionReferenceMap.clear();

  const system = compileWorkflowSystemInstructions(block, systemBlock, ctx);
  const state: WorkflowCompileState = {
    ctx,
    block,
    systemInstructions: system.reference,
  };

  const errorCount = countErrors(ctx);
  const steps: WorkflowStep[] = [];
  for (const [stepName, stmts, range] of collectSteps(block)) {
    const lowered = compileWorkflowStatements(stmts, [], state);
    if (lowered.length === 0) continue;
    steps.push({
      name: stepName,
      directives: nameDirectives(name, stepName, lowered, range, ctx),
    });
  }
  // When the directives were dropped because of errors, those errors are the
  // cause; do not also report the workflow as empty.
  if (steps.length === 0 && countErrors(ctx) === errorCount) {
    ctx.error(
      `Workflow '${name}' has no compilable directives. A workflow needs at least one step with at least one directive.`,
      block.__cst?.range,
      'workflow-no-directives'
    );
  }

  const node: Sourceable<WorkflowNode> = {
    type: 'workflow',
    developer_name: name,
    label: extractSourcedString(block.label) ?? normalizeDeveloperName(name),
    steps,
  };

  if (system.onInit.length > 0) {
    node.on_init = system.onInit;
  }

  const description = extractDescriptionValue(block.description);
  if (description) {
    node.description = description;
  }

  if (actionDefinitions.length > 0) {
    node.action_definitions = actionDefinitions;
  }

  const modelConfig = mergeModelConfigurations(
    globalModelConfig,
    extractTopicModelConfiguration(block as ParsedTopicLike, ctx)
  );
  if (modelConfig) {
    node.model_configuration = modelConfig;
  }

  return node;
}

interface WorkflowSystemInstructions {
  /** Template prepended to each LLM directive; '' when there is none. */
  reference: string;
  /** Actions that build the instructions in the state variable on entry. */
  onInit: (Action | HandOffAction)[];
}

const NO_WORKFLOW_SYSTEM_INSTRUCTIONS: WorkflowSystemInstructions = {
  reference: '',
  onInit: [],
};

/**
 * Store the global system instructions in the system instructions state
 * variable when the workflow is entered, so each directive references the
 * variable instead of repeating the text. The variable is written on entry
 * rather than given a default because subagents with conditional system
 * instructions rewrite it on every turn.
 *
 * Conditional instructions reuse the actions that rebuild the variable before
 * each subagent reasoning iteration. A workflow has no per-directive hook, so
 * the conditions, like any variables in the text, are evaluated once on entry.
 */
function compileWorkflowSystemInstructions(
  block: ParsedWorkflowProcedure,
  systemBlock: ParsedSystem | undefined,
  ctx: CompilerContext
): WorkflowSystemInstructions {
  const compiled = compileSystemInstructions(
    systemBlock,
    block as ParsedTopicLike,
    ctx
  );
  if (!compiled.instructions) return NO_WORKFLOW_SYSTEM_INSTRUCTIONS;

  ctx.usesSystemInstructionsVariable = true;
  const onInit: (Action | HandOffAction)[] =
    compiled.beforeReasoningIteration.length > 0
      ? compiled.beforeReasoningIteration
      : [
          {
            type: 'action',
            target: STATE_UPDATE_ACTION,
            state_updates: [
              {
                [SYSTEM_INSTRUCTIONS_VARIABLE]: `template::${compiled.instructions}`,
              },
            ],
          },
        ];
  return { reference: `{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`, onInit };
}

/** Prepend the agent's system instructions to an LLM directive's text. */
function withSystemInstructions(text: string, system: string): string {
  return system ? `${system}\n\n${text}` : text;
}

/** `say` text becomes the turn's system message, so label both parts. */
function sayWithSystemInstructions(text: string, system: string): string {
  return system
    ? `System Prompt:\n\n${system}\n\nMessage for the system to follow:\n\n${text}`
    : text;
}

function countErrors(ctx: CompilerContext): number {
  return ctx.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    .length;
}

/** Named steps in source order, or the unnamed `steps:` block as `main`. */
function collectSteps(
  block: ParsedWorkflowProcedure
): Array<[string, Statement[], Range | undefined]> {
  const named = block.step as NamedMap<ParsedWorkflowStep> | undefined;
  if (named && named.size > 0) {
    return iterateNamedMap(named).map(([stepName, stepBlock]) => [
      stepName,
      stepBlock.statements ?? [],
      stepBlock.__cst?.range,
    ]);
  }
  if (block.steps?.statements) {
    return [
      [DEFAULT_WORKFLOW_STEP_NAME, block.steps.statements, block.__cst?.range],
    ];
  }
  return [];
}

/**
 * Lower a list of statements to workflow directives. `conditions` is the stack
 * of enclosing `if` guards, outermost first; `conditions[i]` reads the workflow
 * condition slot for depth `i + 1`. Each emitted directive is gated on their
 * conjunction via `enabled`.
 */
function compileWorkflowStatements(
  stmts: Statement[],
  conditions: string[],
  state: WorkflowCompileState
): UnnamedDirective[] {
  return stmts.flatMap(stmt =>
    compileWorkflowStatement(stmt, conditions, state)
  );
}

function compileWorkflowStatement(
  stmt: Statement,
  conditions: string[],
  state: WorkflowCompileState
): UnnamedDirective[] {
  if (stmt instanceof IfStatement) {
    return compileWorkflowIf(stmt, conditions, state);
  }
  if (stmt instanceof Template) {
    return compileDo(stmt, conditions, state);
  }

  const { ctx } = state;
  const range = stmt.__cst?.range;

  let directive: UnnamedDirective | undefined;
  if (stmt instanceof SayStatement) {
    directive = compileSay(stmt, state);
  } else if (stmt instanceof CollectClause) {
    directive = compileAskFor(stmt, state);
  } else if (stmt instanceof RunStatement) {
    directive = compileRun(stmt, state);
  } else if (stmt instanceof SetClause) {
    directive = compileSet(stmt, ctx);
  } else if (stmt instanceof TransitionStatement) {
    directive = compileTransition(stmt, ctx);
  } else if (stmt instanceof EscalateStatement) {
    directive = { type: 'handoff', target: ESCALATION_TARGET };
  } else if (stmt instanceof EndSessionStatement) {
    ctx.error(
      'end_session is not supported inside a workflow.',
      range,
      'workflow-unsupported-statement'
    );
  } else if (!(stmt instanceof UnknownStatement)) {
    // UnknownStatement is already reported as a parse-time diagnostic.
    ctx.error(
      `'${stmt.__kind}' is not supported inside a workflow.`,
      range,
      'workflow-unsupported-statement'
    );
  }

  return guardDirective(directive, conditions);
}

/**
 * Lower `if C: <body> else: <orelse>`.
 *
 * The runtime checks a directive's `enabled` when the directive is reached,
 * against live state. If the branches tested `C` directly, a directive that
 * changes a variable `C` reads (including through an `ask for` or `|` line that
 * spans turns) would change the branch taken by the directives after it, and
 * the else could run as well. So `C` is stored once, before either branch, in a
 * workflow condition slot, and both branches are gated on the slot.
 *
 * The slot is the nesting depth of the `if`. Every enclosing `if` holds a lower
 * slot, so a nested `if` never overwrites a slot that is still being read, and
 * a sibling `if` reuses the slot only after the previous one has finished. An
 * `else if` is an `if` inside `orelse`: it takes the next slot, and its
 * snapshot runs only when the earlier links were false.
 *
 * Evaluate `C` as a bound input, which the workflow ActionNode evaluates
 * strictly before calling the identity action. The action echoes that input,
 * and the state update only copies the result into the slot. Evaluating `C`
 * directly in a state update would swallow missing-key errors and either reuse
 * a stale slot or, with a False reset, incorrectly run the else. A bound-input
 * error instead stops execution before either branch, just like the original
 * enabled guard. No reset is needed because a failed evaluation cannot reach
 * the slot's readers.
 *
 * The snapshot is gated like the branches, so a slot from an earlier run is only
 * ever read alongside an enclosing guard that is false.
 */
function compileWorkflowIf(
  stmt: IfStatement,
  conditions: string[],
  state: WorkflowCompileState
): UnnamedDirective[] {
  const { ctx } = state;
  const condition = compileExpression(stmt.condition, ctx, {
    expressionContext: "'if' condition",
  });
  const depth = conditions.length + 1;
  const slotName = workflowConditionVariableName(depth);
  const slot = `state.${slotName}`;

  const branches = [
    ...compileWorkflowStatements(stmt.body, [...conditions, slot], state),
    ...compileWorkflowStatements(
      stmt.orelse,
      [...conditions, `not (${slot})`],
      state
    ),
  ];
  // Nothing reads the slot when neither branch produced a directive.
  if (branches.length === 0) return [];

  ctx.maxWorkflowConditionSlot = Math.max(ctx.maxWorkflowConditionSlot, depth);
  const snapshot: UnnamedDirective = {
    ...conditionSnapshotAction(slotName, condition),
    chat_history_behavior: NO_CHAT_HISTORY,
  };
  return [...guardDirective(snapshot, conditions), ...branches];
}

function guardDirective(
  directive: UnnamedDirective | undefined,
  conditions: string[]
): UnnamedDirective[] {
  if (!directive) return [];
  if (conditions.length > 0) {
    directive.enabled = joinConditions(conditions);
  }
  return [directive];
}

/**
 * Lower a `|` line and its continuation lines to one `do` directive. Blank
 * lines at the start and end are removed. Each `{!@actions.X}` becomes a tool
 * that the LLM can call. The tools must be actions of the workflow itself.
 */
function compileDo(
  template: Template,
  conditions: string[],
  state: WorkflowCompileState
): UnnamedDirective[] {
  const { ctx } = state;
  const tools: Tool[] = [];
  let valid = true;
  for (const part of template.parts) {
    if (!(part instanceof TemplateInterpolation)) continue;
    const refRange = part.expression.__cst?.range ?? part.__cst?.range;
    const error = workflowDoReferenceError(part.expression);
    const ref = decomposeAtMemberExpression(part.expression);
    if (error) {
      ctx.error(
        error.message,
        error.range ?? refRange,
        'workflow-do-unsupported-reference'
      );
      valid = false;
    } else if (ref?.namespace === 'actions') {
      if (!resolveWorkflowAction(state.block, ref.property)) {
        ctx.error(
          workflowUnknownActionMessage(ref.property, 'do'),
          refRange,
          'workflow-unknown-action'
        );
        valid = false;
      } else if (!tools.some(tool => tool.name === ref.property)) {
        tools.push(compileDoTool(ref.property, ctx));
      }
    }
  }
  if (!valid) return [];

  const instructions = compileTemplate(template.parts, ctx, {
    allowActionReferences: true,
  }).trim();
  if (instructions === '') {
    ctx.error(
      "A '|' line in a workflow requires non-empty text.",
      template.__cst?.range,
      'workflow-empty-do'
    );
    return [];
  }

  return guardDirective(
    {
      type: 'do',
      instructions: withSystemInstructions(
        instructions,
        state.systemInstructions
      ),
      ...(tools.length > 0 ? { tools } : {}),
    },
    conditions
  );
}

/** A tool for a workflow action. The LLM fills the required inputs. */
function compileDoTool(name: string, ctx: CompilerContext): Tool {
  const llmInputs: string[] = [];
  setDefaultLlmInputs(name, {}, llmInputs, ctx);
  return { type: 'action', target: name, name, llm_inputs: llmInputs };
}

function compileSay(
  stmt: SayStatement,
  state: WorkflowCompileState
): UnnamedDirective | undefined {
  const { ctx } = state;
  const text = compileTemplate(stmt.parts, ctx);
  if (text.trim() === '') {
    ctx.error(
      "'say' in a workflow requires non-empty text.",
      stmt.__cst?.range,
      'workflow-empty-say'
    );
    return undefined;
  }
  return {
    type: 'say',
    text: sayWithSystemInstructions(text, state.systemInstructions),
  };
}

function compileAskFor(
  stmt: CollectClause,
  state: WorkflowCompileState
): UnnamedDirective | undefined {
  const { ctx } = state;
  const varName = resolveCollectTarget(stmt, ctx);
  if (!varName) return undefined;
  if (ctx.getVariableNamespace(varName) !== 'state') {
    ctx.error(
      `'ask for' in a workflow must target a mutable variable; '${varName}' is not one.`,
      stmt.target?.__cst?.range ?? stmt.__cst?.range,
      'workflow-ask-for-immutable-target'
    );
    return undefined;
  }
  const instructions = compileTemplateValue(stmt.instructions, ctx);
  if (instructions.trim() === '') {
    ctx.error(
      "'ask for' in a workflow requires non-empty 'instructions:'.",
      stmt.instructions?.__cst?.range ?? stmt.__cst?.range,
      'workflow-ask-for-missing-instructions'
    );
    return undefined;
  }
  return {
    type: 'ask_for',
    llm_inputs: [varName],
    instructions: withSystemInstructions(
      instructions,
      state.systemInstructions
    ),
  };
}

function compileRun(
  stmt: RunStatement,
  state: WorkflowCompileState
): UnnamedDirective | undefined {
  const { ctx } = state;
  const decomposed = decomposeAtMemberExpression(stmt.target);
  if (decomposed?.namespace === 'utils') {
    ctx.error(
      runUtilsMessage(decomposed.property),
      stmt.target.__cst?.range ?? stmt.__cst?.range,
      RUN_UTILS_CODE
    );
    return undefined;
  }
  if (decomposed && decomposed.namespace !== 'actions') {
    ctx.error(
      `'run @${decomposed.namespace}.${decomposed.property}' is not supported inside a workflow. Only '@actions' can be run.`,
      stmt.target.__cst?.range ?? stmt.__cst?.range,
      'workflow-unsupported-statement'
    );
    return undefined;
  }
  const target = resolveAtReference(
    stmt.target,
    'actions',
    ctx,
    'action target'
  );
  if (!target) return undefined;

  const targetRange = stmt.target.__cst?.range ?? stmt.__cst?.range;
  const action = resolveWorkflowAction(state.block, target);
  if (!action) {
    ctx.error(
      workflowUnknownActionMessage(target),
      targetRange,
      'workflow-unknown-action'
    );
    return undefined;
  }

  // Same checks as the workflow-validation lint pass, so a compile without
  // lint still rejects bindings the runtime can't execute.
  const issues = analyzeActionIo({
    actionName: target,
    sig: extractActionSignature(action),
    statements: stmt.body,
    actionRefRange: targetRange,
    mode: 'workflow',
  });
  for (const { diagnostic } of issues) {
    ctx.addDiagnostic(
      diagnostic.severity,
      diagnostic.message,
      diagnostic.range,
      diagnostic.code
    );
  }
  if (issues.some(i => i.diagnostic.severity === DiagnosticSeverity.Error)) {
    return undefined;
  }

  const boundInputs: Record<string, string> = {};
  const stateUpdates: StateUpdate[] = [];
  for (const child of stmt.body) {
    if (child instanceof WithClause) {
      boundInputs[child.param] = compileExpression(child.value, ctx, {
        expressionContext: "'with' clause",
      });
    } else if (child instanceof SetClause) {
      const update = compileStateUpdate(child, ctx);
      if (update) stateUpdates.push(update);
    }
  }

  // The runtime passes only `bound_inputs` to a workflow action; it doesn't
  // apply definition defaults the way it does for reasoning tools. Bind them.
  const inputDecls = action.inputs as
    | NamedMap<ParameterDeclarationNode>
    | undefined;
  for (const [name, decl] of iterateNamedMap(inputDecls)) {
    if (!decl.defaultValue || Object.hasOwn(boundInputs, name)) continue;
    boundInputs[name] = compileExpression(decl.defaultValue, ctx, {
      expressionContext: 'action input default',
    });
  }

  const directive: Omit<WorkflowAction, 'developer_name'> = {
    type: 'action',
    target,
  };
  if (Object.keys(boundInputs).length > 0) {
    directive.bound_inputs = boundInputs;
  }
  if (stateUpdates.length > 0) {
    directive.state_updates = stateUpdates;
  }
  return directive;
}

function compileSet(
  stmt: SetClause,
  ctx: CompilerContext
): UnnamedDirective | undefined {
  const update = compileStateUpdate(stmt, ctx);
  if (!update) return undefined;
  return {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    state_updates: [update],
    chat_history_behavior: NO_CHAT_HISTORY,
  };
}

function compileStateUpdate(
  stmt: SetClause,
  ctx: CompilerContext
): StateUpdate | undefined {
  const varName = resolveAtReference(
    stmt.target,
    'variables',
    ctx,
    'variable name'
  );
  if (!varName) return undefined;
  return {
    [varName]: compileExpression(stmt.value, ctx, {
      expressionContext: "'set' clause",
    }),
  };
}

function compileTransition(
  stmt: TransitionStatement,
  ctx: CompilerContext
): UnnamedDirective | undefined {
  // The transition-target lint pass enforces exactly one `to` clause.
  const clause = stmt.clauses.find(c => c instanceof ToClause);
  if (!(clause instanceof ToClause)) return undefined;

  const decomposed = decomposeAtMemberExpression(clause.target);
  if (decomposed?.namespace === 'step') {
    ctx.error(
      'Transitioning to a workflow step is not supported. Steps run in order; use a transition to another node or escalate to leave the workflow.',
      clause.target.__cst?.range ?? stmt.__cst?.range,
      'workflow-unsupported-statement'
    );
    return undefined;
  }
  const target = resolveAtReference(
    clause.target,
    TRANSITION_TARGET_NAMESPACES,
    ctx,
    'transition target'
  );
  if (!target) return undefined;
  return { type: 'handoff', target };
}

/**
 * Give each directive a positional `developer_name` of the form
 * `<workflow>_<step>_<type>_<NN>`, where NN is its 1-based position in the step.
 * Step names are unique and the type is fixed per directive, so names are
 * unique across the workflow.
 */
function nameDirectives(
  workflowName: string,
  stepName: string,
  directives: UnnamedDirective[],
  range: Range | undefined,
  ctx: CompilerContext
): WorkflowDirective[] {
  let reported = false;
  return directives.map((directive, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    const developerName = `${workflowName}_${stepName}_${directive.type}_${ordinal}`;
    const problem = directiveNameProblem(developerName);
    // Every name in a step shares the same prefix, so one report per step.
    if (problem && !reported) {
      ctx.error(problem, range, 'workflow-invalid-directive-name');
      reported = true;
    }
    return { ...directive, developer_name: developerName };
  });
}

function directiveNameProblem(developerName: string): string | undefined {
  if (developerName.length > DIRECTIVE_NAME_MAX_LENGTH) {
    return `Generated directive name '${developerName}' exceeds ${DIRECTIVE_NAME_MAX_LENGTH} characters. Shorten the workflow or step name.`;
  }
  if (!DIRECTIVE_NAME_PATTERN.test(developerName)) {
    return `Generated directive name '${developerName}' is not a valid developer name. Avoid consecutive or trailing underscores in the workflow and step names.`;
  }
  return undefined;
}
