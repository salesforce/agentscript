/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  RouterNode,
  RouterTool,
  ModelConfiguration,
  Action,
  HandOffAction,
} from '../types.js';
import type { ParsedTopicLike, ParsedSystem } from '../parsed-types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiler handles both topic and subagent reasoning shapes generically
type ParsedReasoningLike = Record<string, any> | null | undefined;
import { AGENT_INSTRUCTIONS_VARIABLE } from '../constants.js';
import {
  extractSourcedString,
  extractSourcedDescription,
  getCstRange,
  iterateNamedMap,
} from '../ast-helpers.js';
import {
  extractTopicModelConfiguration,
  mergeModelConfigurations,
} from '../config/model-config.js';
import type { Sourceable } from '../sourced.js';
import { normalizeDeveloperName } from '../utils.js';
import { compileActionDefinitions } from './compile-actions.js';
import { compileDeterministicDirectives } from './compile-directives.js';
import {
  createStateUpdateAction,
  instructionResetAppendValue,
} from './optimize-actions.js';
import { compileReasoningActions } from './compile-reasoning-actions.js';
import { compileSystemInstructions } from './compile-system-instructions.js';

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

  // Skills are a subagent-reasoning concept — the RouterNode wire has no
  // `skills` field. When a node resolves to a router (hyperclassifier
  // model_config), any authored reasoning.skills would be silently dropped;
  // flag it instead of losing the references.
  const routerSkills = (topicBlock.reasoning as ParsedReasoningLike)?.skills;
  if (routerSkills && iterateNamedMap(routerSkills).length > 0) {
    ctx.error(
      `Node '${topicName}' declares reasoning.skills, but skills are not supported on router (hyperclassifier) nodes.`,
      getCstRange(routerSkills),
      'skills-not-supported-on-router'
    );
  }

  // Extract topic-level model configuration and merge with global
  const topicModelConfig = extractTopicModelConfiguration(topicBlock, ctx);
  const modelConfig = mergeModelConfigurations(
    globalModelConfig,
    topicModelConfig
  );

  // Compile system instructions
  const systemInstructions = compileSystemInstructions(
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
    ? `${systemInstructions.instructions}\n\n{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
    : systemInstructions.instructions;

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

  const combinedBeforeReasoningIteration = [
    ...systemInstructions.beforeReasoningIteration,
    ...beforeReasoningIteration,
  ];
  if (combinedBeforeReasoningIteration.length > 0) {
    node.before_reasoning_iteration = combinedBeforeReasoningIteration;
  }
  if (source !== undefined) {
    (node as Record<string, unknown>).source = source;
  }

  ctx.setScriptPath(node, topicName);

  return node as RouterNode;
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
): (Action | HandOffAction)[] {
  // Procedural instructions: use deterministic directives. Adjacent same-gate
  // instruction appends are fused inside compileDeterministicDirectives (keyed
  // off agentInstructionsVariable). A `transition`/`escalate`/`end_session` in
  // the instructions emits a handoff here, so the result is not Action-only.
  if (isProcedural && proceduralStatements) {
    // The reset is prepended (and folded into the first unconditional append)
    // inside compileDeterministicDirectives on the instruction path.
    return compileDeterministicDirectives(proceduralStatements, _ctx, {
      addNextTopicResetAction: false,
      gateOnNextTopicEmpty: false,
      agentInstructionsVariable: AGENT_INSTRUCTIONS_VARIABLE,
    });
  }

  // Simple template: the reset + single unconditional append fold into one
  // assignment.
  if (!instructionTemplate) return [];

  return [
    createStateUpdateAction(
      [
        {
          [AGENT_INSTRUCTIONS_VARIABLE]:
            instructionResetAppendValue(instructionTemplate),
        },
      ],
      'True'
    ),
  ];
}
