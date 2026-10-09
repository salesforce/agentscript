/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { LlmDriver, LlmStepInput, StepEvent } from '../src/index.js';

const AGENT_WITH_TOOL = `
system:
    instructions: "You are a test agent."

config:
    agent_name: "TestBot"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    order_order_id: mutable string = ""
        description: "Order ID to lookup"

start_agent test_node:
    description: "test node"
    actions:
        Lookup:
            description: "lookup tool"
            inputs:
                order_order_id: string
                    description: "Order ID"
                    is_required: True
            outputs:
                result: string
                    description: "Result"
            target: "fn://lookup"
    reasoning:
        instructions: ->
            | respond to user
        actions:
            lookup: @actions.Lookup
                with order_order_id=@variables.order_order_id
`;

/**
 * Scripted LLM driver that allows injecting custom finish reasons.
 */
class ScriptedLlmWithFinish implements LlmDriver {
  private order_idx = 0;
  readonly calls: LlmStepInput[] = [];
  constructor(
    private readonly script: Array<{
      text?: string;
      toolCalls?: Array<{
        order_id: string;
        name: string;
        arguments: Record<string, unknown>;
      }>;
      finishReason?: 'stop' | 'tool-calls' | 'length' | 'other';
    }>
  ) {}

  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    this.calls.push(input);
    const s = this.script[this.order_idx++] ?? {};
    if (s.text) yield { kind: 'text-delta', text: s.text };
    for (const call of s.toolCalls ?? []) {
      yield { kind: 'tool-call', call };
    }
    yield {
      kind: 'finish',
      reason:
        s.finishReason ??
        ((s.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop'),
    };
  }
}

describe('Runtime — unexecuted tool calls on truncation', () => {
  it('does NOT invoke tools when finishReason is "length" and emits synthetic error results', async () => {
    const { output, diagnostics } = compileSource(AGENT_WITH_TOOL);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const llm = new ScriptedLlmWithFinish([
      {
        toolCalls: [
          { order_id: 'tc1', name: 'lookup', arguments: { order_id: 'ORD-1' } },
        ],
        finishReason: 'length',
      },
      { text: 'I tried but the call was truncated.', finishReason: 'stop' },
    ]);

    const lookupFn = vi.fn(async () => ({ result: 'order shipped' }));
    const fn = new FnAdapter();
    fn.register('lookup', lookupFn);
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('lookup ORD-1');

    // The tool should NOT have been invoked
    expect(lookupFn).not.toHaveBeenCalled();

    // The runtime should have emitted a synthetic error result and continued
    expect(result.assistantText).toContain('truncated');

    // Verify the LLM was called twice (initial + retry after seeing synthetic result)
    expect(llm.calls).toHaveLength(2);
  });

  it('DOES invoke tools normally when finishReason is "stop"', async () => {
    const { output, diagnostics } = compileSource(AGENT_WITH_TOOL);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const llm = new ScriptedLlmWithFinish([
      {
        toolCalls: [
          { order_id: 'tc2', name: 'lookup', arguments: { order_id: 'ORD-2' } },
        ],
        finishReason: 'tool-calls',
      },
      { text: 'The order is shipped.', finishReason: 'stop' },
    ]);

    const lookupFn = vi.fn(async () => ({ result: 'order shipped' }));
    const fn = new FnAdapter();
    fn.register('lookup', lookupFn);
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('lookup ORD-2');

    // The tool SHOULD have been invoked
    expect(lookupFn).toHaveBeenCalledOnce();
    expect(lookupFn.mock.calls[0][0]).toMatchObject({ order_id: 'ORD-2' });

    expect(result.assistantText).toBe('The order is shipped.');
  });

  it('emits synthetic error for "other" finish reason with tool calls', async () => {
    const { output, diagnostics } = compileSource(AGENT_WITH_TOOL);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const llm = new ScriptedLlmWithFinish([
      {
        toolCalls: [
          { order_id: 'tc3', name: 'lookup', arguments: { order_id: 'ORD-3' } },
        ],
        finishReason: 'other',
      },
      { text: 'Recovered after content filter.', finishReason: 'stop' },
    ]);

    const lookupFn = vi.fn(async () => ({ result: 'ok' }));
    const fn = new FnAdapter();
    fn.register('lookup', lookupFn);
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('lookup ORD-3');

    // The tool should NOT have been invoked
    expect(lookupFn).not.toHaveBeenCalled();
    expect(result.assistantText).toContain('Recovered');
  });
});
