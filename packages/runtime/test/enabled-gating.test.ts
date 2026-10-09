import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * The compiler emits `available when <expr>` guards as the `enabled` field on
 * each tool slot. The runtime MUST evaluate those guards before exposing the
 * tool to the LLM — otherwise disabled transitions / actions show up as
 * callable even when their preconditions are unmet, and the model happily
 * calls them, producing incoherent state.
 */

const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "GatedBot"
    default_agent_user: "bot@example.com"

variables:
    ready: mutable boolean = False
        description: "ready"

start_agent main:
    description: "main"

    reasoning:
        instructions: ->
            | decide
        actions:
            advance: @utils.transition to @subagent.next
                description: "move forward"
                available when @variables.ready == True

subagent next:
    description: "next"
    reasoning:
        instructions: ->
            | done
`;

describe('Runtime — LLM tool visibility is gated by `available when`', () => {
  const { output, diagnostics } = compileSource(SRC);
  expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);

  it('hides a tool whose guard evaluates to false', async () => {
    const llm = new ScriptedLlm([{ text: 'waiting' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    // ready=False by default → advance must be hidden
    await runtime.turn('hi');

    expect(llm.calls).toHaveLength(1);
    const toolNames = (llm.calls[0].tools ?? []).map(t => t.name);
    expect(toolNames).not.toContain('advance');
  });

  it('shows the tool once the guard evaluates to true', async () => {
    const llm = new ScriptedLlm([
      { text: 'now ready' },
      { text: 'next node text' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    runtime.state.set('ready', true);
    await runtime.turn('hi');

    const toolNames = (llm.calls[0].tools ?? []).map(t => t.name);
    expect(toolNames).toContain('advance');
  });

  it('emits an action-skipped event for each filtered tool', async () => {
    const llm = new ScriptedLlm([{ text: 'waiting' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const skipped: string[] = [];
    runtime.on(e => {
      if (e.kind === 'action-skipped') skipped.push(e.name);
    });

    await runtime.turn('hi');

    expect(skipped).toContain('advance');
  });

  it('still dispatches a tool that the LLM calls when its guard is true', async () => {
    const fn = new FnAdapter();
    let called = false;
    fn.register('noop', () => {
      called = true;
      return {};
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const src = `
system:
    instructions: "bot"
config:
    agent_name: "GatedFn"
    default_agent_user: "bot@example.com"
variables:
    ok: mutable boolean = False
        description: "ok"
start_agent main:
    description: "x"
    actions:
        Noop:
            description: "noop"
            outputs:
                result: string
            target: "fn://noop"
    reasoning:
        instructions: ->
            | do
        actions:
            go: @actions.Noop
                available when @variables.ok == True
`;
    const { output: out } = compileSource(src);

    // Guard false: LLM shouldn't see the tool. Tool call would error, but we
    // only send text.
    const offLlm = new ScriptedLlm([{ text: 'no' }]);
    const offRuntime = new Runtime({ doc: out, llm: offLlm, tools });
    await offRuntime.turn('hi');
    expect(called).toBe(false);
    expect((offLlm.calls[0].tools ?? []).map(t => t.name)).not.toContain('go');

    // Guard true: tool visible, LLM calls it.
    const onLlm = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'go', arguments: {} }] },
      { text: 'done' },
    ]);
    const onRuntime = new Runtime({ doc: out, llm: onLlm, tools });
    onRuntime.state.set('ok', true);
    await onRuntime.turn('hi');
    expect(called).toBe(true);
    expect((onLlm.calls[0].tools ?? []).map(t => t.name)).toContain('go');
  });
});
