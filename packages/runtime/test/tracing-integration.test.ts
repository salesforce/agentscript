import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  AbortError,
  InMemorySpanExporter,
  MultiSpanExporter,
  TracingContext,
} from '../src/index.js';
import type { RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const MINIMAL = `
system:
    instructions: "bot"

config:
    agent_name: "Bot"
    default_agent_user: "bot@test.com"

variables:
    result: mutable string = ""
        description: "Result"

start_agent main:
    description: "main"

    actions:
        DoSomething:
            description: "Do something"
            inputs:
                input: string
                    description: "Input"
                    is_required: True
            outputs:
                result: string
                    description: "Result"
            target: "fn://do_something"

    reasoning:
        instructions: ->
            | Help the user.
        actions:
            do_something: @actions.DoSomething
                set @variables.result = @outputs.result
`;

function compile() {
  const { output, diagnostics } = compileSource(MINIMAL);
  const errors = diagnostics.filter(
    d =>
      d.severity === 1 &&
      d.code !== 'invalid-action-target' &&
      d.code !== 'action-missing-input'
  );
  expect(errors).toEqual([]);
  return output;
}

function makeToolRegistry() {
  const fn = new FnAdapter();
  fn.register('do_something', args => ({
    result: `done:${String(args.input ?? '')}`,
  }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Tracing integration', () => {
  // -------------------------------------------------------------------------
  // 1. No spans when tracing disabled
  // -------------------------------------------------------------------------
  it('produces no span events when tracing is not configured', async () => {
    const output = compile();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('hi');

    const spanEvents = events.filter(
      e => e.kind === 'span-start' || e.kind === 'span-end'
    );
    expect(spanEvents).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 2. Turn span wraps entire turn
  // -------------------------------------------------------------------------
  it('creates a root "turn" span with correct start/end', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('hi');

    const spans = exporter.getSpans();
    const turnSpan = spans.find(s => s.name === 'turn');
    expect(turnSpan).toBeDefined();
    expect(turnSpan!.parentSpanId).toBeUndefined();
    expect(turnSpan!.startTime).toBeLessThanOrEqual(turnSpan!.endTime!);
    expect(turnSpan!.status).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // 3. Span hierarchy: turn > node > llm-step
  // -------------------------------------------------------------------------
  it('maintains correct parent-child hierarchy via spanId/parentSpanId', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('hi');

    const spans = exporter.getSpans();
    const turnSpan = spans.find(s => s.name === 'turn')!;
    const nodeSpan = spans.find(s => s.name === 'node')!;
    const llmSpan = spans.find(s => s.name === 'llm-step')!;

    expect(turnSpan).toBeDefined();
    expect(nodeSpan).toBeDefined();
    expect(llmSpan).toBeDefined();

    // node is child of turn
    expect(nodeSpan.parentSpanId).toBe(turnSpan.spanId);

    // llm-step is child of node
    expect(llmSpan.parentSpanId).toBe(nodeSpan.spanId);
  });

  // -------------------------------------------------------------------------
  // 4. Tool call spans
  // -------------------------------------------------------------------------
  it('creates a tool-call:{name} span as child of node when LLM calls a tool', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const tools = makeToolRegistry();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_something', arguments: { input: 'test' } },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('do it');

    const spans = exporter.getSpans();
    const toolSpan = spans.find(s => s.name === 'tool-call:do_something');
    const nodeSpan = spans.find(s => s.name === 'node');

    expect(toolSpan).toBeDefined();
    expect(nodeSpan).toBeDefined();
    expect(toolSpan!.parentSpanId).toBe(nodeSpan!.spanId);
    expect(toolSpan!.status).toBe('ok');
  });

  // -------------------------------------------------------------------------
  // 5. Span attributes
  // -------------------------------------------------------------------------
  it('carries expected attributes on spans (node name, tool name)', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const tools = makeToolRegistry();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_something', arguments: { input: 'x' } },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('do it');

    const spans = exporter.getSpans();
    const nodeSpan = spans.find(s => s.name === 'node')!;
    expect(nodeSpan.attributes['node.name']).toBe('main');

    const toolSpan = spans.find(s => s.name === 'tool-call:do_something')!;
    expect(toolSpan.attributes['tool.name']).toBe('do_something');
  });

  // -------------------------------------------------------------------------
  // 6. InMemorySpanExporter receives all spans
  // -------------------------------------------------------------------------
  it('flushes all spans to InMemorySpanExporter after turn completes', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('hi');

    const spans = exporter.getSpans();
    // At minimum: turn + node + llm-step
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // All spans should be completed (have endTime)
    for (const span of spans) {
      expect(span.endTime).toBeDefined();
      expect(span.endTime).toBeGreaterThanOrEqual(span.startTime);
    }
  });

  // -------------------------------------------------------------------------
  // 7. MultiSpanExporter fans out
  // -------------------------------------------------------------------------
  it('fans out spans to multiple exporters via MultiSpanExporter', async () => {
    const output = compile();
    const exporter1 = new InMemorySpanExporter();
    const exporter2 = new InMemorySpanExporter();
    const multi = new MultiSpanExporter([exporter1, exporter2]);
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter: multi },
    });

    await runtime.turn('hi');

    expect(exporter1.getSpans().length).toBeGreaterThanOrEqual(3);
    expect(exporter2.getSpans().length).toBeGreaterThanOrEqual(3);
    // Both exporters should have the same spans
    expect(exporter1.getSpans().length).toBe(exporter2.getSpans().length);
    expect(
      exporter1
        .getSpans()
        .map(s => s.name)
        .sort()
    ).toEqual(
      exporter2
        .getSpans()
        .map(s => s.name)
        .sort()
    );
  });

  // -------------------------------------------------------------------------
  // 8. span-start and span-end events emitted on the event bus
  // -------------------------------------------------------------------------
  it('emits span-start and span-end events on the event bus with correct data', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter },
    });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('hi');

    const spanStarts = events.filter(e => e.kind === 'span-start');
    const spanEnds = events.filter(e => e.kind === 'span-end');

    // We should have matching start/end pairs
    expect(spanStarts.length).toBeGreaterThanOrEqual(3);
    expect(spanEnds.length).toBe(spanStarts.length);

    // Verify structure of a span-start event
    const turnStart = spanStarts.find(
      e => e.kind === 'span-start' && e.name === 'turn'
    );
    expect(turnStart).toBeDefined();
    if (turnStart && turnStart.kind === 'span-start') {
      expect(turnStart.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(turnStart.spanId).toMatch(/^[0-9a-f]{16}$/);
      expect(turnStart.parentSpanId).toBeUndefined();
    }

    // Verify structure of a span-end event
    const turnEnd = spanEnds.find(
      e => e.kind === 'span-end' && e.name === 'turn'
    );
    expect(turnEnd).toBeDefined();
    if (turnEnd && turnEnd.kind === 'span-end') {
      expect(turnEnd.status).toBe('ok');
    }
  });

  // -------------------------------------------------------------------------
  // 9. Abort produces error-status spans
  // -------------------------------------------------------------------------
  it('marks unclosed spans with error status when turn is aborted', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const controller = new AbortController();

    // A slow LLM that lets us abort mid-stream
    const slowLlm = {
      async *step() {
        yield { kind: 'text-delta' as const, text: 'Hello' };
        await new Promise(resolve => setTimeout(resolve, 10));
        yield { kind: 'text-delta' as const, text: ' world' };
        yield { kind: 'finish' as const, reason: 'stop' as const };
      },
    };

    const runtime = new Runtime({
      doc: output,
      llm: slowLlm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter },
    });

    // Abort after the tracing starts but before LLM completes
    setTimeout(() => controller.abort('timeout'), 5);

    await expect(
      runtime.turn('hello', { signal: controller.signal })
    ).rejects.toThrow(AbortError);

    const spans = exporter.getSpans();
    const errorSpans = spans.filter(s => s.status === 'error');
    expect(errorSpans.length).toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 10. Sample rate 0 produces no spans
  // -------------------------------------------------------------------------
  it('produces no spans when sampleRate is 0', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter, sampleRate: 0 },
    });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('hi');

    expect(exporter.getSpans()).toHaveLength(0);
    const spanEvents = events.filter(
      e => e.kind === 'span-start' || e.kind === 'span-end'
    );
    expect(spanEvents).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // 11. Sample rate 1 always traces
  // -------------------------------------------------------------------------
  it('always produces spans when sampleRate is 1', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const llm = new ScriptedLlm([{ text: 'Hello' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      tracing: { enabled: true, exporter, sampleRate: 1 },
    });

    await runtime.turn('hi');

    const spans = exporter.getSpans();
    expect(spans.length).toBeGreaterThanOrEqual(3);
    // Verify all spans have 'ok' status (no errors in a normal turn)
    for (const span of spans) {
      expect(span.status).toBe('ok');
    }
  });

  // -------------------------------------------------------------------------
  // 12. Spans persist correct traceId across entire turn
  // -------------------------------------------------------------------------
  it('all spans in one turn share the same traceId', async () => {
    const output = compile();
    const exporter = new InMemorySpanExporter();
    const tools = makeToolRegistry();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_something', arguments: { input: 'x' } },
        ],
      },
      { text: 'Done' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      tracing: { enabled: true, exporter },
    });

    await runtime.turn('do it');

    const spans = exporter.getSpans();
    expect(spans.length).toBeGreaterThanOrEqual(4); // turn + node + llm-step + tool-call

    const traceIds = new Set(spans.map(s => s.traceId));
    expect(traceIds.size).toBe(1);

    const traceId = spans[0].traceId;
    expect(traceId).toMatch(/^[0-9a-f]{32}$/);
  });

  // -------------------------------------------------------------------------
  // T1.1 — Parallel + slow tool: parent span closes after slowest child
  // -------------------------------------------------------------------------
  it('parent parallel-tool-dispatch span closes after the slowest child', async () => {
    // Regression: with a fast and a slow sibling, the parent's endTime must
    // be >= the slowest child's endTime, both children must be parented to
    // the parallel-dispatch span, and every started span must be finalized
    // (no leak in TracingContext.active) by the end of the turn.
    const fn = new FnAdapter();
    fn.register('fastTool', () => ({ name: 'fastTool' }));
    fn.register('slowTool', async () => {
      await new Promise(r => setTimeout(r, 50));
      return { name: 'slowTool' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c0', name: 'fastTool', arguments: {} },
          { id: 'c1', name: 'slowTool', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]);

    // Use the parallel-tool-calls fixture's makeDoc-equivalent inline:
    // a doc with fastTool/slowTool wired through fn://.
    const doc = {
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
              { name: 'fastTool', target: 'fastTool', description: 'fast' },
              { name: 'slowTool', target: 'slowTool', description: 'slow' },
            ],
            action_definitions: [
              {
                developer_name: 'fastTool',
                invocation_target_type: 'fn',
                invocation_target_name: 'fastTool',
              },
              {
                developer_name: 'slowTool',
                invocation_target_type: 'fn',
                invocation_target_name: 'slowTool',
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

    const exporter = new InMemorySpanExporter();
    const events: RuntimeEvent[] = [];
    const runtime = new Runtime({
      doc,
      llm,
      tools,
      parallel: { strategy: 'always' },
      tracing: { enabled: true, exporter },
    });
    runtime.on(e => events.push(e));

    await runtime.turn('go');

    const spans = exporter.getSpans();
    const parent = spans.find(s => s.name === 'parallel-tool-dispatch');
    const children = spans.filter(s => s.name.startsWith('tool-call:'));

    // Exactly 3 spans relating to the parallel batch: 1 parent + 2 children.
    expect(parent).toBeDefined();
    expect(children).toHaveLength(2);

    // Both children parented to the dispatch span.
    for (const child of children) {
      expect(child.parentSpanId).toBe(parent!.spanId);
      expect(child.status).toBe('ok');
      expect(child.endTime).toBeDefined();
    }

    // Parent must outlive the slowest child.
    const maxChildEnd = Math.max(...children.map(c => c.endTime!));
    expect(parent!.status).toBe('ok');
    expect(parent!.endTime!).toBeGreaterThanOrEqual(maxChildEnd);

    // TracingContext.isEmpty() proxy: every span-start has a matching
    // span-end with the same spanId, so nothing leaked in `active`.
    const startIds = events
      .filter(e => e.kind === 'span-start')
      .map(e => (e as { spanId: string }).spanId);
    const endIds = events
      .filter(e => e.kind === 'span-end')
      .map(e => (e as { spanId: string }).spanId);
    expect(startIds.length).toBeGreaterThan(0);
    expect(endIds.length).toBe(startIds.length);
    expect(new Set(endIds)).toEqual(new Set(startIds));
  });

  // -------------------------------------------------------------------------
  // 13. drainAll closes off-stack parallel children with error status
  // -------------------------------------------------------------------------
  it('drainAll finalizes off-stack child spans on abort', async () => {
    // Regression: parallel dispatch starts child spans off-stack via
    // startChildSpan (no stack push). On abort, drainAll must walk the active
    // map — not just the stack — and close every started-but-unfinished span.
    const ctx = new TracingContext();
    const parent = ctx.startSpan('parallel-tool-dispatch');
    const childA = ctx.startChildSpan(parent.spanId, 'tool-call:slowA');
    const childB = ctx.startChildSpan(parent.spanId, 'tool-call:slowB');
    expect(ctx.isEmpty()).toBe(false);

    const drained = ctx.drainAll('error');

    expect(drained).toHaveLength(3);
    expect(ctx.isEmpty()).toBe(true);
    const completed = ctx.getCompleted();
    const childAFinal = completed.find(s => s.spanId === childA.spanId);
    const childBFinal = completed.find(s => s.spanId === childB.spanId);
    const parentFinal = completed.find(s => s.spanId === parent.spanId);
    expect(childAFinal?.status).toBe('error');
    expect(childAFinal?.endTime).toBeDefined();
    expect(childBFinal?.status).toBe('error');
    expect(childBFinal?.endTime).toBeDefined();
    expect(parentFinal?.status).toBe('error');
    expect(parentFinal?.endTime).toBeDefined();

    // No double-finalize: each span appears exactly once in completed.
    const ids = completed.map(s => s.spanId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
