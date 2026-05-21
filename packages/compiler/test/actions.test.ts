/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Action compilation tests — ported from Python:
 * - test_action_aliases.py
 *
 * Tests action aliases (name vs target), parameter binding,
 * conditions, and mixed actions + transitions.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { STATE_UPDATE_ACTION } from '../src/constants.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('action aliases: syntax', () => {
  // Python: test_action_aliases.test_action_with_alias_same_as_name
  it('should compile action where alias matches the action name', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    data: mutable string = ""

start_agent test:
    description: "Test"
    actions:
        simple_action:
            description: "A simple action"
            target: "flow://SimpleAction"
            inputs:
                param1: string
    reasoning:
        instructions: ->
            | test
        actions:
            simple_action: @actions.simple_action
                with param1=@variables.data
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    // Find the action tool (not a state update tool)
    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(1);

    const tool = actionTools[0];
    expect(tool.name).toBe('simple_action');
    expect(tool.target).toBe('simple_action');
  });

  // Python: test_action_aliases.test_action_with_alias
  it('should compile action with alias different from action name', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    data: mutable string = ""

start_agent test:
    description: "Test"
    actions:
        Very_Long_Technical_Action_Name_V2_XYZ:
            description: "A technical action"
            target: "flow://VeryLongAction"
            inputs:
                param1: string
    reasoning:
        instructions: ->
            | test
        actions:
            friendly_name: @actions.Very_Long_Technical_Action_Name_V2_XYZ
                with param1=@variables.data
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(1);

    const tool = actionTools[0];
    expect(tool.name).toBe('friendly_name'); // LLM sees the friendly name
    expect(tool.target).toBe('Very_Long_Technical_Action_Name_V2_XYZ'); // Actual action
  });

  // Python: test_action_aliases.test_multiple_actions_with_aliases
  it('should compile multiple actions with different aliases', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    data: mutable string = ""
    other: mutable string = ""
    final: mutable string = ""

start_agent test:
    description: "Test"
    actions:
        first_action:
            description: "First"
            target: "flow://First"
            inputs:
                param1: string
        second_action:
            description: "Second"
            target: "flow://Second"
            inputs:
                param2: string
        Third_Long_Action_Name:
            description: "Third"
            target: "flow://Third"
            inputs:
                param3: string
    reasoning:
        instructions: ->
            | test
        actions:
            friendly_first: @actions.first_action
                with param1=@variables.data
            second: @actions.second_action
                with param2=@variables.other
            simple_third: @actions.Third_Long_Action_Name
                with param3=@variables.final
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(3);

    expect(actionTools[0].name).toBe('friendly_first');
    expect(actionTools[0].target).toBe('first_action');

    expect(actionTools[1].name).toBe('second');
    expect(actionTools[1].target).toBe('second_action');

    expect(actionTools[2].name).toBe('simple_third');
    expect(actionTools[2].target).toBe('Third_Long_Action_Name');
  });
});

describe('action aliases: parameter binding', () => {
  // Python: test_action_aliases.test_compile_action_with_matching_alias
  it('should bind parameters from with clauses', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    data: mutable string = ""

start_agent test:
    description: "Test"
    actions:
        simple_action:
            description: "A simple action"
            target: "flow://SimpleAction"
            inputs:
                param1: string
    reasoning:
        instructions: ->
            | test
        actions:
            simple_action: @actions.simple_action
                with param1=@variables.data
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(1);
    expect(actionTools[0].bound_inputs).toEqual({ param1: 'state.data' });
  });

  // Python: test_action_aliases.test_compile_action_with_alias (multi-param)
  it('should bind multiple parameters from with clauses', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    data: mutable string = ""
    user_id: mutable string = ""

start_agent test:
    description: "Test"
    actions:
        Very_Long_Technical_Action_Name_V2_XYZ:
            description: "Technical action"
            target: "flow://VeryLong"
            inputs:
                param1: string
                param2: string
    reasoning:
        instructions: ->
            | test
        actions:
            friendly_name: @actions.Very_Long_Technical_Action_Name_V2_XYZ
                with param1=@variables.data
                with param2=@variables.user_id
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(1);
    expect(actionTools[0].bound_inputs).toEqual({
      param1: 'state.data',
      param2: 'state.user_id',
    });
  });
});

