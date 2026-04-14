/**
 * Directive compilation tests — ported from Python:
 * - test_directive_transition_execution.py
 *
 * Tests before/after reasoning directive compilation.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  STATE_UPDATE_ACTION,
} from '../src/constants.js';

describe('after_reasoning directives', () => {
  // Python: test_directive_transition_execution.test_after_reasoning_transition_directive
  it('should compile after_reasoning transition to state update + handoff', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Handle request
    after_reasoning:
        transition to @topic.destination

topic destination:
    description: "Destination"
    reasoning:
        instructions: ->
            | Destination
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // after_reasoning should have actions for the transition
    expect(node.after_reasoning).toBeDefined();
    expect(node.after_reasoning!.length).toBeGreaterThanOrEqual(2);

    // Should contain a state update action setting next_topic
    const stateUpdateActions = node.after_reasoning!.filter(
      (a: Record<string, unknown>) => a.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateActions.length).toBeGreaterThanOrEqual(1);

    // Should contain a handoff action
    const handoffs = node.after_reasoning!.filter(
      (a: Record<string, unknown>) => a.target === 'destination'
    );
    expect(handoffs.length).toBe(1);

    const handoff = handoffs[0] as Record<string, unknown>;
    expect(handoff.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="destination"`);
    expect(handoff.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
  });
});

describe('before_reasoning directives', () => {
  it('should compile before_reasoning transition directive', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Main topic"
    before_reasoning:
        transition to @topic.destination
    reasoning:
        instructions: ->
            | Handle request

topic destination:
    description: "Destination"
    reasoning:
        instructions: ->
            | Destination
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // before_reasoning should have actions for the transition
    expect(node.before_reasoning).toBeDefined();
    expect(node.before_reasoning!.length).toBeGreaterThanOrEqual(2);

    // Should contain a state update action setting next_topic
    const stateUpdateActions = node.before_reasoning!.filter(
      (a: Record<string, unknown>) => a.target === STATE_UPDATE_ACTION
    );
    expect(stateUpdateActions.length).toBeGreaterThanOrEqual(1);

    // Should contain a handoff action
    const handoffs = node.before_reasoning!.filter(
      (a: Record<string, unknown>) => a.target === 'destination'
    );
    expect(handoffs.length).toBe(1);

    const handoff = handoffs[0] as Record<string, unknown>;
    expect(handoff.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="destination"`);
    expect(handoff.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);

    // Successful compilation should produce zero diagnostics
    expect(diagnostics).toHaveLength(0);
  });

  it('should warn when transitioning to @connected_subagent.X in before_reasoning', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Main topic"
    before_reasoning:
        transition to @connected_subagent.Support_Agent
    reasoning:
        instructions: ->
            | Help the user.

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { diagnostics } = compile(parseSource(source));
    const transitionWarnings = diagnostics.filter(d =>
      d.message.includes('Transition to connected agent')
    );
    expect(transitionWarnings.length).toBeGreaterThan(0);
    expect(transitionWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
  });
});
