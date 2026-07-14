/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the `collect` language construct.
 *
 * `collect` gathers one or more variables from the user, one field at a time,
 * resuming the subagent across turns (via an end-turn-first self-handoff) until
 * every collected field is filled.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect, emitDocument } from '@agentscript/language';
import { AgentforceSchema } from '@agentscript/agentforce-dialect';
import { compile } from '../src/compile.js';
import { parseSource, parseFixture } from './test-utils.js';
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  STATE_UPDATE_ACTION,
} from '../src/constants.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import type {
  SubAgentNode,
  HandOffAction,
  Tool,
  Action,
} from '../src/types.js';

const SCRIPT = `
config:
    agent_name: "CollectBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    patient_address_line1: mutable string
        description: "Street address line 1."
    patient_city: mutable string
        description: "Town or city."

start_agent router:
    description: "Router"
    reasoning:
        instructions: ->
            | Route the user.
        actions:
            go_to_intake: @utils.transition to @subagent.patient_intake
                description: "Go to intake."

subagent patient_intake:
    description: "Gather address line 1 and city."
    reasoning:
        instructions: ->
            collect @variables.patient_address_line1:
                message: "Please provide the first line of your address."

            collect @variables.patient_city:
                message: "Please provide your town or city."
`;

function intakeNode(): SubAgentNode {
  const { output } = compile(parseSource(SCRIPT));
  return output.agent_version.nodes.find(
    n => n.developer_name === 'patient_intake'
  ) as SubAgentNode;
}

// Suppression variant: the builder authored their OWN trailing completion line
// (a `| prose` template) AFTER the last collect. The compiler must respect it
// and NOT inject the deterministic completion handoff.
const SCRIPT_SUPPRESSION = `
config:
    agent_name: "CollectBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    patient_address_line1: mutable string
        description: "Street address line 1."
    patient_city: mutable string
        description: "Town or city."

start_agent router:
    description: "Router"
    reasoning:
        instructions: ->
            | Route the user.
        actions:
            go_to_intake: @utils.transition to @subagent.patient_intake
                description: "Go to intake."

subagent patient_intake:
    description: "Gather address line 1 and city."
    reasoning:
        instructions: ->
            collect @variables.patient_address_line1:
                message: "Please provide the first line of your address."

            collect @variables.patient_city:
                message: "Please provide your town or city."

            | Thank you, your intake is complete. We will be in touch shortly.
`;

// Three-field variant to exercise the right-associated parenthesization the
// runtime evaluator requires for 3+ operand conditions.
const SCRIPT_THREE_FIELDS = `
config:
    agent_name: "CollectBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    patient_address_line1: mutable string
        description: "Street address line 1."
    patient_city: mutable string
        description: "Town or city."
    patient_email: mutable string
        description: "Email."

start_agent router:
    description: "Router"
    reasoning:
        instructions: ->
            | Route the user.
        actions:
            go_to_intake: @utils.transition to @subagent.patient_intake
                description: "Go to intake."

subagent patient_intake:
    description: "Gather address line 1, city, and email."
    reasoning:
        instructions: ->
            collect @variables.patient_address_line1:
                message: "Please provide the first line of your address."

            collect @variables.patient_city:
                message: "Please provide your town or city."

            collect @variables.patient_email:
                message: "Please provide your email address."
`;

function intakeNodeThreeFields(): SubAgentNode {
  const { output } = compile(parseSource(SCRIPT_THREE_FIELDS));
  return output.agent_version.nodes.find(
    n => n.developer_name === 'patient_intake'
  ) as SubAgentNode;
}

// Branching variant: a top-level collect followed by two sibling if-wrapped
// collects (email/phone). Exercises collect-inside-if, branch convergence in
// the gather guards + resume gate, and the union capture binding.
const SCRIPT_BRANCHING = `
config:
    agent_name: "CommsBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    communication_preference: mutable string
        description: "email or phone."
    contact_email: mutable string
        description: "Email."
    contact_phone: mutable string
        description: "Phone."

start_agent router:
    description: "Router"
    reasoning:
        instructions: ->
            | Route the user.
        actions:
            go_to_intake: @utils.transition to @subagent.comms_intake
                description: "Go to intake."

subagent comms_intake:
    description: "Collect comms preference, then branch to email or phone."
    reasoning:
        instructions: ->
            collect @variables.communication_preference:
                message: "How would you like us to contact you — email or phone?"

            if @variables.communication_preference == "email":
                collect @variables.contact_email:
                    message: "What is your email address?"

            if @variables.communication_preference == "phone":
                collect @variables.contact_phone:
                    message: "What is your phone number?"
`;

