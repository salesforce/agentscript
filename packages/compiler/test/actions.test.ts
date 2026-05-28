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

describe('setVariables with condition', () => {
  it('should compile @utils.setVariables with available when and `with` LLM-filled inputs', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    should_run: linked boolean
        description: "Should Run"
    user_name: mutable string
        description: "User name"
    user_email: mutable string
        description: "User email"

start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            capture_user_info: @utils.setVariables
                description: "Capture user info"
                available when @variables.should_run
                with user_name=...
                with user_email=...
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const setVarTool = node.tools.find(t => t.name === 'capture_user_info')!;
    expect(setVarTool).toBeDefined();
    expect(setVarTool.target).toBe(STATE_UPDATE_ACTION);
    expect(setVarTool.enabled).toBe('variables.should_run');
    expect(setVarTool.llm_inputs).toEqual(['user_name', 'user_email']);
    expect(setVarTool.state_updates).toEqual([
      { user_name: 'result.user_name' },
      { user_email: 'result.user_email' },
    ]);
    expect(setVarTool.bound_inputs).toEqual({});
    expect(setVarTool.input_parameters).toEqual([
      { developer_name: 'user_name', label: 'user_name', data_type: 'String' },
      {
        developer_name: 'user_email',
        label: 'user_email',
        data_type: 'String',
      },
    ]);
  });

  it('should compile @utils.setVariables with available when and `set @variables` clauses', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    allow_update: linked boolean
        description: "Allow update"
    status: mutable string = ""
    counter: mutable number = 0

start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            update_state: @utils.setVariables
                description: "Update state"
                available when @variables.allow_update
                set @variables.status = "done"
                set @variables.counter = 1
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const setVarTool = node.tools.find(t => t.name === 'update_state')!;
    expect(setVarTool).toBeDefined();
    expect(setVarTool.target).toBe(STATE_UPDATE_ACTION);
    expect(setVarTool.enabled).toBe('variables.allow_update');
    expect(setVarTool.state_updates).toEqual([
      { status: '"done"' },
      { counter: '1' },
    ]);
    // No `with` clauses → no llm_inputs / bound_inputs / input_parameters
    expect(setVarTool.llm_inputs).toBeUndefined();
    expect(setVarTool.bound_inputs).toBeUndefined();
    expect(setVarTool.input_parameters).toBeUndefined();
  });

  it('should compile @utils.setVariables with available when referencing a mutable state variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    is_ready: mutable boolean = False
    user_name: mutable string

start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            capture_when_ready: @utils.setVariables
                description: "Capture name when ready"
                available when @variables.is_ready
                with user_name=...
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const setVarTool = node.tools.find(t => t.name === 'capture_when_ready')!;
    expect(setVarTool).toBeDefined();
    expect(setVarTool.target).toBe(STATE_UPDATE_ACTION);
    // Mutable variables resolve to the `state.` namespace, not `variables.`
    expect(setVarTool.enabled).toBe('state.is_ready');
    expect(setVarTool.llm_inputs).toEqual(['user_name']);
  });

  it('should compile complex available when expression on @utils.setVariables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    is_business_hours: linked boolean
        description: "Business hours"
    region: mutable string = ""

start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            capture_region: @utils.setVariables
                description: "Capture region"
                available when @variables.is_business_hours == True
                with region=...
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const setVarTool = node.tools.find(t => t.name === 'capture_region')!;
    expect(setVarTool).toBeDefined();
    expect(setVarTool.enabled).toBe('variables.is_business_hours == True');
    expect(setVarTool.llm_inputs).toEqual(['region']);
  });

  it('should compile @utils.setVariables without available when (no enabled condition)', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    user_name: mutable string

start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            capture_name: @utils.setVariables
                description: "Capture name"
                with user_name=...
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const setVarTool = node.tools.find(t => t.name === 'capture_name')!;
    expect(setVarTool).toBeDefined();
    expect(setVarTool.enabled).toBeUndefined();
  });

  it('should keep the last available when and warn when multiple are specified', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    first_flag: linked boolean
        description: "First"
    second_flag: linked boolean
        description: "Second"
    user_name: mutable string

start_agent test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            capture: @utils.setVariables
                description: "Capture"
                available when @variables.first_flag
                available when @variables.second_flag
                with user_name=...
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const setVarTool = node.tools.find(t => t.name === 'capture')!;
    expect(setVarTool).toBeDefined();
    expect(setVarTool.enabled).toBe('variables.second_flag');

    const duplicateAvailableWhenWarnings = diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Warning &&
        d.message.includes('Multiple "available when" clauses')
    );
    expect(duplicateAvailableWhenWarnings).toHaveLength(1);
    expect(duplicateAvailableWhenWarnings[0].message).toContain(
      'only the last one is applied'
    );
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

