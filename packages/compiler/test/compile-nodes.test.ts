/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Node compilation tests — ported from Python:
 * - test_compile_nodes.py
 *
 * Tests compile-level node compilation: multiple topics, start_agent naming,
 * system prompts, description defaults, parameter type conversion, router nodes,
 * variable assignments, and reasoning block compilation.
 *
 * Avoids duplicating tests already covered in node-compilation.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import {
  STATE_UPDATE_ACTION,
  AGENT_INSTRUCTIONS_VARIABLE,
} from '../src/constants.js';
import type { SubAgentNode, RouterNode, Action } from '../src/types.js';

// ---------------------------------------------------------------------------
// Python: test_compile_agentscript_with_functions_and_blocks
// ---------------------------------------------------------------------------

describe('compile multiple topics to multiple nodes', () => {
  it('should compile two topics with actions into two SubAgentNodes', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent UserManagement:
    description: "Manage user accounts"
    actions:
        getUser:
            description: "Get user information"
            target: "apex://getUser"
            inputs:
                userId: string
    reasoning:
        instructions: ->
            | Manage user accounts and profiles.
        actions:
            getUser: @actions.getUser

topic AdminTasks:
    description: "Admin tasks"
    actions:
        updateUser:
            description: "Update user information"
            target: "apex://updateUser"
            inputs:
                userId: string
                userData: object
    reasoning:
        instructions: ->
            | Perform administrative tasks.
        actions:
            updateUser: @actions.updateUser
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(2);

    const userNode = output.agent_version.nodes.find(
      n => n.developer_name === 'UserManagement'
    )!;
    const adminNode = output.agent_version.nodes.find(
      n => n.developer_name === 'AdminTasks'
    )!;

    expect(userNode).toBeDefined();
    expect(adminNode).toBeDefined();

    // UserManagement node
    expect(userNode.type).toBe('subagent');
    expect(userNode.description).toBe('Manage user accounts');
    expect(userNode.tools.length).toBe(1);
    expect(userNode.tools[0].name).toBe('getUser');
    expect(userNode.tools[0].target).toBe('getUser');
    expect(userNode.action_definitions!.length).toBe(1);
    expect(userNode.action_definitions![0].developer_name).toBe('getUser');
    expect(userNode.action_definitions![0].invocation_target_type).toBe('apex');
    expect(userNode.action_definitions![0].invocation_target_name).toBe(
      'getUser'
    );

    // AdminTasks node
    expect(adminNode.type).toBe('subagent');
    expect(adminNode.description).toBe('Admin tasks');
    expect(adminNode.tools.length).toBe(1);
    expect(adminNode.tools[0].name).toBe('updateUser');
    expect(adminNode.action_definitions!.length).toBe(1);
    expect(adminNode.action_definitions![0].developer_name).toBe('updateUser');
    expect(adminNode.action_definitions![0].input_type.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Python: test_compile_agentscript_single_topic
// ---------------------------------------------------------------------------

describe('single topic without actions produces clean node', () => {
  it('should compile topic with no actions into SubAgentNode with empty tools', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent InfoNode:
    description: "Info node"
    reasoning:
        instructions: ->
            | Provide information to the user.
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(1);

    const node = output.agent_version.nodes[0];
    expect(node.developer_name).toBe('InfoNode');
    expect(node.type).toBe('subagent');
    expect(node.description).toBe('Info node');
    expect(node.tools.length).toBe(0);
    expect(
      node.action_definitions === undefined ||
        node.action_definitions === null ||
        node.action_definitions.length === 0
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Python: test_compile_start_agent_with_name
// ---------------------------------------------------------------------------

describe('start_agent with explicit name', () => {
  it('should use the provided name as developer_name', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent greeting:
    description: "Greet the customer"
    reasoning:
        instructions: ->
            | Hello! How can I help you today?
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(1);

    const node = output.agent_version.nodes[0];
    expect(node.developer_name).toBe('greeting');
    expect(node.label).toBe('Greeting');
    expect(node.description).toBe('Greet the customer');
  });
});

// ---------------------------------------------------------------------------
// Python: test_compile_start_agent_without_name / start_agent_none_name
// (In TS syntax, start_agent without a name is not valid grammar.
//  The closest equivalent is using the block type itself as the name.)
// ---------------------------------------------------------------------------

describe('start_agent naming defaults', () => {
  it('should use given name and derive label from it', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent start_agent:
    description: "Anonymous start agent"
    reasoning:
        instructions: ->
            | Hello from anonymous start agent!
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(1);

    const node = output.agent_version.nodes[0];
    expect(node.developer_name).toBe('start_agent');
    expect(node.label).toBe('Start Agent');
    expect(node.description).toBe('Anonymous start agent');
  });
});

// ---------------------------------------------------------------------------
// Python: test_system_prompt_does_not_override_instructions
// Python: test_compile_node_with_system_prompt
// ---------------------------------------------------------------------------

describe('system prompt vs no system prompt behavior', () => {
  it('should use system block instructions as node.instructions when present', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    instructions: "System-level instructions"

start_agent TopicNode:
    description: "Test"
    reasoning:
        instructions: ->
            | Topic-level instructions
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TopicNode'
    )!;

    // System instructions land in node.instructions
    expect(node.instructions).toBe('System-level instructions');
    // Topic instructions are injected via focus_prompt + BRI
    expect(node.focus_prompt).toBe(`{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`);
    // BRI should exist to inject the topic instructions
    expect(node.before_reasoning_iteration).toBeDefined();
    expect(node.before_reasoning_iteration!.length).toBeGreaterThanOrEqual(2);

    // The second BRI action should contain the topic instructions
    const briActions = node.before_reasoning_iteration!;
    const instructionAppend = briActions.find(
      (a: Record<string, unknown>) =>
        typeof a.state_updates === 'object' &&
        JSON.stringify(a.state_updates).includes('Topic-level instructions')
    );
    expect(instructionAppend).toBeDefined();
  });

  it('should leave node.instructions empty when no system block present', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent TopicNode:
    description: "Test"
    reasoning:
        instructions: ->
            | Topic-level instructions only
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TopicNode'
    )!;

    // No system block means instructions should be omitted (match Python)
    expect(node.instructions).toBeUndefined();
    // Topic instructions still flow via focus_prompt
    expect(node.focus_prompt).toBe(`{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`);
  });

  it('should use system instructions across all nodes', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    instructions: "Global system instructions"

start_agent FunctionTopic:
    description: "Topic with functions"
    actions:
        processData:
            description: "Process data function"
            target: "apex://processData"
            inputs:
                data: object
    reasoning:
        instructions: ->
            | Function topic instructions
        actions:
            processData: @actions.processData

topic SimpleTopic:
    description: "Simple"
    reasoning:
        instructions: ->
            | Simple topic instructions

topic StartTopic:
    description: "Start agent topic"
    reasoning:
        instructions: ->
            | Welcome instructions
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(3);

    const functionNode = output.agent_version.nodes.find(
      n => n.developer_name === 'FunctionTopic'
    )!;
    const simpleNode = output.agent_version.nodes.find(
      n => n.developer_name === 'SimpleTopic'
    )!;
    const startNode = output.agent_version.nodes.find(
      n => n.developer_name === 'StartTopic'
    )!;

    // All nodes get global system instructions
    expect(functionNode.instructions).toBe('Global system instructions');
    expect(simpleNode.instructions).toBe('Global system instructions');
    expect(startNode.instructions).toBe('Global system instructions');

    // All use focus_prompt for template instructions
    expect(functionNode.focus_prompt).toBe(
      `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
    );
    expect(simpleNode.focus_prompt).toBe(
      `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
    );
    expect(startNode.focus_prompt).toBe(
      `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
    );

    // Function topic should have action definitions
    expect(functionNode.action_definitions!.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Python: test_none_description_handling
// ---------------------------------------------------------------------------

describe('node description defaults to empty string when missing', () => {
  it('should default description to empty string when not provided', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent NoDescNode:
    reasoning:
        instructions: ->
            | Instructions without description
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'NoDescNode'
    )!;

    expect(node.developer_name).toBe('NoDescNode');
    // Description should default to empty string
    expect(node.description).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Python: test_function_parameter_type_conversion
// ---------------------------------------------------------------------------

describe('function parameter type conversion', () => {
  it('should convert AgentScript types to correct AgentJSON parameter types', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent TypeTestTopic:
    description: "Test parameter type conversion"
    actions:
        typeTestFunction:
            description: "Function with various parameter types"
            target: "apex://typeTestFunction"
            inputs:
                stringParam: string
                numberParam: number
                boolParam: boolean
                objectParam: object
    reasoning:
        instructions: ->
            | Test parameter type conversion
        actions:
            typeTestFunction: @actions.typeTestFunction
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TypeTestTopic'
    )!;

    expect(node.action_definitions!.length).toBe(1);
    const actionDef = node.action_definitions![0];
    expect(actionDef.input_type.length).toBe(4);

    const paramsByName = new Map(
      actionDef.input_type.map(p => [p.developer_name, p])
    );

    // string -> String
    expect(paramsByName.get('stringParam')!.data_type).toBe('String');
    // number -> Double
    expect(paramsByName.get('numberParam')!.data_type).toBe('Double');
    // boolean -> Boolean
    expect(paramsByName.get('boolParam')!.data_type).toBe('Boolean');
    // object -> LightningTypes with complex_data_type_name
    expect(paramsByName.get('objectParam')!.data_type).toBe('LightningTypes');
    expect(paramsByName.get('objectParam')!.complex_data_type_name).toBe(
      'lightning__objectType'
    );
  });
});

// ---------------------------------------------------------------------------
// Python: test_compile_router_node_for_hyperclassifier_model
// ---------------------------------------------------------------------------

describe('router node compilation for hyperclassifier model', () => {
  it('should compile hyperclassifier model config to a RouterNode', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    other_topic_1_enabled: mutable boolean = False

start_agent start_agent:
    description: "Start agent description"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
    reasoning:
        instructions: ->
            | Start agent instructions
        actions:
            other_topic_1: @utils.transition to @topic.other_topic
                description: "Other topic description"
                available when @variables.other_topic_1_enabled
            other_topic_2: @utils.transition to @topic.other_topic_2
                description: "Other topic 2 description"

topic other_topic:
    description: "Other topic description"
    reasoning:
        instructions: ->
            | Other topic instructions

topic other_topic_2:
    description: "Other topic 2 description"
    reasoning:
        instructions: ->
            | Other topic 2 instructions

topic other_topic_3:
    description: "Other topic 3 description"
    reasoning:
        instructions: ->
            | Other topic 3 instructions
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'start_agent'
    )!;

    // Should be a router node
    expect(node.type).toBe('router');
    const routerNode = node as RouterNode;

    expect(routerNode.developer_name).toBe('start_agent');
    expect(routerNode.label).toBe('Start Agent');
    expect(routerNode.description).toBe('Start agent description');

    // Should have model configuration
    expect(routerNode.model_configuration).toBeDefined();
    expect(routerNode.model_configuration.model_ref).toBe(
      'sfdc_ai__DefaultEinsteinHyperClassifier'
    );

    // Should have router tools (NodeReferences) for transition targets
    expect(routerNode.tools.length).toBe(2);

    const tool1 = routerNode.tools[0];
    expect(tool1.name).toBe('other_topic_1');
    expect(tool1.target).toBe('other_topic');
    expect(tool1.description).toBe('Other topic description');
    expect(tool1.enabled).toContain('other_topic_1_enabled');

    const tool2 = routerNode.tools[1];
    expect(tool2.name).toBe('other_topic_2');
    expect(tool2.target).toBe('other_topic_2');
    expect(tool2.description).toBe('Other topic 2 description');

    // other_topic_3 should NOT be in the router tools (not referenced)

    // Instructions should include system + template variable reference
    expect(routerNode.instructions).toContain(
      `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
    );

    // Before reasoning iteration should reset and append instructions
    expect(routerNode.before_reasoning_iteration).toBeDefined();
    expect(routerNode.before_reasoning_iteration!.length).toBe(2);

    // First action: reset agent instructions
    const resetAction = routerNode.before_reasoning_iteration![0] as Action;
    expect(resetAction.target).toBe(STATE_UPDATE_ACTION);
    expect(resetAction.enabled).toBe('True');
    expect(resetAction.state_updates).toEqual([
      { [AGENT_INSTRUCTIONS_VARIABLE]: "''" },
    ]);

    // Second action: append instructions
    const appendAction = routerNode.before_reasoning_iteration![1] as Action;
    expect(appendAction.target).toBe(STATE_UPDATE_ACTION);
    const stateUpdate = appendAction.state_updates![0] as Record<
      string,
      string
    >;
    expect(stateUpdate[AGENT_INSTRUCTIONS_VARIABLE]).toContain(
      'Start agent instructions'
    );
  });

  it('should reject hyperclassifier model without URI scheme', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent router:
    description: "Router without URI scheme"
    model_config:
        model: "sfdc_ai__DefaultEinsteinHyperClassifier"
    reasoning:
        instructions: ->
            | Route to the best topic
        actions:
            go_support: @utils.transition to @topic.support
                description: "Support topic"

topic support:
    description: "Support topic"
    reasoning:
        instructions: ->
            | Provide support
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node).toBeDefined();
    expect(node.type).toBe('router');
    expect(node.model_configuration).toBeUndefined();

    // Should have an error about missing URI scheme
    expect(
      diagnostics.some(
        d =>
          d.message.includes('Model URI must include a scheme') &&
          d.message.includes('sfdc_ai__DefaultEinsteinHyperClassifier')
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Python: test_create_action_from_variable_assignment_with_namespace_default_to_state
// ---------------------------------------------------------------------------

describe('variable assignment action compilation with @variables reference', () => {
  it('should compile set @variables in before_reasoning to state update actions', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    test_variable: mutable string = ""
    some_variable: mutable string = "hello"

start_agent main:
    description: "Test"
    before_reasoning:
        set @variables.test_variable = @variables.some_variable
    reasoning:
        instructions: ->
            | Test instructions
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )! as SubAgentNode;

    // before_reasoning should contain state update actions
    expect(node.before_reasoning).toBeDefined();
    expect(node.before_reasoning!.length).toBeGreaterThanOrEqual(1);

    // Find the state update that sets test_variable
    const stateUpdates = node.before_reasoning!.filter(
      (a: Record<string, unknown>) => a.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdates.length).toBeGreaterThanOrEqual(1);

    // One of the state update actions should reference test_variable
    const testVarUpdate = stateUpdates.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'test_variable' in u);
    }) as Action | undefined;
    expect(testVarUpdate).toBeDefined();

    // The value should reference state.some_variable
    const updateEntry = testVarUpdate!.state_updates!.find(
      u => 'test_variable' in u
    ) as Record<string, string>;
    expect(updateEntry['test_variable']).toBe('state.some_variable');
  });
});