describe('action with condition', () => {
  // Python: test_action_aliases.test_compile_action_with_condition
  it('should compile action with available when condition', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    should_run: linked boolean
        description: "Should Run"
    data: mutable string = ""

start_agent test:
    description: "Test"
    actions:
        conditional_action:
            description: "Conditional action"
            target: "flow://ConditionalAction"
            inputs:
                param1: string
    reasoning:
        instructions: ->
            | test
        actions:
            check_condition: @actions.conditional_action
                available when @variables.should_run
                with param1=@variables.data
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(1);

    const tool = actionTools[0];
    expect(tool.name).toBe('check_condition');
    expect(tool.target).toBe('conditional_action');
    expect(tool.enabled).toBe('variables.should_run');
  });

  // Python: test_parse_expression_with_system_variables_user_input
  it('should compile action with available when @system_variables condition', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test topic"
    actions:
        test_action:
            description: "Test action"
            target: "flow://TestAction"
    reasoning:
        instructions: ->
            | test
        actions:
            test_action: @actions.test_action
                available when @system_variables.user_input == "test"
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(1);
    expect(actionTools[0].enabled).toBe('state.__user_input__ == "test"');
  });
});

describe('mixed actions and transitions', () => {
  // Python: test_action_aliases.test_mixed_actions_and_transitions
  it('should compile actions alongside transitions', () => {
    const source = `
config:
    agent_name: "Mixed_Test_Agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    data: mutable string = ""
    other: mutable string = ""

start_agent main:
    description: "Handle user requests and transitions"
    actions:
        Long_Technical_Action_Name:
            description: "A technical action"
            target: "flow://LongAction"
            inputs:
                param: string
        another_action:
            description: "Another action"
            target: "flow://Another"
            inputs:
                other_param: string
    reasoning:
        instructions: ->
            | Handle user requests and transitions
        actions:
            friendly_action: @actions.Long_Technical_Action_Name
                with param=@variables.data
            go_next: @utils.transition to @topic.next
                description: "Move to next step"
            another: @actions.another_action
                with other_param=@variables.other

topic next:
    description: "Next step"
    reasoning:
        instructions: ->
            | Next step
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // Should have 3 tools: 2 action tools + 1 state update tool for transition
    expect(node.tools.length).toBe(3);

    // Action tools
    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );
    expect(actionTools.length).toBe(2);
    expect(actionTools[0].name).toBe('friendly_action');
    expect(actionTools[0].target).toBe('Long_Technical_Action_Name');

    // Transition tool
    const transitionTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(transitionTools.length).toBe(1);
    expect(transitionTools[0].name).toBe('go_next');
  });
});

describe('placeholder actions', () => {
  it('should emit warning for placeholder:// target during compilation', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        stub_action:
            description: "A stub action"
            target: "placeholder://future_implementation"
    reasoning:
        instructions: ->
            | test
        actions:
            stub: @actions.stub_action
`;
    const { output, diagnostics } = compile(parseSource(source));

    // Should compile successfully
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;
    expect(node).toBeDefined();

    // Should have warning diagnostic
    const warnings = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Warning
    );
    expect(warnings.length).toBeGreaterThan(0);

    const placeholderWarnings = warnings.filter(w =>
      w.message.includes('placeholder target')
    );
    expect(placeholderWarnings).toHaveLength(1);
    expect(placeholderWarnings[0].message).toContain('stub_action');
    expect(placeholderWarnings[0].message).toContain(
      'Replace this with a real implementation before committing'
    );
  });

  it('should compile action definition with placeholder scheme', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        stub_action:
            description: "A stub action"
            target: "placeholder://tbd"
            inputs:
                param1: string
            outputs:
                result: string
    reasoning:
        instructions: ->
            | test
        actions:
            stub: @actions.stub_action
                with param1="test"
`;
    const { output } = compile(parseSource(source));

    // Find the node's action definitions
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    );
    const actions = node?.action_definitions ?? [];
    const stubAction = actions.find(a => a.developer_name === 'stub_action');

    expect(stubAction).toBeDefined();
    // Placeholder actions compile to invocation_target_type: "stub"
    expect(stubAction?.invocation_target_type).toBe('stub');
    // Target name is the action's developer name
    expect(stubAction?.invocation_target_name).toBe('stub_action');
  });

  it('should emit warnings for multiple placeholder actions', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        stub_one:
            description: "Stub one"
            target: "placeholder://implementation_one"
        stub_two:
            description: "Stub two"
            target: "placeholder://implementation_two"
    reasoning:
        instructions: ->
            | test
        actions:
            one: @actions.stub_one
            two: @actions.stub_two
`;
    const { diagnostics } = compile(parseSource(source));

    const placeholderWarnings = diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Warning &&
        d.message.includes('placeholder target')
    );
    expect(placeholderWarnings).toHaveLength(2);
  });
});
