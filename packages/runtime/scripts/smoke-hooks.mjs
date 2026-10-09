#!/usr/bin/env node
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live smoke test for require_user_confirmation + pre_tool_call/post_tool_call
 * hooks against the built dist/index.js (not vitest's src/ path), driving a
 * real compiled agent through the real Runtime with an in-process ScriptedLlm
 * and FnAdapter. No API key required.
 */

import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../dist/index.js';

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

class ScriptedLlm {
  constructor(scripts) {
    this.scripts = scripts;
    this.idx = 0;
    this.calls = [];
  }
  async *step(input) {
    this.calls.push(input);
    const s = this.scripts[this.idx++] ?? {};
    if (s.text) yield { kind: 'text-delta', text: s.text };
    for (const call of s.toolCalls ?? []) {
      yield { kind: 'tool-call', call };
    }
    yield {
      kind: 'finish',
      reason: (s.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop',
    };
  }
}

// --- Scenario 1: require_user_confirmation surfaces to beforeToolCall, and
// middleware can abort based on it. ---
async function testRequireConfirmation() {
  const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "SmokeBot"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "main"

    actions:
        Sensitive:
            description: "needs confirmation"
            target: "fn://sensitive"
            require_user_confirmation: True

    reasoning:
        instructions: ->
            | do it
        actions:
            do_sensitive: @actions.Sensitive
`;
  const { output, diagnostics } = compileSource(SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(
    errors.length === 0,
    'require_user_confirmation: agent compiles cleanly'
  );

  let sensitiveCalled = false;
  const fn = new FnAdapter();
  fn.register('sensitive', () => {
    sensitiveCalled = true;
    return { ok: true };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  let seenFlag;
  const runtime = new Runtime({
    doc: output,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'do_sensitive', arguments: {} }] },
      { text: 'Done' },
    ]),
    tools,
    middleware: [
      {
        name: 'gate',
        beforeToolCall(ctx) {
          seenFlag = ctx.requireConfirmation;
          if (ctx.requireConfirmation) {
            return { abort: { result: { error: 'confirmation required' } } };
          }
        },
      },
    ],
  });

  await runtime.turn('go');
  assert(
    seenFlag === true,
    'require_user_confirmation: middleware saw requireConfirmation=true'
  );
  assert(
    !sensitiveCalled,
    'require_user_confirmation: adapter never invoked after abort'
  );
}

// --- Scenario 2: post_tool_call runs a nested action after the outer tool's
// result, exposing result.* to it. ---
async function testPostToolCall() {
  const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "SmokeBot2"
    default_agent_user: "bot@example.com"

variables:
    b_result: mutable string = ""
        description: "B's result"

start_agent main:
    description: "main"

    actions:
        A:
            description: "Action A"
            outputs:
                value: string
                    description: "A output"
            target: "fn://action_a"
        B:
            description: "Action B"
            inputs:
                from_a: string
                    description: "input from A"
            outputs:
                value: string
                    description: "B output"
            target: "fn://action_b"

    reasoning:
        instructions: ->
            | do it
        actions:
            do_a: @actions.A
                run @actions.B
                    with from_a = @outputs.value
                    set @variables.b_result = @outputs.value
`;
  const { output, diagnostics } = compileSource(SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(errors.length === 0, 'post_tool_call: agent compiles cleanly');

  const calls = [];
  const fn = new FnAdapter();
  fn.register('action_a', () => {
    calls.push('A');
    return { value: 'from-A' };
  });
  fn.register('action_b', args => {
    calls.push('B');
    return { value: `B saw ${args.from_a}` };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  const runtime = new Runtime({
    doc: output,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'do_a', arguments: {} }] },
      { text: 'Done' },
    ]),
    tools,
  });

  await runtime.turn('go');
  assert(
    calls.join(',') === 'A,B',
    'post_tool_call: A then B both ran, in order'
  );
  assert(
    runtime.state.get('b_result') === 'B saw from-A',
    "post_tool_call: B saw A's result via result.* scope"
  );
}

