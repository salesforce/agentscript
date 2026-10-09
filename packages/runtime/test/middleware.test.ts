/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { Middleware, RuntimeEvent, Guardrail } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const TOOL_SRC = `
system:
    instructions: "You are a support bot."

config:
    agent_name: "TestBot"
    default_agent_user: "bot@example.com"

variables:
    result_value: mutable string = ""
        description: "Stored result"

start_agent main:
    description: "Main agent"

    actions:
        Do_Something:
            description: "Does something"
            inputs:
                input: string
                    description: "Input value"
                    is_required: True
            outputs:
                output: string
                    description: "Output value"
            target: "fn://do_something"

    reasoning:
        instructions: ->
            | Help the user.
        actions:
            do_it: @actions.Do_Something
                set @variables.result_value = @outputs.output
`;

describe('Middleware', () => {
  function compileToolSrc() {
    const { output, diagnostics } = compileSource(TOOL_SRC);
    const errors = diagnostics.filter(
      d =>
        d.severity === 1 &&
        d.code !== 'invalid-action-target' &&
        d.code !== 'action-missing-input'
    );
    expect(errors).toEqual([]);
    return output;
  }

  it('beforeToolCall abort blocks tool invocation', async () => {
    const output = compileToolSrc();

    let adapterCalled = false;
    const fn = new FnAdapter();
    fn.register('do_something', () => {
      adapterCalled = true;
      return { output: 'real' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'block-tool',
      beforeToolCall(_ctx) {
        return { abort: { result: { output: 'blocked' } } };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    expect(adapterCalled).toBe(false);
    expect(result.assistantText).toBe('Done.');
  });

  it('afterToolCall transforms result used by state_updates', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'original' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'transform-result',
      afterToolCall(_ctx) {
        return { result: { output: 'transformed' } };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await runtime.turn('test');

    expect(runtime.state.get('result_value')).toBe('transformed');
  });

  it('beforeLlmStep modifies system prompt', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'modify-system',
      beforeLlmStep(_ctx) {
        return { system: 'CUSTOM SYSTEM PROMPT' };
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await runtime.turn('test');

    expect(llm.calls[0].system).toBe('CUSTOM SYSTEM PROMPT');
  });

  it('beforeLlmStep replaceMessages replaces persisted history for the current step', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    // The runtime pushes the user message ("noisy original") before the LLM
    // step. This middleware evicts it and swaps in a single compacted user
    // message. The replacement must be reflected in THIS step's request.
    const middleware: Middleware = {
      name: 'replace-history',
      beforeLlmStep(_ctx) {
        return {
          replaceMessages: [{ role: 'user', content: 'COMPACTED' }],
        };
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await runtime.turn('noisy original');

    // The request the LLM saw this step is exactly the replacement.
    expect(llm.calls[0].messages).toEqual([
      { role: 'user', content: 'COMPACTED' },
    ]);
    expect(
      llm.calls[0].messages.some(
        m => typeof m.content === 'string' && m.content === 'noisy original'
      )
    ).toBe(false);
  });

  it('beforeLlmStep applies appendMessages AFTER replaceMessages', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'replace-then-append',
      beforeLlmStep(_ctx) {
        return {
          replaceMessages: [{ role: 'user', content: 'COMPACTED' }],
          appendMessages: [{ role: 'system', content: 'NOTE' }],
        };
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await runtime.turn('original');

    // Replacement first, note appended after — order preserved.
    expect(llm.calls[0].messages).toEqual([
      { role: 'user', content: 'COMPACTED' },
      { role: 'system', content: 'NOTE' },
    ]);
  });

  it('afterLlmStep modifies text in returned assistantText', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'modify-text',
      afterLlmStep(_ctx) {
        return { text: 'REPLACED TEXT' };
      },
    };

    const llm = new ScriptedLlm([{ text: 'Original text.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    expect(result.assistantText).toBe('REPLACED TEXT');
  });

  it('onError suppresses with fallback result', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => {
      throw new Error('adapter exploded');
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'error-handler',
      onError(_ctx) {
        return { suppress: true, fallbackResult: { output: 'fallback' } };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    // The turn should succeed and state_updates should use the fallback
    expect(result.assistantText).toBe('Done.');
    expect(runtime.state.get('result_value')).toBe('fallback');
  });

  it('respects priority ordering', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const order: string[] = [];

    const mwA: Middleware = {
      name: 'mw-a',
      priority: 200,
      beforeLlmStep() {
        order.push('A');
        return undefined;
      },
    };

    const mwB: Middleware = {
      name: 'mw-b',
      priority: 50,
      beforeLlmStep() {
        order.push('B');
        return undefined;
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [mwA, mwB],
    });
    await runtime.turn('test');

    // mw-b (priority 50) should run before mw-a (priority 200)
    expect(order).toEqual(['B', 'A']);
  });

  // -----------------------------------------------------------------------
  // Tier 2 — T2.6: middleware × guardrail retry contract.
  //
  // CONTRACT: With an output guardrail that rejects the first attempt and
  // accepts the second, `beforeLlmStep` and `afterLlmStep` fire EXACTLY
  // ONCE per outer reasoning iteration (not per attempt) — they bracket the
  // guardrail-driven retry loop. `beforeToolCall` / `afterToolCall` fire
  // ONCE per accepted tool call. Retries happen INSIDE
  // runLlmStepWithGuardrails and are not re-bracketed by middleware. If
  // this is later changed to fire per-attempt, this test will break and
  // signal the new contract.
  // -----------------------------------------------------------------------
  it('middleware fires once-on-accept across guardrail retries', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    let nextId = 0;
    const beforeArgs: Array<Record<string, unknown>> = [];
    const beforeCalls: string[] = [];
    const afterCalls: string[] = [];
    const beforeLlmCalls: number[] = [];
    const afterLlmCalls: number[] = [];

    const middleware: Middleware = {
      name: 'pin-contract',
      beforeLlmStep() {
        beforeLlmCalls.push(Date.now());
        return undefined;
      },
      afterLlmStep() {
        afterLlmCalls.push(Date.now());
        return undefined;
      },
      beforeToolCall(ctx) {
        beforeCalls.push(ctx.toolName);
        const trace_id = ++nextId;
        const stamped = { ...ctx.args, _trace_id: trace_id };
        beforeArgs.push(stamped);
        return { args: stamped };
      },
      afterToolCall(ctx) {
        afterCalls.push(ctx.toolName);
        return undefined;
      },
    };

    // Output guardrail: rejects text containing "approved", accepts on retry.
    const outputGuardrail: Guardrail = {
      name: 'no-approved',
      target: 'both',
      maxRetries: 2,
      validate(out) {
        if (typeof out.text === 'string' && /approved/.test(out.text)) {
          return { valid: false, reason: 'contains "approved"' };
        }
        return { valid: true };
      },
    };

    // First LLM response: text "approved order..." + tool call.
    // Second LLM response: clean revision text + tool call.
    const llm = new ScriptedLlm([
      {
        text: 'approved order — submitting',
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'first' } }],
      },
      {
        text: 'submitting now',
        toolCalls: [
          { id: 'c2', name: 'do_it', arguments: { input: 'second' } },
        ],
      },
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
      guardrails: [outputGuardrail],
    });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('test');
    expect(result.assistantText).toContain('Done.');

    // Two LLM attempts (first rejected, second accepted) — but beforeLlmStep
    // and afterLlmStep each fired exactly ONCE for the reasoning iteration
    // that produced the tool call, plus once more for the final reasoning
    // iteration that produced "Done." — so total 2 each.
    expect(beforeLlmCalls).toHaveLength(2);
    expect(afterLlmCalls).toHaveLength(2);

    // The tool was dispatched exactly once, with the ACCEPTED args (input:
    // "second", from the second LLM attempt).
    expect(beforeCalls).toHaveLength(1);
    expect(afterCalls).toHaveLength(1);
    expect(beforeArgs[0]).toMatchObject({
      input: 'second',
      _trace_id: 1,
    });

    // Guardrail did fire and retry once.
    const fails = events.filter(e => e.kind === 'guardrail-fail');
    const passes = events.filter(e => e.kind === 'guardrail-pass');
    expect(fails).toHaveLength(1);
    expect(passes.length).toBeGreaterThanOrEqual(1);
  });

  // -----------------------------------------------------------------------
  // Tier 2 — T2.8: onError fallbackResult contract.
  //
  // CONTRACT: When a tool throws and a middleware's `onError` returns
  // `{ fallbackResult }` (without `suppress: true`), the runtime currently
  // emits a `tool-error` event AND surfaces the error in history. To
  // actually swap in the fallback you must ALSO set `suppress: true` —
  // suppress is what tells the runtime to use fallbackResult and continue.
  // The existing 'onError suppresses with fallback result' test pins the
  // happy path. Here we verify that with `suppress: true` + fallbackResult,
  // no `tool-error` event reaches subscribers and the history entry is the
  // fallback (NOT the error string).
  // -----------------------------------------------------------------------
  it('onError suppress + fallbackResult: no tool-error reaches subscribers, history has fallback', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => {
      throw new Error('flaky exploded');
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'recoverer',
      onError() {
        return {
          suppress: true,
          fallbackResult: { ok: true, recovered: true, output: 'fb' },
        };
      },
    };

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'do_it', arguments: { input: 'hello' } }],
      },
      { text: 'done' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    const result = await runtime.turn('test');
    expect(result.assistantText).toBe('done');

    // No tool-error event surfaced to subscribers.
    const errs = events.filter(e => e.kind === 'tool-error');
    expect(errs).toHaveLength(0);

    // The history (visible to the next LLM call) carried the fallback,
    // not the original error.
    const toolMsgs = llm.calls[1].messages.filter(m => m.role === 'tool');
    expect(toolMsgs).toHaveLength(1);
    const content = JSON.parse(toolMsgs[0].content as string) as Record<
      string,
      unknown
    >;
    expect(content).toMatchObject({ ok: true, recovered: true });
    expect(JSON.stringify(content)).not.toContain('flaky exploded');
  });

  it('failOpen catches middleware errors and continues', async () => {
    const output = compileToolSrc();

    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const middleware: Middleware = {
      name: 'crashy',
      failOpen: true,
      beforeLlmStep() {
        throw new Error('middleware crashed');
      },
    };

    const llm = new ScriptedLlm([{ text: 'Hello.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    // The turn should succeed despite the middleware crash
    expect(result.assistantText).toBe('Hello.');
  });

  it('onStop continuation forces one more reasoning round', async () => {
    const output = compileToolSrc();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    let stopCalls = 0;
    const middleware: Middleware = {
      name: 'stop-continue',
      onStop(ctx) {
        stopCalls++;
        // Continue once; the second time it's already active, so decline.
        if (!ctx.stopHookActive) return { continuation: 'keep going' };
      },
    };

    // First step: no tool calls (natural stop). onStop injects a continuation,
    // so the loop runs again -> second step emits the final text.
    const llm = new ScriptedLlm([{ text: 'First.' }, { text: 'Second.' }]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    // onStop fires once (the continuation used the single allowance; the second
    // natural stop isn't re-consulted because stopHookUsed is now set).
    expect(stopCalls).toBe(1);
    // Both steps ran and their text accumulated.
    expect(result.assistantText).toBe('First.Second.');
    // The continuation was injected as a user message between the two steps.
    const secondCall = llm.calls[1];
    expect(
      secondCall.messages.some(
        m => m.role === 'user' && m.content === 'keep going'
      )
    ).toBe(true);
  });

  // Ported from the reference agent turn-lifecycle: shouldContinueAfterStop (our onStop) is
  // consulted ONLY at the final non-tool step, never between tool_use steps.
  it('onStop is not consulted between tool_use steps', async () => {
    const output = compileToolSrc();
    const fn = new FnAdapter();
    fn.register('do_something', () => ({ output: 'ok' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    let stopCalls = 0;
    const middleware: Middleware = {
      name: 'stop-counter',
      onStop() {
        stopCalls++;
        // Always decline so the turn stops at its first natural boundary.
      },
    };

    // Two tool-call steps, then a natural stop. onStop must fire exactly once
    // — at the final non-tool step — not after each tool_use step.
    const llm = new ScriptedLlm([
      { toolCalls: [{ id: 'a', name: 'do_it', arguments: { input: '1' } }] },
      { toolCalls: [{ id: 'b', name: 'do_it', arguments: { input: '2' } }] },
      { text: 'done' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    expect(result.assistantText).toBe('done');
    expect(stopCalls).toBe(1);
  });

  // Ported from the reference agent's pipeline contract: the first middleware (in priority
  // order) to return a continuation wins; later middleware are not consulted.
  it('onStop first continuation wins in priority order', async () => {
    const output = compileToolSrc();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const consulted: string[] = [];
    const early: Middleware = {
      name: 'early',
      priority: 10,
      onStop(ctx) {
        consulted.push('early');
        if (!ctx.stopHookActive) return { continuation: 'from-early' };
      },
    };
    const late: Middleware = {
      name: 'late',
      priority: 20,
      onStop() {
        consulted.push('late');
        return { continuation: 'from-late' };
      },
    };

    const llm = new ScriptedLlm([{ text: 'First.' }, { text: 'Second.' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [late, early],
    });
    await runtime.turn('test');

    // 'early' (priority 10) short-circuits, so 'late' is never consulted on the
    // first natural stop. The continuation injected is 'from-early'.
    expect(consulted[0]).toBe('early');
    expect(consulted).not.toContain('late');
    const secondCall = llm.calls[1];
    expect(
      secondCall.messages.some(
        m => m.role === 'user' && m.content === 'from-early'
      )
    ).toBe(true);
  });

  it('onStop is not consulted when it declines to continue', async () => {
    const output = compileToolSrc();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    let stopCalls = 0;
    const middleware: Middleware = {
      name: 'stop-decline',
      onStop() {
        stopCalls++;
        // Decline (return nothing) -> the turn stops normally.
      },
    };

    const llm = new ScriptedLlm([{ text: 'Only.' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    const result = await runtime.turn('test');

    expect(stopCalls).toBe(1);
    expect(result.assistantText).toBe('Only.');
  });

  it('onInterrupt fires with reason "aborted" on abort', async () => {
    const output = compileToolSrc();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const interrupts: Array<{ reason: string }> = [];
    const middleware: Middleware = {
      name: 'interrupt-observer',
      failOpen: true,
      onInterrupt(ctx) {
        interrupts.push({ reason: ctx.reason });
      },
    };

    const llm = new ScriptedLlm([{ text: 'never reached' }]);
    const controller = new AbortController();
    controller.abort();

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      middleware: [middleware],
    });
    await expect(
      runtime.turn('test', { signal: controller.signal })
    ).rejects.toThrow();

    expect(interrupts).toEqual([{ reason: 'aborted' }]);
  });

  it('onInterrupt fires with reason "error" on an unhandled turn error', async () => {
    const output = compileToolSrc();
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const interrupts: Array<{ reason: string }> = [];
    const middleware: Middleware = {
      name: 'interrupt-observer',
      failOpen: true,
      beforeLlmStep() {
        // A non-failOpen crash would surface, but we want the turn to throw from
        // deeper. Instead throw from a hard error path: an LLM that rejects.
      },
      onInterrupt(ctx) {
        interrupts.push({ reason: ctx.reason });
      },
    };

    // An LLM driver that throws synchronously inside step().
    const boomLlm: import('../src/index.js').LlmDriver = {
      // eslint-disable-next-line require-yield
      async *step() {
        throw new Error('boom');
      },
    };

    const runtime = new Runtime({
      doc: output,
      llm: boomLlm,
      tools,
      middleware: [middleware],
    });
    await expect(runtime.turn('test')).rejects.toThrow('boom');

    expect(interrupts).toEqual([{ reason: 'error' }]);
  });
});
