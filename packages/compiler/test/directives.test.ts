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
import {
  isHandOffAction,
  type Action,
  type HandOffAction,
} from '../src/types.js';
import {
  createStateUpdateAction,
  optimizeDirectiveActions,
} from '../src/nodes/optimize-actions.js';
import { parseSource } from './test-utils.js';
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  STATE_UPDATE_ACTION,
  AGENT_INSTRUCTIONS_VARIABLE,
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
    return actions.filter(isHandOffAction);
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

// Optimization 4a: adjacent __state_update_action__ envelopes that share the
// same `enabled` gate fuse into one envelope carrying the concatenated
// state_updates. Fewer runtime steps, identical resulting state.
describe('4a: merge adjacent same-gate state updates', () => {
  const HEAD = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    a: mutable boolean
        description: "a"
    b: mutable boolean
        description: "b"
    counter: mutable number = 0
        description: "counter"
    x: mutable number = 0
        description: "x"
    y: mutable number = 0
        description: "y"
`;

  /** state-update envelopes on main's before_reasoning_iteration */
  function stateUpdates(source: string): {
    enabled: unknown;
    entries: Record<string, string>[];
  }[] {
    const { output, diagnostics } = compile(parseSource(source));
    expect(diagnostics.filter(d => d.severity === 0)).toHaveLength(0);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    return (node.before_reasoning_iteration ?? [])
      .filter(a => a.target === STATE_UPDATE_ACTION)
      .map(a => ({
        enabled: a.enabled,
        entries: (a.state_updates ?? []) as Record<string, string>[],
      }));
  }

  it('fuses two independent same-gate sets into one envelope', () => {
    const envelopes = stateUpdates(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            set @variables.a = True
            set @variables.b = False
            | keep going
`);
    // All three updates (both sets and the ungated `| keep going` append) share
    // the next_topic-empty gate, so they land in ONE envelope as ordered
    // entries rather than three separate envelopes.
    const setEnvelope = envelopes.find(e => e.entries.some(su => 'a' in su))!;
    // The two sets fuse, in source order, ahead of the fused instruction append.
    expect(setEnvelope.entries.slice(0, 2)).toEqual([
      { a: 'True' },
      { b: 'False' },
    ]);
    expect(setEnvelope.entries.length).toBeGreaterThan(2);
    // Exactly one envelope writes `a`, and exactly one writes `b` — proving no
    // duplicate/dropped writes across the merge.
    expect(envelopes.filter(e => e.entries.some(su => 'a' in su))).toHaveLength(
      1
    );
    expect(envelopes.filter(e => e.entries.some(su => 'b' in su))).toHaveLength(
      1
    );
  });

  it('does not fuse sets that sit under different gates', () => {
    const envelopes = stateUpdates(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            if @variables.a
                set @variables.b = True
            set @variables.a = False
`);
    // The gated set (inside the if) and the ungated set carry different
    // `enabled` values, so they must remain separate envelopes.
    const bEnvelope = envelopes.find(e => e.entries.some(su => 'b' in su))!;
    const aEnvelope = envelopes.find(e =>
      e.entries.some(su => su.a === 'False')
    )!;
    expect(bEnvelope.enabled).not.toBe(aEnvelope.enabled);
    expect(bEnvelope).not.toBe(aEnvelope);
  });

  it('does not fuse a self-referencing set across an intra-envelope read-after-write', () => {
    const envelopes = stateUpdates(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            set @variables.counter = 1
            set @variables.counter = @variables.counter + 1
`);
    // Both sets write `counter` under the same (absent) gate, so fusing them
    // naively would put "state.counter + 1" in the same envelope as the write
    // it depends on. The guard must keep them as two separate envelopes, in
    // source order, so the second entry's read still sees committed state
    // from a prior runtime step rather than depending on live-state ordering
    // within one envelope.
    const counterEnvelopes = envelopes.filter(e =>
      e.entries.some(su => 'counter' in su)
    );
    expect(counterEnvelopes).toHaveLength(2);
    expect(counterEnvelopes[0].entries).toEqual([{ counter: '1' }]);
    expect(counterEnvelopes[1].entries).toEqual([
      { counter: 'state.counter + 1' },
    ]);
  });

  it('does not fuse a cross-variable dependent set (b reads a)', () => {
    const envelopes = stateUpdates(`${HEAD}
start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            set @variables.x = 1
            set @variables.y = @variables.x + 1
`);
    // `y`'s RHS reads `state.x`, which the immediately preceding entry writes.
    // Fusing would create the same intra-envelope read-after-write hazard as
    // the self-referencing case, just across two different variable names.
    const xEnvelope = envelopes.find(e => e.entries.some(su => 'x' in su))!;
    const yEnvelope = envelopes.find(e => e.entries.some(su => 'y' in su))!;
    expect(xEnvelope).not.toBe(yEnvelope);
    expect(xEnvelope.entries.some(su => 'y' in su)).toBe(false);
    expect(yEnvelope.entries.some(su => 'x' in su)).toBe(false);
  });

  it('never fuses a set after a transition across the handoff in before_reasoning', () => {
    const { output, diagnostics } = compile(
      parseSource(`${HEAD}
start_agent main:
    description: "m"
    before_reasoning:
        set @variables.a = True
        transition to @topic.dest
        set @variables.b = True
    reasoning:
        instructions: ->
            | hi

topic dest:
    description: "d"
    reasoning:
        instructions: ->
            | dest
`)
    );
    expect(diagnostics.filter(d => d.severity === 0)).toHaveLength(0);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    const actions = node.before_reasoning ?? [];
    const writes = (action: Action, key: string) =>
      (action.state_updates ?? []).some(su => key in su);

    const handoffIndex = actions.findIndex(a => a.target === 'dest');
    const bIndex = actions.findIndex(a => writes(a, 'b'));
    expect(handoffIndex).toBeGreaterThan(-1);
    expect(bIndex).toBeGreaterThan(handoffIndex);
    expect(actions[bIndex].target).toBe(STATE_UPDATE_ACTION);
    // No envelope carries both the next_topic write and the `b` write.
    expect(
      actions.some(a => writes(a, NEXT_TOPIC_VARIABLE) && writes(a, 'b'))
    ).toBe(false);
  });

  describe('shared gate read-after-write guard', () => {
    const fuse = (gate: string) =>
      optimizeDirectiveActions(
        [
          createStateUpdateAction([{ x: '"done"' }], gate),
          createStateUpdateAction([{ y: '1' }], gate),
        ],
        {}
      );

    it('does not fuse when the shared gate reads a key the earlier envelope writes', () => {
      const actions = fuse('state.x == "pending"');
      expect(actions).toHaveLength(2);
    });

    it('fuses when the shared gate reads only unrelated variables', () => {
      const actions = fuse('state.counter == 0');
      expect(actions).toHaveLength(1);
      expect(actions[0].state_updates).toEqual([{ x: '"done"' }, { y: '1' }]);
    });
  });
});

