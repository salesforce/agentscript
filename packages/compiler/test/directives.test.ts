/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Directive compilation tests — ported from Python:
 * - test_directive_transition_execution.py
 *
 * Tests before/after reasoning directive compilation.
 */
import { describe, it, expect } from 'vitest';
import type { Statement } from '@agentscript/language';
import {
  AtIdentifier,
  MemberExpression,
  ToClause,
  TransitionStatement,
} from '@agentscript/language';
import { compile } from '../src/compile.js';
import { compileDeterministicDirectives } from '../src/nodes/compile-directives.js';
import { CompilerContext } from '../src/compiler-context.js';
import type { HandOffAction } from '../src/types.js';
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
});

describe('end_turn_first in transition directives', () => {
  /**
   * Build a `transition to @topic.<target>` directive statement list so we can
   * drive compileDeterministicDirectives directly — this exercises the
   * compileTransitionDirective handoff construction site (distinct from the
   * @utils.transition reasoning action covered in transitions.test.ts).
   */
  function transitionDirective(target: string): Statement[] {
    const toClause = new ToClause(
      new MemberExpression(new AtIdentifier('topic'), target)
    );
    return [new TransitionStatement([toClause])];
  }

  function handoffsFrom(
    actions: ReturnType<typeof compileDeterministicDirectives>
  ): HandOffAction[] {
    return actions.filter(
      (a): a is HandOffAction => (a as HandOffAction).type === 'handoff'
    );
  }

  it('should not emit end_turn_first by default', () => {
    const ctx = new CompilerContext();
    const actions = compileDeterministicDirectives(
      transitionDirective('destination'),
      ctx,
      { addNextTopicResetAction: false }
    );

    const handoffs = handoffsFrom(actions);
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].target).toBe('destination');
    expect(handoffs[0].end_turn_first).toBeUndefined();
    expect('end_turn_first' in handoffs[0]).toBe(false);
  });

  it('should emit end_turn_first=true when the option is set', () => {
    const ctx = new CompilerContext();
    const actions = compileDeterministicDirectives(
      transitionDirective('destination'),
      ctx,
      { addNextTopicResetAction: false, endTurnFirst: true }
    );

    const handoffs = handoffsFrom(actions);
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].end_turn_first).toBe(true);
  });

  it('should not emit end_turn_first when the option is explicitly false', () => {
    const ctx = new CompilerContext();
    const actions = compileDeterministicDirectives(
      transitionDirective('destination'),
      ctx,
      { addNextTopicResetAction: false, endTurnFirst: false }
    );

    const handoffs = handoffsFrom(actions);
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].end_turn_first).toBeUndefined();
  });
});
