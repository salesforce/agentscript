import type { Statement } from '@agentscript/language';
import {
  decomposeAtMemberExpression,
  ToClause,
  TransitionStatement,
  AvailableWhen,
  WithClause,
  Ellipsis,
} from '@agentscript/language';
import type { Range } from '@agentscript/types';
import type { CompilerContext } from '../compiler-context.js';
import type {
  Tool,
  RouterTool,
  PostToolCall,
  HandOffAction,
} from '../types.js';
import type { ParsedTool } from '../parsed-types.js';

/** Template part with text and optional CST range */
export interface TemplatePart {
  text: string;
  range?: Range;
}
import {
  iterateNamedMap,
  extractSourcedString,
  extractSourcedDescription,
  resolveAtReference,
} from '../ast-helpers.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { resolveActionType, type ActionType } from './resolve-action-type.js';
import { compileTransition } from './compile-transition.js';
import { compileSetVariables } from './compile-set-variables.js';
import { compileSupervision } from './compile-supervision.js';
import { compileEscalate } from './compile-escalate.js';
import { compileEndSession } from './compile-end-session.js';
import { compileTool } from './compile-tool.js';
import { warnIfConnectedAgentTransition } from './compile-utils.js';
import { TRANSITION_TARGET_NAMESPACES } from '../constants.js';
import type { Sourceable } from '../sourced.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiler handles both topic and subagent reasoning shapes generically
type ParsedReasoningLike = Record<string, any> | null | undefined;

/**
 * Options for compiling reasoning actions.
 */
export interface CompileReasoningActionsOptions {
  /** The type of node being compiled */
  nodeType: 'router' | 'subagent';
  /** The current topic name (for transitions) */
  topicName: string;
  /** Map of topic/subagent names to their descriptions */
  topicDescriptions: Record<string, string>;
}

/**
 * Result of compiling reasoning actions.
 */
export interface CompileReasoningActionsResult {
  tools: Array<Tool | RouterTool>;
  postToolCalls: PostToolCall[];
  handOffActions: HandOffAction[];
  instructionTemplate: string | undefined;
  instructionTemplateParts: TemplatePart[] | undefined;
  isProcedural: boolean;
  proceduralStatements: Statement[] | undefined;
}

/**
 * Unified function for compiling reasoning actions for both router and subagent nodes.
 *
 * This function:
 * 1. Extracts instruction templates
 * 2. Filters actions based on node type (router only supports transitions + connected-subagents)
 * 3. Dispatches to appropriate compilation functions
 * 4. Adapts tool types based on node context
 */
export function compileReasoningActions(
  reasoning: ParsedReasoningLike | undefined,
  options: CompileReasoningActionsOptions,
  ctx: CompilerContext
): CompileReasoningActionsResult {
  const { nodeType, topicName, topicDescriptions } = options;

  const tools: Array<Tool | RouterTool> = [];
  const postToolCalls: PostToolCall[] = [];
  const handOffActions: HandOffAction[] = [];

  // Extract instruction template (shared logic)
  const {
    instructionTemplate,
    instructionTemplateParts,
    isProcedural,
    proceduralStatements,
  } = extractInstructionTemplate(reasoning, nodeType, ctx);

  // Compile reasoning actions
  const reasoningTools = reasoning?.actions;
  if (!reasoningTools) {
    return {
      tools,
      postToolCalls,
      handOffActions,
      instructionTemplate,
      instructionTemplateParts,
      isProcedural,
      proceduralStatements,
    };
  }

  for (const [actionName, actionDef] of iterateNamedMap(reasoningTools)) {
    const def = actionDef as ParsedTool;
    const body = def.statements ?? [];
    const actionType = resolveActionType(actionName, def);

    // Filter based on node type
    if (!isActionTypeAllowed(actionType, nodeType)) {
      // Emit diagnostic for disallowed action types
      emitDisallowedActionDiagnostic(
        actionType,
        actionName,
        nodeType,
        def,
        ctx
      );
      continue;
    }

    // Compile based on action type
    const result = compileAction(
      actionType,
      actionName,
      def,
      body,
      nodeType,
      topicName,
      topicDescriptions,
      ctx
    );

    // Adapt tools for node type
    const adaptedTools = adaptToolsForNodeType(result.tools, nodeType);
    tools.push(...adaptedTools);

    // Post tool calls and handoffs are only relevant for subagent nodes
    if (nodeType === 'subagent') {
      postToolCalls.push(...result.postToolCalls);
      handOffActions.push(...result.handOffActions);
    }
  }

  return {
    tools,
    postToolCalls,
    handOffActions,
    instructionTemplate,
    instructionTemplateParts,
    isProcedural,
    proceduralStatements,
  };
}

