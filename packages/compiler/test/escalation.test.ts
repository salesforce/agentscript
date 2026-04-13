/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Escalation compilation tests — ported from Python:
 * - test_auto_escalation_state.py
 * - test_compile_utils_escalate.py
 *
 * Tests auto/manual escalation to human agents.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  EMPTY_ESCALATION_NODE_VALUE,
  ESCALATION_TARGET,
  STATE_UPDATE_ACTION,
} from '../src/constants.js';

describe('auto escalation', () => {
  // Python: test_auto_escalation_state.test_auto_escalation_adds_tool_handoff_and_state_variable
  // Python: test_compile_utils_escalate.test_compile_utils_escalate_auto_mode_without_condition
  it('should compile auto escalation to state update tool + handoff to __human__', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System instructions"

start_agent main:
    description: "Route user"
    reasoning:
        instructions: ->
            | Route user
        actions:
            escalate_auto: @utils.escalate
                description: "Escalate when confidence is low."
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // Should have a state update tool
    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);

    const tool = stateUpdateTools[0];
    expect(tool.name).toBe('escalate_auto');
    expect(tool.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_ESCALATION_NODE_VALUE },
    ]);

    // Should have a handoff to __human__
    expect(node.after_all_tool_calls).toBeDefined();
    const humanHandoffs = node.after_all_tool_calls!.filter(
      h => h.target === ESCALATION_TARGET
    );
    expect(humanHandoffs.length).toBe(1);

    const handoff = humanHandoffs[0];
    expect(handoff.enabled).toBe(
      `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`
    );
    expect(handoff.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
  });

  // Python: test_auto_escalation_state.test_auto_escalation_adds_tool_handoff_and_state_variable
  it('should inject next_topic state variable for escalation', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Route user
        actions:
            escalate_auto: @utils.escalate
                description: "Escalate"
`;
    const { output } = compile(parseSource(source));

    // Ensure the next topic state variable is present
    const nextTopicVars = output.agent_version.state_variables.filter(
      v => v.developer_name === NEXT_TOPIC_VARIABLE
    );
    expect(nextTopicVars.length).toBe(1);
  });
});

describe('escalation with available when', () => {
  it('should create tool with enabled condition from available when', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

variables:
    allow_handoff: mutable boolean = False

start_agent main:
    description: "Handle request"
    reasoning:
        instructions: ->
            | Handle request
        actions:
            escalate_manual: @utils.escalate
                description: "Escalate to human"
                available when @variables.allow_handoff
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // Should create a state update tool with enabled condition
    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);

    const tool = stateUpdateTools[0];
    expect(tool.name).toBe('escalate_manual');
    expect(tool.enabled).toBe('state.allow_handoff');
    expect(tool.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_ESCALATION_NODE_VALUE },
    ]);

    // Should have a handoff gated on the internal state variable
    expect(node.after_all_tool_calls).toBeDefined();
    const humanHandoffs = node.after_all_tool_calls!.filter(
      h => h.target === ESCALATION_TARGET
    );
    expect(humanHandoffs.length).toBe(1);

    const handoff = humanHandoffs[0];
    expect(handoff.enabled).toBe(
      `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`
    );
    expect(handoff.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
  });

  it('should compile complex available when expression as tool enabled', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

variables:
    is_business_hours: mutable boolean = False

start_agent main:
    description: "Handle request"
    reasoning:
        instructions: ->
            | Handle request
        actions:
            human_escalation: @utils.escalate
                description: "Escalate to human agent"
                available when @variables.is_business_hours == True
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // Tool should have the available when as enabled
    const tool = node.tools.find(t => t.name === 'human_escalation')!;
    expect(tool).toBeDefined();
    expect(tool.enabled).toBe('state.is_business_hours == True');
    expect(tool.target).toBe(STATE_UPDATE_ACTION);
  });

  it('should work alongside regular tools', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

variables:
    is_business_hours: mutable boolean = False
    case_ref: mutable string = ""

start_agent main:
    description: "Handle request"

    actions:
        create_case:
            description: "Create a case"
            inputs:
                subject_text: string
            outputs:
                ref_code: string
            target: "flow://Create_Case"

    reasoning:
        instructions: ->
            | Handle request
        actions:
            make_case: @actions.create_case
                with subject_text="test"
                set @variables.case_ref = @outputs.ref_code
            human_escalation: @utils.escalate
                description: "Escalate to human"
                available when @variables.is_business_hours == True
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // Should have both tools: make_case and human_escalation
    expect(node.tools.length).toBe(2);
    expect(node.tools[0].name).toBe('make_case');
    expect(node.tools[1].name).toBe('human_escalation');
    expect(node.tools[1].enabled).toBe('state.is_business_hours == True');

    // Handoff gated on internal state variable
    const handoff = node.after_all_tool_calls!.find(
      h => h.target === ESCALATION_TARGET
    )!;
    expect(handoff.enabled).toBe(
      `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`
    );
  });
});
