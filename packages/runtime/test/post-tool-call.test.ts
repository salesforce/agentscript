/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * A nested `run @actions.X` inside a reasoning action's body compiles to a
 * `post_tool_call` entry keyed by the OUTER action's target
 * (compile-tool.ts:195-196). This is the real, compiler-supported construct
 * — no hand-built IR fixture needed for post_tool_call (unlike pre_tool_call,
 * which has no producer yet).
 */
const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "PostHookBot"
    default_agent_user: "bot@example.com"

variables:
    a_result: mutable string = ""
        description: "A's result"
    b_result: mutable string = ""
        description: "B's result"

start_agent main:
    description: "main"

    actions:
        A:
            description: "Action A"
            outputs:
                value: string
                    description: "A output"
            target: "fn://action_a"
        B:
            description: "Action B"
            inputs:
                from_a: string
                    description: "input from A"
            outputs:
                value: string
                    description: "B output"
            target: "fn://action_b"

    reasoning:
        instructions: ->
            | do it
        actions:
            do_a: @actions.A
                set @variables.a_result = @outputs.value
                run @actions.B
                    with from_a = @outputs.value
                    set @variables.b_result = @outputs.value
`;

describe('Runtime — post_tool_call hook execution', () => {
  function compile() {
    const { output, diagnostics } = compileSource(SRC);
    const errors = diagnostics.filter(
      d =>
        d.severity === 1 &&
        d.code !== 'invalid-action-target' &&
        d.code !== 'action-missing-input'
    );
    expect(errors).toEqual([]);
    return output;
  }

  function makeTools() {
    const fn = new FnAdapter();
    const calls: string[] = [];
    fn.register('action_a', () => {
      calls.push('A');
      return { value: 'from-A' };
    });
    fn.register('action_b', args => {
      calls.push('B');
      return { value: `B saw ${args.from_a as string}` };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    return { tools, calls };
  }

  it('runs the nested action after the outer tool result, exposing result.* to its bound_inputs', async () => {
    const output = compile();
    const { tools, calls } = makeTools();

    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'do_a', arguments: {} }] },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({ doc: output, llm, tools });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    // Both A and B ran, in order.
    expect(calls).toEqual(['A', 'B']);

    // B's bound `from_a` resolved against A's result (result.value), and B's
    // own `set` resolved against B's result.
    expect(runtime.state.get('a_result')).toBe('from-A');
    expect(runtime.state.get('b_result')).toBe('B saw from-A');

    // Event order: tool-call(A) -> tool-result(A) -> tool-call(B) -> tool-result(B)
    const toolEvents = events
      .filter(e => e.kind === 'tool-call' || e.kind === 'tool-result')
      .map(e => `${e.kind}:${(e as { name: string }).name}`);
    expect(toolEvents).toEqual([
      'tool-call:fn://action_a',
      'tool-result:fn://action_a',
      'tool-call:fn://action_b',
      'tool-result:fn://action_b',
    ]);
  });
});

/**
 * A tool-body nested `if @outputs.X: transition to @subagent.Y` does NOT
 * compile to a `post_tool_call`-level handoff directly. It compiles to (1) a
 * `post_tool_call` action that sets `AgentScriptInternal_next_topic` from the
 * tool's own result, gated by the condition, and (2) a `HandOffAction` in the
 * node's pre-existing `after_all_tool_calls` list, gated on that same state
 * var (compile-tool.ts's compileTransitionInConditional). So this test
 * exercises `post_tool_call`'s state-write feeding the existing
 * after_all_tool_calls handoff — not the new post_tool_call-level `handoffTo`
 * wired into dispatchToolCall/dispatchToolCallIsolated (pre-existing compiler
 * behavior, confirmed via a direct compile probe of this exact source).
 */
const SRC_HANDOFF = `
system:
    instructions: "bot"

config:
    agent_name: "RouterBot"
    default_agent_user: "bot@example.com"

variables:
    a_flag: mutable boolean = False
        description: "flag"

start_agent main:
    description: "main"

    actions:
        A:
            description: "Action A"
            outputs:
                should_route: boolean
                    description: "route flag"
            target: "fn://action_a"
        Noop:
            description: "no-op sibling"
            target: "fn://noop"

    reasoning:
        instructions: ->
            | do it
        actions:
            do_a: @actions.A
                if @outputs.should_route:
                    transition to @subagent.other
            do_noop: @actions.Noop

subagent other:
    description: "other"
    reasoning:
        instructions: ->
            | done