// ---------------------------------------------------------------------------
// Instruction Template Extraction
// ---------------------------------------------------------------------------

interface InstructionTemplateResult {
  instructionTemplate: string | undefined;
  instructionTemplateParts: TemplatePart[] | undefined;
  isProcedural: boolean;
  proceduralStatements: Statement[] | undefined;
}

function extractInstructionTemplate(
  reasoning: ParsedReasoningLike | undefined,
  nodeType: 'router' | 'subagent',
  ctx: CompilerContext
): InstructionTemplateResult {
  let instructionTemplateParts: TemplatePart[] | undefined;
  let isProcedural = false;
  let proceduralStatements: Statement[] | undefined;

  if (!reasoning) {
    return {
      instructionTemplate: undefined,
      instructionTemplateParts,
      isProcedural,
      proceduralStatements,
    };
  }

  const instructions = reasoning.instructions;
  if (!instructions) {
    return {
      instructionTemplate: undefined,
      instructionTemplateParts,
      isProcedural,
      proceduralStatements,
    };
  }

  // Check for procedural statements (run, if, transition, set)
  if (instructions.statements) {
    const stmts = instructions.statements;
    const hasNonTemplate = stmts.some(
      (s: Statement) => s.__kind !== 'Template'
    );
    if (hasNonTemplate) {
      isProcedural = true;
      proceduralStatements = stmts;
    }

    // Extract individual template parts (one per | block) for multi-block BRI
    // Only for subagent nodes
    if (nodeType === 'subagent' && !hasNonTemplate && stmts.length > 1) {
      instructionTemplateParts = stmts
        .map((stmt: Statement) => ({
          text: compileTemplateValue(stmt, ctx, {
            allowActionReferences: true,
          }),
          range: stmt.__cst?.range,
        }))
        .filter((p: { text: string; range?: Range }) => p.text);
    }
  }

  const instructionTemplate = compileTemplateValue(instructions, ctx, {
    allowActionReferences: true,
  });

  return {
    instructionTemplate,
    instructionTemplateParts,
    isProcedural,
    proceduralStatements,
  };
}

// ---------------------------------------------------------------------------
// Action Type Filtering
// ---------------------------------------------------------------------------

/**
 * Emits a diagnostic when an action type is not allowed for the node type.
 */