function commsIntakeNode(): {
  node: SubAgentNode;
  diagnostics: ReturnType<typeof compile>['diagnostics'];
} {
  const { output, diagnostics } = compile(parseSource(SCRIPT_BRANCHING));
  const node = output.agent_version.nodes.find(
    n => n.developer_name === 'comms_intake'
  ) as SubAgentNode;
  return { node, diagnostics };
}

function gatherActionFor(
  node: SubAgentNode,
  needle: string
): { enabled?: string } {
  const bri = node.before_reasoning_iteration!;
  const match = bri.filter(
    a =>
      Array.isArray(a.state_updates) &&
      a.state_updates.some(su =>
        Object.values(su).some(v => typeof v === 'string' && v.includes(needle))
      )
  );
  expect(match.length).toBe(1);
  return match[0];
}

describe('collect lowering', () => {
  it('compiles without errors and treats collect as procedural (BRI present)', () => {
    const { output, diagnostics } = compile(parseSource(SCRIPT));
    const errors = diagnostics.filter(d => d.severity === 'error');
    expect(errors).toEqual([]);

    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'patient_intake'
    ) as SubAgentNode;
    expect(node.before_reasoning_iteration).toBeDefined();
    expect(node.before_reasoning_iteration!.length).toBeGreaterThan(0);
  });

  it('emits a chained gather instruction per collect, gated on is None/is not None', () => {
    const node = intakeNode();
    const bri = node.before_reasoning_iteration!;

    const gatherActions = bri.filter(
      a =>
        Array.isArray(a.state_updates) &&
        a.state_updates.some(su =>
          Object.values(su).some(
            v => typeof v === 'string' && v.includes('Please provide')
          )
        )
    );
    expect(gatherActions.length).toBe(2);

    // First field: gated only on itself being None.
    const first = gatherActions[0];
    expect(first.enabled).toContain('state.patient_address_line1 is None');
    expect(first.enabled).not.toContain('patient_city');

    // Second field: gated on first being filled AND itself being None.
    const second = gatherActions[1];
    expect(second.enabled).toContain('state.patient_address_line1 is not None');
    expect(second.enabled).toContain('state.patient_city is None');
  });

  it('references the capture action by bare name in the gather prose', () => {
    const node = intakeNode();
    const bri = node.before_reasoning_iteration!;
    const text = JSON.stringify(bri);
    // Bare tool name, NOT the `{!@actions.X}` reference syntax: the prose is
    // injected into a dynamic instructions template the runtime does not run
    // through the action-reference resolver, so a literal `{!@actions.X}` would
    // leak to the LLM and cause the double-ask loop.
    expect(text).toContain('call capture_patient_intake_fields with');
    expect(text).not.toContain('{!@actions.capture_patient_intake_fields}');
  });

  it('emits a capture action as a reasoning tool that writes all fields', () => {
    const node = intakeNode();
    const capture = node.tools.find(
      t => 'name' in t && t.name === 'capture_patient_intake_fields'
    );
    expect(capture).toBeDefined();
    expect(capture!.target).toBe(STATE_UPDATE_ACTION);
    const updatedVars = (capture!.state_updates ?? []).flatMap(su =>
      Object.keys(su)
    );
    expect(updatedVars).toContain('patient_address_line1');
    expect(updatedVars).toContain('patient_city');
    expect(capture!.llm_inputs).toEqual([
      'patient_address_line1',
      'patient_city',
    ]);
  });

  it('emits PARTIAL-SAFE state_updates that never reference an absent result field', () => {
    // Regression guard for the one-field-per-turn capture crash: the gather
    // prompt asks for a single field per turn, so the LLM calls the capture
    // tool with ONLY that field. A plain `result.<field>` state-update then
    // raises a runtime SecurityError the moment it evaluates a field absent
    // from the partial result. Each state-update must instead be guarded so an
    // unprovided field falls back to its current state value.
    const node = intakeNode();
    const capture = node.tools.find(
      t => 'name' in t && t.name === 'capture_patient_intake_fields'
    );
    expect(capture).toBeDefined();

    const expr = (field: string): string =>
      `result.${field} if "${field}" in result else state.${field}`;
    expect(capture!.state_updates).toEqual([
      { patient_address_line1: expr('patient_address_line1') },
      { patient_city: expr('patient_city') },
    ]);

    // No state-update may be a bare `result.<field>` (the brittle form that
    // crashed on partial results); every one must carry the `in result` guard.
    for (const su of capture!.state_updates ?? []) {
      for (const value of Object.values(su)) {
        expect(value).toContain('in result');
        expect(value).not.toMatch(/^result\.[A-Za-z_]+$/);
      }
    }
  });

  it('emits a self-targeted end-turn-first handoff gated while incomplete', () => {
    const node = intakeNode();
    const handoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff'
    );
    const resume = handoffs.find(h => h.target === 'patient_intake');
    expect(resume).toBeDefined();
    expect(resume!.end_turn_first).toBe(true);
    // Fires only while incomplete (at least one field still None) AND no pending
    // transition — the next_topic-EMPTY term lets the cancel tool switch OFF the
    // resume (W-23142782): once the tool sets next_topic to the router, the
    // same-node resume no longer re-arms and the turn ends on the collecting node.
    expect(resume!.enabled).toBe(
      '(state.patient_address_line1 is None or state.patient_city is None) and ' +
        'state.AgentScriptInternal_next_topic=="__EMPTY__"'
    );
    // Resets next_topic when resuming.
    expect(resume!.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
  });

  it('emits the resume handoff in after_reasoning, NOT after_all_tool_calls', () => {
    // Regression guard: the auto-resume handoff MUST be attached to
    // after_reasoning so it fires on no-tool-call "ask a field" turns. In the
    // runtime react graph, a turn where the LLM calls no tool goes
    // tool_planner -> after_reasoning, bypassing after_all_tool_calls; emitting
    // the handoff in after_all_tool_calls means it never fires on ask-turns,
    // the turn does not suspend, and the runtime resets to the router.
    const node = intakeNode();
    const afterReasoningSelfHandoffs = (node.after_reasoning ?? []).filter(
      a =>
        a.type === 'handoff' && (a as HandOffAction).target === 'patient_intake'
    );
    expect(afterReasoningSelfHandoffs.length).toBe(1);

    const afterAllToolCallsSelfHandoffs = (
      node.after_all_tool_calls ?? []
    ).filter(
      a =>
        a.type === 'handoff' && (a as HandOffAction).target === 'patient_intake'
    );
    expect(afterAllToolCallsSelfHandoffs).toEqual([]);
  });

  it('does NOT emit ANY handoff to the router from a collect node (no double goodbye)', () => {
    // The deployed HTA reasoner transitions to a different-node handoff target
    // in the SAME turn (it ignores end_turn_first), so ANY handoff back to the
    // router re-runs the router's instruction injection and emits a SECOND
    // closing message — the double goodbye. This covers both the completion path
    // (handoff dropped in W-22865019) and the change-of-intent / cancel path
    // (handoff dropped in W-23142782, superseding the no-op end_turn_first fix in
    // bbb0d6cf). Routing back to the router happens on the user's NEXT message
    // via reset_to_initial_node, not via a handoff. The only handoff a collect
    // node emits is the same-node resume.
    const node = intakeNode();
    const routerHandoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff' && a.target === 'router'
    );
    expect(routerHandoffs).toEqual([]);
  });

  it('emits ONLY the incomplete->self resume handoff in after_reasoning', () => {
    const node = intakeNode();
    const handoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff'
    );
    // Exactly one handoff: the same-node resume (suspends, end_turn_first). No
    // cancel handoff (W-23142782) — the cancel tool's next_topic write gates the
    // resume off so the cancel turn ends on the collecting node with a single
    // acknowledgement, and reset_to_initial_node re-routes on the next message.
    expect(handoffs.length).toBe(1);
    const resume = handoffs[0];
    expect(resume.target).toBe('patient_intake');
    expect(resume.end_turn_first).toBe(true);
  });

  it('round-trips collect source through parse + emitDocument', () => {
    const src = `subagent intake:
   reasoning:
      instructions: ->
         collect @variables.patient_city:
            message: "Please provide your town or city."
`;
    const { rootNode: root } = parse(src);
    const mappingNode =
      root.namedChildren.find(n => n.type === 'mapping') ?? root;
    const dialect = new Dialect();
    const { value } = dialect.parse(mappingNode, AgentforceSchema);
    const emitted = emitDocument(
      value as Record<string, unknown>,
      AgentforceSchema
    );
    expect(emitted).toContain('collect @variables.patient_city:');
    expect(emitted).toContain('message: "Please provide your town or city."');
  });

  it('right-associates the resume handoff condition for 3+ fields', () => {
    const node = intakeNodeThreeFields();
    const handoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff'
    );
    const resume = handoffs.find(h => h.target === 'patient_intake');
    expect(resume).toBeDefined();
    // Right-associated incomplete condition `A or (B or C)` — explicit parens
    // for 3+ operands, matching the only existing 3-operand golden condition
    // (pronto) — then conjoined with the next_topic-EMPTY mutual-exclusion term
    // (W-23142782).
    expect(resume!.enabled).toBe(
      '(state.patient_address_line1 is None or (state.patient_city is None or state.patient_email is None)) and ' +
        'state.AgentScriptInternal_next_topic=="__EMPTY__"'
    );
  });

  it('right-associates the third gather guard for 3+ fields', () => {
    const node = intakeNodeThreeFields();
    const bri = node.before_reasoning_iteration!;
    const gatherActions = bri.filter(
      a =>
        Array.isArray(a.state_updates) &&
        a.state_updates.some(su =>
          Object.values(su).some(
            v => typeof v === 'string' && v.includes('email address')
          )
        )
    );
    expect(gatherActions.length).toBe(1);
    // Third field guard: two `is not None` priors AND this field `is None`,
    // right-associated to `A and (B and C)`.
    expect(gatherActions[0].enabled).toBe(
      'state.patient_address_line1 is not None and (state.patient_city is not None and state.patient_email is None)'
    );
  });

  it('compiles collect-inside-if with NO unsupported warning', () => {
    const { diagnostics } = commsIntakeNode();
    const warnings = diagnostics.filter(
      d =>
        typeof d.message === 'string' &&
        d.message.includes('collect') &&
        d.code !== 'collect-experimental'
    );
    expect(warnings).toEqual([]);
  });

  it('unions top-level AND nested collect targets into the capture tool', () => {
    const { node } = commsIntakeNode();
    const capture = node.tools.find(
      t => 'name' in t && t.name === 'capture_comms_intake_fields'
    );
    expect(capture).toBeDefined();
    expect(capture!.llm_inputs).toEqual([
      'communication_preference',
      'contact_email',
      'contact_phone',
    ]);
    const updatedVars = (capture!.state_updates ?? []).flatMap(su =>
      Object.keys(su)
    );
    expect(updatedVars).toEqual([
      'communication_preference',
      'contact_email',
      'contact_phone',
    ]);
  });

  it('ANDs the wrapping if predicate into a nested collect gather guard', () => {
    const { node } = commsIntakeNode();
    const emailGather = gatherActionFor(node, 'email address');
    // Wrapping if predicate (stored in the runtime condition variable) AND-ed
    // with the prior-step complete guard AND this field still None.
    expect(emailGather.enabled).toBe(
      '(state.AgentScriptInternal_condition_1) and ' +
        '(state.communication_preference is not None and state.contact_email is None)'
    );
  });

  it('branch convergence: a sibling branch does not gate on its sibling', () => {
    const { node } = commsIntakeNode();
    const phoneGather = gatherActionFor(node, 'phone number');
    // phone's prior guard is the step BEFORE the branch group
    // (communication_preference), NOT its mutually-exclusive sibling email.
    expect(phoneGather.enabled).toContain(
      'state.communication_preference is not None'
    );
    expect(phoneGather.enabled).not.toContain('contact_email');
    expect(phoneGather.enabled).toBe(
      '(state.AgentScriptInternal_condition_1) and ' +
        '(state.communication_preference is not None and state.contact_phone is None)'
    );
  });

  it('resume gate OR-converges branch siblings into one branch step', () => {
    const { node } = commsIntakeNode();
    const handoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff'
    );
    const resume = handoffs.find(h => h.target === 'comms_intake');
    expect(resume).toBeDefined();
    // Incomplete while: the preference step is unfilled OR the branch step is
    // unfilled (the branch step needs ALL siblings unfilled to count incomplete),
    // then conjoined with the next_topic-EMPTY mutual-exclusion term so a
    // mid-gather cancel is not overridden by the resume (W-23142782).
    expect(resume!.enabled).toBe(
      '(state.communication_preference is None or ' +
        '(state.contact_email is None and state.contact_phone is None)) and ' +
        'state.AgentScriptInternal_next_topic=="__EMPTY__"'
    );
  });

  it('sets focus_prompt to the agent-instructions state var for a collect-only subagent', () => {
    // A subagent whose instructions contain ONLY `collect` statements (no
    // `| prose`) must still surface the gathered instructions to the LLM via
    // focus_prompt — otherwise the accumulated gather prose in
    // AgentScriptInternal_agent_instructions is never shown and the LLM
    // hallucinates fields. Regression guard for the collect-only focus_prompt bug.
    const node = intakeNode();
    expect(node.focus_prompt).toBe(
      '{{state.AgentScriptInternal_agent_instructions}}'
    );
  });

  it('sets focus_prompt for a collect-inside-if-only subagent', () => {
    // Branching collect with no top-level `| prose` must also emit focus_prompt.
    const { node } = commsIntakeNode();
    expect(node.focus_prompt).toBe(
      '{{state.AgentScriptInternal_agent_instructions}}'
    );
  });

  const COMPLETION_MESSAGE =
    'All required details have been captured. Thank the user and confirm the request is complete.';

  function completionActions(node: SubAgentNode): Array<{ enabled?: string }> {
    const bri = node.before_reasoning_iteration ?? [];
    return bri.filter(
      a =>
        Array.isArray(a.state_updates) &&
        a.state_updates.some(su =>
          Object.values(su).some(
            v => typeof v === 'string' && v.includes(COMPLETION_MESSAGE)
          )
        )
    );
  }

  it('no longer injects a completion-MESSAGE BRI action (linear)', () => {
    // The product decision: the compiler must NOT inject conversational content
    // on completion. The completion-message BRI action is replaced by a
    // deterministic completion handoff (see the after_reasoning tests).
    const node = intakeNodeThreeFields();
    expect(completionActions(node)).toEqual([]);
    // No BRI state-update anywhere should carry the old completion-message text.
    expect(JSON.stringify(node.before_reasoning_iteration)).not.toContain(
      COMPLETION_MESSAGE
    );
  });

  it('no longer injects a completion-MESSAGE BRI action (branching)', () => {
    const { node } = commsIntakeNode();
    expect(completionActions(node)).toEqual([]);
    expect(JSON.stringify(node.before_reasoning_iteration)).not.toContain(
      COMPLETION_MESSAGE
    );
  });

  it('does NOT emit ANY router handoff for branching collects (no double goodbye)', () => {
    const { node } = commsIntakeNode();
    const handoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff'
    );
    // Exactly one handoff: the incomplete->self resume. No router handoff on
    // either the completion path (W-22865019) or the change-of-intent path
    // (W-23142782) — the cancel tool's next_topic write gates the resume off and
    // the turn ends on the collecting node, with reset_to_initial_node routing
    // the next message back to the router.
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].target).toBe('comms_intake');
    const routerHandoffs = handoffs.filter(h => h.target === 'router');
    expect(routerHandoffs).toEqual([]);
  });

  it('SUPPRESSION: does NOT inject a completion handoff when the builder authored trailing content', () => {
    // A non-collect statement (here a `| prose` template) after the last collect
    // signals the builder owns the completion; respect it and suppress the
    // injected completion handoff. The resume handoff is still emitted.
    const node = (() => {
      const { output } = compile(parseSource(SCRIPT_SUPPRESSION));
      return output.agent_version.nodes.find(
        n => n.developer_name === 'patient_intake'
      ) as SubAgentNode;
    })();
    const handoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff'
    );
    // Resume handoff (incomplete->self) still present...
    expect(handoffs.some(h => h.target === 'patient_intake')).toBe(true);
    // ...and there is NO router handoff at all. Trailing content suppresses the
    // COMPLETION instruction, and the change-of-intent path (W-23142782) never
    // emitted a handoff — it relies on the cancel tool gating off the resume.
    const routerHandoffs = handoffs.filter(h => h.target === 'router');
    expect(routerHandoffs).toEqual([]);
  });

  it('does not emit a completion handoff for subagents without collect', () => {
    const { output } = compile(parseSource(SCRIPT));
    const router = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode;
    const completionHandoffs = (router.after_reasoning ?? []).filter(
      a => a.type === 'handoff' && (a as HandOffAction).target === 'router'
    );
    expect(completionHandoffs).toEqual([]);
    expect(completionActions(router)).toEqual([]);
  });

  const STOP_INSTRUCTION =
    'All required details are collected. Do not ask for anything further.';

  function stopInstructionActions(
    node: SubAgentNode
  ): Array<{ enabled?: string }> {
    const bri = node.before_reasoning_iteration ?? [];
    return bri.filter(
      a =>
        Array.isArray(a.state_updates) &&
        a.state_updates.some(su =>
          Object.values(su).some(
            v => typeof v === 'string' && v.includes(STOP_INSTRUCTION)
          )
        )
    );
  }

  it('injects a terminal STOP instruction gated on the complete condition (W-23142779)', () => {
    // Regression guard: on the completion turn the BRI reset empties the
    // agent-instructions variable and no gather prompt is appended (every field
    // is filled), leaving the LLM with no instruction and causing it to
    // hallucinate field values. A gated stop-instruction must re-assert that
    // everything is collected, enabled ONLY on the complete condition.
    const node = intakeNode();
    const stops = stopInstructionActions(node);
    expect(stops.length).toBe(1);
    expect(stops[0].enabled).toBe(
      'state.patient_address_line1 is not None and state.patient_city is not None'
    );
  });

  it('terminal STOP instruction gate is the complete condition (complement of the resume gate)', () => {
    // The stop instruction fires on the complete turn — gated on
    // buildCompleteCondition, the exact complement of the resume handoff's
    // incomplete gate.
    const node = intakeNode();
    const resume = (node.after_reasoning ?? []).find(
      (a): a is HandOffAction =>
        a.type === 'handoff' && a.target === 'patient_intake'
    );
    const stops = stopInstructionActions(node);
    expect(resume).toBeDefined();
    expect(stops.length).toBe(1);
    expect(stops[0].enabled).toBe(
      'state.patient_address_line1 is not None and state.patient_city is not None'
    );
    expect(stops[0].enabled).not.toBe(resume!.enabled);
  });

  it('terminal STOP instruction appends to the agent-instructions var (does not overwrite)', () => {
    // It must template-append to the existing instructions, not replace them,
    // and target the state-update action like the other BRI instruction appends.
    const node = intakeNode();
    const bri = node.before_reasoning_iteration ?? [];
    const stop = bri.find(
      a =>
        Array.isArray(a.state_updates) &&
        a.state_updates.some(su =>
          Object.values(su).some(
            v => typeof v === 'string' && v.includes(STOP_INSTRUCTION)
          )
        )
    )!;
    expect(stop.target).toBe(STATE_UPDATE_ACTION);
    expect(stop.state_updates).toEqual([
      {
        AgentScriptInternal_agent_instructions: `template::{{state.AgentScriptInternal_agent_instructions}}\n${STOP_INSTRUCTION}`,
      },
    ]);
  });

  it('right-associates the terminal STOP gate for 3+ fields', () => {
    const node = intakeNodeThreeFields();
    const stops = stopInstructionActions(node);
    expect(stops.length).toBe(1);
    expect(stops[0].enabled).toBe(
      'state.patient_address_line1 is not None and (state.patient_city is not None and state.patient_email is not None)'
    );
  });

  it('terminal STOP instruction is SUPPRESSED when the builder authored trailing content', () => {
    const node = (() => {
      const { output } = compile(parseSource(SCRIPT_SUPPRESSION));
      return output.agent_version.nodes.find(
        n => n.developer_name === 'patient_intake'
      ) as SubAgentNode;
    })();
    expect(stopInstructionActions(node)).toEqual([]);
  });

  it('does not emit a terminal STOP instruction for subagents without collect', () => {
    const { output } = compile(parseSource(SCRIPT));
    const router = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode;
    expect(stopInstructionActions(router)).toEqual([]);
  });

  it('does not emit a resume handoff for subagents without collect', () => {
    const { output } = compile(parseSource(SCRIPT));
    const router = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode;
    const selfHandoffs = [
      ...(router.after_all_tool_calls ?? []),
      ...(router.after_reasoning ?? []),
    ].filter(
      a => a.type === 'handoff' && (a as HandOffAction).target === 'router'
    );
    expect(selfHandoffs).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Change-of-intent / cancel mid-gather (W-23142782)
  // -------------------------------------------------------------------------

  const CANCEL_INSTRUCTION =
    'If the user changes their mind, cancels, says never mind, or asks for ' +
    'something else instead, do not ask for the next field — call ' +
    'cancel_patient_intake_collect instead.';

  function cancelTool(node: SubAgentNode): Tool | undefined {
    return node.tools.find(
      (t): t is Tool =>
        'name' in t && t.name === 'cancel_patient_intake_collect'
    ) as Tool | undefined;
  }

  function cancelInstructionActions(
    node: SubAgentNode
  ): Array<{ enabled?: string }> {
    const bri = node.before_reasoning_iteration ?? [];
    return bri.filter(
      a =>
        Array.isArray(a.state_updates) &&
        a.state_updates.some(su =>
          Object.values(su).some(
            v => typeof v === 'string' && v.includes(CANCEL_INSTRUCTION)
          )
        )
    );
  }

  it('synthesizes a cancel tool that routes back to the initial node (router)', () => {
    // The cancel tool is the change-of-intent escape hatch: a state-update
    // action modeled on @utils.transition that writes the initial node into
    // next_topic. It takes no inputs (it only flips routing), so the user's new
    // request is never captured into a collect field.
    const node = intakeNode();
    const cancel = cancelTool(node);
    expect(cancel).toBeDefined();
    expect(cancel!.target).toBe(STATE_UPDATE_ACTION);
    expect(cancel!.llm_inputs).toEqual([]);
    expect(cancel!.input_parameters).toEqual([]);
    expect(cancel!.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: '"router"' },
    ]);
  });

  it('emits NO cancel handoff — the cancel tool gates off the resume instead', () => {
    // W-23142782 (superseding bbb0d6cf): the deployed HTA reasoner ignores
    // end_turn_first, so a different-node cancel handoff would transition to the
    // router in the SAME turn and emit a second closing message (double goodbye).
    // The earlier fix set end_turn_first:true on that handoff, but that flag is a
    // no-op on HTA, so the bug still reproduced live. The correct fix drops the
    // handoff entirely: the cancel tool's next_topic write gates OFF the resume
    // handoff, the turn ends on the collecting node with a single acknowledgement,
    // and reset_to_initial_node routes the user's next message back to the router.
    const node = intakeNode();
    const cancelHandoffs = (node.after_reasoning ?? []).filter(
      (a): a is HandOffAction => a.type === 'handoff' && a.target === 'router'
    );
    expect(cancelHandoffs).toEqual([]);
  });

  it('gates the resume handoff on next_topic EMPTY so a cancel is not overridden', () => {
    // Resume (same-node, end_turn_first) and cancel (different-node) must be
    // mutually exclusive. The resume gate is conjoined with next_topic=="__EMPTY__",
    // so once the cancel tool sets next_topic to the router the resume no longer
    // re-arms — otherwise the still-incomplete gather would trap the user again.
    const node = intakeNode();
    const resume = (node.after_reasoning ?? []).find(
      (a): a is HandOffAction =>
        a.type === 'handoff' && a.target === 'patient_intake'
    );
    expect(resume).toBeDefined();
    expect(resume!.enabled).toContain(
      `state.${NEXT_TOPIC_VARIABLE}=="__EMPTY__"`
    );
  });

  it('injects a change-of-intent instruction gated on the incomplete condition', () => {
    // The instruction is enabled ONLY while the gather is incomplete — the same
    // condition that arms the resume handoff, i.e. exactly the ask turns where a
    // change-of-intent can happen — and tells the model to call the cancel tool
    // instead of asking for the next field.
    const node = intakeNode();
    const instrs = cancelInstructionActions(node);
    expect(instrs.length).toBe(1);
    expect(instrs[0].enabled).toBe(
      'state.patient_address_line1 is None or state.patient_city is None'
    );
  });

  it('change-of-intent instruction appends to the agent-instructions var (does not overwrite)', () => {
    const node = intakeNode();
    const instrs = cancelInstructionActions(node);
    expect(instrs.length).toBe(1);
    expect((instrs[0] as Action).target).toBe(STATE_UPDATE_ACTION);
    expect((instrs[0] as Action).state_updates).toEqual([
      {
        AgentScriptInternal_agent_instructions: `template::{{state.AgentScriptInternal_agent_instructions}}\n${CANCEL_INSTRUCTION}`,
      },
    ]);
  });

  it('change-of-intent instruction is NOT suppressed by builder trailing content', () => {
    // Unlike the terminal STOP instruction, the cancel instruction operates on
    // the incomplete (mid-gather) path, orthogonal to the completion-path
    // trailing-content suppression. A builder closing message must not disable
    // the user's ability to bail before the gather finishes.
    const node = (() => {
      const { output } = compile(parseSource(SCRIPT_SUPPRESSION));
      return output.agent_version.nodes.find(
        n => n.developer_name === 'patient_intake'
      ) as SubAgentNode;
    })();
    // Cancel tool present...
    expect(
      node.tools.some(
        t => 'name' in t && t.name === 'cancel_patient_intake_collect'
      )
    ).toBe(true);
    // ...and the cancel instruction is still injected.
    expect(cancelInstructionActions(node).length).toBe(1);
  });

  it('does not synthesize a cancel tool or handoff for subagents without collect', () => {
    const { output } = compile(parseSource(SCRIPT));
    const router = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode;
    expect(
      router.tools.some(t => 'name' in t && /^cancel_/.test(t.name ?? ''))
    ).toBe(false);
    const cancelHandoffs = [
      ...(router.after_all_tool_calls ?? []),
      ...(router.after_reasoning ?? []),
    ].filter(
      a =>
        a.type === 'handoff' &&
        (a as HandOffAction).enabled?.includes('=="router"')
    );
    expect(cancelHandoffs).toEqual([]);
  });
});

