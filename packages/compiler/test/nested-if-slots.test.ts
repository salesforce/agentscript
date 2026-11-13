/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Condition-slot allocation for nested conditionals.
 *
 * A nested `if` must not reuse its parent's condition slot: statements in the
 * parent body that follow the nested `if` are gated on the parent's slot, so
 * overwriting it with the inner condition mis-gates them.
 *
 * These pin the lowering itself, so they compile with `optimize: false` (the
 * optimizer may inline single-read slots away).
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, findNode } from './test-utils.js';
import { RUNTIME_CONDITION_VARIABLE } from '../src/constants.js';
import type { Action, HandOffAction } from '../src/types.js';

const slot = (n: number) => `${RUNTIME_CONDITION_VARIABLE}_${n}`;

type AnyAction = Action | HandOffAction;

function compileNode(source: string, nodeName = 'main') {
  const { output, diagnostics } = compile(parseSource(source), {
    optimize: false,
  });
  const node = findNode(output, nodeName, 'subagent');
  return { node, output, diagnostics };
}

/** The action that writes `varName` (a state update keyed by it). */
function findWrite(actions: AnyAction[], varName: string): Action[] {
  return actions.filter(
    (a): a is Action =>
      a.type === 'action' &&
      Array.isArray((a as Action).state_updates) &&
      (a as Action).state_updates!.some(u => varName in u)
  );
}

/** Slot variables referenced by an `enabled` expression. */
function slotsIn(enabled: unknown): string[] {
  return [
    ...new Set(
      (typeof enabled === 'string' ? enabled : '').match(
        new RegExp(`${RUNTIME_CONDITION_VARIABLE}_\\d+`, 'g')
      )
    ),
  ].sort();
}

const VARIABLES = `
config:
    agent_name: "TestBot"

variables:
    a: mutable boolean = True
    b: mutable boolean = False
    c: mutable number = 0
    d: mutable number = 0
    e: mutable number = 0
`;

describe('nested plain if in deterministic directives', () => {
  const source = `${VARIABLES}
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.a:
                if @variables.b:
                    set @variables.c = 1
                set @variables.d = 1
            | Done
`;

  it('allocates a fresh slot for the nested if', () => {
    const bri = (compileNode(source).node.before_reasoning_iteration ??
      []) as AnyAction[];
    const [outerWrite] = findWrite(bri, slot(1));
    const [innerWrite] = findWrite(bri, slot(2));
    expect(outerWrite.state_updates).toEqual([{ [slot(1)]: 'state.a' }]);
    expect(innerWrite.state_updates).toEqual([{ [slot(2)]: 'state.b' }]);
    // Nothing else writes slot 1 — the outer value survives the nested if.
    expect(findWrite(bri, slot(1))).toHaveLength(1);
  });

  it('gates the sibling after the nested if on the outer slot only', () => {
    const bri = (compileNode(source).node.before_reasoning_iteration ??
      []) as AnyAction[];
    const [setC] = findWrite(bri, 'c');
    const [setD] = findWrite(bri, 'd');
    expect(slotsIn(setC.enabled)).toEqual([slot(1), slot(2)]);
    expect(slotsIn(setD.enabled)).toEqual([slot(1)]);
  });

  it('declares every slot used as a state variable', () => {
    const { output } = compileNode(source);
    const names = output.agent_version.state_variables!.map(
      v => v.developer_name
    );
    expect(names).toContain(slot(1));
    expect(names).toContain(slot(2));
  });

  it('lets sequential siblings reuse low slots after a nested if', () => {
    const bri = (compileNode(`${VARIABLES}
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.a:
                if @variables.b:
                    set @variables.c = 1
                set @variables.d = 1
            if @variables.b:
                set @variables.e = 1
            | Done
`).node.before_reasoning_iteration ?? []) as AnyAction[];
    const [setE] = findWrite(bri, 'e');
    expect(slotsIn(setE.enabled)).toEqual([slot(1)]);
  });

  it('keeps an outer if stable across a nested if in its body', () => {
    const bri = (compileNode(`${VARIABLES}
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.a:
                if @variables.b:
                    set @variables.c = 1
            else if @variables.b:
                set @variables.d = 1
            | Done
`).node.before_reasoning_iteration ?? []) as AnyAction[];
    // The nested if and the else-if link both sit at depth 2, so both use
    // slot 2. They cannot interfere: one is gated on slot 1, the other on
    // `not` slot 1.
    const [innerWrite, linkWrite] = findWrite(bri, slot(2));
    expect(innerWrite.state_updates).toEqual([{ [slot(2)]: 'state.b' }]);
    expect(innerWrite.enabled).toBe(`state.${slot(1)}`);
    expect(linkWrite.enabled).toBe(`not (state.${slot(1)})`);
    expect(findWrite(bri, slot(1))).toHaveLength(1);
    const [setC] = findWrite(bri, 'c');
    const [setD] = findWrite(bri, 'd');
    expect(setC.enabled).toBe(`(state.${slot(1)}) and (state.${slot(2)})`);
    expect(setD.enabled).toBe(
      `(not (state.${slot(1)})) and (state.${slot(2)})`
    );
  });

  it('no longer warns about nested if/else', () => {
    const { diagnostics } = compileNode(`${VARIABLES}
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.a:
                if @variables.b:
                    set @variables.c = 1
                else:
                    set @variables.c = 2
                set @variables.d = 1
            | Done
`);
    expect(
      diagnostics.find(d => d.message.includes('Nested if/else'))
    ).toBeUndefined();
  });
});

