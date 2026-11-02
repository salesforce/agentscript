/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Expression,
  NamedMap,
  ParameterDeclarationNode,
  Statement,
} from '@agentscript/language';
import type { Range } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import {
  analyzeActionIo,
  extractActionSignature,
  resolveWorkflowAction,
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
  ToClause,
  TransitionStatement,
  UnknownStatement,
  walkAstExpressions,
  WithClause,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  ModelConfiguration,
  StateUpdate,
  WorkflowAction,
  WorkflowDirective,
  WorkflowNode,
  WorkflowStep,
} from '../types.js';
import type { Sourceable } from '../sourced.js';
import type {
  ParsedWorkflowProcedure,
  ParsedWorkflowStep,
} from '../parsed-types.js';
import {
  ESCALATION_TARGET,
  STATE_UPDATE_ACTION,
  TRANSITION_TARGET_NAMESPACES,
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

/** Step name used when a workflow is authored with an unnamed `steps:` block. */
export const DEFAULT_WORKFLOW_STEP_NAME = 'main';

/** Upstream limit and pattern for a directive `developer_name` (agent-dsl STATE_KEY). */
const DIRECTIVE_NAME_MAX_LENGTH = 80;
const DIRECTIVE_NAME_PATTERN = /^[A-Za-z](_?[A-Za-z0-9])*$/;

interface WorkflowCompileState {
  ctx: CompilerContext;
  /** The workflow being compiled; `run` resolves against its `actions:`. */
  block: ParsedWorkflowProcedure;
}

/** A directive before its positional `developer_name` is assigned. */
type UnnamedDirective = WorkflowDirective extends infer D
  ? D extends WorkflowDirective
    ? Omit<D, 'developer_name'>
    : never
  : never;

interface LoweredDirective {
  directive: UnnamedDirective;
  /** Range of the statement the directive was lowered from. */
  range: Range | undefined;
}

/**
 * Compile a `workflow <name>:` block into a WorkflowNode.
 *
 * Maps:
 * - block name → `developer_name`; `label:` (falling back to Title Case of the
 *   name) → `label`; `description:` → `description`
 * - `actions:` → `action_definitions` (top-level actions are not inherited)
 * - `step <name>:` blocks (or an unnamed `steps:` block, as one step named
 *   `main`) → `steps[]`, each statement lowered to a workflow directive
 * - the agent-wide `model_config` → `model_configuration`
 */
export function compileWorkflowNode(
  name: string,
  block: ParsedWorkflowProcedure,
  globalModelConfig: ModelConfiguration | undefined,
  ctx: CompilerContext
): Sourceable<WorkflowNode> {
  const state: WorkflowCompileState = { ctx, block };

  // Also scopes `ctx.actionInputSignatures` to this workflow's own actions.
  const actionDefinitions = compileActionDefinitions(block.actions, ctx);

  const steps: WorkflowStep[] = [];
  for (const [stepName, stmts, range] of collectSteps(block)) {
    const lowered = compileWorkflowStatements(stmts, [], state);
    if (lowered.length === 0) continue;
    steps.push({
      name: stepName,
      directives: nameDirectives(name, stepName, lowered, range, ctx),
    });
  }
  if (steps.length === 0) {
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

  const description = extractDescriptionValue(block.description);
  if (description) {
    node.description = description;
  }

  if (actionDefinitions.length > 0) {
    node.action_definitions = actionDefinitions;
  }

  if (globalModelConfig) {
    node.model_configuration = globalModelConfig;
  }

  return node;
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
 * of enclosing `if` guards; each emitted directive is gated on their
 * conjunction via `enabled`.
 */
function compileWorkflowStatements(
  stmts: Statement[],
  conditions: string[],
  state: WorkflowCompileState
): LoweredDirective[] {
  const result: LoweredDirective[] = [];
  for (const stmt of stmts) {
    result.push(...compileWorkflowStatement(stmt, conditions, state));
  }
  return result;
}

function compileWorkflowStatement(
  stmt: Statement,
  conditions: string[],
  state: WorkflowCompileState
): LoweredDirective[] {
  const { ctx } = state;
  const range = stmt.__cst?.range;

  if (stmt instanceof IfStatement) {
    const condition = compileExpression(stmt.condition, ctx, {
      expressionContext: "'if' condition",
    });
    const lowered = [
      ...compileWorkflowStatements(
        stmt.body,
        [...conditions, condition],
        state
      ),
      ...compileWorkflowStatements(
        stmt.orelse,
        [...conditions, `not (${condition})`],
        state
      ),
    ];
    reportConditionWrites(lowered, referencedVariables(stmt.condition), ctx);
    return lowered;
  }

  let directive: UnnamedDirective | undefined;
  if (stmt instanceof SayStatement) {
    directive = compileSay(stmt, ctx);
  } else if (stmt instanceof CollectClause) {
    directive = compileAskFor(stmt, ctx);
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
  } else if (stmt instanceof Template) {
    ctx.error(
      "Instruction lines ('|') are not supported inside a workflow. Use 'say' to deliver a message.",
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

  if (!directive) return [];
  if (conditions.length > 0) {
    directive.enabled = joinConditions(conditions);
  }
  return [{ directive, range }];
}

function compileSay(
  stmt: SayStatement,
  ctx: CompilerContext
): UnnamedDirective | undefined {
  const text = compileTemplate(stmt.parts, ctx);
  if (text.trim() === '') {
    ctx.error(
      "'say' in a workflow requires non-empty text.",
      stmt.__cst?.range,
      'workflow-empty-say'
    );
    return undefined;
  }
  return { type: 'say', text };
}

function compileAskFor(
  stmt: CollectClause,
  ctx: CompilerContext
): UnnamedDirective | undefined {
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
  return { type: 'ask_for', llm_inputs: [varName], instructions };
}

function compileRun(
  stmt: RunStatement,
  state: WorkflowCompileState
): UnnamedDirective | undefined {
  const { ctx } = state;
  const decomposed = decomposeAtMemberExpression(stmt.target);
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
 * The runtime checks each directive's `enabled` guard when that directive is
 * reached rather than once at the `if`. A directive that writes a variable its
 * enclosing condition reads would therefore change the branch taken by every
 * directive after it in the same if/else, so that shape is rejected. The last
 * directive is exempt: nothing after it is gated on the condition.
 */
function reportConditionWrites(
  lowered: LoweredDirective[],
  conditionVariables: Set<string>,
  ctx: CompilerContext
): void {
  if (conditionVariables.size === 0) return;
  for (const { directive, range } of lowered.slice(0, -1)) {
    const written = writtenVariables(directive).find(v =>
      conditionVariables.has(v)
    );
    if (!written) continue;
    ctx.error(
      `'@variables.${written}' is read by the enclosing 'if' condition, and workflow conditions are re-checked before each directive, so writing it here changes which branch the following directives take. ` +
        "Store the condition in a separate variable before the 'if' and test that variable instead.",
      range,
      'workflow-condition-written-in-branch'
    );
  }
}

/** `@variables.X` names an expression reads. */
function referencedVariables(expr: Expression): Set<string> {
  const names = new Set<string>();
  walkAstExpressions(expr, node => {
    const ref = decomposeAtMemberExpression(node);
    if (ref?.namespace === 'variables') names.add(ref.property);
  });
  return names;
}

/** State variables a directive writes when it runs. */
function writtenVariables(directive: UnnamedDirective): string[] {
  switch (directive.type) {
    case 'ask_for':
      return directive.llm_inputs;
    case 'action':
      return (directive.state_updates ?? []).flatMap(update =>
        Object.keys(update)
      );
    default:
      return [];
  }
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
  lowered: LoweredDirective[],
  range: Range | undefined,
  ctx: CompilerContext
): WorkflowDirective[] {
  let reported = false;
  return lowered.map(({ directive }, index) => {
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

function joinConditions(conditions: string[]): string {
  if (conditions.length === 1) return conditions[0];
  return conditions.map(c => `(${c})`).join(' and ');
}
