/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range } from '@agentscript/types';
import type {
  Statement,
  ProcedureValue,
  Expression,
} from '@agentscript/language';
import {
  ToClause,
  TransitionStatement,
  Template,
  TemplateText,
  TemplateInterpolation,
  IfStatement,
  RunStatement,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  SubAgentNode,
  Tool,
  SupervisionTool,
  PostToolCall,
  HandOffAction,
  Action,
  ModelConfiguration,
} from '../types.js';
import type {
  ParsedTopicLike,
  ParsedSystem,
  ParsedTool,
} from '../parsed-types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- compiler handles both topic and subagent reasoning shapes generically
type ParsedReasoningLike = Record<string, any> | null | undefined;
import {
  DEFAULT_REASONING_TYPE,
  AGENT_INSTRUCTIONS_VARIABLE,
  STATE_UPDATE_ACTION,
  TRANSITION_TARGET_NAMESPACES,
} from '../constants.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedDescription,
  iterateNamedMap,
  resolveAtReference,
} from '../ast-helpers.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import type { Sourceable } from '../sourced.js';
import {
  extractTopicModelConfiguration,
  mergeModelConfigurations,
} from '../config/model-config.js';
import { normalizeDeveloperName, dedent } from '../utils.js';
import { compileActionDefinitions } from './compile-actions.js';
import { compileDeterministicDirectives } from './compile-directives.js';
import { resolveActionType } from './resolve-action-type.js';
import { warnIfConnectedAgentTransition } from './compile-utils.js';
import { compileReasoningActions } from './compile-reasoning-actions.js';

/**
 * Compile a topic block into a SubAgentNode.
 */
