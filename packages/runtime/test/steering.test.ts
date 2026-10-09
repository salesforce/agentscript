/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  type AgentDSLAuthoring,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

function makeDoc(): AgentDSLAuthoring {
  return {
    agent_version: {
      agent_name: 'test',
      initial_node: 'Main',
      state_variables: [],
      nodes: [
        {
          developer_name: 'Main',
          type: 'subagent',
          instructions: 'You are a helpful assistant.',
          tools: [
            {
              name: 'echo',
              target: 'echo',
              description: 'Echoes input',
            },
          ],
          action_definitions: [
            {
              developer_name: 'echo',
              invocation_target_type: 'fn',
              invocation_target_name: 'echo',
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
  fn.register('echo', (args: any) => `echoed: ${args.text}`);
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Mid-turn steering', () => {
  it('enqueues a steering message mid-turn and injects at next step boundary', async () => {
    // Scripted LLM: step 1 tool-calls, step 2 responds to both tool result + steering
    const llm = new ScriptedLlm([
      {
        text: 'Calling tool',
        toolCalls: [{ id: 'tc1', name: 'echo', arguments: { text: 'hello' } }],
      },
      { text: 'Got echo result and steering input: seen both' },
    ]);

    const rt = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
    });

    // Use events to know when we're mid-turn (after first reasoning, before second)
    let afterFirstReasoning = false;
    rt.on(e => {
      if (
        e.kind === 'phase-end' &&
        e.phase === 'reasoning' &&
        !afterFirstReasoning
      ) {
        afterFirstReasoning = true;
        // Enqueue steering immediately after first reasoning phase ends
        // (tool call just dispatched, we're about to loop back)
        rt.enqueueSteering('Also, please uppercase the result');
      }
    });

    // Start the turn
    const result = await rt.turn('Initial prompt');

    // Turn should complete successfully
    expect(result.assistantText).toBeDefined();

    // The LLM should have been called twice:
    // 1. Initial step with user prompt
    // 2. Second step with tool result AND the steered message
    expect(llm.calls.length).toBe(2);

    // Verify the second LLM call contains BOTH the tool result and the steering message
    const secondCall = llm.calls[1];
    expect(secondCall).toBeDefined();
    expect(secondCall?.messages.length).toBeGreaterThan(2); // user, assistant+tools, tool-result, steering-user

    // Find the steering message in history (should be a user message after the tool result)
    const messages = secondCall?.messages ?? [];
    const steeringMsg = messages.find(
      m =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('uppercase')
    );
    expect(steeringMsg).toBeDefined();
    expect(steeringMsg?.content).toContain('uppercase the result');
  });

  it('does not break tool_calls / tool_result pairing when steering is injected', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'tc1', name: 'echo', arguments: { text: 'test' } }] },
      { text: 'Done' },
    ]);

    const rt = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
    });

    // Use events to inject steering at the right time
    let afterFirstReasoning = false;
    rt.on(e => {
      if (
        e.kind === 'phase-end' &&
        e.phase === 'reasoning' &&
        !afterFirstReasoning
      ) {
        afterFirstReasoning = true;
        rt.enqueueSteering('Mid-turn input');
      }
    });

    await rt.turn('Start');

    // Check that messages alternate properly:
    // user → assistant(tool_calls) → tool_result → user(steering) → assistant
    const calls = llm.calls;
    expect(calls.length).toBe(2);

    const secondCallMsgs = calls[1]?.messages ?? [];

    // Find the assistant message with tool_calls and the tool result
    let foundToolCalls = false;
    let foundToolResult = false;
    let foundSteering = false;

    for (let i = 0; i < secondCallMsgs.length; i++) {
      const msg = secondCallMsgs[i];
      if (
        msg?.role === 'assistant' &&
        'tool_calls' in msg &&
        msg.tool_calls &&
        msg.tool_calls.length > 0
      ) {
        foundToolCalls = true;
      }
      if (msg?.role === 'tool' && foundToolCalls && !foundToolResult) {
        foundToolResult = true;
        // Steering should come AFTER tool result, not between tool_calls and tool_result
        expect(foundSteering).toBe(false);
      }
      if (msg?.role === 'user') {
        const content = typeof msg.content === 'string' ? msg.content : '';
        if (content.includes('Mid-turn')) {
          foundSteering = true;
          // Must come after tool result
          expect(foundToolResult).toBe(true);
        }
      }
    }

    expect(foundToolCalls).toBe(true);
    expect(foundToolResult).toBe(true);
    expect(foundSteering).toBe(true);
  });

  it('flushes leftover queued steering after turn ends', async () => {
    const llm = new ScriptedLlm([
      { text: 'First turn response' },
      { text: 'Second turn with leftover steering' },
    ]);

    const rt = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
    });

    const turn1Promise = rt.turn('First');
    await new Promise(resolve => setTimeout(resolve, 10));

    // Enqueue steering near the end of turn 1
    rt.enqueueSteering('Late steering');

    await turn1Promise;

    // Start turn 2 — the leftover steering should become part of this turn's initial prompt
    await rt.turn('Second');

    expect(llm.calls.length).toBe(2);

    // The second turn should see the leftover steering message in its history
    const secondTurnMsgs = llm.calls[1]?.messages ?? [];
    const hasLeftoverSteering = secondTurnMsgs.some(
      m => m.role === 'user' && m.content.includes('Late steering')
    );
    expect(hasLeftoverSteering).toBe(true);
  });

  it('does not start a new turn when enqueueSteering is called mid-turn', async () => {
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'tc1', name: 'echo', arguments: { text: 'hi' } }] },
      { text: 'Finished' },
    ]);

    const rt = new Runtime({
      doc: makeDoc(),
      llm,
      tools: makeTools(),
    });

    const turnPromise = rt.turn('Start');
    await new Promise(resolve => setTimeout(resolve, 10));

    // Enqueue steering — should NOT start a new turn, just enqueue
    rt.enqueueSteering('Steering input');

    await turnPromise;

    // Only 2 LLM steps (initial + after tool), NOT 3 (which would indicate a new turn was started)
    expect(llm.calls.length).toBe(2);
  });
});
