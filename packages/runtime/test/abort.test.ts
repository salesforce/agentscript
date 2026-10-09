import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  AbortError,
  InMemorySpanExporter,
} from '../src/index.js';
import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const HELLO = `
system:
    instructions: "You are a bot."

config:
    agent_name: "AbortBot"
    default_agent_user: "bot@example.com"

variables:
    name: mutable string = ""
        description: "Name"

start_agent main:
    description: "main agent"

    actions:
        Greet:
            description: "Greet a user"
            inputs:
                name: string
                    description: "Name"
                    is_required: True
            outputs:
                greeting: string
                    description: "Greeting"
            target: "fn://greet"

    reasoning:
        instructions: ->
            | Help the user.
        actions:
            greet: @actions.Greet
                set @variables.name = @outputs.greeting
`;

describe('Runtime — abort signal', () => {
  it('rejects immediately with AbortError when signal is pre-aborted', async () => {
    const { output } = compileSource(HELLO);
    const llm = new ScriptedLlm([{ text: 'hi' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const controller = new AbortController();
    controller.abort('cancelled');

    await expect(
      runtime.turn('hello', { signal: controller.signal })
    ).rejects.toThrow(AbortError);

    // LLM should never have been called
    expect(llm.calls).toHaveLength(0);
  });

  it('aborts during LLM step when signal fires mid-stream', async () => {
    const { output } = compileSource(HELLO);
    const controller = new AbortController();

    // A slow LLM that yields one event, then waits for a tick before the
    // second event — giving us time to abort between events.
    const slowLlm: LlmDriver = {
      async *step(_input: LlmStepInput): AsyncIterable<StepEvent> {
        yield { kind: 'text-delta', text: 'Hello' };
        // Yield control so the abort can fire between events
        await new Promise(resolve => setTimeout(resolve, 5));
        yield { kind: 'text-delta', text: ' world' };
        yield { kind: 'finish', reason: 'stop' };
      },
    };

    const runtime = new Runtime({
      doc: output,
      llm: slowLlm,
      tools: new ToolRegistry(),
    });

    // Abort after a short delay (after first yield, before second)
    setTimeout(() => controller.abort('timeout'), 2);

    await expect(
      runtime.turn('hello', { signal: controller.signal })
    ).rejects.toThrow(AbortError);
  });

  it('emits an abort event when the signal fires', async () => {
    const { output } = compileSource(HELLO);
    const controller = new AbortController();
    controller.abort('user cancelled');

    const llm = new ScriptedLlm([{ text: 'hi' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await expect(
      runtime.turn('hello', { signal: controller.signal })
    ).rejects.toThrow(AbortError);

    const abortEvents = events.filter(e => e.kind === 'abort');
    expect(abortEvents).toHaveLength(1);
    expect(abortEvents[0]).toEqual({ kind: 'abort', reason: 'user cancelled' });
  });

  it('forwards signal to tool invocations', async () => {
    const { output } = compileSource(HELLO);
    const controller = new AbortController();

    const receivedSignals: Array<AbortSignal | undefined> = [];
    const fn = new FnAdapter();
    fn.register('greet', (_args, _invocation) => {
      // The FnAdapter doesn't forward signal by default, but we can test
      // via a custom adapter that captures it.
      return { greeting: 'Hi!' };
    });

    // Use a custom tool adapter that captures the signal
    const tools = new ToolRegistry();
    tools.register('fn', {
      async invoke({ signal }) {
        receivedSignals.push(signal);
        return { greeting: 'Hi!' };
      },
    });

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'greet', arguments: { name: 'Alice' } }],
      },
      { text: 'Done' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('greet Alice', { signal: controller.signal });

    expect(receivedSignals).toHaveLength(1);
    expect(receivedSignals[0]).toBe(controller.signal);
  });

  it('uses runtime-level signal when no turn-level signal is provided', async () => {
    const { output } = compileSource(HELLO);
    const controller = new AbortController();
    controller.abort('runtime-level abort');

    const llm = new ScriptedLlm([{ text: 'hi' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      signal: controller.signal,
    });

    await expect(runtime.turn('hello')).rejects.toThrow(AbortError);
    expect(llm.calls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Tier 2 — T2.2: abort fired between LLM finish and tool dispatch via
  // afterLlmStep middleware. Pipeline runs after LLM finishes but before
  // the tool dispatch loop hits its `throwIfAborted` checkpoint.
  // -----------------------------------------------------------------------
  it('aborting from afterLlmStep middleware blocks tool dispatch', async () => {
    const { output } = compileSource(HELLO);
    const controller = new AbortController();

    let toolInvoked = false;
    const fn = new FnAdapter();
    fn.register('greet', () => {
      toolInvoked = true;
      return { greeting: 'hi' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware = {
      name: 'abort-after-llm',
      afterLlmStep() {
        controller.abort('mid-turn cancel');
        return undefined;
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'greet', arguments: { name: 'Alice' } }],
      },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await expect(
      runtime.turn('hello', { signal: controller.signal })
    ).rejects.toThrow(AbortError);

    // Tool was never invoked
    expect(toolInvoked).toBe(false);
    // No tool-call events fired before the abort
    expect(events.filter(e => e.kind === 'tool-call')).toHaveLength(0);
    // Exactly one abort event
    const aborts = events.filter(e => e.kind === 'abort');
    expect(aborts).toHaveLength(1);

    // The runtime should have drained any open tracing spans on abort. We
    // can't access tracingCtx directly, but turning on tracing and checking
    // the exporter saw all spans closed proves no leaks. Skipping span
    // assertions here because tracing is disabled in this minimal test.
  });

  it('aborting from afterLlmStep with tracing on leaves no open spans', async () => {
    const { output } = compileSource(HELLO);
    const controller = new AbortController();

    const fn = new FnAdapter();
    fn.register('greet', () => ({ greeting: 'hi' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware = {
      name: 'abort-after-llm',
      afterLlmStep() {
        controller.abort('mid-turn cancel');
        return undefined;
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'greet', arguments: { name: 'Alice' } }],
      },
    ]);

    const exporter = new InMemorySpanExporter();
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
      tracing: { enabled: true, exporter },
    });

    await expect(
      runtime.turn('hello', { signal: controller.signal })
    ).rejects.toThrow(AbortError);

    // All exported spans must have an endTime (no leaked open spans).
    const spans = exporter.getSpans();
    expect(spans.length).toBeGreaterThan(0);
    for (const s of spans) {
      expect(s.endTime).toBeDefined();
    }
  });

  it('turn-level signal overrides runtime-level signal', async () => {
    const { output } = compileSource(HELLO);
    const runtimeController = new AbortController();
    runtimeController.abort('runtime-level');

    const turnController = new AbortController();
    // Turn-level is NOT aborted, so it should proceed

    const llm = new ScriptedLlm([{ text: 'hi' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
      signal: runtimeController.signal,
    });

    // The turn-level signal overrides the (already aborted) runtime signal
    const result = await runtime.turn('hello', {
      signal: turnController.signal,
    });
    expect(result.assistantText).toBe('hi');
  });
});