describe('nested plain if in post-tool-call conditionals', () => {
  const source = `${VARIABLES}
start_agent main:
    description: "Test"
    actions:
        primary:
            description: "Primary action"
            target: "flow://Primary"
    reasoning:
        instructions: ->
            | test
        actions:
            invoke_primary: @actions.primary
                if @variables.a:
                    if @variables.b:
                        set @variables.c = 1
                    set @variables.d = 1
`;

  it('gates the sibling after the nested if on the outer slot only', () => {
    const { node } = compileNode(source);
    const post = (node.post_tool_call ?? []).find(p => p.target === 'primary');
    expect(post).toBeDefined();
    const actions = post!.actions as AnyAction[];

    const [outerWrite] = findWrite(actions, slot(1));
    const [innerWrite] = findWrite(actions, slot(2));
    expect(outerWrite.bound_inputs).toEqual({ condition: 'state.a' });
    expect(outerWrite.state_updates).toEqual([
      { [slot(1)]: 'result.condition' },
    ]);
    expect(innerWrite.bound_inputs).toEqual({ condition: 'state.b' });
    expect(innerWrite.state_updates).toEqual([
      { [slot(2)]: 'result.condition' },
    ]);
    expect(innerWrite.enabled).toBe(`state.${slot(1)}`);
    expect(findWrite(actions, slot(1))).toHaveLength(1);

    const [setC] = findWrite(actions, 'c');
    const [setD] = findWrite(actions, 'd');
    expect(slotsIn(setC.enabled)).toEqual([slot(1), slot(2)]);
    expect(slotsIn(setD.enabled)).toEqual([slot(1)]);
  });
});

