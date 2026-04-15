/**
 * Node compilation tests — ported from Python:
 * - test_delegation.py → supervision in TS
 * - test_delegation_integration.py → supervision integration
 * - test_inheritance.py (delegation-related → supervision-related)
 * - test_override_functionality.py → system instructions override
 *
 * Tests SubAgentNode compilation, supervision tools, system instructions,
 * labels, and description handling.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { STATE_UPDATE_ACTION } from '../src/constants.js';

describe('supervision (delegation) compilation', () => {
  // Python: test_delegation.test_compile_delegate_basic
  it('should compile basic supervision to SupervisionTool', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | Handle requests
        actions:
            get_specialist_help: @topic.specialist
                description: "Get help from specialist"

topic specialist:
    description: "Expert topic for complex problems"
    reasoning:
        instructions: ->
            | Handle complex problems
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    // Should have a supervision tool (not a state update tool)
    const supervisionTools = node.tools.filter(t => t.type === 'supervision');
    expect(supervisionTools.length).toBe(1);

    const tool = supervisionTools[0];
    expect(tool.name).toBe('get_specialist_help');
    expect(tool.target).toBe('specialist');
    expect(tool.description).toBe('Get help from specialist');
  });

  // Python: test_delegation.test_compile_delegate_with_condition
  it('should compile supervision with available when condition', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    complexity_level: mutable number = 0

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | Handle requests
        actions:
            get_specialist_help: @topic.specialist
                description: "Get help from specialist"
                available when @variables.complexity_level > 5

topic specialist:
    description: "Expert topic"
    reasoning:
        instructions: ->
            | Expert work
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    const supervisionTools = node.tools.filter(t => t.type === 'supervision');
    expect(supervisionTools.length).toBe(1);
    expect(supervisionTools[0].enabled).toContain('complexity_level');
  });

  // Python: test_delegation.test_compile_delegate_with_inheritance
  // Python: test_inheritance.test_delegation_basic_inheritance
  it('should inherit description from target topic when not explicit', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | Handle requests
        actions:
            get_specialist_help: @topic.specialist

topic specialist:
    description: "Expert topic for complex problems"
    reasoning:
        instructions: ->
            | Expert work
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    const supervisionTools = node.tools.filter(t => t.type === 'supervision');
    expect(supervisionTools.length).toBe(1);
    expect(supervisionTools[0].description).toBe(
      'Expert topic for complex problems'
    );
  });

  // Python: test_delegation.test_compile_delegate_explicit_description_overrides_inheritance
  // Python: test_inheritance.test_delegation_explicit_description_overrides_inheritance
  it('should use explicit description over inherited for supervision', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | Handle requests
        actions:
            get_specialist_help: @topic.specialist
                description: "Explicit description"

topic specialist:
    description: "Inherited description"
    reasoning:
        instructions: ->
            | Expert work
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    const supervisionTools = node.tools.filter(t => t.type === 'supervision');
    expect(supervisionTools.length).toBe(1);
    expect(supervisionTools[0].description).toBe('Explicit description');
  });

  // Python: test_delegation_integration.test_compile_node_multiple_delegations
  it('should compile multiple supervision tools on one node', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | Handle requests
        actions:
            get_specialist_help: @topic.specialist
                description: "Get help from specialist"
            escalate_to_manager: @topic.manager
                description: "Escalate to manager"

topic specialist:
    description: "Specialist"
    reasoning:
        instructions: ->
            | Specialist work

topic manager:
    description: "Manager"
    reasoning:
        instructions: ->
            | Manager work
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    const supervisionTools = node.tools.filter(t => t.type === 'supervision');
    expect(supervisionTools.length).toBe(2);

    expect(supervisionTools[0].name).toBe('get_specialist_help');
    expect(supervisionTools[0].target).toBe('specialist');

    expect(supervisionTools[1].name).toBe('escalate_to_manager');
    expect(supervisionTools[1].target).toBe('manager');
  });

  // Python: test_delegation_integration.test_compile_node_with_mixed_delegation_and_transition
  it('should compile mixed supervision and transition tools', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent current:
    description: "current"
    reasoning:
        instructions: ->
            | Handle complex requests
        actions:
            get_specialist_help: @topic.specialist
                description: "Get help from specialist"
            proceed: @utils.transition to @topic.next_step
                description: "Move to next step"

topic specialist:
    description: "Specialist"
    reasoning:
        instructions: ->
            | Specialist work

topic next_step:
    description: "Next step"
    reasoning:
        instructions: ->
            | Next step
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'current'
    )!;

    // Should have 2 tools: supervision + state update
    expect(node.tools.length).toBe(2);

    const supervisionTools = node.tools.filter(t => t.type === 'supervision');
    expect(supervisionTools.length).toBe(1);
    expect(supervisionTools[0].name).toBe('get_specialist_help');

    const transitionTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(transitionTools.length).toBe(1);

    // Auto transition should create handoff in after_all_tool_calls
    expect(node.after_all_tool_calls).toBeDefined();
    expect(node.after_all_tool_calls!.length).toBe(1);
  });
});

describe('system instructions override', () => {
  // Python: test_override_functionality.test_compile_override_functionality
  it('should use topic-level system instructions when present', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId
        description: "This variable may also be referred to as MessagingEndUser Id"
    StateVariable: mutable string = "hello"

system:
    instructions: "Global instructions"

start_agent TestTopic:
    description: "Test topic"
    system:
        instructions:|
            topic-level override
            {! @system_variables.user_input }
            {! @variables.EndUserId }
            {! @variables.StateVariable }
    reasoning:
        instructions: ->
            | Topic instructions
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TestTopic'
    )!;
    expect(node.instructions).toBe(
      'topic-level override\n{{state.__user_input__}}\n{{variables.EndUserId}}\n{{state.StateVariable}}'
    );
  });

  // Python: test_override_functionality.test_no_override_uses_topic_instructions
  it('should fall back to global system instructions when no override', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

system:
    instructions: "Global instructions"

start_agent TestTopic:
    description: "Test topic"
    reasoning:
        instructions: ->
            | Topic instructions
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TestTopic'
    )!;
    expect(node.instructions).toBe('Global instructions');
  });

  // Python: test_override_functionality.test_multiline_override_compilation
  it('should preserve multiline system instructions override', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

system:
    instructions: "Global instructions"

start_agent TestTopic:
    description: "Test topic with multiline override"
    system:
        instructions: |
            Complex multiline instructions:
            *** Section 1 ***
            Important guidelines here.

            *** Section 2 ***
            1. First point
            2. Second point

            Final instructions.
    reasoning:
        instructions: ->
            | Test reasoning
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'TestTopic'
    )!;
    expect(node.instructions).toBe(
      'Complex multiline instructions:\n*** Section 1 ***\nImportant guidelines here.\n\n*** Section 2 ***\n1. First point\n2. Second point\n\nFinal instructions.'
    );
  });

  it('should compile state variables in system instructions', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

variables:
    my_var:
        type: string
        value: "default"

start_agent main:
    description: "desc"
    system:
        instructions:|
            Hello {! @variables.my_var }
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    expect(node.instructions).toBe('Hello {{state.my_var}}');
  });
});

describe('node structure', () => {
  // Python: test_compile.test_basic_script — node assertions
  it('should compile node with developer_name and description', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent simple:
    description: "Simple topic description"
    reasoning:
        instructions: ->
            | Please answer the question
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(1);

    const node = output.agent_version.nodes[0];
    expect(node.developer_name).toBe('simple');
    expect(node.description).toBe('Simple topic description');
  });

  it('should derive label from developer_name', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent weather_service_router:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0];
    // snake_case → Title Case
    expect(node.label).toBe('Weather Service Router');
  });

  it('should compile focus_prompt using state variable reference', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent simple:
    description: "desc"
    reasoning:
        instructions: ->
            | Please answer the question
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0];
    expect(node.focus_prompt).toBe(
      '{{state.AgentScriptInternal_agent_instructions}}'
    );
  });
});
