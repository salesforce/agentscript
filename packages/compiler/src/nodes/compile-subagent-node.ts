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
  CollectClause,
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
  extractBooleanValue,
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
import { compileSkills } from './compile-skills.js';
import {
  compileDeterministicDirectives,
  createInstructionResetAction,
  createStateUpdateAction,
  instructionAppendValue,
} from './compile-directives.js';
import { resolveActionType } from './resolve-action-type.js';
import { compileReasoningActions } from './compile-reasoning-actions.js';
import {
  collectStepsFromStatements,
  findAllCollectTargets,
  buildCaptureTool,
  buildResumeHandoff,
  buildCancelTool,
  buildCompleteCondition,
  buildIncompleteCondition,
  cancelActionName,
  hasTrailingCompletionAfterCollect,
} from './compile-collect.js';

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

  // Compile skills
  const skills = compileSkills(
    (topicBlock as { skills?: Parameters<typeof compileSkills>[0] }).skills
  );

  // Compile reasoning tools
  const {
    tools,
    postToolCalls,
    afterAllToolCalls,
    instructionTemplate,
    isProcedural,
    proceduralStatements,
  } = compileReasoningTools(
    topicName,
    topicBlock.reasoning,
    topicDescriptions,
    ctx
  );

  // `collect` lowering: synthesize the capture tool and the end-turn-first
  // self-resume handoff for any collect statements in reasoning.instructions.
  // The gather prompts themselves are emitted via before_reasoning_iteration.
  // The resume handoff is emitted into AFTER_REASONING (collected below), not
  // after_all_tool_calls — see synthesizeCollectArtifacts for why.
  const collectAfterReasoning: (Action | HandOffAction)[] = [];
  synthesizeCollectArtifacts(
    topicName,
    proceduralStatements,
    tools,
    collectAfterReasoning,
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
      // Mixed or purely procedural instructions compiled into BRI.
      // Emit focus_prompt when there is instruction content to surface to the
      // LLM: actual template text (recursively, inside if/else bodies) OR any
      // `collect` statement. A collect-only subagent has no template text but
      // its gather prose lives in the agent-instructions state variable, so it
      // MUST still expose focus_prompt — otherwise the LLM never sees the
      // gather instructions and hallucinates fields.
      const hasTemplateContent =
        statementsHaveTemplateContent(proceduralStatements);
      const hasCollect =
        findAllCollectTargets(proceduralStatements, ctx).length > 0;
      focusPrompt =
        hasTemplateContent || hasCollect
          ? `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
          : '';
      beforeReasoningIteration = compileBeforeReasoningIteration(
        proceduralStatements,
        topicName,
        ctx
      );
    } else {
      // Template-only: use focus_prompt + BRI. Consecutive instruction lines
      // (`| ...` blocks) are flattened into a single append action.
      focusPrompt = `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`;
      beforeReasoningIteration =
        compileSimpleInstructionIteration(instructionTemplate);
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

  // Compile after_reasoning directives, then append any collect resume handoff.
  // The collect auto-resume handoff MUST run on no-tool-call ("ask a field")
  // turns. In the runtime react graph, when the LLM calls NO tool the graph
  // goes tool_planner -> after_reasoning (bypassing after_all_tool_calls), so a
  // handoff emitted in after_all_tool_calls never fires on ask-turns and the
  // turn does not suspend (end_turn_first is forced False), causing a reset to
  // the router. after_reasoning runs on BOTH the no-tool path and the
  // tool-call path (the reasoning loop terminates there once no further tool is
  // planned), and a handoff there sets hand_off -> on_exit with end_turn_first,
  // which suspends the turn and resumes the same subagent next turn.
  const afterReasoningDirectives = compileAfterReasoning(
    extractStatements(topicBlock.after_reasoning),
    ctx
  );
  const afterReasoning: (Action | HandOffAction)[] | null =
    afterReasoningDirectives || collectAfterReasoning.length > 0
      ? [...(afterReasoningDirectives ?? []), ...collectAfterReasoning]
      : null;

  const node: Sourceable<SubAgentNode> = {
    type: 'subagent',
    reasoning_type: DEFAULT_REASONING_TYPE,
    description,
    tools,
    developer_name: topicName,
    label,
    action_definitions: actionDefinitions,
  };

  // Always emit `instructions` as a string ("" when there is no system block;
  // `compileSystemInstructions` already returns "" in that case). The
  // downstream schema types this field as a non-nullable string, and omitting
  // the key causes it to round-trip as an explicit `null` (dumped from a None
  // default), which then fails re-validation against `str`. Emitting "" keeps
  // the value a valid string. This mirrors the router node, which already
  // always emits `instructions`. Assigned here (rather than in the literal
  // above) to preserve key insertion order for existing serialized fixtures.
  node.instructions = systemInstructions;

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
  if (skills.length > 0) {
    node.skills = skills;
  }
  if (source !== undefined) {
    node.source = source;
  }
  // Resolve the DSL `strip_salesforce_instructions` field with the
  // subagent-level `system` block overriding the global `system` block, and
  // emit it as the AgentJSON `strip_salesforce_system_prompt` field. Authors
  // set it at the top-level `system:` block to apply to every subagent, and
  // may override it on an individual subagent's `system:` block.
  const stripSalesforceInstructions =
    extractBooleanValue(topicBlock.system?.strip_salesforce_instructions) ??
    extractBooleanValue(systemBlock?.strip_salesforce_instructions);
  if (stripSalesforceInstructions !== undefined) {
    node.strip_salesforce_system_prompt = stripSalesforceInstructions;
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
  if (!reasoning) {
    return {
      tools,
      postToolCalls,
      afterAllToolCalls: allHandOffs,
      instructionTemplate,
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
    isProcedural: result.isProcedural,
    proceduralStatements: result.proceduralStatements,
  };
}

// ---------------------------------------------------------------------------
// Collect lowering
// ---------------------------------------------------------------------------

/**
 * Synthesize the capture tool and the end-turn-first self-resume handoff for
 * `collect` statements in a subagent's reasoning.instructions.
 *
 * - The capture tool (an @utils.setVariables-style action) is appended to the
 *   reasoning tools so the LLM can write collected fields.
 * - The self-resume handoff is appended to AFTER_REASONING (not
 *   after_all_tool_calls). after_reasoning runs on no-tool-call "ask a field"
 *   turns (tool_planner -> after_reasoning), whereas after_all_tool_calls is
 *   bypassed entirely when the LLM calls no tool. Emitting the handoff here lets
 *   it fire on ask-turns so the turn suspends (end_turn_first) and resumes the
 *   same subagent next turn instead of resetting to the router. It is gated on
 *   the gather being incomplete, so it disappears once all fields are filled.
 */
function synthesizeCollectArtifacts(
  topicName: string,
  proceduralStatements: Statement[] | undefined,
  tools: (Tool | SupervisionTool)[],
  afterReasoning: (Action | HandOffAction)[],
  ctx: CompilerContext
): void {
  const steps = collectStepsFromStatements(proceduralStatements, ctx);
  if (steps.length === 0) return;

  // `collect` is a demo/beta feature. Emit a single Information-severity notice
  // (once per script, gated by a flag on the per-compile context) pointed at the
  // first `collect` keyword. It does not fail compilation or alter output.
  if (!ctx.collectExperimentalNoticeEmitted) {
    ctx.collectExperimentalNoticeEmitted = true;
    ctx.info(
      "'collect' is experimental and provided for early feedback; its behavior may change in future releases.",
      firstCollectRange(proceduralStatements),
      'collect-experimental'
    );
  }

  // `collect` is only well-defined in a NON-initial subagent (W-23177847).
  // Its lowering assumes the gathering node is reached via a transition from the
  // router: the self-resume handoff re-arms the gather each turn, and
  // reset_to_initial_node returns the user to the router after the gather / on
  // cancel. The start_agent IS the initial node — if it hosts the gather,
  // reset_to_initial_node resets back INTO the gather every turn and there is no
  // router to fall back to: the user is trapped and cancel/change-of-intent has
  // nowhere to route. Reject it at author time rather than emit a trapping graph.
  if (ctx.initialNode && topicName === ctx.initialNode) {
    const range = firstCollectRange(proceduralStatements);
    ctx.error(
      "'collect' cannot be used in start_agent. Move it into a subagent.",
      range
    );
    return;
  }

  // Union EVERY collect target — top-level AND nested (branch) — so the shared
  // capture binding can write any field the user provides.
  const targets = findAllCollectTargets(proceduralStatements, ctx);
  if (targets.length === 0) return;

  // Capture tool — written into the reasoning actions.
  tools.push(buildCaptureTool(topicName, targets, ctx));

  // Change-of-intent escape hatch (W-23142782). Mid-gather the user may abandon
  // their original request ("never mind", "cancel", "let's do X instead").
  // Without an escape the gather is a trap: the resume handoff below re-arms the
  // same collecting node every turn while any field is unfilled, overriding
  // reset_to_initial_node. We synthesize a cancel tool the model can call to
  // break that loop. The cancel tool writes the graph's initial node (the
  // router) into next_topic, which gates OFF the resume handoff (its enabled
  // condition ANDs in NEXT_TOPIC_EMPTY_CONDITION), so the resume no longer
  // re-arms the collecting node and the turn ends cleanly on it.
  //
  // We deliberately emit NO cancel HANDOFF (W-23142782, superseding bbb0d6cf).
  // The deployed HTA reasoner does NOT honor end_turn_first at all — a handoff
  // whose target is a DIFFERENT node ALWAYS transitions in the SAME turn. So a
  // cancel handoff back to the router would re-run the router's instruction
  // injection and emit a SECOND closing message right after the collecting
  // node's "No problem…" acknowledgement — the change-of-intent "double
  // goodbye". (The earlier fix set end_turn_first:true on that handoff, but
  // that flag is a no-op on HTA, so the bug still reproduced live.) By DROPPING
  // the handoff: the cancel turn fires no handoff (resume is gated off because
  // next_topic is no longer EMPTY), the turn ends on the collecting node, and
  // exactly ONE message (the acknowledgement) is emitted. The user's NEXT
  // message resets to the router via reset_to_initial_node_on_every_turn (which
  // unconditionally sets the current agent to the initial node at the start of
  // every request — it does NOT read next_topic), so the new request is handled
  // normally. This mirrors the completion-path double-goodbye fix, which
  // likewise drops the handoff and relies on reset_to_initial_node for routing.
  //
  // The cancel tool can only route somewhere if the graph HAS an initial node;
  // ctx.initialNode is resolved before node compilation (see
  // compileAgentVersion). When absent (defensive — a well-formed agent always
  // has a start_agent), we skip the escape hatch and fall back to the prior
  // trap-but-functional behavior.
  const initialNode = ctx.initialNode;
  if (initialNode) {
    tools.push(buildCancelTool(topicName, initialNode));
  }

  // Emit ONLY the INCOMPLETE -> self resume handoff (end_turn_first:true): it
  // resumes the same subagent next turn while any field is still unfilled, and
  // its incomplete gate is FALSE once every field is filled, so it does not fire
  // on the completion turn. The branch gate is branch-aware: a branch-group step
  // counts as satisfied once any sibling field is filled.
  //
  // No completion handoff is emitted. The deployed HTA reasoner transitions to a
  // DIFFERENT-node handoff target in the SAME turn (it does not honor
  // end_turn_first), so a completion handoff back to the router re-ran the
  // router's instruction injection and emitted a SECOND closing message — the
  // "double goodbye". It is also unnecessary for routing: the agent runs with
  // reset_to_initial_node, so once the gather completes and the turn ends, the
  // user's NEXT message already resets to the router. Dropping the completion
  // handoff lets the turn end cleanly on the collecting subagent node.
  afterReasoning.push(buildResumeHandoff(topicName, steps));

  // No cancel handoff is emitted (see the change-of-intent comment above). The
  // cancel tool's next_topic write gates OFF this resume handoff, so the cancel
  // turn ends on the collecting node with a single acknowledgement message;
  // routing back to the router happens on the user's next message via
  // reset_to_initial_node. Emitting a different-node cancel handoff here would
  // transition in the same turn on HTA (end_turn_first is ignored) and produce
  // a second closing message — the double goodbye this story fixes.
}

/**
 * Find the source range of the first `collect` statement (top-level or nested in
 * an if's then/else body) so the start_agent rejection diagnostic points at the
 * offending construct. Falls back to undefined (FALLBACK_RANGE) when no range is
 * recoverable.
 */
function firstCollectRange(
  statements: Statement[] | undefined
): Range | undefined {
  if (!statements) return undefined;
  for (const stmt of statements) {
    if (stmt instanceof CollectClause) {
      return stmt.__cst?.range;
    }
    if (stmt instanceof IfStatement) {
      const nested = firstCollectRange([...stmt.body, ...stmt.orelse]);
      if (nested) return nested;
    }
  }
  return undefined;
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
  topicName: string,
  ctx: CompilerContext
): Action[] {
  if (statements.length === 0) return [];

  // Reset agent instructions
  const result: Action[] = [createInstructionResetAction()];

  // Compile each statement into before_reasoning_iteration actions. Adjacent
  // same-gate instruction appends (e.g. consecutive top-level `| ...` lines) are
  // fused inside compileDeterministicDirectives (keyed off
  // agentInstructionsVariable) into a single state update.
  const actions = compileDeterministicDirectives(statements, ctx, {
    addNextTopicResetAction: false,
    gateOnNextTopicEmpty: false,
    agentInstructionsVariable: AGENT_INSTRUCTIONS_VARIABLE,
    topicName,
  });

  result.push(...(actions as Action[]));

  // Terminal-turn STOP instruction (W-23142779).
  //
  // before_reasoning_iteration resets AGENT_INSTRUCTIONS_VARIABLE to '' every
  // turn and then appends a gather prompt only for fields that are still
  // unfilled. On the completion ("end") turn every field IS filled, so no
  // gather prompt is appended and the agent-instructions variable stays empty.
  // With no instruction in focus_prompt the LLM has nothing telling it to stop,
  // so it freelances and hallucinates field values.
  //
  // To close that gap we append a gated instruction, enabled ONLY on the
  // complete condition (the exact complement of the resume gate), that
  // re-asserts "everything is collected, do not ask for more". The deterministic
  // completion handoff still routes back to the router (see
  // synthesizeCollectArtifacts), but this guarantees the terminal turn never
  // leaves the LLM with an empty instruction to freelance into.
  //
  // Suppressed when the builder authored their own trailing completion handling,
  // mirroring the completion-handoff suppression so we never override their prose.
  const collectSteps = collectStepsFromStatements(statements, ctx);
  if (
    collectSteps.length > 0 &&
    !hasTrailingCompletionAfterCollect(statements, ctx)
  ) {
    result.push({
      type: 'action',
      target: STATE_UPDATE_ACTION,
      enabled: buildCompleteCondition(collectSteps),
      state_updates: [
        {
          [AGENT_INSTRUCTIONS_VARIABLE]: `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}\nAll required details are collected. Do not ask for anything further.`,
        },
      ],
    });
  }

  // Change-of-intent instruction (W-23142782).
  //
  // The gather prompts above are hard-steered: each tells the model to ask for
  // the next missing field and call the capture tool. Nothing in that prose
  // lets the user back out, so a mid-gather "actually never mind / cancel /
  // let's do X instead" is ignored and the user is trapped. We append a gated
  // instruction — enabled ONLY while the gather is INCOMPLETE (the same
  // condition that arms the resume handoff), i.e. exactly on the ask turns where
  // a change-of-intent can happen — that tells the model to call the cancel tool
  // instead of asking for the next field when the user wants to bail. The cancel
  // tool flips next_topic to the router; the cancel handoff then routes there in
  // the same turn (see synthesizeCollectArtifacts) and the new request is
  // handled normally.
  //
  // Only emitted when the graph has an initial node to route back to (so the
  // cancel tool actually exists). Unlike the terminal STOP instruction this is
  // NOT suppressed by builder-authored trailing content: trailing content is a
  // COMPLETION-path concern (the builder's closing prose after a finished
  // gather), whereas change-of-intent operates mid-gather on the INCOMPLETE
  // path, so the two never conflict — a builder who wrote a closing message
  // still wants the user to be able to bail before the gather finishes.
  if (collectSteps.length > 0 && ctx.initialNode) {
    const cancelName = cancelActionName(topicName);
    result.push({
      type: 'action',
      target: STATE_UPDATE_ACTION,
      enabled: buildIncompleteCondition(collectSteps),
      state_updates: [
        {
          [AGENT_INSTRUCTIONS_VARIABLE]: `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}\nIf the user changes their mind, cancels, says never mind, or asks for something else instead, do not ask for the next field — call ${cancelName} instead.`,
        },
      ],
    });
  }

  return result;
}

/**
 * Create before_reasoning_iteration actions for simple template instructions.
 * Resets agent instructions then appends the whole template in a single action.
 * Consecutive `| ...` instruction lines are already joined with `\n` into one
 * template string, so N lines flatten to one append rather than N appends.
 */
function compileSimpleInstructionIteration(
  instructionTemplate: string
): Action[] {
  const resetAction = createInstructionResetAction();
  if (!instructionTemplate) return [resetAction];

  const appendAction = createStateUpdateAction([
    {
      [AGENT_INSTRUCTIONS_VARIABLE]: instructionAppendValue(
        AGENT_INSTRUCTIONS_VARIABLE,
        instructionTemplate
      ),
    },
  ]);

  return [resetAction, appendAction];
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