// `optimize` compile flag: proves optimize: false actually disables the
// directive-action fusions above (more, smaller envelopes) while the
// per-turn instruction reset — required lowering, not an optimization — is
// still emitted.
describe('optimize compile flag', () => {
  const SOURCE = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    a: mutable boolean
        description: "a"

start_agent main:
    description: "m"
    reasoning:
        instructions: ->
            set @variables.a = True
            | keep going
`;

  function beforeReasoningIteration(actions: unknown): Action[] {
    return (actions ?? []) as Action[];
  }

  it('optimize: false yields more unfused actions than the optimize: true default, and keeps the per-turn reset', () => {
    const optimized = compile(parseSource(SOURCE));
    const unoptimized = compile(parseSource(SOURCE), { optimize: false });

    const optimizedNode = optimized.output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    const unoptimizedNode = unoptimized.output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    const optimizedActions = beforeReasoningIteration(
      optimizedNode.before_reasoning_iteration
    );
    const unoptimizedActions = beforeReasoningIteration(
      unoptimizedNode.before_reasoning_iteration
    );

    // The head directive is a `set`, not an append, so there is no reset-fold:
    // the 'True'-gated reset stays its own envelope. The `set` and the
    // `| keep going` append share the (absent) gate and fuse into a second
    // envelope, so optimize: true yields two envelopes; optimize: false leaves
    // the reset, set, and append as three.
    expect(unoptimizedActions.length).toBeGreaterThan(optimizedActions.length);

    // The per-turn reset must still be present — as its own standalone
    // envelope, unfolded — even though optimization is off.
    const reset = unoptimizedActions.find(
      action =>
        action.target === STATE_UPDATE_ACTION &&
        action.enabled === 'True' &&
        (action.state_updates ?? []).some(
          update => update[AGENT_INSTRUCTIONS_VARIABLE] === "''"
        )
    );
    expect(reset).toBeDefined();
  });
});
