/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import {
  buildMessagesStrict,
  isContextOverflowError,
  isRecoverableRequestStructureError,
} from '../src/llm/messages-strict.js';
import type { Middleware, Msg } from '../src/index.js';
import type { LlmDriver, LlmStepInput, StepEvent } from '../src/index.js';

// ---------------------------------------------------------------------------
// isRecoverableRequestStructureError
// ---------------------------------------------------------------------------

class StatusError extends Error {
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
  }
}

describe('isRecoverableRequestStructureError', () => {
  it('recognizes a tool_use/tool_result adjacency 400', () => {
    expect(
      isRecoverableRequestStructureError(
        new StatusError(
          'messages: an assistant message with tool_use blocks must be followed by tool_result blocks',
          400
        )
      )
    ).toBe(true);
  });

  it('recognizes an OpenAI-style orphan tool message 400', () => {
    expect(
      isRecoverableRequestStructureError(
        new StatusError(
          "messages with role 'tool' must be a response to a preceding message with 'tool_calls'",
          400
        )
      )
    ).toBe(true);
  });

  it('recognizes duplicate tool_use ids and empty-message 400s', () => {
    expect(
      isRecoverableRequestStructureError(
        new StatusError('messages: `tool_use` ids must be unique', 400)
      )
    ).toBe(true);
    expect(
      isRecoverableRequestStructureError(
        new StatusError(
          "the message at position 3 with role 'assistant' must not be empty",
          422
        )
      )
    ).toBe(true);
  });

  it('does NOT treat context-overflow 400s as structural', () => {
    expect(
      isRecoverableRequestStructureError(
        new StatusError(
          'prompt is too long: maximum context length exceeded',
          400
        )
      )
    ).toBe(false);
  });

  it('ignores non-4xx and unrelated errors', () => {
    expect(
      isRecoverableRequestStructureError(
        new StatusError('tool_use tool_result', 500)
      )
    ).toBe(false);
    expect(
      isRecoverableRequestStructureError(new StatusError('something else', 400))
    ).toBe(false);
    expect(isRecoverableRequestStructureError(new Error('no status'))).toBe(
      false
    );
  });
});

