/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier-3 operational stress: 30-turn conversation against a single Runtime.
 * Asserts:
 *   - history grows linearly and deterministically
 *   - the per-turn listener attached inside runtime.turn() is detached at the
 *     end of every turn (registry size doesn't drift)
 *   - heap usage between turn 5 and turn 30 stays bounded (no obvious leak)
 *   - span exports grow linearly with no cross-turn duplicates
 */

import { describe, it, expect } from 'vitest';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  InMemorySpanExporter,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

function makeDoc(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'long-conversation',
      initial_node: 'main',
      state_variables: [],
      nodes: [
        {
          developer_name: 'main',
          type: 'subagent',
          instructions: 'You are an information-lookup agent.',
          tools: [
            {
              name: 'lookup',
              target: 'lookup',
              description: 'Look up something',
            },
          ],
          action_definitions: [
            {
              developer_name: 'lookup',
              invocation_target_type: 'fn',
              invocation_target_name: 'lookup',
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

describe('Runtime — 30-turn long conversation (Tier-3 stress)', () => {
  it('history, listener registry, heap, and spans stay bounded', async () => {
    const TURNS = 30;

    // Build a deterministic 2-cycle script: every odd turn issues a tool call
    // and a reply; every even turn replies with plain text only.
    // ScriptedLlm consumes one entry per LLM step. A tool-call turn needs
    // 2 entries (call, then text after tool result); a text-only turn needs 1.
    const script: Array<{
      text?: string;
      toolCalls?: {
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }[];
    }> = [];
    for (let t = 0; t < TURNS; t++) {
      if (t % 2 === 0) {
        // tool-call turn
        script.push({
          toolCalls: [
            { id: `c${t}`, name: 'lookup', arguments: { q: `query-${t}` } },
          ],
        });
        script.push({ text: `Result for turn ${t}.` });
      } else {
        // text-only turn
        script.push({ text: `Plain reply turn ${t}.` });
      }
    }

    const llm = new ScriptedLlm(script);
    const fn = new FnAdapter();
    fn.register('lookup', (args: Record<string, unknown>) => ({
      hit: true,
      query: args.q,
    }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const exporter = new InMemorySpanExporter();
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      tracing: { enabled: true, exporter },
    });

    // Probe listener — registered ONCE outside the turn. The runtime adds
    // its own per-turn listener inside turn(); if it fails to clean up,
    // the bus's internal Set grows turn-over-turn. We pin the count.
    const probeEvents: string[] = [];
    const offProbe = runtime.on(e => probeEvents.push(e.kind));

    // Capture pre-turn baseline: only the probe is attached.
    const bus = (runtime as unknown as { bus: { listeners: Set<unknown> } })
      .bus;
    expect(bus.listeners.size).toBe(1);

    let heapAtTurn5 = 0;
    let spansAtTurn5 = 0;
    const listenerCounts: number[] = [];

    for (let t = 0; t < TURNS; t++) {
      const userMsg = t % 2 === 0 ? `lookup turn ${t}` : `chat turn ${t}`;
      await runtime.turn(userMsg);

      // After each turn: per-turn listener must be cleaned up. Only the
      // probe should remain.
      listenerCounts.push(bus.listeners.size);

      if (t === 4) {
        if (typeof globalThis.gc === 'function') globalThis.gc();
        heapAtTurn5 = process.memoryUsage().heapUsed;
        spansAtTurn5 = exporter.getSpans().length;
      }
    }

    // ---- Listener registry stable: every post-turn count is exactly 1 ----
    expect(new Set(listenerCounts)).toEqual(new Set([1]));
    expect(bus.listeners.size).toBe(1);

    // ---- History grows linearly ----
    // Per turn-call (with tool call): user + assistant(tool_calls) + tool + assistant(text) = 4 messages
    // Per turn-call (text only):       user + assistant(text)                                = 2 messages
    // 30 turns: 15 tool-call + 15 text-only = 15*4 + 15*2 = 90
    const history = (runtime as unknown as { history: unknown[] }).history;
    expect(history.length).toBe(15 * 4 + 15 * 2);

    // The checkpoint API also exposes history; cross-check it matches.
    const cp = runtime.checkpoint();
    expect(cp.history.length).toBe(history.length);

    // ---- Heap is bounded between turn 5 and turn 30 ----
    if (typeof globalThis.gc === 'function') globalThis.gc();
    const heapAtTurn30 = process.memoryUsage().heapUsed;
    const heapDeltaMb = (heapAtTurn30 - heapAtTurn5) / (1024 * 1024);
    // Generous threshold — payload is tiny, real growth should be < 10 MB.
    expect(heapDeltaMb).toBeLessThan(50);

    // ---- Span counts grow roughly linearly with no duplicates ----
    const spans = exporter.getSpans();
    // Each turn produces at minimum: 1 turn span + 1 node span + N llm-step spans.
    // After turn 5, exporter had spansAtTurn5; after turn 30 we expect ~6x more
    // (allowing some slack — strict linearity isn't required, just no runaway).
    expect(spans.length).toBeGreaterThan(spansAtTurn5);
    const expectedRatioMin = 3; // 30/5 = 6, but we leave wide margin
    expect(spans.length / Math.max(spansAtTurn5, 1)).toBeGreaterThanOrEqual(
      expectedRatioMin
    );

    // No duplicate span IDs (would indicate a leaking listener replaying spans).
    const ids = spans.map(s => s.spanId);
    expect(new Set(ids).size).toBe(ids.length);

    // Probe listener saw events — sanity check it actually fires.
    expect(probeEvents.length).toBeGreaterThan(0);

    offProbe();
    expect(bus.listeners.size).toBe(0);
  });
});
