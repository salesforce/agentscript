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
  NEXT_TOPIC_VARIABLE,
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
    expect(node.before_reasoning_iteration!.length).toBeGreaterThanOrEqual(1);

    // A BRI action should contain the topic instructions (the reset folds into
    // the first unconditional append)
    const briActions = node.before_reasoning_iteration!;
    const instructionAppend = briActions.find(
      (a: Record<string, unknown>) =>
        typeof a.state_updates === 'object' &&
        JSON.stringify(a.state_updates).includes('Topic-level instructions')
    );
    expect(instructionAppend).toBeDefined();
  });

  it('should emit node.instructions as an empty string when no system block present', () => {
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

    // No system block means node.instructions defaults to "" (a valid string),
    // never omitted/None. Omitting the key makes it round-trip through the
    // downstream schema as an explicit `null`, which then fails re-validation
    // against the non-nullable `str` type.
    expect(node.instructions).toBe('');
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

    // Before reasoning iteration: the unconditional reset + single append fold
    // into one assignment.
    expect(routerNode.before_reasoning_iteration).toBeDefined();
    expect(routerNode.before_reasoning_iteration!.length).toBe(1);

    // Single folded action: assign instructions (self-reference resolved away).
    const instructionAction = routerNode
      .before_reasoning_iteration![0] as Action;
    expect(instructionAction.target).toBe(STATE_UPDATE_ACTION);
    expect(instructionAction.enabled).toBe('True');
    const stateUpdate = instructionAction.state_updates![0] as Record<
      string,
      string
    >;
    expect(stateUpdate[AGENT_INSTRUCTIONS_VARIABLE]).toContain(
      'Start agent instructions'
    );
    expect(stateUpdate[AGENT_INSTRUCTIONS_VARIABLE]).not.toContain(
      `{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`
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

    // BRI folds the unconditional reset + single append into one assignment.
    expect(node.before_reasoning_iteration).toBeDefined();
    expect(node.before_reasoning_iteration!.length).toBe(1);

    const instructionAction = node.before_reasoning_iteration![0] as Action;
    expect(instructionAction.target).toBe(STATE_UPDATE_ACTION);
    expect(instructionAction.enabled).toBe('True');
    const update = instructionAction.state_updates![0] as Record<
      string,
      string
    >;
    expect(update[AGENT_INSTRUCTIONS_VARIABLE]).toBe(
      'template::\nDirect template instructions without Procedure wrapper.'
    );
  });

  it('should flatten N consecutive instruction lines into a single append', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent MultiLineTopic:
    description: "Multi-line template test"
    reasoning:
        instructions: ->
            | first line
            | second line
            | third line
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'MultiLineTopic'
    )!;

    // A single folded action, regardless of the number of | lines: the
    // unconditional reset + append collapse into one assignment.
    expect(node.before_reasoning_iteration).toBeDefined();
    expect(node.before_reasoning_iteration!.length).toBe(1);

    // The lines are newline-joined into one state update, with the reset folded
    // in (self-reference resolved away).
    const instructionAction = node.before_reasoning_iteration![0] as Action;
    expect(instructionAction.enabled).toBe('True');
    const update = instructionAction.state_updates![0] as Record<
      string,
      string
    >;
    expect(update[AGENT_INSTRUCTIONS_VARIABLE]).toBe(
      'template::\nfirst line\nsecond line\nthird line'
    );
  });

  it('merges adjacent same-gate instruction lines in a procedural block but keeps gate boundaries', () => {
    // An `if` makes the whole block procedural (one action per statement), but
    // consecutive ungated `| ...` lines still fuse into one append, while the
    // if/else bodies stay separate because their gates differ.
    const source = `
config:
    agent_name: "TestBot"

variables:
    is_vip: mutable boolean
        description: "VIP flag."

start_agent ProceduralTopic:
    description: "Interleaved template + if"
    reasoning:
        instructions: ->
            | intro line one
            | intro line two

            if @variables.is_vip
                | vip branch
            else
                | standard branch

            | outro line one
            | outro line two
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'ProceduralTopic'
    )!;
    const bri = node.before_reasoning_iteration!;

    const PREFIX = `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`;
    const values = bri
      .map(a => a.state_updates?.[0] as Record<string, string>)
      .map(su => su?.[AGENT_INSTRUCTIONS_VARIABLE])
      .filter((v): v is string => typeof v === 'string');

    // The two intro lines fuse; being the first unconditional run they also fold
    // with the reset, so their value drops the self-reference prefix.
    expect(values).toContain('template::\nintro line one\nintro line two');

    // The remaining appends keep the self-reference prefix: the two outro lines
    // fuse; the vip/else bodies stay separate (opposite gates).
    const appends = values.filter(v => v.startsWith(PREFIX));
    expect(appends.length).toBe(3);
    expect(appends).toContain(`${PREFIX}\noutro line one\noutro line two`);
    expect(appends).toContain(`${PREFIX}\nvip branch`);
    expect(appends).toContain(`${PREFIX}\nstandard branch`);
  });
});

// ---------------------------------------------------------------------------
// Instruction append merging across procedural directives (if / transition /
// set and combinations). Each non-template directive is a merge boundary; only
// adjacent same-gate instruction appends fuse.
// ---------------------------------------------------------------------------

describe('instruction append merging across procedural directives', () => {
  const PREFIX = `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`;

  // The first unconditional append folds with the reset, so its value loses the
  // `{{state.X}}` self-reference and reads `template::\n...`.
  const FOLDED_PREFIX = 'template::\n';

  /**
   * All instruction values on the node's before_reasoning_iteration — both the
   * self-referencing appends (`template::{{state.X}}\n...`) and the folded head
   * assignment (`template::\n...`). Flattens across every `state_updates` entry,
   * not just index 0, because 4a (mergeAdjacentStateUpdates) fuses same-gate
   * envelopes: distinct appends can now live as sibling entries inside one merged
   * envelope. Instruction-append string fusion still keeps a `set`/`transition`
   * from concatenating the runs on either side into one string — this helper
   * verifies that stays true.
   */
  function instructionAppends(node: SubAgentNode): string[] {
    return (node.before_reasoning_iteration ?? [])
      .flatMap(a => (a.state_updates ?? []) as Record<string, string>[])
      .map(su => su?.[AGENT_INSTRUCTIONS_VARIABLE])
      .filter(
        (v): v is string =>
          typeof v === 'string' &&
          (v.startsWith(PREFIX) || v.startsWith(FOLDED_PREFIX))
      );
  }

  function compileMain(source: string): SubAgentNode {
    const { output, diagnostics } = compile(parseSource(source));
    expect(diagnostics.filter(d => d.severity === 0)).toHaveLength(0);
    return output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )! as SubAgentNode;
  }

  const HEAD = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    flag: mutable boolean
        description: "A flag."
`;

  it('set: a set statement is a string-fusion boundary between instruction runs', () => {
    const node = compileMain(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            | before one
            | before two
            set @variables.flag = True
            | after one
            | after two
`);
    const appends = instructionAppends(node);
    // Two string-fused runs, split by the set — not four separate lines. The
    // set does not concatenate into either run's template string; the first run
    // additionally folds with the reset (self-reference dropped).
    expect(appends).toEqual([
      `${FOLDED_PREFIX}before one\nbefore two`,
      `${PREFIX}\nafter one\nafter two`,
    ]);

    // The set write still exists as its own `{ flag: 'True' }` entry. 4a may
    // fuse it into a same-gate envelope alongside the appends, so look across
    // every state_updates entry rather than assuming its own envelope.
    const flagEntries = (node.before_reasoning_iteration ?? [])
      .flatMap(a => (a.state_updates ?? []) as Record<string, unknown>[])
      .filter(su => 'flag' in su);
    expect(flagEntries).toEqual([{ flag: 'True' }]);
  });

  it('transition to: a transition is a string-fusion boundary between instruction runs', () => {
    const node = compileMain(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            | before one
            | before two
            transition to @topic.dest
            | after one
            | after two

topic dest:
    description: "d"
    reasoning:
        instructions: ->
            | dest
`);
    const appends = instructionAppends(node);
    expect(appends).toEqual([
      `${FOLDED_PREFIX}before one\nbefore two`,
      `${PREFIX}\nafter one\nafter two`,
    ]);

    // The transition still emits its next_topic set + handoff. The set may be
    // fused into a same-gate envelope by 4a, so search across all entries.
    const bri = node.before_reasoning_iteration ?? [];
    const nextTopicSet = bri.find(a =>
      ((a.state_updates ?? []) as Record<string, string>[]).some(
        su => su[NEXT_TOPIC_VARIABLE] === '"dest"'
      )
    );
    expect(nextTopicSet).toBeDefined();
    const handoff = bri.find(a => a.target === 'dest');
    expect(handoff).toBeDefined();
  });

  it('if only: consecutive lines inside an if body fuse, gated on the condition', () => {
    const node = compileMain(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            | outer one
            | outer two
            if @variables.flag
                | inner one
                | inner two
            | trailer one
            | trailer two
`);
    const bri = node.before_reasoning_iteration ?? [];

    // Ungated outer/trailer runs each fuse; the if-body fuses under its gate.
    const appends = instructionAppends(node);
    expect(appends).toEqual([
      `${FOLDED_PREFIX}outer one\nouter two`,
      `${PREFIX}\ninner one\ninner two`,
      `${PREFIX}\ntrailer one\ntrailer two`,
    ]);

    // The fused if-body append is gated on the synthesized condition variable.
    const gatedInner = bri.find(
      a =>
        a.state_updates?.[0]?.[AGENT_INSTRUCTIONS_VARIABLE] ===
        `${PREFIX}\ninner one\ninner two`
    ) as Action;
    expect(gatedInner.enabled).toMatch(
      /^state\.AgentScriptInternal_condition_/
    );
  });

  it('combo: set + if/else + transition are string-fusion boundaries while runs fuse', () => {
    const node = compileMain(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            | pre one
            | pre two
            set @variables.flag = True
            | mid one
            | mid two
            if @variables.flag
                | if body one
                | if body two
            else
                | else body one
                | else body two
            transition to @topic.dest
            | post one
            | post two

topic dest:
    description: "d"
    reasoning:
        instructions: ->
            | dest
`);
    const appends = instructionAppends(node);

    // Each run fuses; if and else bodies stay separate (opposite gates). The
    // first run additionally folds with the reset (self-reference dropped).
    expect(appends).toEqual([
      `${FOLDED_PREFIX}pre one\npre two`,
      `${PREFIX}\nmid one\nmid two`,
      `${PREFIX}\nif body one\nif body two`,
      `${PREFIX}\nelse body one\nelse body two`,
      `${PREFIX}\npost one\npost two`,
    ]);

    // Confirm the if/else bodies carry complementary gates.
    const bri = node.before_reasoning_iteration ?? [];
    const gateOf = (text: string) =>
      (
        bri.find(
          a => a.state_updates?.[0]?.[AGENT_INSTRUCTIONS_VARIABLE] === text
        ) as Action
      ).enabled;
    const ifGate = gateOf(`${PREFIX}\nif body one\nif body two`)!;
    const elseGate = gateOf(`${PREFIX}\nelse body one\nelse body two`)!;
    expect(elseGate).toBe(`not (${ifGate})`);
  });
});