describe('else if in deterministic directives', () => {
  const nextTopicEmpty = 'state.AgentScriptInternal_next_topic=="__EMPTY__"';
  const s = (n: number) => `state.${slot(n)}`;

  function beforeReasoning(body: string) {
    const { node, output } = compileNode(`${VARIABLES}
start_agent main:
    description: "Test"
    before_reasoning:
${body}
    reasoning:
        instructions: ->
            | Done
`);
    const declared = (output.agent_version.state_variables ?? [])
      .map(v => v.developer_name)
      .filter(n => n.startsWith(RUNTIME_CONDITION_VARIABLE));
    return { actions: (node.before_reasoning ?? []) as AnyAction[], declared };
  }

  it('gates each else-if snapshot on the earlier conditions being false', () => {
    const { actions } = beforeReasoning(`
        if @variables.a:
            set @variables.c = 1
        else if @variables.b:
            set @variables.d = 1
        else if @variables.c == 2:
            set @variables.d = 2
        else:
            set @variables.e = 1`);

    const [w1] = findWrite(actions, slot(1));
    const [w2] = findWrite(actions, slot(2));
    const [w3] = findWrite(actions, slot(3));
    expect(w1.enabled).toBe(nextTopicEmpty);
    expect(w2.state_updates).toEqual([{ [slot(2)]: 'state.b' }]);
    expect(w2.enabled).toBe(`(${nextTopicEmpty}) and (not (${s(1)}))`);
    expect(w3.state_updates).toEqual([{ [slot(3)]: 'state.c == 2' }]);
    expect(w3.enabled).toBe(
      `(${nextTopicEmpty}) and ((not (${s(1)})) and (not (${s(2)})))`
    );

    const [setE] = findWrite(actions, 'e');
    expect(setE.enabled).toBe(
      `(${nextTopicEmpty}) and ((not (${s(1)})) and (not (${s(2)})) and (not (${s(3)})))`
    );
  });

  it('writes each snapshot before the branches that read it', () => {
    const { actions } = beforeReasoning(`
        if @variables.a:
            set @variables.c = 1
        else if @variables.b:
            set @variables.d = 1`);
    const index = (name: string) =>
      actions.indexOf(findWrite(actions, name)[0]);
    expect(index(slot(1))).toBeLessThan(index('c'));
    expect(index('c')).toBeLessThan(index(slot(2)));
    expect(index(slot(2))).toBeLessThan(index('d'));
  });

  it('gives an if nested in an else-if body the next depth', () => {
    const { actions } = beforeReasoning(`
        if @variables.a:
            set @variables.c = 1
        else if @variables.b:
            if @variables.c == 1:
                set @variables.d = 1
            set @variables.e = 1`);
    const [nested] = findWrite(actions, slot(3));
    expect(nested.state_updates).toEqual([{ [slot(3)]: 'state.c == 1' }]);
    const [setD] = findWrite(actions, 'd');
    const [setE] = findWrite(actions, 'e');
    expect(slotsIn(setD.enabled)).toEqual([slot(1), slot(2), slot(3)]);
    expect(slotsIn(setE.enabled)).toEqual([slot(1), slot(2)]);
  });

  it('lets a sibling chain reuse the same slots', () => {
    const { actions, declared } = beforeReasoning(`
        if @variables.a:
            set @variables.c = 1
        else if @variables.b:
            set @variables.d = 1
        if @variables.b:
            set @variables.e = 1`);
    expect(findWrite(actions, slot(1))).toHaveLength(2);
    expect(declared).toEqual([slot(1), slot(2)]);
  });

  it('stores falsy conditions as written so the else branch selects', () => {
    const { actions } = beforeReasoning(`
        if None:
            set @variables.c = 1
        else if False:
            set @variables.d = 1
        else:
            set @variables.e = 1`);
    expect(findWrite(actions, slot(1))[0].state_updates).toEqual([
      { [slot(1)]: 'None' },
    ]);
    expect(findWrite(actions, slot(2))[0].state_updates).toEqual([
      { [slot(2)]: 'False' },
    ]);
  });

  it('applies the same gating in after_reasoning and instructions', () => {
    const { node } = compileNode(`${VARIABLES}
start_agent main:
    description: "Test"
    after_reasoning:
        if @variables.a:
            set @variables.c = 1
        else if @variables.b:
            set @variables.d = 1
    reasoning:
        instructions: ->
            if @variables.a:
                | A
            else if @variables.b:
                | B
`);
    for (const actions of [
      node.after_reasoning,
      node.before_reasoning_iteration,
    ] as AnyAction[][]) {
      const [link] = findWrite(actions, slot(2));
      expect(link.state_updates).toEqual([{ [slot(2)]: 'state.b' }]);
      expect(link.enabled).toContain(`not (${s(1)})`);
    }
  });
});