// --- Scenario 3: pre_tool_call (synthetic IR mutation, since no compiler
// producer exists yet) hands off before the tool runs and before middleware. ---
async function testPreToolCall() {
  const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "SmokeBot3"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "main"

    actions:
        A:
            description: "Action A"
            target: "fn://action_a"

    reasoning:
        instructions: ->
            | do it
        actions:
            do_a: @actions.A
subagent other:
    description: "other"
    reasoning:
        instructions: ->
            | done
`;
  const { output, diagnostics } = compileSource(SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(errors.length === 0, 'pre_tool_call: agent compiles cleanly');

  const mainNode = output.agent_version.nodes.find(
    n => n.developer_name === 'main'
  );
  mainNode.pre_tool_call = [
    { target: 'A', actions: [{ type: 'handoff', target: 'other' }] },
  ];

  let aCalled = false;
  let middlewareCalled = false;
  const fn = new FnAdapter();
  fn.register('action_a', () => {
    aCalled = true;
    return { ok: true };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  const events = [];
  const runtime = new Runtime({
    doc: output,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'do_a', arguments: {} }] },
      { text: 'Done' },
    ]),
    tools,
    middleware: [
      {
        name: 'observer',
        beforeToolCall() {
          middlewareCalled = true;
        },
      },
    ],
  });
  runtime.on(e => events.push(e));

  const result = await runtime.turn('go');
  assert(
    result.finalNode === 'other',
    'pre_tool_call: handed off to target node'
  );
  assert(!aCalled, 'pre_tool_call: outer tool never invoked');
  assert(
    !middlewareCalled,
    'pre_tool_call: beforeToolCall middleware never invoked'
  );
  assert(
    events.some(e => e.kind === 'phase-start' && e.phase === 'pre_tool_call'),
    'pre_tool_call: phase-start event emitted'
  );
}

// --- Scenario 4: require_user_confirmation surfaces on the parallel
// (isolated-dispatch) path too — the second, separately-wired code path. ---
async function testRequireConfirmationParallel() {
  const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "SmokeBot4"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "main"

    actions:
        Sensitive:
            description: "needs confirmation"
            target: "fn://sensitive"
            require_user_confirmation: True
        Plain:
            description: "no confirmation"
            target: "fn://plain"

    reasoning:
        instructions: ->
            | do it
        actions:
            do_sensitive: @actions.Sensitive
            do_plain: @actions.Plain
`;
  const { output, diagnostics } = compileSource(SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(
    errors.length === 0,
    'require_user_confirmation (parallel): agent compiles cleanly'
  );

  let sensitiveCalled = false;
  const fn = new FnAdapter();
  fn.register('sensitive', () => {
    sensitiveCalled = true;
    return { ok: true };
  });
  fn.register('plain', () => ({ ok: true }));
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  const seen = [];
  const runtime = new Runtime({
    doc: output,
    llm: new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'do_sensitive', arguments: {} },
          { id: 'c2', name: 'do_plain', arguments: {} },
        ],
      },
      { text: 'Done' },
    ]),
    tools,
    parallel: { strategy: 'always' },
    middleware: [
      {
        name: 'gate',
        beforeToolCall(ctx) {
          seen.push({
            target: ctx.target,
            requireConfirmation: ctx.requireConfirmation,
          });
          if (ctx.requireConfirmation) {
            return { abort: { result: { error: 'confirmation required' } } };
          }
        },
      },
    ],
  });

  await runtime.turn('go');
  assert(
    !sensitiveCalled,
    'require_user_confirmation (parallel): sensitive adapter never invoked'
  );
  assert(
    seen.some(
      s => s.target === 'fn://sensitive' && s.requireConfirmation === true
    ),
    'require_user_confirmation (parallel): middleware saw the flag on the isolated-dispatch path'
  );
}

async function main() {
  console.log('--- require_user_confirmation ---');
  await testRequireConfirmation();
  console.log('--- post_tool_call ---');
  await testPostToolCall();
  console.log('--- pre_tool_call ---');
  await testPreToolCall();
  console.log('--- require_user_confirmation (parallel dispatch) ---');
  await testRequireConfirmationParallel();
  console.log('\nAll live smoke checks passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