// ---------------------------------------------------------------------------
// Fold the unconditional instruction reset into the first unconditional append.
// The fold must NOT fire when the first append is gated — a gated append needs
// the standalone reset to keep the variable empty on the false branch.
// ---------------------------------------------------------------------------

describe('instruction reset+append fold', () => {
  const PREFIX = `template::{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`;

  const HEAD = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    flag: mutable boolean
        description: "A flag."
`;

  function mainBri(source: string): Action[] {
    const { output, diagnostics } = compile(parseSource(source));
    expect(diagnostics.filter(d => d.severity === 0)).toHaveLength(0);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    return (node.before_reasoning_iteration ?? []) as Action[];
  }

  const instructionValue = (a: Action): string | undefined =>
    a.state_updates?.[0]?.[AGENT_INSTRUCTIONS_VARIABLE];

  it('folds an unconditional reset + first unconditional append into one assignment', () => {
    const bri = mainBri(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            | only line
`);
    // Single folded assignment: no standalone reset, self-reference dropped, but
    // the leading newline (and hence the rendered instruction) is preserved.
    expect(bri.length).toBe(1);
    expect(bri[0].enabled).toBe('True');
    expect(bri[0].state_updates![0]).toEqual({
      [AGENT_INSTRUCTIONS_VARIABLE]: 'template::\nonly line',
    });
  });

  it('does NOT fold when the first append is gated — the standalone reset survives', () => {
    const bri = mainBri(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            if @variables.flag
                | gated line
`);
    // The leading content is gated, so the reset cannot fold: it survives as a
    // standalone `''` assignment (keeping the variable empty when the gate is
    // false).
    const reset = bri.find(a => instructionValue(a) === "''");
    expect(reset).toBeDefined();
    expect(reset!.enabled).toBe('True');

    // The gated append is present and unchanged (still self-referencing).
    const gated = bri.find(a => instructionValue(a)?.includes('gated line'))!;
    expect(instructionValue(gated)).toBe(`${PREFIX}\ngated line`);
    expect(gated.enabled).toMatch(/^state\.AgentScriptInternal_condition_/);
  });

  it('folds the unconditional head only when it precedes a gated append', () => {
    const bri = mainBri(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            | intro
            if @variables.flag
                | gated line
`);
    // Head folds → no standalone reset remains.
    expect(bri.some(a => instructionValue(a) === "''")).toBe(false);
    expect(instructionValue(bri[0])).toBe('template::\nintro');
    expect(bri[0].enabled).toBe('True');

    // The gated append still keeps its self-reference and its gate.
    const gated = bri.find(a => instructionValue(a)?.includes('gated line'))!;
    expect(instructionValue(gated)).toBe(`${PREFIX}\ngated line`);
    expect(gated.enabled).toMatch(/^state\.AgentScriptInternal_condition_/);
  });
});