function emitDisallowedActionDiagnostic(
  actionType: ActionType,
  actionName: string,
  nodeType: 'router' | 'subagent',
  def: ParsedTool,
  ctx: CompilerContext
): void {
  // Only router nodes have restrictions
  if (nodeType !== 'router') {
    return;
  }

  // Determine what the action is and provide a helpful message
  let actionDescription = '';
  let allowedTypes = '';

  // Special case: handoff actions (@topic.X, @subagent.X, @connected_subagent.X)
  if (actionType === 'supervise') {
    const decomposed = def.value
      ? decomposeAtMemberExpression(def.value)
      : null;

    let message = '';
    if (decomposed?.namespace === 'connected_subagent') {
      message =
        `Router node cannot use connected agent handoff '${actionName}'. ` +
        `Router nodes use hyperclassifier models for simple routing and do not support handoffs to connected agents. ` +
        `Remove the hyper classifier config if you need to invoke connected agents.`;
    } else {
      message =
        `Router node cannot use handoff action '${actionName}'. ` +
        `Router nodes use hyperclassifier models for simple routing and do not support handoffs to subagents or topics. ` +
        `Use transitions (@utils.transition) for routing or remove the hyper classifier config if you need to use handoff.`;
    }
    ctx.error(message, def.__cst?.range);
    return;
  }

  if (actionType === 'tool') {
    // Regular action reference
    const decomposed = def.value
      ? decomposeAtMemberExpression(def.value)
      : null;
    if (decomposed?.namespace === 'actions') {
      actionDescription = `action reference '@actions.${decomposed.property}'`;

      // Check if this action has LLM inputs (with param=... where ... is ellipsis)
      const hasLLMInputs = hasLLMInputParameters(def);
      if (hasLLMInputs) {
        const message =
          `Router node cannot use action '${actionName}' with LLM inputs (param=...). ` +
          `Router nodes use hyperclassifier models and cannot fill action inputs via LLM. ` +
          `Either provide explicit values for all inputs or move this action to a subagent node.`;
        ctx.error(message, def.__cst?.range);
        return;
      }
    } else {
      actionDescription = 'action';
    }
  } else {
    actionDescription = `'@utils.${actionType}' action`;
  }

  allowedTypes =
    'transitions (@utils.transition) and connected-subagents (@connected_subagent.X)';

  const message = `Router nodes only support ${allowedTypes}. The ${actionDescription} '${actionName}' will be ignored. Consider moving it to a subagent node or removing it.`;

  ctx.error(message, def.__cst?.range);
}

/**
 * Checks if a tool definition has LLM input parameters (with param=...).
 */