// A `collect` placed directly in the start_agent (the graph's initial node) is
// rejected at compile time (W-23177847). Its lowering assumes the gathering
// node is a non-initial subagent reached via a transition; in the initial node
// reset_to_initial_node would reset back into the gather every turn and there
// is no router to fall back to, trapping the user.
const SCRIPT_COLLECT_IN_START_AGENT = `
config:
    agent_name: "CollectBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    patient_city: mutable string
        description: "Town or city."

start_agent router:
    description: "Router"
    reasoning:
        instructions: ->
            collect @variables.patient_city:
                message: "Please provide your town or city."
`;

describe('collect placement validation (W-23177847)', () => {
  it('rejects a collect inside start_agent with a clear, actionable error', () => {
    const { diagnostics } = compile(parseSource(SCRIPT_COLLECT_IN_START_AGENT));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(d =>
        d.message.includes("'collect' cannot be used in start_agent")
      )
    ).toBe(true);
  });

  it('does not synthesize collect artifacts on the rejected start_agent node', () => {
    const { output } = compile(parseSource(SCRIPT_COLLECT_IN_START_AGENT));
    const router = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode;
    // No capture / cancel tool, no self-resume handoff — the construct is
    // rejected before any artifacts are emitted.
    expect(
      (router.tools ?? []).some(
        t => 'name' in t && /^(capture|cancel)_/.test(t.name ?? '')
      )
    ).toBe(false);
  });

  it('still compiles a collect inside a non-initial subagent without errors', () => {
    // Regression guard: the valid placement (SCRIPT — collect in patient_intake,
    // a subagent reached via @utils.transition) must remain error-free.
    const { diagnostics } = compile(parseSource(SCRIPT));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toEqual([]);
  });
});

