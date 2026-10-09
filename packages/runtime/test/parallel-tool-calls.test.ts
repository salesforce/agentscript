/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  InMemorySpanExporter,
  type RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

function makeDoc(toolCount = 3): AgentDSLAuthoring {
  const tools = Array.from({ length: toolCount }, (_, i) => ({
    name: `tool${i}`,
    target: `tool${i}`,
    description: `Tool ${i}`,
  }));
  const actionDefs = Array.from({ length: toolCount }, (_, i) => ({
    developer_name: `tool${i}`,
    invocation_target_type: 'fn',
    invocation_target_name: `tool${i}`,
  }));
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
          tools,
          action_definitions: actionDefs,
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
      ],
    },
  } as unknown as AgentDSLAuthoring;
}

function makeDocWithStateUpdate(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'test',
      initial_node: 'main',
      state_variables: [{ developer_name: 'counter', data_type: 'number' }],
      nodes: [
        {
          developer_name: 'main',
          type: 'subagent',
          instructions: 'You are a test agent.',
          tools: [
            { name: 'tool0', target: 'tool0', description: 'Tool 0' },
            {
              name: 'setState',
              target: '__state_update_action__',
              description: 'Set state',
            },
          ],
          action_definitions: [
            {
              developer_name: 'tool0',
              invocation_target_type: 'fn',
              invocation_target_name: 'tool0',
            },
          ],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
      ],
    },
  } as unknown as AgentDSLAuthoring;
}

