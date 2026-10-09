/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { Middleware } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * `pre_tool_call` has no compiler producer yet (schema-only in
 * generated/agent-dsl.ts) — no `.agent` construct emits it. Per the plan,
 * compile a normal agent through the real pipeline, then mutate the
 * compiled node's `pre_tool_call` directly before constructing `Runtime`.
 * This exercises the runtime-side mechanism (identical to `post_tool_call`,
 * just triggered earlier) ahead of the compiler catching up.
 */
const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "PreHookBot"
    default_agent_user: "bot@example.com"

variables:
    seen_by_pre: mutable string = ""
        description: "set by the pre_tool_call hook"

start_agent main:
    description: "main"

    actions:
        A:
            description: "Action A"
            inputs:
                x: string
                    description: "input x"
            outputs:
                value: string
                    description: "A output"
            target: "fn://action_a"
        Marker:
            description: "records that a pre-hook ran"
            target: "fn://marker"

    reasoning:
        instructions: ->
            | do it
        actions:
            do_a: @actions.A
                with x = "from-tool"
subagent other:
    description: "other"
    reasoning:
        instructions: ->
            | done
`;

function compile() {
  const { output, diagnostics } = compileSource(SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  expect(errors).toEqual([]);
  return output;
}

function mainNode(output: ReturnType<typeof compile>) {
  const node = output.agent_version.nodes.find(
    (n: { developer_name: string }) => n.developer_name === 'main'
  ) as { pre_tool_call?: unknown };
  if (!node) throw new Error('main node not found in compiled output');
  return node;
}

describe('Runtime — pre_tool_call hook execution', () => {
  function makeTools() {
    const fn = new FnAdapter();
    let aCalled = false;
    fn.register('action_a', args => {
      aCalled = true;
      return { value: `saw ${args.x as string}` };
    });
    fn.register('marker', () => ({ ok: true }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    return { tools, isACalled: () => aCalled };
  }

  it('runs before the tool executes and before beforeToolCall middleware, with its state write visible to both', async () => {
    const output = compile();
    mainNode(output).pre_tool_call = [
      {
        target: 'A',
        actions: [
          {
            type: 'action',
            target: '__state_update_action__',
            state_updates: [{ seen_by_pre: '"marker-ran"' }],
          },
        ],
      },
    ];

    const { tools, isACalled } = makeTools();
    const middlewareSeenState: unknown[] = [];
    const middleware: Middleware = {
      name: 'observer',
      beforeToolCall(ctx) {
        middlewareSeenState.push(ctx.state.seen_by_pre);
      },
    };

    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'do_a', arguments: {} }] },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });

    await runtime.turn('go');

    expect(isACalled()).toBe(true);
    expect(runtime.state.get('seen_by_pre')).toBe('marker-ran');
    // beforeToolCall ran after the pre-hook, so it already saw the write.
    expect(middlewareSeenState).toEqual(['marker-ran']);
  });

  it('a pre_tool_call handoff pre-empts both the tool call and beforeToolCall middleware', async () => {
    const output = compile();
    mainNode(output).pre_tool_call = [
      {
        target: 'A',
        actions: [{ type: 'handoff', target: 'other' }],
      },
    ];

    const { tools, isACalled } = makeTools();
    let middlewareCalled = false;
    const middleware: Middleware = {
      name: 'observer',
      beforeToolCall() {
        middlewareCalled = true;
      },
    };

    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'do_a', arguments: {} }] },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });

    const result = await runtime.turn('go');

    expect(result.finalNode).toBe('other');
    expect(isACalled()).toBe(false);
    expect(middlewareCalled).toBe(false);
  });

  it('surfaces the same ordering on the isolated parallel-dispatch path', async () => {
    const output = compile();
    mainNode(output).pre_tool_call = [
      {
        target: 'A',
        actions: [
          {
            type: 'action',
            target: '__state_update_action__',
            state_updates: [{ seen_by_pre: '"marker-ran"' }],
          },
        ],
      },
    ];

    const { tools, isACalled } = makeTools();
    const middlewareSeenState: unknown[] = [];
    const middleware: Middleware = {
      name: 'observer',
      beforeToolCall(ctx) {
        middlewareSeenState.push(ctx.state.seen_by_pre);
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_a', arguments: {} },
          { id: 'c2', name: 'do_marker', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    // `do_marker` isn't declared in the SRC's reasoning actions, so add it
    // directly to the compiled tool list alongside `do_a`.
    (
      output.agent_version.nodes[0] as unknown as {
        tools: Array<Record<string, unknown>>;
      }
    ).tools.push({
      type: 'action',
      target: 'Marker',
      bound_inputs: {},
      llm_inputs: [],
      state_updates: [],
      name: 'do_marker',
      description: 'Marker',
    });

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
      parallel: { strategy: 'always' },
    });

    await runtime.turn('go');

    expect(isACalled()).toBe(true);
    expect(runtime.state.get('seen_by_pre')).toBe('marker-ran');
    expect(middlewareSeenState).toContain('marker-ran');
  });
});
