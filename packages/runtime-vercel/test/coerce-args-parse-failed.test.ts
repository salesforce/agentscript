/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { LlmStepInput } from '@agentscript/runtime';
import { VercelAiSdkDriver } from '../src/driver.js';

const baseInput: LlmStepInput = {
  system: 'test',
  messages: [{ role: 'user', content: 'hello' }],
  tools: [],
};

async function collectEvents(driver: VercelAiSdkDriver, input = baseInput) {
  const events = [];
  for await (const event of driver.step(input)) {
    events.push(event);
  }
  return events;
}

describe('coerceArgs parseFailed flag', () => {
  it('emits parseFailed:true when tool args are truncated JSON', async () => {
    const generateText = vi.fn(async () => ({
      text: '',
      toolCalls: [
        {
          toolCallId: 'tc-truncated',
          toolName: 'lookup',
          input: '{"id":"ORD-1", "partial',
        },
      ],
      finishReason: 'length',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'mock' },
      generateText,
    });

    const events = await collectEvents(driver);
    expect(events).toEqual([
      {
        kind: 'tool-call',
        call: { id: 'tc-truncated', name: 'lookup', arguments: {} },
        parseFailed: true,
      },
      { kind: 'finish', reason: 'length' },
    ]);
  });

  it('emits parseFailed:false when tool args are valid JSON', async () => {
    const generateText = vi.fn(async () => ({
      text: '',
      toolCalls: [
        {
          toolCallId: 'tc-ok',
          toolName: 'lookup',
          input: { id: 'ORD-2' },
        },
      ],
      finishReason: 'tool-calls',
    }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'mock' },
      generateText,
    });

    const events = await collectEvents(driver);
    expect(events).toEqual([
      {
        kind: 'tool-call',
        call: { id: 'tc-ok', name: 'lookup', arguments: { id: 'ORD-2' } },
        parseFailed: false,
      },
      { kind: 'finish', reason: 'tool-calls' },
    ]);
  });

  it('emits parseFailed:true when streaming tool args with truncated JSON string', async () => {
    async function* fullStream() {
      yield {
        type: 'tool-call',
        toolCallId: 'tc-stream-bad',
        toolName: 'lookup',
        input: '{"incomplete":',
      };
      yield { type: 'finish-step', finishReason: 'length' };
      yield { type: 'finish', finishReason: 'length' };
    }
    const streamText = vi.fn(() => ({ fullStream: fullStream() }));
    const driver = new VercelAiSdkDriver({
      model: { modelId: 'stream-model' },
      generateText: vi.fn(),
      streamText,
    });

    const events = await collectEvents(driver);
    expect(events).toEqual([
      {
        kind: 'tool-call',
        call: { id: 'tc-stream-bad', name: 'lookup', arguments: {} },
        parseFailed: true,
      },
      { kind: 'finish', reason: 'length' },
    ]);
  });
});