`;

describe('Runtime — post_tool_call state-write into after_all_tool_calls handoff', () => {
  function compile() {
    const { output, diagnostics } = compileSource(SRC_HANDOFF);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);
    return output;
  }

  function makeTools(shouldRoute: boolean) {
    const fn = new FnAdapter();
    let noopCalled = false;
    fn.register('action_a', () => ({ should_route: shouldRoute }));
    fn.register('noop', () => {
      noopCalled = true;
      return {};
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    return { tools, isNoopCalled: () => noopCalled };
  }

  it('hands off to the target node once the batch finishes (via after_all_tool_calls, not mid-batch)', async () => {
    const output = compile();
    const { tools, isNoopCalled } = makeTools(true);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_a', arguments: {} },
          { id: 'c2', name: 'do_noop', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({ doc: output, llm, tools });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('go');

    expect(result.finalNode).toBe('other');
    // Because the condition sets state (post_tool_call) rather than the
    // batch's post_tool_call producing a handoffTo itself, the handoff only
    // fires once after_all_tool_calls evaluates at end-of-round — the sibling
    // `do_noop` call issued in the same LLM step still runs.
    expect(isNoopCalled()).toBe(true);

    const toolCallEvents = events
      .filter(e => e.kind === 'tool-call')
      .map(e => (e as { name: string }).name);
    expect(toolCallEvents).toEqual(['fn://action_a', 'fn://noop']);
  });

  it('does not hand off when the condition is false, and the sibling call runs', async () => {
    const output = compile();
    const { tools, isNoopCalled } = makeTools(false);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_a', arguments: {} },
          { id: 'c2', name: 'do_noop', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({ doc: output, llm, tools });

    const result = await runtime.turn('go');

    expect(result.finalNode).toBe('main');
    expect(isNoopCalled()).toBe(true);
  });
});

/**
 * No `.agent` construct compiles a `HandOffAction` directly into
 * `post_tool_call.actions` (see the suite above) — a tool-body `if`/`to`
 * always routes through the pre-existing `after_all_tool_calls` list
 * instead. To exercise the actual `handoffTo`-from-`post_tool_call` branch
 * wired into dispatchToolCall/dispatchToolCallIsolated, hand-build an
 * AgentDSLAuthoring doc (parallel-tool-calls.test.ts's makeDoc() pattern)
 * with a handoff entry placed directly in post_tool_call.
 */
function makeHandoffDoc(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'test',
      initial_node: 'main',
      state_variables: [],
      nodes: [
        {
          developer_name: 'main',
          type: 'subagent',
          instructions: 'You are a test agent.',
          tools: [
            { name: 'tool_a', target: 'ActionA', description: 'Tool A' },
            { name: 'tool_b', target: 'ActionB', description: 'Tool B' },
          ],
          action_definitions: [
            {
              developer_name: 'ActionA',
              invocation_target_type: 'fn',
              invocation_target_name: 'action_a',
            },
            {
              developer_name: 'ActionB',
              invocation_target_type: 'fn',
              invocation_target_name: 'action_b',
            },
          ],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
          post_tool_call: [
            {
              target: 'ActionA',
              actions: [
                {
                  type: 'handoff',
                  target: 'other',
                },
              ],
            },
          ],
        },
        {
          developer_name: 'other',
          type: 'subagent',
          instructions: 'You are the other agent.',
          tools: [],
          action_definitions: [],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
      ],
    },
  } as unknown as AgentDSLAuthoring;
}

describe('Runtime — post_tool_call-level handoff (synthetic IR)', () => {
  function makeTools() {
    const fn = new FnAdapter();
    let bCalled = false;
    fn.register('action_a', () => ({ ok: true }));
    fn.register('action_b', () => {
      bCalled = true;
      return { ok: true };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    return { tools, isBCalled: () => bCalled };
  }

  it('hands off immediately, abandoning the sibling call in the same batch (sequential dispatch)', async () => {
    const doc = makeHandoffDoc();
    const { tools, isBCalled } = makeTools();

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'tool_a', arguments: {} },
          { id: 'c2', name: 'tool_b', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    // Force the sequential dispatch path — the default 'auto' strategy
    // dispatches >1 calls in parallel, which is covered separately below.
    const runtime = new Runtime({
      doc,
      llm,
      tools,
      parallel: { strategy: 'never' },
    });

    const result = await runtime.turn('go');

    expect(result.finalNode).toBe('other');
    expect(isBCalled()).toBe(false);
  });

  it('hands off immediately under parallel dispatch too, aggregating "first submitted wins"', async () => {
    const doc = makeHandoffDoc();
    const { tools } = makeTools();

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'tool_a', arguments: {} },
          { id: 'c2', name: 'tool_b', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc,
      llm,
      tools,
      parallel: { strategy: 'always' },
    });

    const result = await runtime.turn('go');

    expect(result.finalNode).toBe('other');
  });
});