// ---------------------------------------------------------------------------
// Python: test_compile_reasoning_block_with_template_instructions
// ---------------------------------------------------------------------------

describe('reasoning block compilation with Template instructions', () => {
  it('should compile template instructions into focus_prompt + BRI', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent TemplateInstructionsTopic:
    description: "Template test"
    reasoning:
        instructions: ->
            | Direct template instructions without Procedure wrapper.
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TemplateInstructionsTopic'
    )!;

    expect(node.developer_name).toBe('TemplateInstructionsTopic');
    expect(node.label).toBe('Template Instructions Topic');
    expect(node.description).toBe('Template test');
    expect(node.type).toBe('subagent');
    expect((node as SubAgentNode).reasoning_type).toBe('salesforce.default');

    // Focus prompt uses state variable for dynamic instructions
    expect(node.focus_prompt).toBe(`{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`);

    // BRI should reset and append the template
    expect(node.before_reasoning_iteration).toBeDefined();
    expect(node.before_reasoning_iteration!.length).toBe(2);

    // First: reset action
    const resetAction = node.before_reasoning_iteration![0] as Action;
    expect(resetAction.target).toBe(STATE_UPDATE_ACTION);
    expect(resetAction.state_updates).toEqual([
      { [AGENT_INSTRUCTIONS_VARIABLE]: "''" },
    ]);

    // Second: append the template text
    const appendAction = node.before_reasoning_iteration![1] as Action;
    expect(appendAction.target).toBe(STATE_UPDATE_ACTION);
    const update = appendAction.state_updates![0] as Record<string, string>;
    expect(update[AGENT_INSTRUCTIONS_VARIABLE]).toContain(
      'Direct template instructions without Procedure wrapper.'
    );
  });
});