// Two subagents each using `collect` — the experimental notice must still fire
// only ONCE per script (guarded by a flag on the per-compile context).
const SCRIPT_TWO_COLLECT_SUBAGENTS = `
config:
    agent_name: "CollectBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    patient_address_line1: mutable string
        description: "Street address line 1."
    patient_city: mutable string
        description: "Town or city."

start_agent router:
    description: "Router"
    reasoning:
        instructions: ->
            | Route the user.
        actions:
            go_to_intake: @utils.transition to @subagent.patient_intake
                description: "Go to intake."
            go_to_billing: @utils.transition to @subagent.billing_intake
                description: "Go to billing."

subagent patient_intake:
    description: "Gather address line 1."
    reasoning:
        instructions: ->
            collect @variables.patient_address_line1:
                message: "Please provide the first line of your address."

subagent billing_intake:
    description: "Gather city."
    reasoning:
        instructions: ->
            collect @variables.patient_city:
                message: "Please provide your town or city."
`;

const COLLECT_EXPERIMENTAL_MESSAGE =
  "'collect' is experimental and provided for early feedback; its behavior may change in future releases.";

describe('collect experimental notice (W-22865019)', () => {
  it('emits exactly ONE Information diagnostic with the exact message and code', () => {
    const { diagnostics } = compile(parseSource(SCRIPT));
    const notices = diagnostics.filter(d => d.code === 'collect-experimental');
    expect(notices).toHaveLength(1);
    expect(notices[0].severity).toBe(DiagnosticSeverity.Information);
    expect(notices[0].message).toBe(COLLECT_EXPERIMENTAL_MESSAGE);
  });

  it('emits the notice only ONCE across multiple subagents using collect', () => {
    const { diagnostics } = compile(parseSource(SCRIPT_TWO_COLLECT_SUBAGENTS));
    const notices = diagnostics.filter(d => d.code === 'collect-experimental');
    expect(notices).toHaveLength(1);
    expect(notices[0].severity).toBe(DiagnosticSeverity.Information);
  });

  it('emits NO notice for a script that does not use collect', () => {
    const { diagnostics } = compile(parseFixture('001_loan_origination.agent'));
    const notices = diagnostics.filter(d => d.code === 'collect-experimental');
    expect(notices).toHaveLength(0);
  });

  it('points the notice at the first collect, not the (0,0) fallback', () => {
    const { diagnostics } = compile(parseSource(SCRIPT));
    const notice = diagnostics.find(d => d.code === 'collect-experimental');
    expect(notice).toBeDefined();
    const { start } = notice!.range;
    expect(start.line === 0 && start.character === 0).toBe(false);
  });
});
