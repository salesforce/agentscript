/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end wiring of the repeated-identical-tool-call guard through a real
 * Runtime. A scripted LLM keeps issuing the SAME `(tool, args)` call every step
 * (a classic ReAct spin). We assert the escalating <system-reminder>s land in
 * the tool-result history, the `tool-call-repeat` events fire with the right
 * action tiers, and the turn force-stops at the ceiling instead of running to
 * the step cap.
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  ToolCall,
  RuntimeEvent,
} from '../src/index.js';

/**
 * Emits the SAME tool call on every step, forever. Because the runtime always
 * loops back to the model after a tool round, this reproduces a spin without
 * having to script a finite tape.
 */
class SpinLlm implements LlmDriver {
  constructor(private readonly call: ToolCall) {}
  private issued = 0;

  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(_input: LlmStepInput): AsyncIterable<StepEvent> {
    void _input;
    this.issued += 1;
    yield {
      kind: 'tool-call',
      call: { ...this.call, id: `c${String(this.issued)}` },
    };
    yield { kind: 'finish', reason: 'tool-calls' };
  }
}

const SOURCE = `
system:
    instructions: "Spin bot."

config:
    agent_name: "SpinBot"
    default_agent_user: "bot@test.com"

start_agent main:
    description: "Agent that spins on one tool"

    actions:
        Probe:
            description: "Probe something"
            inputs:
                q: string
                    description: "Query"
            outputs:
                output: string
                    description: "Probe result"
            target: "fn://probe"

    reasoning:
        instructions: ->
            | Probe repeatedly.
        actions:
            probe: @actions.Probe
                with q=...
`;

function buildRuntime(llm: LlmDriver, opts?: { toolLoopGuard?: boolean }) {
  const { output } = compileSource(SOURCE);
  const tools = new ToolRegistry();
  const fn = new FnAdapter();
  fn.register('probe', () => ({ output: 'same answer' }));
  tools.register('fn', fn);
  return new Runtime({
    doc: output,
    llm,
    tools,
    maxStepsPerTurn: 100,
    ...opts,
  });
}

const probeCall: ToolCall = {
  id: 'seed',
  name: 'probe',
  arguments: { q: 'x' },
};

function toolContents(rt: Runtime): string[] {
  return rt
    .checkpoint({ id: 't' })
    .history.filter(m => m.role === 'tool')
    .map(m => String(m.content));
}

describe('Runtime — repeated-tool-call guard', () => {
  it('suffixes escalating reminders and force-stops the spin at the ceiling', async () => {
    const rt = buildRuntime(new SpinLlm(probeCall));
    const events: RuntimeEvent[] = [];
    rt.on(e => {
      if (e.kind === 'tool-call-repeat') events.push(e);
    });

    await rt.turn('go');

    const repeats = events.filter(e => e.kind === 'tool-call-repeat') as Array<{
      streak: number;
      action: string;
    }>;
    const actions = repeats.map(r => r.action);
    // The escalation fired in order and terminated with a force-stop.
    expect(actions).toContain('r1');
    expect(actions).toContain('r2');
    expect(actions).toContain('r3');
    expect(actions.at(-1)).toBe('stop');

    // The force-stop capped the run well under the 100-step ceiling: exactly
    // 12 dispatches (streak 1..12) then the turn ended.
    const contents = toolContents(rt);
    expect(contents).toHaveLength(12);

    // Reminders are embedded in the tool results the model sees.
    expect(contents[2]).toContain('repeated several times in a row'); // streak 3 -> r1
    expect(contents[4]).toContain('5 times in a row'); // streak 5 -> r2
    expect(contents[7]).toContain('Write your final response now'); // streak 8 -> r3
    expect(contents[11]).toContain('Write your final response now'); // streak 12 -> stop
    // The very first (non-repeated) result carries no reminder.
    expect(contents[0]).not.toContain('system-reminder');
  });

  it('does not nudge when the model varies its calls', async () => {
    // A tape that alternates args so no streak ever reaches 3.
    class AltLlm implements LlmDriver {
      private i = 0;
      // eslint-disable-next-line @typescript-eslint/require-await
      async *step(): AsyncIterable<StepEvent> {
        if (this.i >= 6) {
          yield { kind: 'text-delta', text: 'done' };
          yield { kind: 'finish', reason: 'stop' };
          return;
        }
        const q = this.i % 2 === 0 ? 'a' : 'b';
        this.i += 1;
        yield {
          kind: 'tool-call',
          call: { id: `c${String(this.i)}`, name: 'probe', arguments: { q } },
        };
        yield { kind: 'finish', reason: 'tool-calls' };
      }
    }
    const rt = buildRuntime(new AltLlm());
    const repeats: RuntimeEvent[] = [];
    rt.on(e => {
      if (e.kind === 'tool-call-repeat') repeats.push(e);
    });
    await rt.turn('go');
    expect(repeats).toHaveLength(0);
    for (const c of toolContents(rt)) {
      expect(c).not.toContain('system-reminder');
    }
  });

  it('is inert when toolLoopGuard is disabled', async () => {
    // With the guard off, the spin runs until the step cap instead of force-
    // stopping — and no reminders are appended.
    const rt = buildRuntime(new SpinLlm(probeCall), { toolLoopGuard: false });
    const repeats: RuntimeEvent[] = [];
    rt.on(e => {
      if (e.kind === 'tool-call-repeat') repeats.push(e);
    });
    await rt.turn('go');
    expect(repeats).toHaveLength(0);
    for (const c of toolContents(rt)) {
      expect(c).not.toContain('system-reminder');
    }
    // It ran past the force-stop ceiling (12) — the guard did not cap it.
    expect(toolContents(rt).length).toBeGreaterThan(12);
  });

  it('resets the streak across turns', async () => {
    // Spin exactly 2 identical calls PER TURN then stop. Counting tool results
    // since the last user message bounds each turn independently. If the streak
    // leaked across turns, turn 2's 2 calls would land on top of turn 1's — but
    // the per-turn reset keeps every streak at <= 2, below the r1 threshold.
    class PerTurnSpin implements LlmDriver {
      // eslint-disable-next-line @typescript-eslint/require-await
      async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
        // How many tool rounds have happened in THIS turn: tool messages after
        // the final user message.
        const lastUser = input.messages
          .map((m, i) => (m.role === 'user' ? i : -1))
          .reduce((a, b) => Math.max(a, b), -1);
        const toolsThisTurn = input.messages
          .slice(lastUser + 1)
          .filter(m => m.role === 'tool').length;
        if (toolsThisTurn >= 2) {
          yield { kind: 'text-delta', text: 'done' };
          yield { kind: 'finish', reason: 'stop' };
          return;
        }
        yield {
          kind: 'tool-call',
          call: {
            id: `c${String(toolsThisTurn)}`,
            name: 'probe',
            arguments: { q: 'x' },
          },
        };
        yield { kind: 'finish', reason: 'tool-calls' };
      }
    }
    const rt = buildRuntime(new PerTurnSpin());
    const repeats: RuntimeEvent[] = [];
    rt.on(e => {
      if (e.kind === 'tool-call-repeat') repeats.push(e);
    });
    await rt.turn('first');
    await rt.turn('second');
    // 2 + 2 dispatches, max streak per turn is 2 < threshold 3.
    expect(repeats).toHaveLength(0);
    // Sanity: 4 total dispatches actually happened (guard didn't suppress them).
    expect(toolContents(rt)).toHaveLength(4);
  });
});
