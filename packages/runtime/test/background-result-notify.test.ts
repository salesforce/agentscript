/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression: reading a background subagent's result via `subagent://result`
 * WHILE IT IS STILL RUNNING must not permanently suppress its eventual
 * completion notice.
 *
 * The bug: `handleSubagentOp('result')` called `mgr.markNotified(taskId)`
 * unconditionally. `markNotified` pins `info.notified = true`; `settle()` never
 * clears it; `pendingNotifications()` filters on `!notified`. So a model that
 * polled the result once before the child settled flipped `notified` on for a
 * still-`running` task, and when the child finally completed the completion
 * injector had nothing to announce — the parent never learned its subagent
 * finished. The fix guards `markNotified` on a terminal status.
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  BackgroundTaskManager,
} from '../src/index.js';
import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  ToolCall,
} from '../src/index.js';

/** Content-routed LLM: per-route scripted steps chosen by system-prompt match. */
class RoutedLlm implements LlmDriver {
  private cursors = new Map<string, number>();
  constructor(
    private readonly routes: Array<{
      match: string;
      steps: Array<{ text?: string; toolCalls?: ToolCall[] }>;
    }>
  ) {}
  // eslint-disable-next-line @typescript-eslint/require-await
  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    const route =
      this.routes.find(r => input.system.includes(r.match)) ?? this.routes[0];
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

// The `read` action binds task_id FROM the stored variable, so the real
// subagent://result handler runs against the launched task's id.
const SOURCE = `
system:
    instructions: "Background subagent system."

config:
    agent_name: "BgBot"
    default_agent_user: "bot@test.com"

variables:
    last_task: mutable string = ""
        description: "Task id of the launched background subagent"

start_agent parent:
    description: "PARENT_MARKER agent that launches then peeks a result early"

    actions:
        Launch_Worker:
            description: "Launch the worker in the background"
            inputs:
                context: string
                    description: "What to work on"
                run_in_background: boolean
                    description: "Run detached"
            outputs:
                task_id: string
                    description: "Handle to the background task"
            target: "delegate://worker"
            set @variables.last_task = @outputs.task_id

        Read_Result:
            description: "Read a background subagent's result"
            inputs:
                task_id: string
                    description: "Task handle"
            target: "subagent://result"

    reasoning:
        instructions: ->
            | PARENT_MARKER: launch work, then read the result.
        actions:
            launch: @actions.Launch_Worker
                with context=..., run_in_background=...
                set @variables.last_task = @outputs.task_id
            read: @actions.Read_Result
                with task_id=@variables.last_task

subagent worker:
    description: "WORKER_MARKER agent that does background work"

    reasoning:
        instructions: ->
            | WORKER_MARKER: do the work and report back.
`;

function buildTools(): ToolRegistry {
  const fn = new FnAdapter();
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('Runtime — reading a RUNNING subagent result preserves its completion notice', () => {
  it('does not mark a still-running task notified; the later completion is still announced', async () => {
    const { output } = compileSource(SOURCE);
    const background = new BackgroundTaskManager();

    // Gate the worker so it stays `running` across the parent's read. The
    // parent launches (turn 1a), then reads the result (turn 1b) while the
    // worker is still blocked on this promise.
    let releaseWorker!: () => void;
    const workerGate = new Promise<void>(resolve => {
      releaseWorker = resolve;
    });

    const llm = new RoutedLlm([
      {
        match: 'PARENT_MARKER',
        steps: [
          // Launch detached.
          {
            toolCalls: [
              {
                id: 'p1',
                name: 'launch',
                arguments: { context: 'slow work', run_in_background: true },
              },
            ],
          },
          // Immediately peek the result while the worker is still running.
          { toolCalls: [{ id: 'p2', name: 'read', arguments: {} }] },
          { text: 'Peeked early; will wait for it to finish.' },
        ],
      },
      {
        // The worker blocks until released, then reports.
        match: 'WORKER_MARKER',
        steps: [{ text: 'WORKER_DONE the answer is 42' }],
      },
    ]);

    // The worker's node text step resolves immediately in the RoutedLlm, so to
    // actually hold the child `running` we gate via a tool the child awaits.
    // Simpler: intercept the manager to keep the task running by delaying the
    // child turn. We do that by making the worker's LLM step await the gate.
    const gatedLlm: LlmDriver = {
      async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
        if (input.system.includes('WORKER_MARKER')) {
          await workerGate; // hold the child in `running` until released
        }
        yield* llm.step(input);
      },
    };

    const runtime = new Runtime({
      doc: output,
      llm: gatedLlm,
      tools: buildTools(),
      background,
    });

    // Turn 1: launch + early read happen here. The worker is gated, so at the
    // moment of the read the task is still `running`.
    const turn = runtime.turn('launch then peek');

    // Let the launch + read dispatch run while the worker is gated.
    await tick();
    await tick();

    const taskId = runtime.state.get('last_task') as string;
    expect(taskId).toMatch(/^task-/);
    // Precondition for the regression: the task was still running when read.
    // (If it had already settled the test wouldn't exercise the bug — but the
    // gate guarantees it hasn't.)
    expect(background.get(taskId)!.status).toBe('running');

    // Now release the worker and let everything settle.
    releaseWorker();
    await turn;
    // Give the fire-and-forget settle + notification a moment.
    await tick();
    await tick();

    const info = background.get(taskId)!;
    expect(info.status).toBe('completed');
    expect(info.resultText).toContain('the answer is 42');

    // THE REGRESSION ASSERTION: the completion must still be announceable — an
    // early read of a running task must NOT have pinned `notified`.
    expect(info.notified).not.toBe(true);
    expect(background.pendingNotifications().map(t => t.taskId)).toContain(
      taskId
    );
  });

  it('DOES mark notified when the result is read after the task is terminal', async () => {
    // The complement: once terminal, reading the result legitimately delivers
    // the notice so the injector won't re-announce it.
    const background = new BackgroundTaskManager();
    const info = background.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: () => Promise.resolve({ assistantText: 'done', steps: 1 }),
    });
    await tick();
    expect(background.get(info.taskId)!.status).toBe('completed');
    // Terminal → marking notified is correct.
    background.markNotified(info.taskId);
    expect(background.pendingNotifications()).toEqual([]);
  });
});
