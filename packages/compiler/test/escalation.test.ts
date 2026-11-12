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
import {
  RUN_UTILS_CODE,
  SUBAGENT_UNKNOWN_ACTION_CODE,
  runUtilsMessage,
  subagentUnknownActionMessage,
} from '@agentscript/agentscript-dialect';
import { compile } from '../src/compile.js';
import { parseSource, findNode } from './test-utils.js';
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
    const node = findNode(output, 'main', 'subagent');

    // Should have a state update tool
    const stateUpdateTools = node.tools!.filter(
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
    const nextTopicVars = output.agent_version.state_variables!.filter(
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
    const node = findNode(output, 'main', 'subagent');

    // Should create a state update tool with enabled condition
    const stateUpdateTools = node.tools!.filter(
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
    const node = findNode(output, 'main', 'subagent');

    // Tool should have the available when as enabled
    const tool = node.tools!.find(t => t.name === 'human_escalation')!;
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
    const node = findNode(output, 'main', 'subagent');

    // Should have both tools: make_case and human_escalation
    expect(node.tools!.length).toBe(2);
    expect(node.tools![0].name).toBe('make_case');
    expect(node.tools![1].name).toBe('human_escalation');
    expect(node.tools![1].enabled).toBe('state.is_business_hours == True');

    // Handoff gated on internal state variable
    const handoff = node.after_all_tool_calls!.find(
      h => h.target === ESCALATION_TARGET
    )!;
    expect(handoff.enabled).toBe(
      `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`
    );
  });
});

describe('run on a reasoning action', () => {
  const source = (hook: string, target = '@actions.escalate_to_human') => `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System instructions"

start_agent main:
    description: "Route user"
    ${hook}:
        run ${target}
    reasoning:
        instructions: ->
            | Route user
        actions:
            escalate_to_human: @utils.escalate
                description: "Escalate."
`;

  it.each(['before_reasoning', 'after_reasoning'] as const)(
    'rejects run on an @utils.escalate tool in %s and emits no dead action',
    hook => {
      const { output, diagnostics } = compile(parseSource(source(hook)));
      const errors = diagnostics.filter(
        d => d.code === SUBAGENT_UNKNOWN_ACTION_CODE
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toBe(
        subagentUnknownActionMessage('escalate_to_human')
      );

      const node = findNode(output, 'main', 'subagent');
      expect(
        (node[hook] ?? []).filter(a => a.target === 'escalate_to_human')
      ).toEqual([]);
    }
  );

  it('rejects run on a reasoning key of a non-escalate tool in before_reasoning_iteration', () => {
    const { diagnostics } = compile(
      parseSource(`
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
            run @actions.go_next
            | Route user
        actions:
            go_next: @utils.transition to @subagent.other
                description: "Go"

subagent other:
    description: "Other"
    reasoning:
        instructions: ->
            | Other
`)
    );
    expect(
      diagnostics.filter(d => d.code === SUBAGENT_UNKNOWN_ACTION_CODE)
    ).toHaveLength(1);
  });

  it('rejects run on a reasoning key nested in a reasoning action', () => {
    const { output, diagnostics } = compile(
      parseSource(`
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System instructions"

start_agent main:
    description: "Route user"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | Route user
        actions:
            escalate_to_human: @utils.escalate
                description: "Escalate."
            lookup: @actions.Lookup
                run @actions.escalate_to_human
`)
    );
    expect(
      diagnostics.filter(d => d.code === SUBAGENT_UNKNOWN_ACTION_CODE)
    ).toHaveLength(1);
    expect(JSON.stringify(output)).not.toContain(
      '"target":"escalate_to_human"'
    );
  });

  it('rejects run on an @utils member and points to its statement form', () => {
    const { diagnostics } = compile(
      parseSource(source('before_reasoning', '@utils.escalate'))
    );
    expect(
      diagnostics.filter(d => d.code === RUN_UTILS_CODE).map(d => d.message)
    ).toEqual([runUtilsMessage('escalate')]);
  });

  it('still allows run on an action defined in the subagent actions', () => {
    const { output, diagnostics } = compile(
      parseSource(`
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System instructions"

start_agent main:
    description: "Route user"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
    before_reasoning:
        run @actions.Lookup
    reasoning:
        instructions: ->
            | Route user
        actions:
            lookup: @actions.Lookup
`)
    );
    expect(
      diagnostics.filter(d => d.code === SUBAGENT_UNKNOWN_ACTION_CODE)
    ).toEqual([]);
    const node = findNode(output, 'main', 'subagent');
    expect(node.before_reasoning).toContainEqual(
      expect.objectContaining({ type: 'action', target: 'Lookup' })
    );
  });

  it('still allows run on an inherited agent-level action with a same-named reasoning key', () => {
    const { output, diagnostics } = compile(
      parseSource(`
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

actions:
    log_activity:
        description: "Log activity"
        target: "flow://LogActivity"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | Route.

subagent worker:
    description: "Worker"
    before_reasoning:
        run @actions.log_activity
    reasoning:
        instructions: ->
            | Work.
        actions:
            log_activity: @actions.log_activity
`)
    );
    expect(
      diagnostics.filter(
        d =>
          d.code === SUBAGENT_UNKNOWN_ACTION_CODE || d.code === RUN_UTILS_CODE
      )
    ).toEqual([]);
    const node = findNode(output, 'worker', 'subagent');
    expect(node.before_reasoning).toContainEqual(
      expect.objectContaining({ type: 'action', target: 'log_activity' })
    );
  });
});