describe('isContextOverflowError', () => {
  it('recognizes common context-window rejection wordings', () => {
    for (const msg of [
      'prompt is too long: maximum context length exceeded',
      "This model's maximum context length is 200000 tokens",
      'context_length_exceeded',
      'input is too long for requested model',
      'Please reduce the length of the messages',
      'too many tokens in the request',
    ]) {
      expect(isContextOverflowError(new Error(msg))).toBe(true);
    }
  });

  it('recognizes overflow on any status (400 or 413)', () => {
    expect(
      isContextOverflowError(new StatusError('prompt is too long', 400))
    ).toBe(true);
    expect(
      isContextOverflowError(new StatusError('context length exceeded', 413))
    ).toBe(true);
  });

  it('does not fire on unrelated or structural errors', () => {
    expect(isContextOverflowError(new Error('tool_use tool_result'))).toBe(
      false
    );
    expect(isContextOverflowError(new Error('rate limited'))).toBe(false);
    // A structural repair error is NOT an overflow — they route differently.
    expect(
      isContextOverflowError(new StatusError('unexpected `tool_result`', 400))
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildMessagesStrict
// ---------------------------------------------------------------------------

describe('buildMessagesStrict', () => {
  it('synthesizes a missing tool result for an aborted call', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'do it' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', name: 'lookup', arguments: {} }],
      },
      // No tool result — the batch was aborted mid-dispatch.
      { role: 'user', content: 'are you done?' },
    ];
    const out = buildMessagesStrict(messages);
    expect(out).toHaveLength(4);
    const result = out[2] as {
      role: string;
      tool_call_id: string;
      is_error?: boolean;
    };
    expect(result.role).toBe('tool');
    expect(result.tool_call_id).toBe('c1');
    expect(result.is_error).toBe(true);
  });

  it('drops a stray tool result with no preceding call', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'tool',
        tool_call_id: 'orphan',
        tool_name: 'lookup',
        content: '{}',
      },
      { role: 'assistant', content: 'hello' },
    ];
    const out = buildMessagesStrict(messages);
    expect(out.find(m => m.role === 'tool')).toBeUndefined();
    expect(out).toHaveLength(2);
  });

  it('dedupes duplicate tool_use ids and pairs each with its result', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'dup', name: 'lookup', arguments: { n: 1 } },
          { id: 'dup', name: 'lookup', arguments: { n: 2 } },
        ],
      },
      {
        role: 'tool',
        tool_call_id: 'dup',
        tool_name: 'lookup',
        content: '{"ok":1}',
      },
    ];
    const out = buildMessagesStrict(messages);
    const asst = out[1] as { tool_calls: unknown[] };
    expect(asst.tool_calls).toHaveLength(1);
    // One assistant + exactly one result.
    expect(out.filter(m => m.role === 'tool')).toHaveLength(1);
  });

  it('drops empty assistant messages', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '   ' },
      { role: 'assistant', content: 'real answer' },
    ];
    const out = buildMessagesStrict(messages);
    expect(out).toHaveLength(2);
    expect((out[1] as { content: string }).content).toBe('real answer');
  });

  it('leaves a well-formed history unchanged in shape', () => {
    const messages: Msg[] = [
      { role: 'user', content: 'go' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', name: 'lookup', arguments: {} }],
      },
      {
        role: 'tool',
        tool_call_id: 'c1',
        tool_name: 'lookup',
        content: '{"ok":1}',
      },
      { role: 'assistant', content: 'done' },
    ];
    const out = buildMessagesStrict(messages);
    expect(out).toHaveLength(4);
    expect(out.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Integration — the runtime resends once on a structural 400.
// ---------------------------------------------------------------------------

const AGENT = `
system:
    instructions: "You are a test agent."

config:
    agent_name: "TestBot"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

start_agent test_node:
    description: "test node"
    reasoning:
        instructions: ->
            | respond to user
`;

/**
 * Driver that throws a structural 400 on its first call, then streams a normal
 * text reply. Records how many times step() was invoked and the messages it
 * received each time.
 */
class FailOnceStructural implements LlmDriver {
  calls = 0;
  readonly received: LlmStepInput[] = [];
  constructor(private readonly reply: string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    this.calls++;
    this.received.push(input);
    if (this.calls === 1) {
      throw new StatusError(
        'messages: an assistant message with tool_use blocks must be followed by tool_result blocks',
        400
      );
    }
    yield { kind: 'text-delta', text: this.reply };
    yield { kind: 'finish', reason: 'stop' };
  }
}

class AlwaysStructural implements LlmDriver {
  calls = 0;
  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(): AsyncIterable<StepEvent> {
    this.calls++;
    throw new StatusError('unexpected `tool_result` block', 400);
    // eslint-disable-next-line no-unreachable
    yield { kind: 'finish', reason: 'stop' };
  }
}

/**
 * Driver that throws a context-overflow 400 on its first call, then streams a
 * normal reply. Records the messages it received each time so a test can assert
 * the second (post-compaction) request was smaller.
 */
class FailOnceOverflow implements LlmDriver {
  calls = 0;
  readonly received: LlmStepInput[] = [];
  constructor(private readonly reply: string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    this.calls++;
    this.received.push(input);
    if (this.calls === 1) {
      throw new StatusError(
        'prompt is too long: maximum context length exceeded',
        400
      );
    }
    yield { kind: 'text-delta', text: this.reply };
    yield { kind: 'finish', reason: 'stop' };
  }
}

class AlwaysOverflow implements LlmDriver {
  calls = 0;
  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(): AsyncIterable<StepEvent> {
    this.calls++;
    throw new StatusError('context length exceeded', 400);
    // eslint-disable-next-line no-unreachable
    yield { kind: 'finish', reason: 'stop' };
  }
}

/**
 * Minimal compaction-style middleware: only acts when the runtime signals
 * `overflow`, replacing history with a single short message. Mirrors the
 * harness compaction middleware's overflow behavior without pulling the harness
 * into the runtime's test deps.
 */
function overflowCompactor(state: { compactions: number }): Middleware {
  return {
    name: 'test:overflow-compactor',
    priority: 500,
    // eslint-disable-next-line @typescript-eslint/require-await
    async beforeLlmStep(ctx) {
      if (!ctx.overflow) return;
      state.compactions++;
      return {
        replaceMessages: [{ role: 'user', content: 'compacted' }],
        appendMessages: [
          { role: 'system', content: '[context-compaction] over window' },
        ],
      };
    },
  };
}

describe('Runtime — context-overflow recovery', () => {
  it('compacts and resends once when the provider rejects on window size', async () => {
    const { output } = compileSource(AGENT);
    const llm = new FailOnceOverflow('Recovered after compaction.');
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());
    const state = { compactions: 0 };

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [overflowCompactor(state)],
    });
    const result = await runtime.turn('hello');

    expect(llm.calls).toBe(2);
    expect(state.compactions).toBe(1);
    expect(result.assistantText).toBe('Recovered after compaction.');
    // The resend carried the compacted history, not the original.
    const resent = llm.received[1].messages;
    expect(resent.some(m => m.content === 'compacted')).toBe(true);
  });

  it('propagates the overflow if no middleware can compact', async () => {
    const { output } = compileSource(AGENT);
    const llm = new AlwaysOverflow();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    // No compaction middleware → nothing shrinks the history → the runtime must
    // surface the original overflow rather than looping.
    const runtime = new Runtime({ doc: output, llm, tools });
    await expect(runtime.turn('hello')).rejects.toThrow(/context length/i);
    // Exactly one call: with no middleware the pipeline is empty, so there's no
    // recovery attempt at all.
    expect(llm.calls).toBe(1);
  });

  it('does not loop when a middleware exists but fails to shrink history', async () => {
    const { output } = compileSource(AGENT);
    const llm = new AlwaysOverflow();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());
    const state = { compactions: 0 };

    // The compactor replaces history on the overflow pass, so a resend happens,
    // but the provider still overflows → the second failure propagates (no
    // infinite retry).
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [overflowCompactor(state)],
    });
    await expect(runtime.turn('hello')).rejects.toThrow(/context length/i);
    expect(state.compactions).toBe(1);
    // initial + exactly one recovery resend.
    expect(llm.calls).toBe(2);
  });
});

describe('Runtime — structural request repair', () => {
  it('resends once with a strict rebuild and recovers', async () => {
    const { output } = compileSource(AGENT);
    const llm = new FailOnceStructural('Recovered.');
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('hello');

    expect(llm.calls).toBe(2);
    expect(result.assistantText).toBe('Recovered.');
  });

  it('propagates the error if the strict resend is still rejected', async () => {
    const { output } = compileSource(AGENT);
    const llm = new AlwaysStructural();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const runtime = new Runtime({ doc: output, llm, tools });
    await expect(runtime.turn('hello')).rejects.toThrow(/tool_result/);
    // Exactly one repair attempt: initial + one strict resend.
    expect(llm.calls).toBe(2);
  });
});
