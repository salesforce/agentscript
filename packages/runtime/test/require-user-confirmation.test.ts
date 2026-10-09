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
 * `require_user_confirmation` has no compiler-side DSL surface exercised
 * elsewhere in this suite, so the fixture is a hand-built `AgentDSLAuthoring`
 * doc (same pattern as parallel-tool-calls.test.ts) with the flag set
 * directly on `action_definitions`.
 */
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
          tools: [
            {
              name: 'sensitive_tool',
              target: 'SensitiveAction',
              description: 'Needs confirmation',
            },
            {
              name: 'plain_tool',
              target: 'PlainAction',
              description: 'No confirmation needed',
            },
          ],
          action_definitions: [
            {
              developer_name: 'SensitiveAction',
              invocation_target_type: 'fn',
              invocation_target_name: 'sensitive_action',
              require_user_confirmation: true,
            },
            {
              developer_name: 'PlainAction',
              invocation_target_type: 'fn',
              invocation_target_name: 'plain_action',
              require_user_confirmation: false,
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

function makeToolRegistry() {
  const fn = new FnAdapter();
  fn.register('sensitive_action', () => ({ ok: true, from: 'sensitive' }));
  fn.register('plain_action', () => ({ ok: true, from: 'plain' }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Runtime — require_user_confirmation surfacing', () => {
  it('surfaces requireConfirmation: true/false to beforeToolCall middleware (sequential)', async () => {
    const seen: Array<{ target: string; requireConfirmation?: boolean }> = [];
    const middleware: Middleware = {
      name: 'recorder',
      beforeToolCall(ctx) {
        seen.push({
          target: ctx.target,
          requireConfirmation: ctx.requireConfirmation,
        });
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'sensitive_tool', arguments: {} },
          { id: 'c2', name: 'plain_tool', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);

    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      middleware: [middleware],
    });

    await runtime.turn('go');

    expect(seen).toEqual([
      { target: 'fn://sensitive_action', requireConfirmation: true },
      { target: 'fn://plain_action', requireConfirmation: false },
    ]);
  });

  it('a middleware can abort a call flagged requireConfirmation, leaving the adapter uninvoked', async () => {
    let sensitiveCalled = false;
    let plainCalled = false;
    const fn = new FnAdapter();
    fn.register('sensitive_action', () => {
      sensitiveCalled = true;
      return { ok: true };
    });
    fn.register('plain_action', () => {
      plainCalled = true;
      return { ok: true };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'gate',
      beforeToolCall(ctx) {
        if (ctx.requireConfirmation) {
          return { abort: { result: { error: 'confirmation required' } } };
        }
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'sensitive_tool', arguments: {} },
          { id: 'c2', name: 'plain_tool', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);

    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      middleware: [middleware],
    });

    await runtime.turn('go');

    expect(sensitiveCalled).toBe(false);
    expect(plainCalled).toBe(true);

    const toolMsgs = llm.calls[1].messages.filter(m => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    expect(JSON.parse(toolMsgs[0].content as string)).toEqual({
      error: 'confirmation required',
    });
  });

  it('surfaces requireConfirmation on the isolated parallel-dispatch path too', async () => {
    const seen: Array<{ target: string; requireConfirmation?: boolean }> = [];
    const middleware: Middleware = {
      name: 'recorder',
      beforeToolCall(ctx) {
        seen.push({
          target: ctx.target,
          requireConfirmation: ctx.requireConfirmation,
        });
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'sensitive_tool', arguments: {} },
          { id: 'c2', name: 'plain_tool', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);

    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      middleware: [middleware],
      parallel: { strategy: 'always' },
    });

    await runtime.turn('go');

    expect(seen.sort((a, b) => a.target.localeCompare(b.target))).toEqual([
      { target: 'fn://plain_action', requireConfirmation: false },
      { target: 'fn://sensitive_action', requireConfirmation: true },
    ]);
  });

  it('a middleware can abort a requireConfirmation call under parallel dispatch too', async () => {
    let sensitiveCalled = false;
    const fn = new FnAdapter();
    fn.register('sensitive_action', () => {
      sensitiveCalled = true;
      return { ok: true };
    });
    fn.register('plain_action', () => ({ ok: true }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'gate',
      beforeToolCall(ctx) {
        if (ctx.requireConfirmation) {
          return { abort: { result: { error: 'confirmation required' } } };
        }
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'sensitive_tool', arguments: {} },
          { id: 'c2', name: 'plain_tool', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);

    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools,
      middleware: [middleware],
      parallel: { strategy: 'always' },
    });

    await runtime.turn('go');

    expect(sensitiveCalled).toBe(false);
  });
});
