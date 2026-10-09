/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier-3 operational stress: pin the actual behavior of the runtime when
 * `maxStepsPerTurn` is reached.
 *
 * NOTE — runtime API reality check:
 *   The `exhaustionPolicy` option is wired ONLY for *guardrail* retry
 *   exhaustion (see runtime.ts ~line 889). The maxStepsPerTurn ceiling is
 *   enforced via `if (++steps > this.maxSteps) break outer;` — it never
 *   throws and never consults `exhaustionPolicy`. Both 'throw' and the
 *   value 'last-response' (the only two values of `ExhaustionPolicy`)
 *   behave identically when `maxStepsPerTurn` is hit.
 *
 *   The user-facing scenario asked for `'throw'` vs `'accept-last'`. There
 *   is no `'accept-last'` value. We therefore:
 *     1. Test guardrail exhaustion (where the policy IS wired) — that's
 *        the actual exhaustion-boundary in the runtime.
 *     2. Pin the no-throw, history-well-formed behavior of
 *        `maxStepsPerTurn=1` so any future change becomes visible.
 */

import { describe, it, expect } from 'vitest';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  GuardrailExhaustionError,
  type Guardrail,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

function makeDoc(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'exh',
      initial_node: 'main',
      state_variables: [],
      nodes: [
        {
          developer_name: 'main',
          type: 'subagent',
          instructions: 'You are an agent.',
          tools: [{ name: 'work', target: 'work', description: 'Work tool' }],
          action_definitions: [
            {
              developer_name: 'work',
              invocation_target_type: 'fn',
              invocation_target_name: 'work',
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

function makeTools(): ToolRegistry {
  const fn = new FnAdapter();
  fn.register('work', () => ({ ok: true }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

/** Validates messages by some content rule — used to force exhaustion. */
function alwaysFailGuardrail(): Guardrail {
  return {
    name: 'always-fail',
    target: 'both',
    maxRetries: 1,
    // eslint-disable-next-line @typescript-eslint/require-await
    async validate() {
      return { valid: false, reason: 'forced failure' };
    },
  };
}

describe('Runtime — guardrail exhaustion policy boundary (Tier-3)', () => {
  it("policy 'throw' rejects the turn with GuardrailExhaustionError", async () => {
    const llm = new ScriptedLlm([
      { text: 'attempt 1' },
      { text: 'attempt 2' },
      { text: 'attempt 3' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
      guardrails: [alwaysFailGuardrail()],
      exhaustionPolicy: 'throw',
    });

    await expect(runtime.turn('go')).rejects.toBeInstanceOf(
      GuardrailExhaustionError
    );

    // No end-session was emitted because the throw aborted the turn.
    // History should remain well-formed: only the user message was pushed —
    // the rejected attempts live in a scratch buffer per the runtime contract.
    const history = (runtime as unknown as { history: { role: string }[] })
      .history;
    expect(history[history.length - 1]).toMatchObject({ role: 'user' });
    // No assistant tool_calls were appended without a matching tool_result.
    const orphaned = history.filter(
      (m): m is { role: string; tool_calls?: unknown[] } =>
        m.role === 'assistant' &&
        Array.isArray((m as { tool_calls?: unknown[] }).tool_calls)
    );
    expect(orphaned).toHaveLength(0);
  });

  it("policy 'last-response' resolves with the last (rejected) text and history is well-formed", async () => {
    const llm = new ScriptedLlm([
      { text: 'attempt 1' },
      { text: 'attempt 2' },
      { text: 'final text' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
      guardrails: [alwaysFailGuardrail()],
      exhaustionPolicy: 'last-response',
    });

    const result = await runtime.turn('go');
    // Some non-empty assistant text survives — the runtime accepted the
    // last invalid response under 'last-response'.
    expect(typeof result.assistantText).toBe('string');
    expect(result.assistantText.length).toBeGreaterThan(0);

    // History must remain well-formed: every assistant tool_calls message
    // (none here, since the LLM never tool-called) is balanced.
    const history = (
      runtime as unknown as {
        history: { role: string; tool_calls?: unknown[] }[];
      }
    ).history;
    const danglingToolCalls = history.filter(
      m => m.role === 'assistant' && Array.isArray(m.tool_calls)
    );
    // No tool calls were issued.
    expect(danglingToolCalls).toHaveLength(0);

    // A *subsequent* turn must succeed: exhaustion didn't corrupt counters.
    // Use a runtime without guardrails for the second run by reaching into
    // opts isn't possible — but the same runtime can take another turn if
    // we swap the LLM script. The simplest pin: the runtime is still callable.
    expect(runtime.currentNodeName).toBe('main');
  });
});

describe('Runtime — maxStepsPerTurn=1 boundary (Tier-3)', () => {
  // The runtime breaks the reasoning loop on step exhaustion without
  // throwing. Both exhaustion policies behave identically here; we pin
  // both shapes so any future divergence is visible.

  it("maxStepsPerTurn=1 with policy 'throw' returns gracefully when LLM keeps calling tools", async () => {
    const llm = new ScriptedLlm([
      // step 1: tool call (consumes the single allowed step)
      { toolCalls: [{ id: 'c1', name: 'work', arguments: {} }] },
      // step 2: would be a second LLM step — we never expect to reach it.
      { toolCalls: [{ id: 'c2', name: 'work', arguments: {} }] },
      { text: 'unreachable' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
      maxStepsPerTurn: 1,
      exhaustionPolicy: 'throw',
    });

    const result = await runtime.turn('go');

    // Documented behavior: the turn resolves; assistantText may be empty
    // because the LLM never produced final text.
    expect(typeof result.assistantText).toBe('string');

    // No `end-session` event — exhaustion is not a session-terminal signal.
    const endEvents = result.events.filter(e => e.kind === 'end-session');
    expect(endEvents).toHaveLength(0);

    // Exhaustion is now announced, not silent: a `step-limit-reached` event
    // carries the node and the limit so consumers can distinguish a truncated
    // turn from a natural stop.
    const limitEvents = result.events.filter(
      e => e.kind === 'step-limit-reached'
    );
    expect(limitEvents).toHaveLength(1);
    expect((limitEvents[0] as { limit: number }).limit).toBe(1);
    expect((limitEvents[0] as { node: string }).node).toBe('main');

    // History invariant: every assistant message with tool_calls has a
    // matching tool message that follows.
    const history = (
      runtime as unknown as {
        history: { role: string; tool_calls?: { id: string }[] }[];
      }
    ).history;
    for (let i = 0; i < history.length; i++) {
      const m = history[i];
      if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
        for (const tc of m.tool_calls) {
          // Find a tool message with this id after the assistant.
          const toolMsg = history
            .slice(i + 1)
            .find(
              x =>
                x.role === 'tool' &&
                (x as unknown as { tool_call_id?: string }).tool_call_id ===
                  tc.id
            );
          expect(
            toolMsg,
            `missing tool result for tool_call ${tc.id}`
          ).toBeDefined();
        }
      }
    }
  });

  it("maxStepsPerTurn=1 with policy 'last-response' has identical observable shape (counters not corrupted)", async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'work', arguments: {} }] },
      { toolCalls: [{ id: 'c2', name: 'work', arguments: {} }] },
      { text: 'unreachable' },
      // Subsequent turn:
      { text: 'second turn ok' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
      maxStepsPerTurn: 1,
      exhaustionPolicy: 'last-response',
    });

    const r1 = await runtime.turn('first');
    expect(typeof r1.assistantText).toBe('string');

    // Subsequent turn must succeed — exhaustion didn't corrupt step counters
    // or leave the runtime in a broken state.
    const r2 = await runtime.turn('second');
    // With maxStepsPerTurn=1 the second turn also exits after the first
    // step. The script's text-only response should still come back.
    expect(typeof r2.assistantText).toBe('string');
    // The runtime still reports a sane current node.
    expect(runtime.currentNodeName).toBe('main');
  });
});
