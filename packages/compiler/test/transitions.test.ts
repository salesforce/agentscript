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
import { DiagnosticSeverity } from '@agentscript/types';
import {
  AtIdentifier,
  MemberExpression,
  ToClause,
} from '@agentscript/language';
import { compile } from '../src/compile.js';
import { compileTransition } from '../src/nodes/compile-transition.js';
import { CompilerContext } from '../src/compiler-context.js';
import type { ParsedTool } from '../src/parsed-types.js';
import * as schema from '../src/generated/agent-dsl.js';
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

  it('should keep the last available when and warn when multiple are specified', () => {
    const source = `
config:
    agent_name: "test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    first_flag: mutable boolean = False
    second_flag: mutable boolean = False

start_agent test:
    description: "test"
    reasoning:
        instructions: ->
            | test
        actions:
            transition_dup: @utils.transition to @topic.destination
                available when @variables.first_flag
                available when @variables.second_flag

topic destination:
    description: "destination"
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const stateUpdateTools = node.tools.filter(
      t => t.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateTools.length).toBe(1);
    const tool = stateUpdateTools[0];
    expect(tool.name).toBe('transition_dup');
    expect(tool.enabled).toBe('state.second_flag');

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

describe('adecco-style transitions', () => {
  // Python: test_utils_transition.test_adecco_style_transition
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

describe('end_turn_first handoff option', () => {
  /**
   * Build a minimal @utils.transition action body (`to @topic.<target>`) so we
   * can drive compileTransition directly and assert on the emitted handoff.
   */
  function transitionTo(target: string): {
    name: string;
    def: ParsedTool;
    body: ToClause[];
  } {
    const toClause = new ToClause(
      new MemberExpression(new AtIdentifier('topic'), target)
    );
    // ParsedTool fields read by compileTransition (label/description/value) are
    // all optional here; only the body drives the transition target.
    const def = {} as ParsedTool;
    return { name: 'my_transition', def, body: [toClause] };
  }

  it('should not emit end_turn_first by default', () => {
    const ctx = new CompilerContext();
    const { name, def, body } = transitionTo('destination');

    const { handOffActions } = compileTransition(
      name,
      def,
      body,
      'source',
      {},
      ctx
    );

    expect(handOffActions.length).toBe(1);
    const handoff = handOffActions[0];
    expect(handoff.target).toBe('destination');
    expect(handoff.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="destination"`);
    expect(handoff.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
    // Default behavior: no end_turn_first key emitted.
    expect(handoff.end_turn_first).toBeUndefined();
    expect('end_turn_first' in handoff).toBe(false);
  });

  it('should emit end_turn_first=true when the option is set', () => {
    const ctx = new CompilerContext();
    const { name, def, body } = transitionTo('destination');

    const { handOffActions } = compileTransition(
      name,
      def,
      body,
      'source',
      {},
      ctx,
      {
        endTurnFirst: true,
      }
    );

    expect(handOffActions.length).toBe(1);
    const handoff = handOffActions[0];
    expect(handoff.target).toBe('destination');
    expect(handoff.end_turn_first).toBe(true);
  });

  it('should not emit end_turn_first when the option is explicitly false', () => {
    const ctx = new CompilerContext();
    const { name, def, body } = transitionTo('destination');

    const { handOffActions } = compileTransition(
      name,
      def,
      body,
      'source',
      {},
      ctx,
      {
        endTurnFirst: false,
      }
    );

    expect(handOffActions.length).toBe(1);
    expect(handOffActions[0].end_turn_first).toBeUndefined();
  });

  it('should set end_turn_first on every handoff for multi-target transitions', () => {
    const ctx = new CompilerContext();
    // A single @utils.transition action body can list multiple `to @topic.X`
    // clauses; each lowers to its own handoff and all must carry the flag.
    const body = [
      new ToClause(new MemberExpression(new AtIdentifier('topic'), 'first')),
      new ToClause(new MemberExpression(new AtIdentifier('topic'), 'second')),
    ];

    const { handOffActions } = compileTransition(
      'my_transition',
      {} as ParsedTool,
      body,
      'source',
      {},
      ctx,
      { endTurnFirst: true }
    );

    expect(handOffActions.length).toBe(2);
    expect(handOffActions.map(h => h.target)).toEqual(['first', 'second']);
    expect(handOffActions.every(h => h.end_turn_first === true)).toBe(true);
  });

  it('should accept end_turn_first as a valid handOffAction schema field', () => {
    const handoff = schema.handOffAction.parse({
      type: 'handoff',
      target: 'destination',
      end_turn_first: true,
    });
    expect(handoff.end_turn_first).toBe(true);

    // Field is optional: omitting it still parses.
    const without = schema.handOffAction.parse({
      type: 'handoff',
      target: 'destination',
    });
    expect(without.end_turn_first).toBeUndefined();
  });

  it('should accept false and null for end_turn_first (nullable boolean)', () => {
    // Upstream types end_turn_first as a nullable boolean, lowered to
    // z.boolean().nullish(); false and null are both valid inputs.
    const falsey = schema.handOffAction.parse({
      type: 'handoff',
      target: 'destination',
      end_turn_first: false,
    });
    expect(falsey.end_turn_first).toBe(false);

    const nulled = schema.handOffAction.parse({
      type: 'handoff',
      target: 'destination',
      end_turn_first: null,
    });
    expect(nulled.end_turn_first).toBeNull();
  });

  it('should reject a non-boolean end_turn_first', () => {
    const result = schema.handOffAction.safeParse({
      type: 'handoff',
      target: 'destination',
      end_turn_first: 'yes',
    });
    expect(result.success).toBe(false);
  });

  it('should not emit end_turn_first on handoffs from a full authored compile (default)', () => {
    // End-to-end guarantee: authored transitions never carry end_turn_first
    // until collect auto-resume wires it (a later story). Both the reasoning
    // action handoff and the after_reasoning directive handoff must be clean.
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
    after_reasoning:
        transition to @topic.other

topic destination:
    description: "destination"
    reasoning:
        instructions: ->
            | destination

topic other:
    description: "other"
    reasoning:
        instructions: ->
            | other
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'test'
    )!;

    const handoffs = [
      ...(node.after_all_tool_calls ?? []),
      ...(node.after_reasoning ?? []),
    ].filter((a: Record<string, unknown>) => a.type === 'handoff');

    expect(handoffs.length).toBeGreaterThanOrEqual(2);
    for (const handoff of handoffs) {
      expect(
        (handoff as Record<string, unknown>).end_turn_first
      ).toBeUndefined();
      expect('end_turn_first' in handoff).toBe(false);
    }
  });
});
