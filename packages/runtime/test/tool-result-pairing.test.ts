/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: every tool_call the model emits must be paired with a tool
 * result in history, EVEN when the dispatch loop breaks early (step-limit hit,
 * session ended, or the repeated-tool-call guard force-stops) partway through a
 * MULTI-call assistant message. A dangling tool_call — one with no matching
 * tool result — is a malformed handshake the OpenAI Responses API rejects on
 * the NEXT request ("No tool output found for function call ..."). Because a
 * long-running agent reuses one Runtime across turns, an unpaired call from one
 * turn poisons the following turn. These tests lock the pairing invariant.
 */

import { describe, it, expect } from 'vitest';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import { Runtime, ToolRegistry, FnAdapter, type Msg } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

function makeDoc(): AgentDSLAuthoring {
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
          tools: [{ name: 'myTool', target: 'myTool', description: 'A tool' }],
          action_definitions: [
            {
              developer_name: 'myTool',
              invocation_target_type: 'fn',
              invocation_target_name: 'myTool',
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
  fn.register('myTool', args => ({ ok: true, ...args }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

/** Assert every assistant tool_call id has a matching tool-result message. */
function assertNoDanglingCalls(history: Msg[]): void {
  const resultIds = new Set(
    history
      .filter(m => m.role === 'tool')
      .map(m => (m as { tool_call_id: string }).tool_call_id)
  );
  const callIds = history
    .filter(m => m.role === 'assistant' && 'tool_calls' in m)
    .flatMap(m => (m as { tool_calls: Array<{ id: string }> }).tool_calls)
    .map(c => c.id);
  const dangling = callIds.filter(id => !resultIds.has(id));
  expect(
    dangling,
    `dangling (unpaired) tool_call ids: ${dangling.join(', ')}`
  ).toEqual([]);
}

describe('Runtime — tool_call/tool_result pairing on early break', () => {
  it('pairs every call when the step limit falls mid-batch', async () => {
    // One assistant message with THREE tool calls, but maxStepsPerTurn=2. The
    // loop dispatches 2 then hits the ceiling mid-batch — the 3rd must still be
    // paired with a synthetic result.
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'a1', name: 'myTool', arguments: { n: 1 } },
          { id: 'a2', name: 'myTool', arguments: { n: 2 } },
          { id: 'a3', name: 'myTool', arguments: { n: 3 } },
        ],
      },
    ]);
    const rt = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
      maxStepsPerTurn: 2,
      // Force the sequential path so the mid-batch break is exercised.
      parallel: { strategy: 'never' },
    });
    await rt.turn('go');
    const { history } = rt.checkpoint({ id: 't' });
    assertNoDanglingCalls(history);
    // All three ids are present as results (2 real + 1 synthetic).
    const resultIds = history
      .filter(m => m.role === 'tool')
      .map(m => (m as { tool_call_id: string }).tool_call_id);
    expect(new Set(resultIds)).toEqual(new Set(['a1', 'a2', 'a3']));
  });

  it('pairs remaining calls when the loop guard force-stops mid-batch', async () => {
    // The model repeats the SAME call enough to trip the force-stop ceiling
    // (streak 12) on the 12th call of a long single-message batch. Every call
    // after the stop must still be paired.
    const repeated = Array.from({ length: 15 }, (_, i) => ({
      id: `r${i}`,
      name: 'myTool',
      arguments: { q: 'x' },
    }));
    const llm = new ScriptedLlm([{ toolCalls: repeated }]);
    const rt = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
      maxStepsPerTurn: 100,
      parallel: { strategy: 'never' },
    });
    await rt.turn('go');
    const { history } = rt.checkpoint({ id: 't' });
    assertNoDanglingCalls(history);
    // Every one of the 15 calls is paired (dispatched or force-stop-flushed).
    const resultIds = new Set(
      history
        .filter(m => m.role === 'tool')
        .map(m => (m as { tool_call_id: string }).tool_call_id)
    );
    expect(resultIds).toEqual(new Set(repeated.map(c => c.id)));
  });
});
