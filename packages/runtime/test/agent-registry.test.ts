/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * The registry is the seam that gives every delegation a stable id so hosts
 * (TUI, tests) can look up transcripts by agentId rather than by
 * `(parentNode, childNode, depth)`. Tests here cover both the pure registry
 * class and its wiring into Runtime.delegate / delegateMultiple.
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  AgentRegistry,
} from '../src/index.js';
import type { RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const MULTI_AGENT = `
system:
    instructions: "Multi-agent system."

config:
    agent_name: "DelegationBot"
    default_agent_user: "bot@test.com"

variables:
    result: mutable string = ""
        description: "Delegation result"

start_agent parent:
    description: "Parent agent"

    actions:
        Delegate_To_Child:
            description: "Delegate work to the child agent"
            inputs:
                context: string
                    description: "Context for delegation"
            outputs:
                result: string
                    description: "Child's response"
            target: "delegate://child"

    reasoning:
        instructions: ->
            | You can delegate to the child agent.
        actions:
            delegate: @actions.Delegate_To_Child
                with context=...
                set @variables.result = @outputs.result

subagent child:
    description: "Child agent"

    actions:
        Do_Work:
            description: "Do some work"
            inputs:
                task: string
                    description: "Task to perform"
            outputs:
                output: string
                    description: "Work result"
            target: "fn://do_work"

    reasoning:
        instructions: ->
            | Do the work.
        actions:
            do_work: @actions.Do_Work
                with task=...
`;

describe('AgentRegistry — unit', () => {
  it('mints monotonic ids and preserves registration order', () => {
    const r = new AgentRegistry();
    const a = r.register({
      parentNode: 'p',
      childNode: 'c1',
      depth: 1,
      parallel: false,
    });
    const b = r.register({
      parentNode: 'p',
      childNode: 'c2',
      depth: 1,
      parallel: false,
    });
    expect(a.agentId).toBe('agent-1');
    expect(b.agentId).toBe('agent-2');
    expect(r.list().map(h => h.agentId)).toEqual(['agent-1', 'agent-2']);
  });

  it('settle flips a running handle to ok and emits an agent-end event', () => {
    const r = new AgentRegistry();
    const events: string[] = [];
    r.on(e => events.push(`${e.kind}:${e.handle.agentId}:${e.handle.status}`));
    const h = r.register({
      parentNode: 'p',
      childNode: 'c',
      depth: 1,
      parallel: false,
    });
    r.settle(h.agentId, {
      kind: 'ok',
      result: {
        assistantText: 'done',
        stateChanges: {},
        finalNode: 'c',
        steps: 1,
      },
    });
    expect(r.get(h.agentId)?.status).toBe('ok');
    expect(r.get(h.agentId)?.result?.assistantText).toBe('done');
    expect(events).toEqual([
      'agent-start:agent-1:running',
      'agent-end:agent-1:ok',
    ]);
  });

  it('settle records an error outcome with the stringified error', () => {
    const r = new AgentRegistry();
    const h = r.register({
      parentNode: 'p',
      childNode: 'c',
      depth: 1,
      parallel: false,
    });
    r.settle(h.agentId, { kind: 'error', error: 'boom' });
    expect(r.get(h.agentId)?.status).toBe('error');
    expect(r.get(h.agentId)?.error).toBe('boom');
  });

  it('children() groups handles by parentAgentId', () => {
    const r = new AgentRegistry();
    const top = r.register({
      parentNode: 'root',
      childNode: 'a',
      depth: 1,
      parallel: false,
    });
    r.register({
      parentNode: 'a',
      childNode: 'a-1',
      depth: 2,
      parallel: false,
      parentAgentId: top.agentId,
    });
    r.register({
      parentNode: 'a',
      childNode: 'a-2',
      depth: 2,
      parallel: false,
      parentAgentId: top.agentId,
    });
    r.register({
      parentNode: 'root',
      childNode: 'b',
      depth: 1,
      parallel: false,
    });
    expect(r.children(undefined).map(h => h.childNode)).toEqual(['a', 'b']);
    expect(r.children(top.agentId).map(h => h.childNode)).toEqual([
      'a-1',
      'a-2',
    ]);
  });
});

describe('Runtime — agent registry wiring', () => {
  it('registers a handle per delegation and stamps agentId on the events', async () => {
    const { output } = compileSource(MULTI_AGENT);
    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help' } },
        ],
      },
      { text: 'child summary' },
      { text: 'parent wrap up' },
    ]);
    const events: RuntimeEvent[] = [];
    const runtime = new Runtime({ doc: output, llm, tools });
    runtime.bus.on(e => events.push(e));

    await runtime.turn('go');

    const started = events.find(e => e.kind === 'delegation-start');
    const ended = events.find(e => e.kind === 'delegation-end');
    expect(started).toBeDefined();
    expect(ended).toBeDefined();
    expect((started as { agentId?: string }).agentId).toBe('agent-1');
    expect((ended as { agentId?: string }).agentId).toBe('agent-1');

    const [handle] = runtime.agents.list();
    expect(handle.agentId).toBe('agent-1');
    expect(handle.parentNode).toBe('parent');
    expect(handle.childNode).toBe('child');
    expect(handle.depth).toBe(1);
    expect(handle.status).toBe('ok');
    expect(handle.parallel).toBe(false);
    expect(handle.result?.assistantText).toBe('child summary');
  });

  it('leaves the registry empty when onWillDelegate aborts before registration', async () => {
    const { output } = compileSource(MULTI_AGENT);
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help' } },
        ],
      },
      { text: 'ok, giving up' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: {
        onWillDelegate: () => {
          throw new Error('gate refused');
        },
      },
    });
    const events: RuntimeEvent[] = [];
    runtime.bus.on(e => events.push(e));
    await runtime.turn('go');
    expect(runtime.agents.list()).toEqual([]);
    expect(events.some(e => e.kind === 'delegation-start')).toBe(false);
  });

  it('records an error outcome when the child times out inside its reasoning loop', async () => {
    // Force a delegation to reject AFTER the frame has been pushed. maxSteps=0
    // makes the mini-loop bail immediately with DelegationTimeoutError — that
    // path DOES pass through settle(), unlike the pre-registration abort.
    const { output } = compileSource(MULTI_AGENT);
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help' } },
        ],
      },
      { text: 'never reached' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: { maxSteps: 0 },
    });
    await runtime.turn('go');
    const [handle] = runtime.agents.list();
    expect(handle).toBeDefined();
    expect(handle.status).toBe('error');
    expect(handle.error ?? '').toMatch(/DelegationTimeout|timed out/i);
  });

  it('exposes agentId on onDidDelegate hook context', async () => {
    const { output } = compileSource(MULTI_AGENT);
    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help' } },
        ],
      },
      { text: 'child summary' },
      { text: 'wrap' },
    ]);
    let observedId: string | undefined;
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: {
        onDidDelegate: ctx => {
          observedId = ctx.agentId;
        },
      },
    });
    await runtime.turn('go');
    // The hook context should have been populated with the id assigned to
    // the just-completed delegation, so downstream observers can key state.
    expect(observedId).toBe('agent-1');
  });
});