function hasLLMInputParameters(def: ParsedTool): boolean {
  const body = def.statements ?? [];
  for (const stmt of body) {
    if (stmt instanceof WithClause) {
      // Check if value is an ellipsis (means LLM fills it in)
      if (stmt.value instanceof Ellipsis) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determines if an action type is allowed for a given node type.
 *
 * - Subagent nodes: support all action types
 * - Router nodes: only support transitions
 */
function isActionTypeAllowed(
  actionType: ActionType,
  nodeType: 'router' | 'subagent'
): boolean {
  if (nodeType === 'subagent') {
    // Subagent nodes support all action types
    return true;
  }

  // Router nodes only support transitions
  if (actionType === 'transition') {
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Router Transition Compilation
// ---------------------------------------------------------------------------

/**
 * Compile a transition action for router nodes.
 * Router transitions create simple routing tools (not state updates + handoffs).
 */
function compileRouterTransition(
  actionName: string,
  def: ParsedTool,
  body: Statement[],
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): Tool {
  // Resolve target from @topic.X and enabled from AvailableWhen
  let targetName: string | undefined;
  let enabledCondition: string | undefined;

  for (const stmt of body) {
    if (stmt instanceof ToClause) {
      if (warnIfConnectedAgentTransition(stmt.target, ctx)) continue;
      const resolved = resolveAtReference(
        stmt.target,
        TRANSITION_TARGET_NAMESPACES,
        ctx,
        'transition target'
      );
      if (resolved) targetName = resolved;
    } else if (stmt instanceof TransitionStatement) {
      for (const clause of stmt.clauses) {
        if (clause instanceof ToClause) {
          if (warnIfConnectedAgentTransition(clause.target, ctx)) continue;
          const resolved = resolveAtReference(
            clause.target,
            TRANSITION_TARGET_NAMESPACES,
            ctx,
            'transition target'
          );
          if (resolved) targetName = resolved;
        }
      }
    } else if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause",
      });
    }
  }

  // Use resolved target name, fall back to action name
  const resolvedTarget = targetName ?? actionName;
  const alias = extractSourcedString(def.label);
  const description =
    extractSourcedDescription(def.description) ??
    topicDescriptions[resolvedTarget] ??
    '';

  const tool: Sourceable<Tool> = {
    name: alias ?? actionName,
    target: resolvedTarget,
    description,
  } as Tool;

  if (enabledCondition) {
    tool.enabled = enabledCondition;
  }

  return tool as Tool;
}

// ---------------------------------------------------------------------------
// Action Compilation Dispatcher
// ---------------------------------------------------------------------------

interface CompileActionResult {
  tools: Tool[];
  postToolCalls: PostToolCall[];
  handOffActions: HandOffAction[];
}

/**
 * Dispatches action compilation to the appropriate function based on action type.
 */
function compileAction(
  actionType: ActionType,
  actionName: string,
  def: ParsedTool,
  body: Statement[],
  nodeType: 'router' | 'subagent',
  topicName: string,
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): CompileActionResult {
  switch (actionType) {
    case 'transition': {
      // Router nodes have simpler transition handling
      if (nodeType === 'router') {
        const tool = compileRouterTransition(
          actionName,
          def,
          body,
          topicDescriptions,
          ctx
        );
        return { tools: [tool], postToolCalls: [], handOffActions: [] };
      }

      // Subagent nodes use full transition compilation
      const result = compileTransition(
        actionName,
        def,
        body,
        topicName,
        topicDescriptions,
        ctx
      );
      return {
        tools: result.tools,
        postToolCalls: [],
        handOffActions: result.handOffActions,
      };
    }

    case 'setVariables': {
      const tool = compileSetVariables(actionName, def, body, ctx);
      return { tools: [tool], postToolCalls: [], handOffActions: [] };
    }

    case 'supervise': {
      // Check if this is a @connected_subagent.X reference
      const decomposed = def.value
        ? decomposeAtMemberExpression(def.value)
        : null;

      if (decomposed?.namespace === 'connected_subagent') {
        // Connected-subagent references compile as tools, not supervision
        const result = compileTool(actionName, def, body, ctx);
        return {
          tools: [result.tool],
          postToolCalls: result.postToolCall ? [result.postToolCall] : [],
          handOffActions: result.handOffActions,
        };
      }

      // Regular supervision (@topic.X, @subagent.X)
      const result = compileSupervision(
        actionName,
        def,
        body,
        topicDescriptions,
        ctx
      );
      return { tools: [result.tool], postToolCalls: [], handOffActions: [] };
    }

    case 'escalate': {
      const result = compileEscalate(actionName, def, body, ctx);
      return {
        tools: [result.tool],
        postToolCalls: [],
        handOffActions: [result.handOffAction],
      };
    }

    case 'end_session': {
      const result = compileEndSession(actionName, def, body, ctx);
      return {
        tools: [result.tool],
        postToolCalls: [],
        handOffActions: [],
      };
    }

    default: {
      // Regular tool (action or connected-subagent)
      const result = compileTool(actionName, def, body, ctx);
      return {
        tools: [result.tool],
        postToolCalls: result.postToolCall ? [result.postToolCall] : [],
        handOffActions: result.handOffActions,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Tool Adaptation
// ---------------------------------------------------------------------------

/**
 * Adapts tools for the target node type.
 *
 * - Subagent nodes: use full Tool types as-is
 * - Router nodes: convert to simpler RouterTool (nodeReference) format
 */
function adaptToolsForNodeType(
  tools: Tool[],
  nodeType: 'router' | 'subagent'
): Array<Tool | RouterTool> {
  if (nodeType === 'subagent') {
    return tools;
  }

  // Convert to RouterTool for router nodes
  // Strip out fields that router tools don't support: type, bound_inputs, llm_inputs, forced, input_parameters
  return tools.map(tool => {
    const routerTool: RouterTool = {
      name: tool.name,
      target: tool.target,
      description: tool.description,
    };

    if (tool.enabled !== undefined) {
      routerTool.enabled = tool.enabled;
    }

    if (tool.state_updates && tool.state_updates.length > 0) {
      routerTool.state_updates = tool.state_updates;
    }

    return routerTool;
  });
}
