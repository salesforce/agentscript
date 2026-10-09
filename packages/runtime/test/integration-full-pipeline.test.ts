/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full-pipeline integration test: exercises compilation → runtime → middleware
 * → tool limits → abort → checkpoint in a single cohesive scenario that
 * mirrors a real AgentScript execution with a scripted (deterministic) LLM.
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  AbortError,
  MemoryCheckpointStore,
  type Middleware,
  type RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const ORDER_BOT_SRC = `
system:
    instructions: "You are an order tracking assistant. Be concise."

config:
    agent_name: "OrderBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    order_number: mutable string = ""
        description: "Order number provided by the user"
    order_status: mutable string = ""
        description: "Status returned by the lookup tool"

start_agent order_tracker:
    description: "Looks up order status on demand"

    actions:
        Lookup_Order:
            description: "Look up an order by its number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
            target: "fn://lookup_order"

    reasoning:
        instructions: ->
            |   You are helping a user check order status.
                If the user has given an order number, call {!@actions.lookup}
                with it, then tell the user the result in one sentence.
        actions:
            lookup: @actions.Lookup_Order
                with order_number=...
                set @variables.order_status = @outputs.status
`;

function compileOrderBot() {
  const { output, diagnostics } = compileSource(ORDER_BOT_SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (errors.length > 0)
    throw new Error(`Compile failed: ${JSON.stringify(errors)}`);
  return output;
}

function makeTools() {
  const fn = new FnAdapter();
  fn.register('lookup_order', async args => {
    const { order_number } = args as { order_number: string };
    if (order_number === 'ORD-42') return { status: 'shipped' };
    if (order_number === 'ORD-99') return { status: 'processing' };
    return { status: 'not found' };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Integration — full pipeline', () => {
  it('compiles AgentScript, calls tools, updates state, returns text', async () => {
    const doc = compileOrderBot();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      { text: 'Your order ORD-42 has been shipped.' },
    ]);

    const runtime = new Runtime({ doc, llm, tools: makeTools() });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('Check order ORD-42');

    expect(result.assistantText).toBe('Your order ORD-42 has been shipped.');
    expect(result.finalNode).toBe('order_tracker');
    expect(runtime.state.get('order_status')).toBe('shipped');

    const toolCallEvent = events.find(e => e.kind === 'tool-call');
    expect(toolCallEvent).toBeDefined();

    const toolResultEvent = events.find(e => e.kind === 'tool-result');
    expect(toolResultEvent).toBeDefined();

    const textEvents = events.filter(e => e.kind === 'llm-text');
    expect(textEvents.length).toBeGreaterThan(0);
  });

  it('middleware intercepts before turn and can rewrite user input', async () => {
    const doc = compileOrderBot();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-99' } },
        ],
      },
      { text: 'ORD-99 is still processing.' },
    ]);

    const inputRewriter: Middleware = {
      priority: 10,
      beforeTurn: async ctx => {
        if (ctx.userInput.includes('ORD-99')) {
          return { userInput: '[REWRITTEN] User wants status for ORD-99' };
        }
        return {};
      },
    };

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      middleware: [inputRewriter],
    });

    const result = await runtime.turn('What about ORD-99?');
    expect(result.assistantText).toBe('ORD-99 is still processing.');
    expect(llm.calls[0].messages.at(-1)?.content).toBe(
      '[REWRITTEN] User wants status for ORD-99'
    );
  });

  it('middleware can abort a turn early', async () => {
    const doc = compileOrderBot();
    const llm = new ScriptedLlm([]);

    const blockerMiddleware: Middleware = {
      priority: 1,
      beforeTurn: async ctx => {
        if (ctx.userInput.includes('BLOCKED')) {
          return {
            abort: {
              assistantText: 'This request has been blocked by policy.',
            },
          };
        }
        return {};
      },
    };

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      middleware: [blockerMiddleware],
    });

    const result = await runtime.turn('BLOCKED request');
    expect(result.assistantText).toBe(
      'This request has been blocked by policy.'
    );
    expect(llm.calls).toHaveLength(0);
  });

  it('middleware afterTurn can transform assistant text', async () => {
    const doc = compileOrderBot();
    const llm = new ScriptedLlm([{ text: 'Hello there.' }]);

    const suffixer: Middleware = {
      priority: 5,
      afterTurn: async () => {
        return { assistantText: 'Hello there. [Reviewed by QA middleware]' };
      },
    };

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      middleware: [suffixer],
    });

    const result = await runtime.turn('Hi');
    expect(result.assistantText).toBe(
      'Hello there. [Reviewed by QA middleware]'
    );
  });

  it('tool limits prevent repeated invocations', async () => {
    const doc = compileOrderBot();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      {
        toolCalls: [
          { id: 'tc2', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      { text: 'Could not look up again — limit reached.' },
    ]);

    const events: RuntimeEvent[] = [];
    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      toolLimits: { lookup: { maxCalls: 1 } },
    });
    runtime.on(e => events.push(e));

    const result = await runtime.turn('Check ORD-42 twice');

    expect(result.assistantText).toBe(
      'Could not look up again — limit reached.'
    );
    const limitEvents = events.filter(e => e.kind === 'tool-limit-reached');
    expect(limitEvents).toHaveLength(1);
    expect(
      (
        limitEvents[0] as {
          kind: 'tool-limit-reached';
          name: string;
          limit: number;
        }
      ).name
    ).toBe('lookup');
  });

  it('tool limits with resetPerTurn resets counters between turns', async () => {
    const doc = compileOrderBot();

    const llm = new ScriptedLlm([
      // Turn 1: call tool once
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      { text: 'Shipped.' },
      // Turn 2: call tool again — should succeed because resetPerTurn
      {
        toolCalls: [
          { id: 'tc2', name: 'lookup', arguments: { order_number: 'ORD-99' } },
        ],
      },
      { text: 'Processing.' },
    ]);

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      toolLimits: { lookup: { maxCalls: 1, resetPerTurn: true } },
    });

    const r1 = await runtime.turn('Check ORD-42');
    expect(r1.assistantText).toBe('Shipped.');
    expect(runtime.state.get('order_status')).toBe('shipped');

    const r2 = await runtime.turn('Now check ORD-99');
    expect(r2.assistantText).toBe('Processing.');
    expect(runtime.state.get('order_status')).toBe('processing');
  });

  it('AbortSignal cancels a turn with AbortError', async () => {
    const doc = compileOrderBot();
    const controller = new AbortController();

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      { text: 'This should not appear' },
    ]);

    // Abort before the second LLM call
    const fn = new FnAdapter();
    fn.register('lookup_order', async () => {
      controller.abort('user cancelled');
      return { status: 'shipped' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const events: RuntimeEvent[] = [];
    const runtime = new Runtime({
      doc,
      llm,
      tools,
      signal: controller.signal,
    });
    runtime.on(e => events.push(e));

    await expect(runtime.turn('Check ORD-42')).rejects.toThrow(AbortError);
    const abortEvent = events.find(e => e.kind === 'abort');
    expect(abortEvent).toBeDefined();
  });

  it('AbortSignal set per-turn overrides runtime-level signal', async () => {
    const doc = compileOrderBot();
    const runtimeController = new AbortController();
    const turnController = new AbortController();

    const llm = new ScriptedLlm([{ text: 'Hello!' }]);

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      signal: runtimeController.signal,
    });

    // The runtime-level signal is not aborted, but the turn-level is
    turnController.abort('turn cancelled');

    await expect(
      runtime.turn('Hi', { signal: turnController.signal })
    ).rejects.toThrow(AbortError);
  });

  it('checkpoint + restore preserves state and node across sessions', async () => {
    const doc = compileOrderBot();
    const store = new MemoryCheckpointStore();

    // Session 1: run a turn that sets state
    const llm1 = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      { text: 'Your order has shipped.' },
    ]);
    const runtime1 = new Runtime({ doc, llm: llm1, tools: makeTools() });
    await runtime1.turn('Check ORD-42');

    expect(runtime1.state.get('order_status')).toBe('shipped');
    expect(runtime1.currentNodeName).toBe('order_tracker');

    // Save checkpoint
    const cp = runtime1.checkpoint({ id: 'cp-1', metadata: { turn: 1 } });
    await store.save(cp);

    // Session 2: restore from checkpoint and verify state
    const loaded = await store.load('cp-1');
    expect(loaded).not.toBeNull();

    const llm2 = new ScriptedLlm([{ text: 'Yes, it was shipped.' }]);
    const runtime2 = Runtime.fromCheckpoint(
      { doc, llm: llm2, tools: makeTools() },
      loaded!
    );

    expect(runtime2.state.get('order_status')).toBe('shipped');
    expect(runtime2.currentNodeName).toBe('order_tracker');

    const r2 = await runtime2.turn('Was my order shipped?');
    expect(r2.assistantText).toBe('Yes, it was shipped.');
  });

  it('middleware + tool limits + events all compose correctly', async () => {
    const doc = compileOrderBot();
    const callLog: string[] = [];

    const loggingMiddleware: Middleware = {
      priority: 1,
      beforeTurn: async ctx => {
        callLog.push(`beforeTurn:${ctx.userInput}`);
        return {};
      },
      beforeToolCall: async ctx => {
        callLog.push(`beforeToolCall:${ctx.toolName}`);
        return {};
      },
      afterToolCall: async ctx => {
        callLog.push(
          `afterToolCall:${ctx.toolName}:${JSON.stringify(ctx.result)}`
        );
        return {};
      },
      afterTurn: async ctx => {
        callLog.push(`afterTurn:${ctx.finalNode}`);
        return {};
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      {
        toolCalls: [
          { id: 'tc2', name: 'lookup', arguments: { order_number: 'ORD-42' } },
        ],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools(),
      middleware: [loggingMiddleware],
      toolLimits: { lookup: { maxCalls: 1 } },
    });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('Check ORD-42');

    expect(result.assistantText).toBe('Done.');
    expect(callLog).toContain('beforeTurn:Check ORD-42');
    expect(callLog).toContain('beforeToolCall:lookup');
    expect(callLog).toContain('afterToolCall:lookup:{"status":"shipped"}');
    expect(callLog).toContain('afterTurn:order_tracker');

    // Second tool call was blocked by limit — no afterToolCall for it
    const afterToolCalls = callLog.filter(l => l.startsWith('afterToolCall'));
    expect(afterToolCalls).toHaveLength(1);

    // Events contain the tool-limit-reached event
    expect(events.some(e => e.kind === 'tool-limit-reached')).toBe(true);
  });

  it('phase events are emitted in correct order', async () => {
    const doc = compileOrderBot();
    const llm = new ScriptedLlm([{ text: 'Hello!' }]);

    const runtime = new Runtime({ doc, llm, tools: makeTools() });
    const phases: string[] = [];
    runtime.on(e => {
      if (e.kind === 'phase-start' || e.kind === 'phase-end') {
        phases.push(`${e.kind}:${e.phase}`);
      }
    });

    await runtime.turn('Hi');

    expect(phases).toContain('phase-start:reasoning');
    expect(phases).toContain('phase-end:reasoning');
    const startIdx = phases.indexOf('phase-start:reasoning');
    const endIdx = phases.indexOf('phase-end:reasoning');
    expect(startIdx).toBeLessThan(endIdx);
  });
});
