/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { LlmStepInput } from '@agentscript/runtime';
import { VercelAiSdkDriver } from '../src/driver.js';

const baseInput: LlmStepInput = {
  system: 'system prompt',
  messages: [
    { role: 'user', content: 'hello' },
    {
      role: 'tool',
      tool_call_id: 'c1',
      tool_name: 'lookup',
      content: '{"status":"ok"}',
    },
  ],
  tools: [
    {
      name: 'lookup',
      description: 'Lookup order',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } } },
    },
  ],
};

async function collectEvents(driver: VercelAiSdkDriver, input = baseInput) {
  const events = [];
  for await (const event of driver.step(input)) {
    events.push(event);
  }
  return events;
}

describe('VercelAiSdkDriver', () => {
  it('maps input args from object and passes jsonSchema wrapper', async () => {
    const jsonSchema = vi.fn(schema => ({ wrapped: schema }));
    const generateText = vi.fn(async () => ({
      text: 'done',
      toolCalls: [
        {
          toolCallId: 'tool-1',
          toolName: 'lookup',
          input: { id: 'ORD-1' },
        },
      ],
      finishReason: 'tool-calls',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'mock' },
      generateText,
      jsonSchema,
      callSettings: { temperature: 0.2 },
    });

    const events = await collectEvents(driver);

    expect(jsonSchema).toHaveBeenCalledOnce();
    expect(generateText).toHaveBeenCalledOnce();
    expect(generateText.mock.calls[0]?.[0]).toMatchObject({
      system: 'system prompt',
      temperature: 0.2,
    });
    expect(events).toEqual([
      { kind: 'text-delta', text: 'done' },
      {
        kind: 'tool-call',
        call: { id: 'tool-1', name: 'lookup', arguments: { id: 'ORD-1' } },
        parseFailed: false,
      },
      { kind: 'finish', reason: 'tool-calls' },
    ]);
  });

  it('falls back to args and parses JSON string payloads', async () => {
    const generateText = vi.fn(async () => ({
      text: '',
      toolCalls: [
        {
          toolCallId: 'tool-2',
          toolName: 'lookup',
          args: '{"id":"ORD-2"}',
        },
      ],
      finishReason: 'stop',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'mock' },
      generateText,
    });

    const events = await collectEvents(driver);
    expect(events).toEqual([
      {
        kind: 'tool-call',
        call: { id: 'tool-2', name: 'lookup', arguments: { id: 'ORD-2' } },
        parseFailed: false,
      },
      { kind: 'finish', reason: 'stop' },
    ]);
  });

  it('emits a usage event (v5 field names) before finish', async () => {
    const generateText = vi.fn(async () => ({
      text: 'hi',
      usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
      finishReason: 'stop',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'gpt-4o' },
      generateText,
    });
    const events = await collectEvents(driver);
    expect(events).toEqual([
      { kind: 'text-delta', text: 'hi' },
      {
        kind: 'usage',
        usage: { inputTokens: 12, outputTokens: 8, totalTokens: 20 },
        model: 'gpt-4o',
      },
      { kind: 'finish', reason: 'stop' },
    ]);
  });

  it('bridges v4 usage field names and derives the total', async () => {
    const generateText = vi.fn(async () => ({
      text: 'hi',
      usage: { promptTokens: 10, completionTokens: 5 },
      finishReason: 'stop',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'legacy' },
      generateText,
    });
    const events = await collectEvents(driver);
    expect(events).toContainEqual({
      kind: 'usage',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      model: 'legacy',
    });
  });

  it('emits no usage event when the result has none', async () => {
    const generateText = vi.fn(async () => ({
      text: 'hi',
      finishReason: 'stop',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'm' },
      generateText,
    });
    const events = await collectEvents(driver);
    expect(events.some(e => e.kind === 'usage')).toBe(false);
  });

  it('tags failed tool results as error-json and successes as json', async () => {
    const generateText = vi.fn(async () => ({
      text: 'ok',
      finishReason: 'stop',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'm' },
      generateText,
    });
    await collectEvents(driver, {
      system: 's',
      messages: [
        {
          role: 'tool',
          tool_call_id: 'ok1',
          tool_name: 'lookup',
          content: '{"status":"shipped"}',
        },
        {
          role: 'tool',
          tool_call_id: 'err1',
          tool_name: 'lookup',
          content: '{"error":"boom"}',
          is_error: true,
        },
      ],
      tools: [],
    });

    const sentMessages = (
      generateText.mock.calls[0]?.[0] as {
        messages: Array<{ content: Array<{ output: { type: string } }> }>;
      }
    ).messages;
    expect(sentMessages[0]?.content[0]?.output.type).toBe('json');
    expect(sentMessages[1]?.content[0]?.output.type).toBe('error-json');
  });

  it('streams text deltas and tool calls via injected streamText', async () => {
    async function* fullStream() {
      yield { type: 'text-start', id: 't1' };
      yield { type: 'text-delta', id: 't1', text: 'Hel' };
      yield { type: 'text-delta', id: 't1', text: 'lo' };
      yield {
        type: 'tool-call',
        toolCallId: 'tc1',
        toolName: 'lookup',
        input: { id: 'ORD-9' },
      };
      yield {
        type: 'finish-step',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        finishReason: 'tool-calls',
      };
      yield { type: 'finish', finishReason: 'tool-calls' };
    }
    const streamText = vi.fn(() => ({ fullStream: fullStream() }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'stream-model' },
      generateText: vi.fn(),
      streamText,
    });

    const events = await collectEvents(driver);
    expect(streamText).toHaveBeenCalledOnce();
    expect(events).toEqual([
      { kind: 'text-delta', text: 'Hel' },
      { kind: 'text-delta', text: 'lo' },
      {
        kind: 'tool-call',
        call: { id: 'tc1', name: 'lookup', arguments: { id: 'ORD-9' } },
        parseFailed: false,
      },
      {
        kind: 'usage',
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
        model: 'stream-model',
      },
      { kind: 'finish', reason: 'tool-calls' },
    ]);
  });

  it('propagates an error part from the streamText fullStream', async () => {
    const boom = new Error('provider exploded');
    async function* fullStream() {
      yield { type: 'text-delta', id: 't1', text: 'partial' };
      yield { type: 'error', error: boom };
    }
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'm' },
      generateText: vi.fn(),
      streamText: vi.fn(() => ({ fullStream: fullStream() })),
    });

    await expect(collectEvents(driver)).rejects.toThrow('provider exploded');
  });

  it('coerces invalid tool input to empty object and maps unknown finish reasons', async () => {
    const generateText = vi.fn(async () => ({
      text: '',
      toolCalls: [
        {
          toolCallId: 'tool-3',
          toolName: 'lookup',
          input: 'not-json',
        },
      ],
      finishReason: 'content-filter',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'mock' },
      generateText,
    });

    const events = await collectEvents(driver);
    expect(events).toEqual([
      {
        kind: 'tool-call',
        call: { id: 'tool-3', name: 'lookup', arguments: {} },
        parseFailed: true,
      },
      { kind: 'finish', reason: 'other' },
    ]);
  });
});
