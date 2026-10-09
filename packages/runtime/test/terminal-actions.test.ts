import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * Terminal utility actions compiled to built-in sentinel targets:
 *   @utils.end_session  → target `__end_session_action__`
 *   @utils.escalate     → target `__state_update_action__` that sets
 *                         AgentScriptInternal_next_topic to '__human__'
 * Both should stop the current turn cleanly and emit an `end-session` event.
 */

const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "TermBot"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "main"

    reasoning:
        instructions: ->
            | decide
        actions:
            bye: @utils.end_session
                description: "end chat"
            human: @utils.escalate
                description: "escalate"
`;

describe('Runtime — terminal utility actions', () => {
  const { output, diagnostics } = compileSource(SRC);
  expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);

  it('ends the turn when @utils.end_session is called', async () => {
    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'bye', arguments: {} }],
      },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const events: string[] = [];
    runtime.on(e => events.push(e.kind));

    const result = await runtime.turn('goodbye');

    expect(events).toContain('end-session');
    expect(events[events.length - 1]).toBe('turn-end');
    // Only one LLM call — no follow-up reasoning iteration after end_session.
    expect(llm.calls).toHaveLength(1);
    expect(result.finalNode).toBe('main');
  });

  it('ends the turn when @utils.escalate is called', async () => {
    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'human', arguments: {} }],
      },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const events: string[] = [];
    runtime.on(e => events.push(e.kind));

    await runtime.turn('I need a person');

    expect(events).toContain('end-session');
    expect(llm.calls).toHaveLength(1);
  });

  it('non-terminal calls do not trigger end-session', async () => {
    const llm = new ScriptedLlm([
      // no tool call, just text — plain turn end, not a session end
      { text: 'hello' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const events: string[] = [];
    runtime.on(e => events.push(e.kind));

    await runtime.turn('hi');

    expect(events).not.toContain('end-session');
    expect(events).toContain('turn-end');
  });
});
