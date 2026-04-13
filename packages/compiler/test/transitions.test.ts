/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Transition compilation tests — ported from Python:
 * - test_auto_transition.py
 * - test_manual_transition.py
 * - test_utils_transition.py
 * - test_description_inheritance.py
 * - test_inheritance.py (transition-related)
 * - test_state_variable_generation.py
 *
 * Tests auto/manual transitions, description inheritance, and state variable injection.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  STATE_UPDATE_ACTION,
} from '../src/constants.js';

describe('auto transitions', () => {
  // Python: test_auto_transition.test_auto_transition_compiles_to_tool_and_handoff
  // Python: test_utils_transition.test_auto_transition_compilation
  it('should compile auto transition to state update tool + handoff', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent test:
    description: "test"
    reasoning:
        instructions: ->
            | test
        actions:
            my_transition: @utils.transition to @topic.destination
                description: "Test transition"

topic destination:
    description: "destination"
    reasoning:
        instructions: ->
            | destination
`;
    const { output, diagnostics } = compile(parseSource(source));
    // Successful transition compilation should produce zero diagnostics
    expect(diagnostics).toHaveLength(0);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    // Should have a state update tool
    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);

    const tool = stateUpdateTools[0];
    expect(tool.name).toBe('my_transition');
    expect(tool.description).toBe('Test transition');
    expect(tool.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: '"destination"' },
    ]);

    // Should have a handoff action
    expect(node.after_all_tool_calls).toBeDefined();
    expect(node.after_all_tool_calls!.length).toBe(1);

    const handoff = node.after_all_tool_calls![0];
    expect(handoff.target).toBe('destination');
    expect(handoff.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="destination"`);
    expect(handoff.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
  });

  // Python: test_auto_transition.test_multiple_auto_transitions_compile
  it('should compile multiple auto transitions', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | current
        actions:
            first: @utils.transition to @topic.first_dest
                description: "First transition"
            second: @utils.transition to @topic.second_dest
                description: "Second transition"

topic first_dest:
    description: "first"
    reasoning:
        instructions: ->
            | first

topic second_dest:
    description: "second"
    reasoning:
        instructions: ->
            | second
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(2);

    expect(stateUpdateTools[0].name).toBe('first');
    expect(stateUpdateTools[0].state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: '"first_dest"' },
    ]);
    expect(stateUpdateTools[1].name).toBe('second');
    expect(stateUpdateTools[1].state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: '"second_dest"' },
    ]);

    // Both should have handoffs
    expect(node.after_all_tool_calls!.length).toBe(2);
  });
});