export function compileSubAgentNode(
  topicName: string,
  topicBlock: ParsedTopicLike,
  systemBlock: ParsedSystem | undefined,
  topicDescriptions: Record<string, string>,
  globalModelConfig: ModelConfiguration | undefined,
  ctx: CompilerContext
): SubAgentNode {
  const description = extractSourcedDescription(topicBlock.description) ?? '';
  const label =
    extractSourcedString(topicBlock.label) ?? normalizeDeveloperName(topicName);
  const source = extractSourcedString(topicBlock.source) ?? undefined;

  // Extract topic-level model configuration and merge with global
  const topicModelConfig = extractTopicModelConfiguration(topicBlock, ctx);
  const mergedModelConfig = mergeModelConfigurations(
    globalModelConfig,
    topicModelConfig
  );

  // Compile action definitions
  const actionDefinitions = compileActionDefinitions(
    topicBlock.tool_definitions ?? topicBlock.actions,
    ctx
  );

  // Compile reasoning tools
  const {
    tools,
    postToolCalls,
    afterAllToolCalls,
    instructionTemplate,
    instructionTemplateParts,
    isProcedural,
    proceduralStatements,
  } = compileReasoningTools(
    topicName,
    topicBlock.reasoning,
    topicDescriptions,
    ctx
  );

  // Compile system instructions
  const systemInstructions = compileSystemInstructions(
    systemBlock,
    topicBlock,
    ctx
  );

  // Compile focus_prompt and before_reasoning_iteration
  // Template-only instructions use focus_prompt + BRI to inject instructions.
  // Procedural instructions (if/run/transition) use BRI only — no focus_prompt.
  let focusPrompt: string;
  let beforeReasoningIteration: Action[];

  if (instructionTemplate !== undefined) {
    if (isProcedural && proceduralStatements) {
      // Mixed or purely procedural instructions compiled into BRI
      // Only emit focus_prompt when there's actual template text content
      // (recursively checking inside if/else bodies)
      const hasTemplateContent =
        statementsHaveTemplateContent(proceduralStatements);
      focusPrompt = hasTemplateContent
        ? `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
        : '';
      beforeReasoningIteration = compileBeforeReasoningIteration(
        proceduralStatements,
        ctx
      );
    } else {
      // Template-only: use focus_prompt + BRI
      focusPrompt = `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`;
      // Use per-block parts when available (multiple | blocks → separate BRI actions)
      const parts = instructionTemplateParts ?? [
        {
          text: instructionTemplate,
          range: topicBlock.reasoning?.instructions?.__cst?.range,
        },
      ];
      beforeReasoningIteration = compileSimpleInstructionIteration(parts, ctx);
    }
  } else {
    focusPrompt = compileFocusPrompt(undefined, topicBlock.reasoning);
    beforeReasoningIteration = [];
  }

  // Compile before_reasoning directives
  const beforeReasoning = compileBeforeReasoning(
    extractStatements(topicBlock.before_reasoning),
    ctx
  );

  // Compile after_reasoning directives
  const afterReasoning = compileAfterReasoning(
    extractStatements(topicBlock.after_reasoning),
    ctx
  );

  const node: Sourceable<SubAgentNode> = {
    type: 'subagent',
    reasoning_type: DEFAULT_REASONING_TYPE,
    description,
    tools,
    developer_name: topicName,
    label,
    action_definitions: actionDefinitions,
  };

  // Only emit instructions when non-empty (match Python: omit when no system block)
  if (systemInstructions) {
    node.instructions = systemInstructions;
  }

  // Only emit focus_prompt when non-empty
  if (focusPrompt) {
    node.focus_prompt = focusPrompt;
  }

  // Add optional fields only when present
  if (beforeReasoningIteration.length > 0) {
    node.before_reasoning_iteration = beforeReasoningIteration;
  }
  if (beforeReasoning) {
    node.before_reasoning = beforeReasoning as Action[];
  }
  if (afterReasoning) {
    node.after_reasoning = afterReasoning;
  }
  if (afterAllToolCalls.length > 0) {
    node.after_all_tool_calls = afterAllToolCalls;
  }
  if (postToolCalls.length > 0) {
    node.post_tool_call = postToolCalls;
  }
  if (mergedModelConfig) {
    node.model_configuration = mergedModelConfig;
  }
  if (source !== undefined) {
    node.source = source;
  }

  ctx.setScriptPath(node, topicName);

  return node as SubAgentNode;
}

// ---------------------------------------------------------------------------
// Reasoning Tools
// ---------------------------------------------------------------------------

interface ReasoningToolsResult {
  tools: (Tool | SupervisionTool)[];
  postToolCalls: PostToolCall[];
  afterAllToolCalls: (Action | HandOffAction)[];
  instructionTemplate: string | undefined;
  /** Individual compiled template parts (one per | block) with CST info */
  instructionTemplateParts: Array<{ text: string; range?: Range }> | undefined;
  /** True if instructions contain procedural statements (if/run/transition) */
  isProcedural: boolean;
  /** The raw ProcedureValueNode statements for procedural instructions */
  proceduralStatements: Statement[] | undefined;
}

function compileReasoningTools(
  topicName: string,
  reasoning: ParsedReasoningLike,
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): ReasoningToolsResult {
  const tools: (Tool | SupervisionTool)[] = [];
  const postToolCalls: PostToolCall[] = [];
  const allHandOffs: HandOffAction[] = [];
  let instructionTemplate: string | undefined;
  let instructionTemplateParts:
    | Array<{ text: string; range?: Range }>
    | undefined;
  if (!reasoning) {
    return {
      tools,
      postToolCalls,
      afterAllToolCalls: allHandOffs,
      instructionTemplate,
      instructionTemplateParts,
      isProcedural: false,
      proceduralStatements: undefined,
    };
  }

  // Pre-scan reasoning actions to build action reference map.
  // This maps target topic names to their reasoning action keys,
  // so that @actions.TopicName resolves to the tool key (e.g., go_to_TopicName).
  const reasoningTools = reasoning.actions;
  ctx.actionReferenceMap.clear();
  if (reasoningTools) {
    for (const [actionKey, actionDef] of iterateNamedMap(reasoningTools)) {
      const def = actionDef as ParsedTool;
      const actionType = resolveActionType(actionKey, def);
      if (actionType === 'transition') {
        // Find transition target from body statements
        const body = def.statements ?? [];
        let foundTarget = false;
        for (const stmt of body) {
          if (stmt instanceof ToClause) {
            if (warnIfConnectedAgentTransition(stmt.target, ctx)) continue;
            const targetName = resolveAtReference(
              stmt.target,
              TRANSITION_TARGET_NAMESPACES,
              ctx,
              'transition target'
            );
            if (targetName) {
              ctx.actionReferenceMap.set(targetName, actionKey);
              foundTarget = true;
            }
          } else if (stmt instanceof TransitionStatement) {
            for (const clause of stmt.clauses) {
              if (clause instanceof ToClause) {
                if (warnIfConnectedAgentTransition(clause.target, ctx))
                  continue;
                const targetName = resolveAtReference(
                  clause.target,
                  TRANSITION_TARGET_NAMESPACES,
                  ctx,
                  'transition target'
                );
                if (targetName) {
                  ctx.actionReferenceMap.set(targetName, actionKey);
                  foundTarget = true;
                }
              }
            }
          }
        }
        // Fallback: check colinear value for inline target (only if no target found in body)
        if (!foundTarget && def.value) {
          if (!warnIfConnectedAgentTransition(def.value as Expression, ctx)) {
            const targetName = resolveAtReference(
              def.value as Expression,
              TRANSITION_TARGET_NAMESPACES,
              ctx,
              'transition target'
            );
            if (targetName) {
              ctx.actionReferenceMap.set(targetName, actionKey);
            }
          }
        }
      }
    }
  }

  // Use unified reasoning action compiler
  const result = compileReasoningActions(
    reasoning,
    {
      nodeType: 'subagent',
      topicName,
      topicDescriptions,
    },
    ctx
  );

  return {
    tools: result.tools as (Tool | SupervisionTool)[],
    postToolCalls: result.postToolCalls,
    afterAllToolCalls: result.handOffActions,
    instructionTemplate: result.instructionTemplate,
    instructionTemplateParts: result.instructionTemplateParts,
    isProcedural: result.isProcedural,
    proceduralStatements: result.proceduralStatements,
  };
}

// ---------------------------------------------------------------------------
// System Instructions
// ---------------------------------------------------------------------------

function compileSystemInstructions(
  systemBlock: ParsedSystem | undefined,
  topicBlock: ParsedTopicLike,
  ctx: CompilerContext
): string {
  const opts = { allowActionReferences: true };

  // Topic-level system.instructions take priority
  if (topicBlock.system) {
    const instructions = compileTemplateValue(
      topicBlock.system.instructions,
      ctx,
      opts
    );
    if (instructions) return dedent(instructions);
  }

  // Fall back to global system.instructions
  if (systemBlock) {
    const instructions = compileTemplateValue(
      systemBlock.instructions,
      ctx,
      opts
    );
    if (instructions) return dedent(instructions);
  }

  return '';
}

// ---------------------------------------------------------------------------
// Before Reasoning Iteration (instruction injection)
// ---------------------------------------------------------------------------

function compileBeforeReasoningIteration(
  statements: Statement[],
  ctx: CompilerContext
): Action[] {
  if (statements.length === 0) return [];

  // Reset agent instructions
  const resetAction: Action = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    enabled: 'True',
    state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }],
  };
  const result: Action[] = [resetAction];

  // Compile each statement into before_reasoning_iteration actions
  const actions = compileDeterministicDirectives(statements, ctx, {
    addNextTopicResetAction: false,
    gateOnNextTopicEmpty: false,
    agentInstructionsVariable: AGENT_INSTRUCTIONS_VARIABLE,
  });

  result.push(...(actions as Action[]));

  return result;
}

/**
 * Create before_reasoning_iteration actions for simple template instructions.
 * Resets agent instructions then appends one action per template part.
 * When multiple | blocks exist, each gets a separate append action.
 */
function compileSimpleInstructionIteration(
  templateParts: Array<{ text: string; range?: Range }>,
  _ctx: CompilerContext
): Action[] {
  // Reset action
  const resetAction: Action = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    enabled: 'True',
    state_updates: [{ [AGENT_INSTRUCTIONS_VARIABLE]: "''" }],
  };

  const result: Action[] = [resetAction];

  for (const part of templateParts) {
    const appendAction: Action = {
      type: 'action',
      target: STATE_UPDATE_ACTION,
      state_updates: [
        {
          [AGENT_INSTRUCTIONS_VARIABLE]: `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}\n${part.text}`,
        },
      ],
    };
    result.push(appendAction);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Focus Prompt
// ---------------------------------------------------------------------------

function compileFocusPrompt(
  instructionTemplate: string | undefined,
  reasoning: ParsedReasoningLike
): string {
  // If there's a compiled instruction template, use it directly as focus_prompt
  if (instructionTemplate) {
    return instructionTemplate.trim();
  }

  // Direct focus prompt from reasoning (fallback — not typical for AgentForce)
  if (reasoning) {
    const focusPrompt = extractStringValue(reasoning['focus_prompt']);
    if (focusPrompt) return focusPrompt;
  }

  return '';
}

// ---------------------------------------------------------------------------
// Before/After Reasoning
// ---------------------------------------------------------------------------

function compileBeforeReasoning(
  directives: Statement[] | undefined,
  ctx: CompilerContext
): (Action | HandOffAction)[] | null {
  if (!directives || directives.length === 0) return null;
  return compileDeterministicDirectives(directives, ctx, {
    addNextTopicResetAction: true,
    gateOnNextTopicEmpty: true,
  });
}

function compileAfterReasoning(
  directives: Statement[] | undefined,
  ctx: CompilerContext
): (Action | HandOffAction)[] | null {
  if (!directives || directives.length === 0) return null;
  return compileDeterministicDirectives(directives, ctx, {
    addNextTopicResetAction: true,
    gateOnNextTopicEmpty: true,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// resolveActionType is imported from ./resolve-action-type.js

/**
 * Check if a statement tree contains any Template with non-whitespace content.
 * Recurses into if/else bodies to find nested templates.
 */
function statementsHaveTemplateContent(statements: Statement[]): boolean {
  for (const stmt of statements) {
    if (stmt instanceof Template) {
      if (
        stmt.parts?.some(
          p =>
            (p instanceof TemplateText && p.value?.trim()) ||
            p instanceof TemplateInterpolation
        )
      ) {
        return true;
      }
    }
    // Recurse into if/else bodies
    if (stmt instanceof IfStatement) {
      if (statementsHaveTemplateContent(stmt.body)) return true;
      if (stmt.orelse.length > 0 && statementsHaveTemplateContent(stmt.orelse))
        return true;
    } else if (stmt instanceof RunStatement) {
      if (statementsHaveTemplateContent(stmt.body)) return true;
    }
  }
  return false;
}

/**
 * Extract Statement[] from a before_reasoning/after_reasoning value.
 * The dialect parser returns a ProcedureValue with a `.statements` array,
 * not a raw Statement[]. This helper handles both formats.
 */
export function extractStatements(
  value: ProcedureValue | undefined
): Statement[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as Statement[];
  if ('statements' in value) {
    return value.statements;
  }
  return undefined;
}
