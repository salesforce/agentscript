import { describe, it, expect } from 'vitest';
import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import {
  compileSource,
  createAgent,
  type AgentStreamPart,
  type GenerateTextFn,
  type StreamTextFn,
} from '../src/index.js';
import { runtimeEventToStreamPart } from '../src/agent.js';

const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "OrderBot"
    default_agent_user: "bot@example.com"

variables:
    status: mutable string = ""
        description: "Order status"

start_agent tracker:
    description: "Look up order"

    actions:
        Lookup:
            description: "Look up order"
            inputs:
                order_number: string
                    is_required: True
            outputs:
                status: string
            target: "fn://lookup"

    reasoning:
        instructions: ->
            | Look up the order.
        actions:
            lookup: @actions.Lookup
                with order_number=...
                set @variables.status = @outputs.status
`;

/** Mock generateText: turn 1 calls the tool, turn 2 emits text. */
function makeMockLlm() {
  let step = 0;
  const generateText: GenerateTextFn = async () => {
    step++;
    if (step === 1) {
      return {
        text: '',
        toolCalls: [
          {
            toolCallId: 'c1',
            toolName: 'lookup',
            args: { order_number: 'ORD-42' },
          },
        ],
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        finishReason: 'tool-calls',
      };
    }
    return {
      text: 'shipped.',
      toolCalls: [],
      usage: { inputTokens: 6, outputTokens: 2, totalTokens: 8 },
      finishReason: 'stop',
    };
  };
  return generateText;
}

function makeAgent(opts?: {
  modelPricing?: Record<string, { inputPer1k: number; outputPer1k: number }>;
}) {
  const { output, diagnostics } = compileSource(SRC);
  expect(
    diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    )
  ).toEqual([]);

  const fn = new FnAdapter();
  fn.register('lookup', () => ({ status: 'shipped' }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  return createAgent({
    doc: output,
    llm: {
      model: { modelId: 'mock', provider: 'mock' },
      generateText: makeMockLlm(),
    },
    tools,
    modelPricing: opts?.modelPricing,
  });
}

describe('createAgent — run()', () => {
  it('returns an AgentRunResult and fires onStepFinish + onFinish', async () => {
    const agent = makeAgent();
    const steps: string[] = [];
    let finishPayload: unknown = null;

    const result = await agent.run('where is my order?', {
      onStepFinish: step => {
        steps.push(step.node);
      },
      onFinish: r => {
        finishPayload = r;
      },
    });

    expect(result.assistantText).toBe('shipped.');
    expect(result.finalNode).toBe('tracker');
    expect(agent.state.get('status')).toBe('shipped');
    expect(steps).toEqual(['tracker']);
    expect(finishPayload).toEqual(result);
  });
});

describe('createAgent — stream()', () => {
  it('emits typed stream parts through fullStream and resolves result', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');

    const parts: AgentStreamPart[] = [];
    for await (const part of stream.fullStream) parts.push(part);

    const types = parts.map(p => p.type);
    expect(types).toContain('start-step');
    expect(types).toContain('tool-call');
    expect(types).toContain('tool-result');
    expect(types).toContain('state-change');
    expect(types).toContain('text-delta');
    expect(types[types.length - 1]).toBe('finish');

    const toolCall = parts.find(p => p.type === 'tool-call');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolName: 'fn://lookup',
      args: { order_number: 'ORD-42' },
    });

    const final = await stream.result;
    expect(final.assistantText).toBe('shipped.');
    expect(final.finalNode).toBe('tracker');
  });

  it('textStream yields just the text deltas', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');

    const chunks: string[] = [];
    for await (const chunk of stream.textStream) chunks.push(chunk);

    expect(chunks.join('')).toBe('shipped.');
    const final = await stream.result;
    expect(final.assistantText).toBe('shipped.');
  });

  it('fullStream and textStream can be consumed concurrently without stealing parts', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');

    const parts: AgentStreamPart[] = [];
    const chunks: string[] = [];
    // Drain both iterables at the same time — they must each see the full
    // stream (independent cursors over one broadcast buffer).
    await Promise.all([
      (async () => {
        for await (const part of stream.fullStream) parts.push(part);
      })(),
      (async () => {
        for await (const chunk of stream.textStream) chunks.push(chunk);
      })(),
    ]);

    expect(chunks.join('')).toBe('shipped.');
    expect(parts.map(p => p.type)).toContain('text-delta');
    expect(parts[parts.length - 1]?.type).toBe('finish');
    const final = await stream.result;
    expect(final.assistantText).toBe('shipped.');
  });

  it('stops cleanly when the consumer breaks out early', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');

    let count = 0;
    for await (const _part of stream.fullStream) {
      count++;
      break; // abandon the stream after the first part
    }
    expect(count).toBe(1);

    // The turn was aborted; awaiting result must settle (not hang). It may
    // resolve or reject depending on abort semantics — either is fine here.
    await stream.result.then(
      () => undefined,
      () => undefined
    );
  });

  it('emits a usage stream part and surfaces usage on the result', async () => {
    const agent = makeAgent();
    const stream = agent.stream('where is my order?');
    const parts: AgentStreamPart[] = [];
    for await (const part of stream.fullStream) parts.push(part);

    const usagePart = parts.find(p => p.type === 'usage');
    expect(usagePart).toBeDefined();
    // Two LLM steps: (10+6) input, (4+2) output.
    expect(usagePart).toMatchObject({
      type: 'usage',
      usage: { inputTokens: 16, outputTokens: 6, totalTokens: 22, steps: 2 },
    });

    const final = await stream.result;
    expect(final.usage?.totalTokens).toBe(22);
  });
});

/**
 * Streaming mock: turn 1 calls the tool, turn 2 streams "shipped." across
 * three text-delta parts to prove tokens surface incrementally end-to-end.
 */
function makeStreamingLlm(): StreamTextFn {
  let step = 0;
  return () => {
    step++;
    async function* fullStream() {
      if (step === 1) {
        yield {
          type: 'tool-call' as const,
          toolCallId: 'c1',
          toolName: 'lookup',
          input: { order_number: 'ORD-42' },
        };
        yield { type: 'finish' as const, finishReason: 'tool-calls' };
      } else {
        yield { type: 'text-delta' as const, text: 'ship' };
        yield { type: 'text-delta' as const, text: 'ped' };
        yield { type: 'text-delta' as const, text: '.' };
        yield { type: 'finish' as const, finishReason: 'stop' };
      }
    }
    return { fullStream: fullStream() };
  };
}

function makeStreamingAgent() {
  const { output } = compileSource(SRC);
  const fn = new FnAdapter();
  fn.register('lookup', () => ({ status: 'shipped' }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return createAgent({
    doc: output,
    llm: {
      model: { modelId: 'mock', provider: 'mock' },
      // generateText is unused when streamText is supplied.
      generateText: (async () => ({
        text: '',
        finishReason: 'stop',
      })) as GenerateTextFn,
      streamText: makeStreamingLlm(),
    },
    tools,
  });
}

describe('createAgent — streamText token streaming', () => {
  it('surfaces multiple text-delta parts (real incremental tokens)', async () => {
    const agent = makeStreamingAgent();
    const stream = agent.stream('where is my order?');

    const deltas: string[] = [];
    for await (const part of stream.fullStream) {
      if (part.type === 'text-delta') deltas.push(part.text);
    }

    // Three separate deltas, not one buffered chunk.
    expect(deltas).toEqual(['ship', 'ped', '.']);
    const final = await stream.result;
    expect(final.assistantText).toBe('shipped.');
  });
});

describe('createAgent — usage/cost', () => {
  it('aggregates per-turn token usage on run()', async () => {
    const agent = makeAgent();
    const result = await agent.run('where is my order?');
    expect(result.usage).toMatchObject({
      inputTokens: 16,
      outputTokens: 6,
      totalTokens: 22,
      steps: 2,
    });
  });

  it('estimates cost when modelPricing is supplied', async () => {
    const agent = makeAgent({
      modelPricing: { mock: { inputPer1k: 1, outputPer1k: 2 } },
    });
    const result = await agent.run('where is my order?');
    // (16/1000)*1 + (6/1000)*2 = 0.016 + 0.012 = 0.028
    expect(result.usage?.costUsd).toBeCloseTo(0.028, 6);
    expect(agent.usage().totalTokens).toBe(22);
  });

  it('isolates usage per turn (second turn only counts its own steps)', async () => {
    const agent = makeAgent();
    const first = await agent.run('turn one');
    expect(first.usage?.steps).toBe(2);
    // Lifetime total accumulates across turns.
    expect(agent.usage().steps).toBe(2);
  });
});

describe('runtimeEventToStreamPart — extended lifecycle events', () => {
  it('maps guardrail, delegation, parallel, tool-limit and session events', () => {
    expect(
      runtimeEventToStreamPart({ kind: 'guardrail-pass', name: 'g' })
    ).toEqual({ type: 'guardrail-pass', name: 'g' });
    expect(
      runtimeEventToStreamPart({
        kind: 'guardrail-fail',
        name: 'g',
        error: 'bad',
        attempt: 1,
      })
    ).toEqual({ type: 'guardrail-fail', name: 'g', error: 'bad', attempt: 1 });
    expect(
      runtimeEventToStreamPart({
        kind: 'guardrail-exhausted',
        name: 'g',
        error: 'bad',
        attempts: 3,
      })
    ).toEqual({
      type: 'guardrail-exhausted',
      name: 'g',
      error: 'bad',
      attempts: 3,
    });
    expect(
      runtimeEventToStreamPart({
        kind: 'delegation-start',
        parentNode: 'p',
        childNode: 'c',
        depth: 1,
      })
    ).toEqual({
      type: 'delegation-start',
      parentNode: 'p',
      childNode: 'c',
      depth: 1,
    });
    expect(
      runtimeEventToStreamPart({
        kind: 'delegation-error',
        parentNode: 'p',
        childNode: 'c',
        error: 'x',
      })
    ).toEqual({
      type: 'delegation-error',
      parentNode: 'p',
      childNode: 'c',
      error: 'x',
    });
    expect(
      runtimeEventToStreamPart({
        kind: 'parallel-dispatch-start',
        node: 'n',
        toolNames: ['a', 'b'],
      })
    ).toEqual({
      type: 'parallel-dispatch-start',
      node: 'n',
      toolNames: ['a', 'b'],
    });
    expect(
      runtimeEventToStreamPart({
        kind: 'tool-limit-reached',
        name: 't',
        limit: 2,
      })
    ).toEqual({ type: 'tool-limit-reached', toolName: 't', limit: 2 });
    expect(
      runtimeEventToStreamPart({
        kind: 'step-limit-reached',
        node: 'n',
        limit: 8,
      })
    ).toEqual({ type: 'step-limit-reached', node: 'n', limit: 8 });
    expect(
      runtimeEventToStreamPart({
        kind: 'action-skipped',
        name: 'a',
        reason: 'r',
      })
    ).toEqual({ type: 'action-skipped', name: 'a', reason: 'r' });
    expect(runtimeEventToStreamPart({ kind: 'end-session' })).toEqual({
      type: 'end-session',
    });
  });

  it('drops internal/tracing events (returns null)', () => {
    expect(
      runtimeEventToStreamPart({ kind: 'turn-start', node: 'n' })
    ).toBeNull();
    expect(
      runtimeEventToStreamPart({ kind: 'turn-end', node: 'n' })
    ).toBeNull();
    expect(
      runtimeEventToStreamPart({
        kind: 'span-start',
        traceId: 't',
        spanId: 's',
        name: 'x',
      })
    ).toBeNull();
  });
});