describe('manual transitions', () => {
  // Python: test_manual_transition.test_manual_transition_creates_tool_and_handoff
  // Python: test_utils_transition.test_manual_transition_compilation
  it('should compile manual transition with condition', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    ready: mutable boolean = False

start_agent test:
    description: "test"
    reasoning:
        instructions: ->
            | test
        actions:
            transition_4: @utils.transition to @topic.destination
                available when @variables.ready

topic destination:
    description: "destination"
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    // Manual transition should create a state update tool gated by condition
    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);

    const tool = stateUpdateTools[0];
    expect(tool.name).toBe('transition_4');
    expect(tool.enabled).toBe('state.ready');
    expect(tool.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: '"destination"' },
    ]);

    // Should have a handoff
    expect(node.after_all_tool_calls!.length).toBe(1);
    const handoff = node.after_all_tool_calls![0];
    expect(handoff.target).toBe('destination');
    expect(handoff.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="destination"`);
  });
});

describe('description inheritance', () => {
  // Python: test_utils_transition.test_description_inheritance
  // Python: test_description_inheritance.test_description_inherited_in_tool
  // Python: test_inheritance.test_topic_description_inheritance_basic
  it('should inherit description from target topic when not explicitly set', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent test:
    description: "test"
    reasoning:
        instructions: ->
            | test
        actions:
            my_transition: @utils.transition to @topic.destination

topic destination:
    description: "Destination topic description"
    reasoning:
        instructions: ->
            | destination
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);
    expect(stateUpdateTools[0].description).toBe(
      'Destination topic description'
    );
  });

  // Python: test_utils_transition.test_explicit_description_overrides_inheritance
  // Python: test_inheritance.test_explicit_description_overrides_inheritance
  it('should use explicit description over inherited one', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent test:
    description: "test"
    reasoning:
        instructions: ->
            | test
        actions:
            my_transition: @utils.transition to @topic.destination
                description: "Explicit description"

topic destination:
    description: "Destination topic description"
    reasoning:
        instructions: ->
            | destination
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);
    expect(stateUpdateTools[0].description).toBe('Explicit description');
  });

  // Python: test_utils_transition.test_inheritance_only_when_no_explicit_description
  it('should only inherit when no explicit description is provided', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent test:
    description: "test"
    reasoning:
        instructions: ->
            | test
        actions:
            my_transition: @utils.transition to @topic.destination

topic destination:
    description: "Inherited description"
    reasoning:
        instructions: ->
            | destination
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);
    expect(stateUpdateTools[0].description).toBe('Inherited description');
  });
});

describe('keyword flexibility', () => {
  // Python: test_utils_transition.test_keyword_flexibility
  it('should allow transition-related words in descriptions and variable names', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    transition_status: mutable string = "pending"
    user_message: mutable string = "Welcome to our service"

start_agent test:
    description: "Help users transition to the new interface"
    reasoning:
        instructions: ->
            | Guide the user to complete their transition
        actions:
            finish_transition: @utils.transition to @topic.complete
                description: "Move to completion when ready"

topic complete:
    description: "Transition completed successfully"
    reasoning:
        instructions: ->
            | Congratulate user on successful transition
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(2);

    // Verify descriptions contain "transition" as a word without conflict
    const testNode = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;
    expect(testNode.description).toContain('transition to the new interface');

    // Verify state variables include user-defined ones
    const stateVarNames = output.agent_version.state_variables.map(
      v => v.developer_name
    );
    expect(stateVarNames).toContain('transition_status');
    expect(stateVarNames).toContain('user_message');
  });
});

describe('mixed auto and manual transitions', () => {
  it('should compile mixed auto and manual transitions', () => {
    const source = `
config:
    agent_name: "InterviewAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    end_interview: mutable boolean = False

topic general_faq:
    description: "General FAQ handling"
    reasoning:
        instructions: ->
            | Answer general questions
        actions:
            Main_Interview: @utils.transition to @topic.ask_killer_questions
                description: "Transition to this topic when the user expresses desire to start an interview."
            transition_5: @utils.transition to @topic.finalize_interview
                available when @variables.end_interview

start_agent ask_killer_questions:
    description: "Interview questions"
    reasoning:
        instructions: ->
            | Ask interview questions

topic finalize_interview:
    description: "Interview completion"
    reasoning:
        instructions: ->
            | Finalize the interview
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'general_faq'
    )!;

    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(2);

    // Auto transition
    const autoTool = stateUpdateTools.find(t => t.name === 'Main_Interview')!;
    expect(autoTool).toBeDefined();
    expect(autoTool.description).toContain('start an interview');

    // Manual transition should be gated by condition
    const manualTool = stateUpdateTools.find(t => t.name === 'transition_5')!;
    expect(manualTool).toBeDefined();
    expect(manualTool.enabled).toBe('state.end_interview');
    expect(manualTool.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: '"finalize_interview"' },
    ]);

    // Both should have handoff entries
    expect(node.after_all_tool_calls!.length).toBe(2);
  });
});

describe('state variable generation', () => {
  // Python: test_state_variable_generation.test_auto_transition_ensures_next_topic_variable_present
  it('should always include AgentScriptInternal_next_topic state variable', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const nextTopicVars = output.agent_version.state_variables.filter(
      v => v.developer_name === NEXT_TOPIC_VARIABLE
    );
    expect(nextTopicVars.length).toBe(1);
    expect(nextTopicVars[0].default).toBe(EMPTY_TOPIC_VALUE);
  });

  // Python: test_state_variable_generation.test_manual_transition_also_has_next_topic_variable
  it('should include next_topic variable alongside user variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    ready: mutable boolean = False

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const nextTopicVars = output.agent_version.state_variables.filter(
      v => v.developer_name === NEXT_TOPIC_VARIABLE
    );
    expect(nextTopicVars.length).toBe(1);

    // User variable should also be present
    const readyVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'ready'
    );
    expect(readyVar).toBeDefined();
    expect(readyVar!.data_type).toBe('boolean');
  });
});