function makeToolRegistry(delay = 0): ToolRegistry {
  const fn = new FnAdapter();
  for (let i = 0; i < 5; i++) {
    const name = `tool${i}`;
    fn.register(name, async args => {
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      return { ok: true, name, ...args };
    });
  }
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

function makeFailingToolRegistry(): ToolRegistry {
  const fn = new FnAdapter();
  fn.register('tool0', async () => ({ ok: true, name: 'tool0' }));
  fn.register('tool1', async () => {
    throw new Error('tool1 exploded');
  });
  fn.register('tool2', async () => ({ ok: true, name: 'tool2' }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Runtime — parallel tool dispatch', () => {
  it('dispatches multiple tool calls in parallel (strategy: always)', async () => {
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: { x: 0 } },
          { id: 'c1', name: 'tool1', arguments: { x: 1 } },
          { id: 'c2', name: 'tool2', arguments: { x: 2 } },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'always' },
    });

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('Done');

    const toolResults = result.events.filter(e => e.kind === 'tool-result');
    expect(toolResults).toHaveLength(3);
  });

  it('results appear in history in original call order', async () => {
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: { order: 'first' } },
          { id: 'c1', name: 'tool1', arguments: { order: 'second' } },
          { id: 'c2', name: 'tool2', arguments: { order: 'third' } },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'always' },
    });

    await runtime.turn('go');

    // Check the second LLM call's messages — tool results should be in order
    const messages = llm.calls[1].messages;
    const toolMsgs = messages.filter(m => m.role === 'tool');
    expect(toolMsgs).toHaveLength(3);
    expect(JSON.parse(toolMsgs[0].content as string)).toMatchObject({
      name: 'tool0',
      order: 'first',
    });
    expect(JSON.parse(toolMsgs[1].content as string)).toMatchObject({
      name: 'tool1',
      order: 'second',
    });
    expect(JSON.parse(toolMsgs[2].content as string)).toMatchObject({
      name: 'tool2',
      order: 'third',
    });
  });

  it('actually runs in parallel (timing check)', async () => {
    const delay = 50;
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
          { id: 'c2', name: 'tool2', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(delay),
      parallel: { strategy: 'always' },
    });

    const start = Date.now();
    await runtime.turn('go');
    const elapsed = Date.now() - start;

    // Sequential would take ~150ms, parallel should take ~50ms (+overhead)
    expect(elapsed).toBeLessThan(delay * 2.5);
  });

  it('handles one tool failing while others succeed', async () => {
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
          { id: 'c2', name: 'tool2', arguments: {} },
        ],
      },
      { text: 'Handled error' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeFailingToolRegistry(),
      parallel: { strategy: 'always' },
    });

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('Handled error');

    const toolErrors = result.events.filter(e => e.kind === 'tool-error');
    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toMatchObject({ name: 'fn://tool1' });

    const toolResults = result.events.filter(e => e.kind === 'tool-result');
    expect(toolResults).toHaveLength(2);
  });

  it('emits parallel-dispatch-start and parallel-dispatch-end events', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'always' },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const starts = events.filter(e => e.kind === 'parallel-dispatch-start');
    const ends = events.filter(e => e.kind === 'parallel-dispatch-end');
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      kind: 'parallel-dispatch-start',
      node: 'main',
      toolNames: ['tool0', 'tool1'],
    });
  });

  it('cancels remaining calls on abort signal', async () => {
    const controller = new AbortController();
    const fn = new FnAdapter();
    fn.register('tool0', async (_args, opts) => {
      // Simulate work that respects the signal
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 200);
        opts?.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
      return { ok: true };
    });
    fn.register('tool1', async () => ({ ok: true }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(2),
      llm,
      tools,
      parallel: { strategy: 'always' },
    });

    // Abort after a short delay
    setTimeout(() => controller.abort(), 20);

    await expect(
      runtime.turn('go', { signal: controller.signal })
    ).rejects.toThrow();
  });

  it('strategy: never always dispatches sequentially', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'never' },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    // No parallel events should be emitted
    const parallelEvents = events.filter(
      e => e.kind === 'parallel-dispatch-start'
    );
    expect(parallelEvents).toHaveLength(0);
  });

  it('strategy: auto falls back to sequential when state_update present', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'setState', arguments: { counter: 5 } },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDocWithStateUpdate(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'auto' },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const parallelEvents = events.filter(
      e => e.kind === 'parallel-dispatch-start'
    );
    expect(parallelEvents).toHaveLength(0);
  });

  it('sequentialTools option prevents specific tools from parallel dispatch', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'auto', sequentialTools: ['tool1'] },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const parallelEvents = events.filter(
      e => e.kind === 'parallel-dispatch-start'
    );
    expect(parallelEvents).toHaveLength(0);
  });

  it('tool limits are pre-checked before parallel dispatch', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'always' },
      toolLimits: { tool0: { maxCalls: 0 } },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const limitEvents = events.filter(e => e.kind === 'tool-limit-reached');
    expect(limitEvents).toHaveLength(1);
    expect(limitEvents[0]).toMatchObject({ name: 'tool0' });

    // tool1 should still have succeeded
    const toolResults = events.filter(e => e.kind === 'tool-result');
    expect(toolResults).toHaveLength(1);
  });

  it('middleware beforeToolCall/afterToolCall fire for each parallel call', async () => {
    const hooks: string[] = [];
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'always' },
      middleware: [
        {
          name: 'test-hooks',
          priority: 1,
          beforeToolCall: async ctx => {
            hooks.push(`before:${ctx.toolName}`);
            return undefined;
          },
          afterToolCall: async ctx => {
            hooks.push(`after:${ctx.toolName}`);
            return undefined;
          },
        },
      ],
    });

    await runtime.turn('go');

    expect(hooks).toContain('before:tool0');
    expect(hooks).toContain('before:tool1');
    expect(hooks).toContain('after:tool0');
    expect(hooks).toContain('after:tool1');
  });

  it('produces correct parent/child span tree under concurrent dispatch', async () => {
    // Regression: tracing previously used a single LIFO stack, so concurrent
    // siblings cross-popped each other and parent/child relationships
    // depended on completion order. Children stagger their resolution to
    // force interleaving — order should not matter.
    const fn = new FnAdapter();
    const delays: Record<string, number> = { tool0: 30, tool1: 5, tool2: 20 };
    for (const name of Object.keys(delays)) {
      fn.register(name, async () => {
        await new Promise(r => setTimeout(r, delays[name]));
        return { name };
      });
    }
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
          { id: 'c2', name: 'tool2', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);
    const exporter = new InMemorySpanExporter();
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      parallel: { strategy: 'always' },
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('go');

    const spans = exporter.getSpans();
    const parent = spans.find(s => s.name === 'parallel-tool-dispatch');
    const children = spans.filter(s => s.name.startsWith('tool-call:'));

    expect(parent).toBeDefined();
    expect(children).toHaveLength(3);
    expect(parent!.parentSpanId).toBeDefined();
    for (const child of children) {
      expect(child.parentSpanId).toBe(parent!.spanId);
      expect(child.status).toBe('ok');
      expect(child.endTime).toBeGreaterThanOrEqual(child.startTime);
    }
    expect(parent!.status).toBe('ok');
    // Parent must outlive every child even when children resolve out of order.
    for (const child of children) {
      expect(parent!.endTime!).toBeGreaterThanOrEqual(child.endTime!);
    }
  });

  it('failed parallel tool call closes its span exactly once with error status', async () => {
    // Regression: when a parallel tool call rejects, its child span must still
    // be finalized via endSpanById in dispatchToolCallIsolated's catch path —
    // not left dangling for drainAll to second-close. The exporter must see
    // each child span exactly once with the right status.
    const fn = new FnAdapter();
    fn.register('tool0', async () => ({ ok: true }));
    fn.register('tool1', () => Promise.reject(new Error('boom')));
    fn.register('tool2', async () => ({ ok: true }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'tool0', arguments: {} },
          { id: 'c1', name: 'tool1', arguments: {} },
          { id: 'c2', name: 'tool2', arguments: {} },
        ],
      },
      { text: 'Recovered' },
    ]);
    const exporter = new InMemorySpanExporter();
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      parallel: { strategy: 'always' },
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('go');

    const spans = exporter.getSpans();
    const childSpans = spans.filter(s => s.name.startsWith('tool-call:'));
    expect(childSpans).toHaveLength(3);

    const failed = childSpans.find(s => s.name === 'tool-call:tool1');
    expect(failed).toBeDefined();
    expect(failed!.status).toBe('error');
    expect(failed!.endTime).toBeDefined();

    for (const s of childSpans.filter(c => c.name !== 'tool-call:tool1')) {
      expect(s.status).toBe('ok');
      expect(s.endTime).toBeDefined();
    }

    const ids = childSpans.map(s => s.spanId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // -----------------------------------------------------------------------
  // Tier 2 — T2.1: failurePolicy 'fail-fast' contract.
  //
  // CONTRACT: fail-fast only fires when a settled promise is `rejected` from
  // dispatchToolCallIsolated's outer surface. In practice tool errors are
  // CAUGHT inside dispatchToolCallIsolated and surface as fulfilled outcomes
  // with `error: true`. So fail-fast as implemented does NOT abort siblings
  // when a tool throws — siblings run to completion, errors land in history,
  // child spans close as 'error' (failed) or 'ok' (succeeded), and one
  // 'tool-error' event fires for the failer. To exercise the abort path you
  // need a true rejection from invoke (and currently the runtime catches
  // those too).
  //
  // This test pins that observed behaviour. If the runtime is later changed
  // to propagate tool errors as rejections (so fail-fast actually cancels),
  // update the assertions to match the new contract.
  // -----------------------------------------------------------------------
  it("failurePolicy 'fail-fast' with a throwing tool: siblings still complete, error surfaces, spans close per outcome", async () => {
    const sawAbort: Record<string, boolean> = {
      slowOk1: false,
      slowOk2: false,
    };
    const fn = new FnAdapter();
    fn.register('quickFail', async () => {
      // Reject quickly so the runtime aborts the child controller while the
      // slow siblings are still in their setTimeout window.
      await new Promise(r => setTimeout(r, 5));
      throw new Error('quickFail boom');
    });
    const slowTool =
      (name: 'slowOk1' | 'slowOk2') =>
      async (_args: unknown, opts?: { signal?: AbortSignal }) => {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, 200);
          opts?.signal?.addEventListener('abort', () => {
            clearTimeout(t);
            sawAbort[name] = opts?.signal?.aborted ?? false;
            reject(new Error('aborted'));
          });
        });
        return { ok: true };
      };
    fn.register('slowOk1', slowTool('slowOk1'));
    fn.register('slowOk2', slowTool('slowOk2'));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    function makeFailFastDoc(): AgentDSLAuthoring {
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
                {
                  name: 'quickFail',
                  target: 'quickFail',
                  description: 'fast failer',
                },
                { name: 'slowOk1', target: 'slowOk1', description: 'slow ok' },
                { name: 'slowOk2', target: 'slowOk2', description: 'slow ok' },
              ],
              action_definitions: [
                {
                  developer_name: 'quickFail',
                  invocation_target_type: 'fn',
                  invocation_target_name: 'quickFail',
                },
                {
                  developer_name: 'slowOk1',
                  invocation_target_type: 'fn',
                  invocation_target_name: 'slowOk1',
                },
                {
                  developer_name: 'slowOk2',
                  invocation_target_type: 'fn',
                  invocation_target_name: 'slowOk2',
                },
              ],
              before_reasoning: [],
              before_reasoning_iteration: [],
              after_all_tool_calls: [],
              after_reasoning: [],
            },
          ],
        },
      } as unknown as AgentDSLAuthoring;
    }

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'quickFail', arguments: {} },
          { id: 'c1', name: 'slowOk1', arguments: {} },
          { id: 'c2', name: 'slowOk2', arguments: {} },
        ],
      },
      { text: 'recovered' },
    ]);
    const exporter = new InMemorySpanExporter();
    const runtime = new Runtime({
      doc: makeFailFastDoc(),
      llm,
      tools,
      parallel: { strategy: 'always', failurePolicy: 'fail-fast' },
      tracing: { enabled: true, exporter },
    });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('recovered');

    // Exactly one tool-error event for the fast failer.
    const toolErrors = events.filter(e => e.kind === 'tool-error');
    expect(toolErrors).toHaveLength(1);
    expect(toolErrors[0]).toMatchObject({ name: 'fn://quickFail' });

    // Per the contract documented above, the slow siblings ran to completion
    // (they did NOT see signal.aborted). The variable is recorded only on
    // abort — so it remains false here.
    expect(sawAbort.slowOk1).toBe(false);
    expect(sawAbort.slowOk2).toBe(false);

    // 4 spans: 1 parent (parallel-tool-dispatch) + 3 children. All children
    // must be finalized.
    const spans = exporter.getSpans();
    const parent = spans.find(s => s.name === 'parallel-tool-dispatch');
    const children = spans.filter(s => s.name.startsWith('tool-call:'));
    expect(parent).toBeDefined();
    expect(children).toHaveLength(3);
    for (const c of children) {
      expect(c.endTime).toBeDefined();
    }
    const fail = children.find(s => s.name === 'tool-call:quickFail');
    expect(fail?.status).toBe('error');
    // Successful siblings closed 'ok'.
    expect(children.find(s => s.name === 'tool-call:slowOk1')?.status).toBe(
      'ok'
    );
    expect(children.find(s => s.name === 'tool-call:slowOk2')?.status).toBe(
      'ok'
    );

    // History contains one role:'tool' entry per call, in call order.
    const toolMsgs = llm.calls[1].messages.filter(m => m.role === 'tool');
    expect(toolMsgs).toHaveLength(3);
    expect(toolMsgs[0].tool_name).toBe('quickFail');
    expect(toolMsgs[1].tool_name).toBe('slowOk1');
    expect(toolMsgs[2].tool_name).toBe('slowOk2');
  });

  // -----------------------------------------------------------------------
  // Tier 2 — T2.3: deterministic state-write order under parallel dispatch
  // and ref-equality suppression of no-op state changes.
  // -----------------------------------------------------------------------
  describe('parallel state-write order is deterministic by call order', () => {
    function makeStatefulDoc(): AgentDSLAuthoring {
      return {
        agent_version: {
          agent_name: 'test',
          initial_node: 'main',
          state_variables: [{ developer_name: 'counter', data_type: 'number' }],
          nodes: [
            {
              developer_name: 'main',
              type: 'subagent',
              instructions: 'You are a test agent.',
              tools: [
                {
                  name: 'slowSet',
                  target: 'slowSet',
                  description: 'slow setter',
                  state_updates: [{ counter: 'result.value' }],
                },
                {
                  name: 'fastSet',
                  target: 'fastSet',
                  description: 'fast setter',
                  state_updates: [{ counter: 'result.value' }],
                },
              ],
              action_definitions: [
                {
                  developer_name: 'slowSet',
                  invocation_target_type: 'fn',
                  invocation_target_name: 'slowSet',
                },
                {
                  developer_name: 'fastSet',
                  invocation_target_type: 'fn',
                  invocation_target_name: 'fastSet',
                },
              ],
              before_reasoning: [],
              before_reasoning_iteration: [],
              after_all_tool_calls: [],
              after_reasoning: [],
            },
          ],
        },
      } as unknown as AgentDSLAuthoring;
    }

    function buildRuntime(
      slowVal: unknown,
      fastVal: unknown
    ): {
      runtime: Runtime;
      events: RuntimeEvent[];
    } {
      const fn = new FnAdapter();
      fn.register('slowSet', async () => {
        await new Promise(r => setTimeout(r, 50));
        return { value: slowVal };
      });
      fn.register('fastSet', async () => {
        await new Promise(r => setTimeout(r, 5));
        return { value: fastVal };
      });
      const tools = new ToolRegistry();
      tools.register('fn', fn);

      const llm = new ScriptedLlm([
        {
          toolCalls: [
            { id: 'c0', name: 'slowSet', arguments: {} },
            { id: 'c1', name: 'fastSet', arguments: {} },
          ],
        },
        { text: 'done' },
      ]);
      const runtime = new Runtime({
        doc: makeStatefulDoc(),
        llm,
        tools,
        parallel: { strategy: 'always' },
      });
      const events: RuntimeEvent[] = [];
      runtime.on(e => events.push(e));
      return { runtime, events };
    }

    it('last write in call order wins (slowSet writes 1, then fastSet writes 2)', async () => {
      const { runtime, events } = buildRuntime(1, 2);
      await runtime.turn('go');
      expect(runtime.state.get('counter')).toBe(2);
      // The order assertions below are for the canonical apply-in-call-order
      // path: slowSet writes 1 first, then fastSet writes 2.
      const stateChanges = events.filter(
        e => e.kind === 'state-change' && e.name === 'counter'
      );
      expect(stateChanges).toHaveLength(2);
      expect(stateChanges[0]).toMatchObject({
        kind: 'state-change',
        name: 'counter',
        before: null,
        after: 1,
      });
      expect(stateChanges[1]).toMatchObject({
        kind: 'state-change',
        name: 'counter',
        before: 1,
        after: 2,
      });
    });

    it('writing the same primitive twice emits only one state-change (ref-equality suppression)', async () => {
      const { runtime, events } = buildRuntime(7, 7);
      await runtime.turn('go');
      expect(runtime.state.get('counter')).toBe(7);
      const stateChanges = events.filter(
        e => e.kind === 'state-change' && e.name === 'counter'
      );
      expect(stateChanges).toHaveLength(1);
      expect(stateChanges[0]).toMatchObject({
        kind: 'state-change',
        before: null,
        after: 7,
      });
    });

    it('writing two distinct object values both fire (object identity differs)', async () => {
      // Distinct object literals — same shape, different identity.
      const a = { x: 1 };
      const b = { x: 1 };
      const { runtime, events } = buildRuntime(a, b);
      await runtime.turn('go');
      const stateChanges = events.filter(
        e => e.kind === 'state-change' && e.name === 'counter'
      );
      // First write goes from default (0) -> a, second a -> b.
      expect(stateChanges).toHaveLength(2);
      expect(stateChanges[0].after).toBe(a);
      expect(stateChanges[1].after).toBe(b);
    });
  });

  it('single tool call does not trigger parallel dispatch', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c0', name: 'tool0', arguments: {} }] },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      parallel: { strategy: 'always' },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const parallelEvents = events.filter(
      e => e.kind === 'parallel-dispatch-start'
    );
    expect(parallelEvents).toHaveLength(0);
  });
});