describe('post-tool-call conditionals', () => {
  const source = `${VARIABLES}
start_agent main:
    description: "Test"
    actions:
        primary:
            description: "Primary action"
            target: "flow://Primary"
            outputs:
                status: string
    reasoning:
        instructions: ->
            | test
        actions:
            invoke_primary: @actions.primary
                if @outputs.status == "ok":
                    set @variables.c = 1
                else if @outputs.status == "retry":
                    set @variables.d = 1
                else:
                    set @variables.e = 1
                if @variables.a:
                    set @variables.c = 2
`;

  function postActions(src = source) {
    const { node } = compileNode(src);
    const post = (node.post_tool_call ?? []).find(p => p.target === 'primary');
    expect(post).toBeDefined();
    return post!.actions as AnyAction[];
  }

  it('evaluates @outputs conditions as bound inputs of the snapshot', () => {
    const [head] = findWrite(postActions(), slot(1));
    expect(head).toEqual({
      type: 'action',
      target: '__state_update_action__',
      bound_inputs: { condition: 'result.status == "ok"' },
      state_updates: [{ [slot(1)]: 'result.condition' }],
      enabled: 'True',
    });
  });

  it('gates the else-if snapshot on the earlier condition being false', () => {
    const actions = postActions();
    const [link] = findWrite(actions, slot(2));
    expect(link.bound_inputs).toEqual({
      condition: 'result.status == "retry"',
    });
    expect(link.state_updates).toEqual([{ [slot(2)]: 'result.condition' }]);
    expect(link.enabled).toBe(`not (state.${slot(1)})`);

    const [setE] = findWrite(actions, 'e');
    expect(setE.enabled).toBe(
      `(not (state.${slot(1)})) and (not (state.${slot(2)}))`
    );
  });

  it('lets a sibling if reuse slot 1', () => {
    const actions = postActions();
    const heads = findWrite(actions, slot(1));
    expect(heads.map(a => a.bound_inputs)).toEqual([
      { condition: 'result.status == "ok"' },
      { condition: 'state.a' },
    ]);
  });

  it('emits no chat_history_behavior', () => {
    for (const action of postActions()) {
      expect(action).not.toHaveProperty('chat_history_behavior');
    }
  });

  describe('set in a branch', () => {
    const OUTPUT_VARIABLES = `${VARIABLES}
    s: mutable string = ""
`;

    function branchSets(body: string) {
      return postActions(`${OUTPUT_VARIABLES}
start_agent main:
    description: "Test"
    actions:
        primary:
            description: "Primary action"
            target: "flow://Primary"
            outputs:
                status: string
                count: number
    reasoning:
        instructions: ->
            | test
        actions:
            invoke_primary: @actions.primary
${body}
`);
    }

    it('evaluates an @outputs value as a bound input in every branch', () => {
      const actions = branchSets(`
                if @outputs.status == "ok":
                    set @variables.s = @outputs.status
                else if @outputs.status == "retry":
                    set @variables.c = @outputs.count + 1
                else:
                    set @variables.d = @outputs["count"]`);

      expect(findWrite(actions, 's')).toEqual([
        {
          type: 'action',
          target: '__state_update_action__',
          enabled: `state.${slot(1)}`,
          bound_inputs: { value: 'result.status' },
          state_updates: [{ s: 'result.value' }],
        },
      ]);
      const [setC] = findWrite(actions, 'c');
      expect(setC.bound_inputs).toEqual({ value: 'result.count + 1' });
      expect(setC.state_updates).toEqual([{ c: 'result.value' }]);
      expect(setC.enabled).toBe(
        `(not (state.${slot(1)})) and (state.${slot(2)})`
      );
      const [setD] = findWrite(actions, 'd');
      expect(setD.bound_inputs).toEqual({ value: 'result["count"]' });
      expect(setD.state_updates).toEqual([{ d: 'result.value' }]);
    });

    it('keeps the direct form for a value that does not read @outputs', () => {
      const actions = branchSets(`
                if @outputs.status == "ok":
                    set @variables.c = @variables.d + 1`);

      expect(findWrite(actions, 'c')).toEqual([
        {
          type: 'action',
          target: '__state_update_action__',
          enabled: `state.${slot(1)}`,
          state_updates: [{ c: 'state.d + 1' }],
        },
      ]);
    });

    it('evaluates an @outputs value in a nested if as a bound input', () => {
      const actions = branchSets(`
                if @variables.a:
                    if @outputs.status == "ok":
                        set @variables.s = @outputs.status`);

      const [setS] = findWrite(actions, 's');
      expect(setS.bound_inputs).toEqual({ value: 'result.status' });
      expect(setS.enabled).toBe(`(state.${slot(1)}) and (state.${slot(2)})`);
    });
  });
});

describe('subagent and workflow condition slots', () => {
  it('declares the two slot families separately', () => {
    const { output } = compile(
      parseSource(`${VARIABLES}
start_agent main:
    description: "Test"
    before_reasoning:
        if @variables.a:
            set @variables.c = 1
        else if @variables.b:
            set @variables.d = 1
    reasoning:
        instructions: ->
            | Done
        actions:
            go_flow: @utils.transition to @workflow.flow

workflow flow:
    description: "Flow"
    step decide: ->
        if @variables.a:
            say "A"
        else if @variables.b:
            say "B"
`),
      { optimize: false }
    );
    const names = (output.agent_version.state_variables ?? []).map(
      v => v.developer_name
    );
    expect(names).toEqual(
      expect.arrayContaining([
        slot(1),
        slot(2),
        'AgentScriptInternal_workflow_condition_1',
        'AgentScriptInternal_workflow_condition_2',
      ])
    );

    const workflow = output.agent_version.nodes.find(
      n => n.type === 'workflow'
    );
    expect(JSON.stringify(workflow)).not.toMatch(
      new RegExp(`${RUNTIME_CONDITION_VARIABLE}_\\d`)
    );
  });
});
