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
  type RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * Minimal compiled IR doc with a single subagent node that exposes one fn tool.
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
              name: 'myTool',
              target: 'myTool',
              description: 'A tool',
            },
          ],
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

function makeToolRegistry(): ToolRegistry {
  const fn = new FnAdapter();
  fn.register('myTool', args => ({ ok: true, ...args }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Runtime — step-limit-reached event', () => {
  it('emits step-limit-reached when a turn exceeds maxStepsPerTurn', async () => {
    // The LLM never stops calling tools, so the only way out is the per-turn
    // step cap. Provide plenty of tool-call steps so the cap fires first.
    const llm = new ScriptedLlm(
      Array.from({ length: 20 }, (_, i) => ({
        toolCalls: [{ id: `c${i}`, name: 'myTool', arguments: { i } }],
      }))
    );
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      maxStepsPerTurn: 2,
    });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const limitEvents = events.filter(e => e.kind === 'step-limit-reached');
    expect(limitEvents).toHaveLength(1);
    expect(limitEvents[0]).toEqual({
      kind: 'step-limit-reached',
      node: 'main',
      limit: 2,
    });
  });

  it('does not emit step-limit-reached when the turn completes naturally', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: {} }] },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      maxStepsPerTurn: 8,
    });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('Done');
    expect(events.filter(e => e.kind === 'step-limit-reached')).toHaveLength(0);
  });
});
