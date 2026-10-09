/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import { validateToolArgs } from '../src/tools/args-validator.js';
import type { LlmDriver, LlmStepInput, StepEvent } from '../src/index.js';

// ---------------------------------------------------------------------------
// Unit tests — the zero-dep schema validator itself.
// ---------------------------------------------------------------------------

describe('validateToolArgs', () => {
  const schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      count: { type: 'integer' },
      ratio: { type: 'number' },
      flag: { type: 'boolean' },
    },
    required: ['id'],
  };

  it('accepts well-formed args', () => {
    expect(
      validateToolArgs(schema, { id: 'x', count: 3, ratio: 1.5, flag: true })
    ).toBeNull();
  });

  it('reports a missing required parameter', () => {
    expect(validateToolArgs(schema, { count: 3 })).toMatch(
      /missing required parameter "id"/
    );
  });

  it('reports a type mismatch', () => {
    expect(validateToolArgs(schema, { id: 42 })).toMatch(
      /parameter "id" must be of type string, received integer/
    );
  });

  it('accepts an integer where a number is required (widening)', () => {
    expect(validateToolArgs(schema, { id: 'x', ratio: 2 })).toBeNull();
  });

  it('rejects a non-integer where integer is required', () => {
    expect(validateToolArgs(schema, { id: 'x', count: 2.5 })).toMatch(
      /parameter "count" must be of type integer/
    );
  });

  it('collects multiple violations', () => {
    const msg = validateToolArgs(schema, { count: 'nope' });
    expect(msg).toMatch(/missing required parameter "id"/);
    expect(msg).toMatch(/parameter "count" must be of type integer/);
  });

  it('rejects non-object args', () => {
    expect(validateToolArgs(schema, 'a string')).toMatch(
      /arguments must be an object, received string/
    );
  });

  it('is permissive for a non-object schema or absent schema', () => {
    expect(validateToolArgs({ type: 'string' }, 'anything')).toBeNull();
    expect(validateToolArgs(undefined, { anything: true })).toBeNull();
  });

  it('ignores properties with no declared type', () => {
    expect(
      validateToolArgs(
        { type: 'object', properties: { any: {} } },
        { any: [1, 2, 3] }
      )
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration tests — preflight rejection through the turn runtime.
// ---------------------------------------------------------------------------

const AGENT_WITH_TOOL = `
system:
    instructions: "You are a test agent."

config:
    agent_name: "TestBot"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    order_id: mutable string = ""
        description: "Order ID to lookup"

start_agent test_node:
    description: "test node"
    actions:
        Lookup:
            description: "lookup tool"
            inputs:
                order_id: string
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
`;

/** Scripted driver that can mark a tool-call's args as parse-failed. */
class ScriptedLlmWithFlags implements LlmDriver {
  private idx = 0;
  readonly calls: LlmStepInput[] = [];
  constructor(
    private readonly script: Array<{
      text?: string;
      toolCalls?: Array<{
        id: string;
        name: string;
        arguments: Record<string, unknown>;
        parseFailed?: boolean;
      }>;
    }>
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    this.calls.push(input);
    const s = this.script[this.idx++] ?? {};
    if (s.text) yield { kind: 'text-delta', text: s.text };
    for (const c of s.toolCalls ?? []) {
      yield {
        kind: 'tool-call',
        call: { id: c.id, name: c.name, arguments: c.arguments },
        parseFailed: c.parseFailed,
      };
    }
    yield {
      kind: 'finish',
      reason: (s.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop',
    };
  }
}

function buildTools(fn: () => Promise<Record<string, unknown>>) {
  const adapter = new FnAdapter();
  adapter.register('lookup', fn);
  const tools = new ToolRegistry();
  tools.register('fn', adapter);
  return tools;
}

describe('Runtime — tool-arg preflight validation', () => {
  it('rejects a call missing a required parameter without invoking the tool', async () => {
    const { output } = compileSource(AGENT_WITH_TOOL);
    const llm = new ScriptedLlmWithFlags([
      // Missing the required `order_id`.
      { toolCalls: [{ id: 'c1', name: 'lookup', arguments: {} }] },
      { text: 'Sorry, I omitted the order id.' },
    ]);
    const lookupFn = vi.fn(async () => ({ result: 'shipped' }));

    const runtime = new Runtime({
      doc: output,
      llm,
      tools: buildTools(lookupFn),
    });
    const result = await runtime.turn('look it up');

    expect(lookupFn).not.toHaveBeenCalled();
    // The model got a second turn to self-correct after seeing the error.
    expect(llm.calls).toHaveLength(2);
    expect(result.assistantText).toContain('order id');

    // The synthetic error result is in history for the model to read.
    const toolMsg = llm.calls[1].messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/missing required parameter.*order_id/);
  });

  it('rejects a call whose arguments failed to parse (parseFailed)', async () => {
    const { output } = compileSource(AGENT_WITH_TOOL);
    const llm = new ScriptedLlmWithFlags([
      {
        toolCalls: [
          { id: 'c1', name: 'lookup', arguments: {}, parseFailed: true },
        ],
      },
      { text: 'Retrying with valid JSON.' },
    ]);
    const lookupFn = vi.fn(async () => ({ result: 'shipped' }));

    const runtime = new Runtime({
      doc: output,
      llm,
      tools: buildTools(lookupFn),
    });
    await runtime.turn('look it up');

    expect(lookupFn).not.toHaveBeenCalled();
    const toolMsg = llm.calls[1].messages.find(m => m.role === 'tool');
    expect(toolMsg?.content).toMatch(/could not be parsed as JSON/);
  });

  it('dispatches a valid call normally', async () => {
    const { output } = compileSource(AGENT_WITH_TOOL);
    const llm = new ScriptedLlmWithFlags([
      {
        toolCalls: [
          { id: 'c1', name: 'lookup', arguments: { order_id: 'ORD-1' } },
        ],
      },
      { text: 'The order is shipped.' },
    ]);
    const lookupFn = vi.fn(async () => ({ result: 'shipped' }));

    const runtime = new Runtime({
      doc: output,
      llm,
      tools: buildTools(lookupFn),
    });
    const result = await runtime.turn('look up ORD-1');

    expect(lookupFn).toHaveBeenCalledOnce();
    expect(result.assistantText).toBe('The order is shipped.');
  });

  it('dispatches valid calls while rejecting invalid ones in the same step', async () => {
    const { output } = compileSource(AGENT_WITH_TOOL);
    const llm = new ScriptedLlmWithFlags([
      {
        toolCalls: [
          { id: 'c1', name: 'lookup', arguments: { order_id: 'ORD-1' } }, // valid
          { id: 'c2', name: 'lookup', arguments: {} }, // invalid: missing order_id
        ],
      },
      { text: 'Done.' },
    ]);
    const lookupFn = vi.fn(async () => ({ result: 'shipped' }));

    const runtime = new Runtime({
      doc: output,
      llm,
      tools: buildTools(lookupFn),
    });
    await runtime.turn('look up both');

    // Only the valid call executed.
    expect(lookupFn).toHaveBeenCalledOnce();
    expect(lookupFn.mock.calls[0][0]).toMatchObject({ order_id: 'ORD-1' });

    // Both a real result and a synthetic error appear in history.
    const toolMsgs = llm.calls[1].messages.filter(m => m.role === 'tool');
    expect(toolMsgs).toHaveLength(2);
    const contents = toolMsgs.map(m => String(m.content)).join('\n');
    expect(contents).toMatch(/missing required parameter.*order_id/);
  });
});