describe('action target type translation', () => {
  // Helpers
  const makeSource = (scheme: string, name: string) => `
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        my_action:
            description: "Action"
            target: "${scheme}://${name}"
    reasoning:
        instructions: ->
            | test
        actions:
            my_action: @actions.my_action
`;

  const compileAndGetActionDef = (scheme: string, name: string) => {
    const { output } = compile(parseSource(makeSource(scheme, name)));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;
    return (node.action_definitions ?? []).find(
      a => a.developer_name === 'my_action'
    );
  };

  // Alias schemes translate to their canonical Agent JSON form.
  it.each([
    ['prompt', 'generatePromptResponse'],
    ['serviceCatalog', 'createCatalogItemRequest'],
    ['integrationProcedureAction', 'executeIntegrationProcedure'],
    ['expressionSet', 'runExpressionSet'],
  ])(
    'translates alias scheme "%s://" to canonical "%s"',
    (alias, canonical) => {
      const actionDef = compileAndGetActionDef(alias, 'X');
      expect(actionDef?.invocation_target_type).toBe(canonical);
      expect(actionDef?.invocation_target_name).toBe('X');
    }
  );

  // Canonical forms are also accepted on input (and pass through unchanged).
  it.each([
    'generatePromptResponse',
    'createCatalogItemRequest',
    'executeIntegrationProcedure',
    'runExpressionSet',
  ])('accepts canonical scheme "%s://" unchanged', canonical => {
    const actionDef = compileAndGetActionDef(canonical, 'X');
    expect(actionDef?.invocation_target_type).toBe(canonical);
  });

  // Non-alias schemes pass through unchanged. (Scheme validity itself is
  // enforced by the agentforce dialect's actionTargetSchemeRule lint pass,
  // not by the compiler.)
  it.each(['apex', 'mcpTool', 'slack', 'namedQuery', 'retriever'])(
    'passes through non-alias scheme "%s://" unchanged',
    scheme => {
      const actionDef = compileAndGetActionDef(scheme, 'X');
      expect(actionDef?.invocation_target_type).toBe(scheme);
    }
  );
});

// Tool.description is an explicit override of ActionConfiguration.description
// (per DSL schema). The compiler must only emit it when the user supplied a
// `description:` on the reasoning action — otherwise leave it absent so the
// runtime falls back to the action's real description.
describe('tool description override', () => {
  function compileTopic(source: string) {
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;
    return node.tools.filter(t => t.target !== STATE_UPDATE_ACTION);
  }

  it('emits description when supplied on the reasoning action', () => {
    const tools = compileTopic(`
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        clean_zoo:
            description: "use this action to clean the zoo."
            target: "flow://CleanZoo"
    reasoning:
        instructions: ->
            | test
        actions:
            clean_zoo: @actions.clean_zoo
                description: "Override on the reasoning binding"
`);
    expect(tools[0].description).toBe('Override on the reasoning binding');
  });

  it('omits description when not supplied on the reasoning action', () => {
    const tools = compileTopic(`
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        clean_zoo:
            description: "use this action to clean the zoo."
            target: "flow://CleanZoo"
    reasoning:
        instructions: ->
            | test
        actions:
            clean_zoo: @actions.clean_zoo
`);
    expect(tools[0].description).toBeUndefined();
  });

  it('omits description even when reasoning binding uses an alias', () => {
    // Regression: previously emitted humanized name (e.g. "Tidy Up") which
    // shadowed the action's real description at runtime.
    const tools = compileTopic(`
config:
    agent_name: "TestBot"

start_agent test:
    description: "Test"
    actions:
        CleanZoo:
            description: "use this action to clean the zoo."
            target: "flow://CleanZoo"
    reasoning:
        instructions: ->
            | test
        actions:
            tidy_up: @actions.CleanZoo
`);
    expect(tools[0].name).toBe('tidy_up');
    expect(tools[0].target).toBe('CleanZoo');
    expect(tools[0].description).toBeUndefined();
  });
});
