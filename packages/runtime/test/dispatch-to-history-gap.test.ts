/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { Middleware } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * `runIsolatedDelegation` (the parallel-child path behind `delegateMultiple`)
 * dispatches its tool calls via `dispatchToolCallForHistory`, which runs no
 * middleware and no pre_tool_call/post_tool_call hooks at all — a documented,
 * pre-existing gap distinct from (and not fixed by) the require_user_confirmation
 * and pre/post_tool_call work elsewhere in this suite. This test is a
 * red-if-ever-silently-fixed marker: if it starts failing, that means someone
 * wired hooks/middleware into this path, and README/ROADMAP should be updated
 * to reflect the fix rather than this test being "corrected" to match.
 */
function makeDoc(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'test',
      initial_node: 'parent',
      state_variables: [],
      nodes: [
        {
          developer_name: 'parent',
          type: 'subagent',
          instructions: 'Parent agent.',
          tools: [],
          action_definitions: [],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
        },
        {
          developer_name: 'child',
          type: 'subagent',
          instructions: 'Child agent.',
          tools: [
            {
              name: 'sensitive_tool',
              target: 'SensitiveAction',
              description: 'Needs confirmation',
            },
          ],
          action_definitions: [
            {
              developer_name: 'SensitiveAction',
              invocation_target_type: 'fn',
              invocation_target_name: 'sensitive_action',
              require_user_confirmation: true,
            },
          ],
          before_reasoning: [],
          before_reasoning_iteration: [],
          after_all_tool_calls: [],
          after_reasoning: [],
          post_tool_call: [
            {
              target: 'SensitiveAction',
              actions: [
                {
                  type: 'action',
                  target: '__state_update_action__',
                  state_updates: [{ post_hook_ran: 'True' }],
                },
              ],
            },
          ],
        },
      ],
    },
  } as unknown as AgentDSLAuthoring;
}

describe('Runtime — dispatchToolCallForHistory gap (parallel-delegation-history)', () => {
  it('does not surface requireConfirmation to middleware, nor run post_tool_call, on this path', async () => {
    const fn = new FnAdapter();
    let sensitiveCalled = false;
    fn.register('sensitive_action', () => {
      sensitiveCalled = true;
      return { ok: true };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const beforeToolCallInvocations: unknown[] = [];
    const middleware: Middleware = {
      name: 'observer',
      beforeToolCall(ctx) {
        beforeToolCallInvocations.push(ctx.requireConfirmation);
      },
    };

    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'sensitive_tool', arguments: {} }] },
      { text: 'Child done' },
    ]);

    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      middleware: [middleware],
    });

    const results = await runtime.delegateMultiple([{ nodeName: 'child' }]);

    expect(results).toHaveLength(1);
    // The adapter still fires — dispatchToolCallForHistory has no
    // confirmation-gating mechanism to abort it.
    expect(sensitiveCalled).toBe(true);
    // beforeToolCall middleware never runs on this path at all.
    expect(beforeToolCallInvocations).toEqual([]);
    // post_tool_call's state write never happened.
    expect(runtime.state.get('post_hook_ran')).toBeUndefined();
  });
});
