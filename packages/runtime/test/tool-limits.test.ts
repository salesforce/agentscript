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

describe('Runtime — per-tool usage limits', () => {
  it('allows tool calls within the limit', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: { x: 1 } }] },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      toolLimits: { myTool: { maxCalls: 2 } },
    });

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('Done');
    // The tool call should have succeeded (tool-result event present)
    const toolResults = result.events.filter(e => e.kind === 'tool-result');
    expect(toolResults).toHaveLength(1);
  });

  it('returns error to LLM when tool call exceeds limit', async () => {
    const llm = new ScriptedLlm([
      // First call: succeeds (count goes to 1)
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: { x: 1 } }] },
      // Second call: should hit the limit (count is already 1, maxCalls is 1)
      { toolCalls: [{ id: 'c2', name: 'myTool', arguments: { x: 2 } }] },
      // LLM responds after getting error
      { text: 'Cannot call tool anymore' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      toolLimits: { myTool: { maxCalls: 1 } },
    });

    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('Cannot call tool anymore');

    // Verify the second tool call resulted in an error message in history
    const limitEvents = result.events.filter(
      e => e.kind === 'tool-limit-reached'
    );
    expect(limitEvents).toHaveLength(1);
    expect(limitEvents[0]).toEqual({
      kind: 'tool-limit-reached',
      name: 'myTool',
      limit: 1,
    });
  });

  it('removes tool from visible tools after exhaustion', async () => {
    const llm = new ScriptedLlm([
      // First call: succeeds
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: { x: 1 } }] },
      // Second LLM step: tool should not be visible
      { text: 'No more tools' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      toolLimits: { myTool: { maxCalls: 1 } },
    });

    await runtime.turn('go');

    // The second LLM call should not include myTool in its tools
    expect(llm.calls).toHaveLength(2);
    const secondCallTools = llm.calls[1].tools ?? [];
    const toolNames = secondCallTools.map(t => t.name);
    expect(toolNames).not.toContain('myTool');
  });

  it('resets counters per turn when resetPerTurn is true', async () => {
    const llm = new ScriptedLlm([
      // Turn 1: call the tool (uses up the limit)
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: { x: 1 } }] },
      { text: 'Turn 1 done' },
      // Turn 2: tool should be available again due to resetPerTurn
      { toolCalls: [{ id: 'c2', name: 'myTool', arguments: { x: 2 } }] },
      { text: 'Turn 2 done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      toolLimits: { myTool: { maxCalls: 1, resetPerTurn: true } },
    });

    const result1 = await runtime.turn('first');
    expect(result1.assistantText).toBe('Turn 1 done');

    const result2 = await runtime.turn('second');
    expect(result2.assistantText).toBe('Turn 2 done');

    // Both turns should have successful tool results
    const toolResults1 = result1.events.filter(e => e.kind === 'tool-result');
    expect(toolResults1).toHaveLength(1);
    const toolResults2 = result2.events.filter(e => e.kind === 'tool-result');
    expect(toolResults2).toHaveLength(1);
  });

  it('resetToolUsage() allows tool to be called again after manual reset', async () => {
    const llm = new ScriptedLlm([
      // Turn 1: exhaust the tool
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: { x: 1 } }] },
      { text: 'Exhausted' },
      // Turn 2: after manual reset, tool works again
      { toolCalls: [{ id: 'c2', name: 'myTool', arguments: { x: 2 } }] },
      { text: 'Reset worked' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      toolLimits: { myTool: { maxCalls: 1 } },
    });

    await runtime.turn('first');

    // Manually reset the tool usage
    runtime.resetToolUsage('myTool');

    const result2 = await runtime.turn('second');
    expect(result2.assistantText).toBe('Reset worked');
    const toolResults = result2.events.filter(e => e.kind === 'tool-result');
    expect(toolResults).toHaveLength(1);
  });

  it('emits tool-limit-reached event when limit is hit', async () => {
    const events: RuntimeEvent[] = [];
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'myTool', arguments: {} }] },
      { toolCalls: [{ id: 'c2', name: 'myTool', arguments: {} }] },
      { text: 'done' },
    ]);
    const runtime = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeToolRegistry(),
      toolLimits: { myTool: { maxCalls: 1 } },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const limitEvents = events.filter(e => e.kind === 'tool-limit-reached');
    expect(limitEvents).toHaveLength(1);
    expect(limitEvents[0]).toEqual({
      kind: 'tool-limit-reached',
      name: 'myTool',
      limit: 1,
    });
  });
});
