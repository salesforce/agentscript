/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier-3 operational stress: span hierarchy under nested concurrency.
 *
 * Scenario (simplified per the runtime's "what does not run yet" matrix —
 * nested delegation-as-tool from inside a parallel batch isn't a first-class
 * supported pattern, so we use Promise.all *inside* one of the parallel
 * tools to provoke the nested concurrency the runtime would actually see):
 *
 *   - LLM emits 3 tool calls in a single step
 *   - Runtime dispatches them in parallel (strategy: 'always')
 *   - One of the tools internally fires Promise.all over 2 sub-tasks
 *
 * Assertions:
 *   - every span has a parentSpanId resolvable in the export OR is a root
 *   - endTime >= startTime for every span
 *   - child time intervals fall inside parent intervals
 *   - parallel-dispatch-start count === parallel-dispatch-end count
 *   - TracingContext.isEmpty() after the turn (all spans closed)
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
import type { Span } from '../src/tracing/types.js';
import { ScriptedLlm } from './helpers.js';

function makeDoc(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'nested',
      initial_node: 'main',
      state_variables: [],
      nodes: [
        {
          developer_name: 'main',
          type: 'subagent',
          instructions: 'You are a parallel agent.',
          tools: [
            { name: 'fetch_a', target: 'fetch_a', description: 'Fetch A' },
            { name: 'fetch_b', target: 'fetch_b', description: 'Fetch B' },
            {
              name: 'fanout',
              target: 'fanout',
              description: 'Fans out internally to two sub-fetches',
            },
          ],
          action_definitions: [
            {
              developer_name: 'fetch_a',
              invocation_target_type: 'fn',
              invocation_target_name: 'fetch_a',
            },
            {
              developer_name: 'fetch_b',
              invocation_target_type: 'fn',
              invocation_target_name: 'fetch_b',
            },
            {
              developer_name: 'fanout',
              invocation_target_type: 'fn',
              invocation_target_name: 'fanout',
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

describe('Runtime — nested concurrency span tree (Tier-3)', () => {
  it('produces a well-formed span tree under parallel dispatch with internal Promise.all', async () => {
    const fn = new FnAdapter();
    fn.register('fetch_a', async () => {
      await new Promise(r => setTimeout(r, 15));
      return { name: 'a' };
    });
    fn.register('fetch_b', async () => {
      await new Promise(r => setTimeout(r, 25));
      return { name: 'b' };
    });
    // The "fanout" tool itself runs two concurrent inner tasks via
    // Promise.all to exercise nested concurrency at the userland level.
    fn.register('fanout', async () => {
      const [x, y] = await Promise.all([
        new Promise<number>(r => setTimeout(() => r(1), 10)),
        new Promise<number>(r => setTimeout(() => r(2), 20)),
      ]);
      return { sum: x + y };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'fetch_a', arguments: {} },
          { id: 'c1', name: 'fanout', arguments: {} },
          { id: 'c2', name: 'fetch_b', arguments: {} },
        ],
      },
      { text: 'all done' },
    ]);

    const exporter = new InMemorySpanExporter();
    const events: RuntimeEvent[] = [];
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      parallel: { strategy: 'always' },
      tracing: { enabled: true, exporter },
    });
    runtime.on(e => events.push(e));

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('all done');

    const spans = exporter.getSpans();
    expect(spans.length).toBeGreaterThan(0);

    // ---- Every span: endTime >= startTime ----
    for (const s of spans) {
      expect(s.endTime, `span ${s.name} missing endTime`).toBeDefined();
      expect(s.endTime!).toBeGreaterThanOrEqual(s.startTime);
    }

    // ---- Every span has parentSpanId resolvable in the export OR is a root ----
    const byId = new Map<string, Span>();
    for (const s of spans) byId.set(s.spanId, s);

    let roots = 0;
    for (const s of spans) {
      if (s.parentSpanId === undefined) {
        roots++;
      } else {
        expect(
          byId.has(s.parentSpanId),
          `parent ${s.parentSpanId} for span ${s.name} not in export`
        ).toBe(true);
      }
    }
    // We expect a single root: the "turn" span.
    expect(roots).toBe(1);

    // ---- Children fall inside parents ----
    for (const s of spans) {
      if (s.parentSpanId === undefined) continue;
      const p = byId.get(s.parentSpanId)!;
      expect(s.startTime).toBeGreaterThanOrEqual(p.startTime);
      expect(s.endTime!).toBeLessThanOrEqual(p.endTime!);
    }

    // ---- parallel-dispatch-start === parallel-dispatch-end ----
    const starts = events.filter(e => e.kind === 'parallel-dispatch-start');
    const ends = events.filter(e => e.kind === 'parallel-dispatch-end');
    expect(starts.length).toBe(ends.length);
    expect(starts.length).toBeGreaterThanOrEqual(1);

    // ---- The 3 tool-call children share the parallel-tool-dispatch parent ----
    const parallelParent = spans.find(s => s.name === 'parallel-tool-dispatch');
    expect(parallelParent).toBeDefined();
    const toolChildren = spans.filter(s => s.name.startsWith('tool-call:'));
    expect(toolChildren.length).toBeGreaterThanOrEqual(3);
    for (const child of toolChildren) {
      expect(child.parentSpanId).toBe(parallelParent!.spanId);
    }

    // ---- TracingContext is empty (all spans closed) ----
    const ctx = (
      runtime as unknown as {
        _tracingCtx: { isEmpty: () => boolean } | null;
      }
    )._tracingCtx;
    expect(ctx).not.toBeNull();
    expect(ctx!.isEmpty()).toBe(true);
  });
});
