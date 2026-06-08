import type { Statement } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  RouterNode,
  RouterTool,
  ModelConfiguration,
  Action,
} from '../types.js';
import type { ParsedTopicLike, ParsedSystem } from '../parsed-types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiler handles both topic and subagent reasoning shapes generically
type ParsedReasoningLike = Record<string, any> | null | undefined;
import {
  AGENT_INSTRUCTIONS_VARIABLE,
  STATE_UPDATE_ACTION,
} from '../constants.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedDescription,
} from '../ast-helpers.js';
import {
  extractTopicModelConfiguration,
  mergeModelConfigurations,
} from '../config/model-config.js';
import type { Sourceable } from '../sourced.js';
import { normalizeDeveloperName, dedent } from '../utils.js';
import { compileActionDefinitions } from './compile-actions.js';
import { compileDeterministicDirectives } from './compile-directives.js';
import { compileReasoningActions } from './compile-reasoning-actions.js';

/**
 * Compile a topic block with hyperclassifier model into a RouterNode.
 */
export function compileRouterNode(
  topicName: string,
  topicBlock: ParsedTopicLike,
  systemBlock: ParsedSystem | undefined,
  topicDescriptions: Record<string, string>,
  globalModelConfig: ModelConfiguration | undefined,
  ctx: CompilerContext
): RouterNode {
  const description = extractSourcedDescription(topicBlock.description) ?? '';
  const label =
    extractSourcedString(topicBlock.label) ?? normalizeDeveloperName(topicName);
  const source = extractSourcedString(topicBlock.source) ?? undefined;

  // Extract topic-level model configuration and merge with global
  const topicModelConfig = extractTopicModelConfiguration(topicBlock, ctx);
  const modelConfig = mergeModelConfigurations(
    globalModelConfig,
    topicModelConfig
  );

  // Compile system instructions
  const systemInstructions = compileRouterSystemInstructions(
    systemBlock,
    topicBlock,
    ctx
  );

  // Compile reasoning tools (transitions with resolved targets)
  const { tools, instructionTemplate, isProcedural, proceduralStatements } =
    compileRouterTools(topicBlock.reasoning, topicDescriptions, ctx);

  // Compile action definitions from topic's actions block
  const actionDefinitions = compileActionDefinitions(topicBlock.actions, ctx);

  // Compile before_reasoning_iteration (instruction injection)
  const beforeReasoningIteration = compileRouterBeforeReasoningIteration(
    instructionTemplate,
    isProcedural,
    proceduralStatements,
    ctx
  );

  // Build final instructions with template injection
  const hasInstructions =
    isProcedural ||
    (instructionTemplate !== undefined && instructionTemplate !== '');
  const instructions = hasInstructions
    ? `${systemInstructions}\n\n{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
    : systemInstructions;

  const node: Sourceable<RouterNode> = {
    model_configuration: modelConfig!,
    type: 'router',
    description,
    instructions,
    tools,
    developer_name: topicName,
    label,
    action_definitions: actionDefinitions,
  };

  if (beforeReasoningIteration.length > 0) {
    node.before_reasoning_iteration = beforeReasoningIteration;
  }
  if (source !== undefined) {
    (node as Record<string, unknown>).source = source;
  }

  ctx.setScriptPath(node, topicName);

  return node as RouterNode;
}

// ---------------------------------------------------------------------------
// Router System Instructions
// ---------------------------------------------------------------------------

function compileRouterSystemInstructions(
  systemBlock: ParsedSystem | undefined,
  topicBlock: ParsedTopicLike,
  _ctx: CompilerContext
): string {
  if (topicBlock.system) {
    const instructions = extractStringValue(topicBlock.system.instructions);
    if (instructions) return dedent(instructions);
  }

  if (systemBlock) {
    const instructions = extractStringValue(systemBlock.instructions);
    if (instructions) return dedent(instructions);
  }

  return '';
}

// ---------------------------------------------------------------------------
// Router Tools
// ---------------------------------------------------------------------------

interface RouterToolsResult {
  tools: RouterTool[];
  instructionTemplate: string | undefined;
  isProcedural: boolean;
  proceduralStatements: Statement[] | undefined;
}

function compileRouterTools(
  reasoning: ParsedReasoningLike | undefined,
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): RouterToolsResult {
  const tools: RouterTool[] = [];
  let instructionTemplate: string | undefined;
  if (!reasoning) {
    return {
      tools,
      instructionTemplate,
      isProcedural: false,
      proceduralStatements: undefined,
    };
  }

  // Use unified reasoning action compiler
  const result = compileReasoningActions(
    reasoning,
    {
      nodeType: 'router',
      topicName: '', // Router nodes don't have a current topic name
      topicDescriptions,
    },
    ctx
  );

  return {
    tools: result.tools as RouterTool[], // Type assertion safe due to adaptation
    instructionTemplate: result.instructionTemplate,
    isProcedural: result.isProcedural,
    proceduralStatements: result.proceduralStatements,
  };
}

// ---------------------------------------------------------------------------
// Before Reasoning Iteration
// ---------------------------------------------------------------------------

function compileRouterBeforeReasoningIteration(
  instructionTemplate: string | undefined,
  isProcedural: boolean,
  proceduralStatements: Statement[] | undefined,
  _ctx: CompilerContext
): Action[] {
  // Procedural instructions: use deterministic directives
  if (isProcedural && proceduralStatements) {
    const resetAction: Action = {
      type: 'action',
      target: STATE_UPDATE_ACTION,
      enabled: 'True',
      state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }],
    };

    const actions = compileDeterministicDirectives(proceduralStatements, _ctx, {
      addNextTopicResetAction: false,
      gateOnNextTopicEmpty: false,
      agentInstructionsVariable: AGENT_INSTRUCTIONS_VARIABLE,
    });

    return [resetAction, ...(actions as Action[])];
  }

  // Simple template: reset + append
  if (!instructionTemplate) return [];

  const resetAction: Action = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    enabled: 'True',
    state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }],
  };

  const appendAction: Action = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    state_updates: [
      {
        [AGENT_INSTRUCTIONS_VARIABLE]: `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}\n${instructionTemplate}`,
      },
    ],
  };

  return [resetAction, appendAction];
}
