/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end swarm fan-out through a real Runtime: a parent calls a
 * `swarm://<node>` tool with an items list + a prompt template; the runtime
 * expands it into N isolated child runs, executes them bounded-concurrently,
 * and hands back one aggregated <agent_swarm_result> block. Mirrors the
 * background-integration harness (content-routed LLM, per-route cursors).
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  ToolCall,
} from '../src/index.js';

/**
 * Content-routed LLM. For the swarm child route we also inspect the LAST user
 * message so each child can echo back its own expanded prompt — that lets the
 * test assert per-item isolation (each child saw a different {{item}}).
 */
class RoutedLlm implements LlmDriver {
  private cursors = new Map<string, number>();
  constructor(
    private readonly routes: Array<{
      match: string;
      steps: Array<{ text?: string; toolCalls?: ToolCall[] }>;
      /** When set, the route echoes the last user message instead of scripted text. */
      echoUser?: boolean;
    }>
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    const route =
      this.routes.find(r => input.system.includes(r.match)) ?? this.routes[0];
    if (route.echoUser) {
      const lastUser = [...input.messages]
        .reverse()
        .find(m => m.role === 'user');
      const text =
        typeof lastUser?.content === 'string' ? lastUser.content : 'no-user';
      yield { kind: 'text-delta', text: `ECHO: ${text}` };
      yield { kind: 'finish', reason: 'stop' };
      return;
    }
    const idx = this.cursors.get(route.match) ?? 0;
    this.cursors.set(route.match, idx + 1);
    const s = route.steps[idx] ?? {};
    if (s.text) yield { kind: 'text-delta', text: s.text };
    for (const call of s.toolCalls ?? []) yield { kind: 'tool-call', call };
    yield {
      kind: 'finish',
      reason: (s.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop',
    };
  }
}

const SOURCE = `
system:
    instructions: "Swarm system."

config:
    agent_name: "SwarmBot"
    default_agent_user: "bot@test.com"

start_agent parent:
    description: "PARENT_MARKER agent that fans out a swarm"

    actions:
        Launch_Swarm:
            description: "Fan out an investigation over many items"
            inputs:
                prompt_template: string
                    description: "Per-item prompt with {{item}}"
                items: string
                    description: "Items to fan out over"
            outputs:
                output: string
                    description: "Aggregated result"
            target: "swarm://worker"

    reasoning:
        instructions: ->
            | PARENT_MARKER: fan out the swarm.
        actions:
            swarm: @actions.Launch_Swarm
                with prompt_template=..., items=...

subagent worker:
    description: "WORKER_MARKER child that echoes its expanded prompt"

    reasoning:
        instructions: ->
            | WORKER_MARKER: do the work and report back.
`;

function buildTools(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register('fn', new FnAdapter());
  return tools;
}

describe('Runtime — swarm fan-out integration', () => {
  it('expands items into isolated children and aggregates their reports', async () => {
    const { output } = compileSource(SOURCE);
    const llm = new RoutedLlm([
      {
        match: 'PARENT_MARKER',
        steps: [
          {
            toolCalls: [
              {
                id: 'p1',
                name: 'swarm',
                arguments: {
                  prompt_template: 'Investigate {{item}}',
                  items: '["alpha", "beta", "gamma"]',
                },
              },
            ],
          },
          { text: 'Swarm complete.' },
        ],
      },
      { match: 'WORKER_MARKER', steps: [], echoUser: true },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools: buildTools() });
    const result = await runtime.turn('go');
    expect(result.assistantText).toContain('Swarm complete');

    // The tool result carried the aggregated XML into the parent's history.
    const toolMsg = runtime
      .checkpoint({ id: 't' })
      .history.find(
        m =>
          m.role === 'tool' && String(m.content).includes('agent_swarm_result')
      );
    expect(toolMsg).toBeDefined();
    const xml = String(toolMsg!.content);
    expect(xml).toContain('completed: 3');
    // Each child saw its OWN expanded prompt (isolation + correct substitution).
    expect(xml).toContain('Investigate alpha');
    expect(xml).toContain('Investigate beta');
    expect(xml).toContain('Investigate gamma');
    // One block per item, in input order.
    expect(xml.indexOf('alpha')).toBeLessThan(xml.indexOf('beta'));
    expect(xml.indexOf('beta')).toBeLessThan(xml.indexOf('gamma'));
  });

  it('emits swarm-start and swarm-end events with outcome tallies', async () => {
    const { output } = compileSource(SOURCE);
    const llm = new RoutedLlm([
      {
        match: 'PARENT_MARKER',
        steps: [
          {
            toolCalls: [
              {
                id: 'p1',
                name: 'swarm',
                arguments: {
                  prompt_template: 'Check {{item}}',
                  items: '["x", "y"]',
                },
              },
            ],
          },
          { text: 'done' },
        ],
      },
      { match: 'WORKER_MARKER', steps: [], echoUser: true },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools: buildTools() });
    const events: Array<Record<string, unknown>> = [];
    runtime.on(e => {
      if (e.kind === 'swarm-start' || e.kind === 'swarm-end') {
        events.push(e as unknown as Record<string, unknown>);
      }
    });

    await runtime.turn('go');

    const start = events.find(e => e.kind === 'swarm-start');
    const end = events.find(e => e.kind === 'swarm-end');
    expect(start).toMatchObject({ childNode: 'worker', count: 2 });
    expect(end).toMatchObject({
      childNode: 'worker',
      count: 2,
      completed: 2,
      failed: 0,
      aborted: 0,
    });
  });

  it('rejects a bad batch (missing placeholder) as a tool result, not a crash', async () => {
    const { output } = compileSource(SOURCE);
    const llm = new RoutedLlm([
      {
        match: 'PARENT_MARKER',
        steps: [
          {
            toolCalls: [
              {
                id: 'p1',
                name: 'swarm',
                arguments: {
                  prompt_template: 'no placeholder here',
                  items: '["a", "b"]',
                },
              },
            ],
          },
          { text: 'handled the error' },
        ],
      },
      { match: 'WORKER_MARKER', steps: [], echoUser: true },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools: buildTools() });
    const result = await runtime.turn('go');
    // The turn survived; the model got an error tool-result to react to.
    expect(result.assistantText).toContain('handled the error');
    const toolMsg = runtime
      .checkpoint({ id: 't' })
      .history.find(
        m => m.role === 'tool' && String(m.content).includes('error')
      );
    expect(String(toolMsg!.content)).toContain('{{item}}');
  });

  it('accepts a JSON-encoded items string (schema types it as scalar)', async () => {
    const { output } = compileSource(SOURCE);
    const llm = new RoutedLlm([
      {
        match: 'PARENT_MARKER',
        steps: [
          {
            toolCalls: [
              {
                id: 'p1',
                name: 'swarm',
                arguments: {
                  prompt_template: 'Look at {{item}}',
                  items: '["one", "two"]',
                },
              },
            ],
          },
          { text: 'ok' },
        ],
      },
      { match: 'WORKER_MARKER', steps: [], echoUser: true },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools: buildTools() });
    await runtime.turn('go');
    const toolMsg = runtime
      .checkpoint({ id: 't' })
      .history.find(
        m =>
          m.role === 'tool' && String(m.content).includes('agent_swarm_result')
      );
    const xml = String(toolMsg!.content);
    expect(xml).toContain('completed: 2');
    expect(xml).toContain('Look at one');
    expect(xml).toContain('Look at two');
  });
});
