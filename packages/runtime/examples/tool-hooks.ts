#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Example — pre_tool_call / post_tool_call: hooks around a tool dispatch
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Two hook points sit around every tool call a node makes, keyed by the
 * tool's target:
 *
 *   • post_tool_call — runs AFTER the tool succeeds, with the tool's own
 *     result available under `result.*`. Compiled today whenever a `.agent`
 *     file nests a `run @actions.X` inside a reasoning action's body — no
 *     hand-built IR needed, this is a real DSL construct.
 *
 *   • pre_tool_call — runs BEFORE the tool executes and BEFORE any
 *     `beforeToolCall` middleware. If it hands off, the tool call and
 *     middleware never happen at all. The compiler doesn't have a `.agent`
 *     surface for this yet (schema-only as of compiler 2.6.9), so this
 *     example builds it the same way the test suite does: compile normally,
 *     then set `node.pre_tool_call` directly on the compiled output before
 *     constructing the `Runtime`. The runtime-side mechanism is identical
 *     to post_tool_call, just triggered earlier — this is a preview of what
 *     the DSL will look like once the compiler catches up.
 *
 * This example wires one agent with both: looking up an order auto-logs an
 * audit entry afterward (post_tool_call chains work on success); cancelling
 * one is intercepted beforehand and escalated to a human-review node instead
 * of running at all (pre_tool_call pre-empts the call entirely). Side by
 * side, they show the two hook points are complementary, not redundant.
 *
 * Run:  pnpm --filter @agentscript/runtime example:hooks
 */

import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './_shared/scripted-llm.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const SRC = `
system:
    instructions: "bot"

config:
    agent_name: "HooksBot"
    default_agent_user: "bot@example.com"

variables:
    audit_log: mutable string = ""
        description: "records audit trail entries"

start_agent main:
    description: "main"

    actions:
        Lookup_Order:
            description: "Look up an order's status"
            target: "fn://lookup_order"
        Log_Audit:
            description: "Record an audit trail entry"
            target: "fn://log_audit"
        Cancel_Order:
            description: "Cancel an order"
            target: "fn://cancel_order"

    reasoning:
        instructions: ->
            | do it
        actions:
            lookup: @actions.Lookup_Order
                run @actions.Log_Audit
                    set @variables.audit_log = "lookup logged"
            cancel: @actions.Cancel_Order
subagent human_review:
    description: "Escalated to a human reviewer before cancelling"
    reasoning:
        instructions: ->
            | This cancellation needs a human to look at it.
`;

function compileAgent() {
  const { output, diagnostics } = compileSource(SRC);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(errors.length === 0, 'HooksBot agent compiles cleanly');

  // No compiler producer for pre_tool_call yet — set it directly on the
  // compiled node, exactly like `test/pre-tool-call.test.ts` does. `target`
  // matches the tool's pre-resolution developer_name ("Cancel_Order"), the
  // same key post_tool_call already uses for the real, compiler-emitted case.
  const mainNode = output.agent_version.nodes.find(
    (n: { developer_name: string }) => n.developer_name === 'main'
  ) as { pre_tool_call?: unknown };
  mainNode.pre_tool_call = [
    {
      target: 'Cancel_Order',
      actions: [{ type: 'handoff', target: 'human_review' }],
    },
  ];

  return output;
}

function buildTools() {
  let cancelCalled = false;
  const fn = new FnAdapter();
  fn.register('lookup_order', () => ({ status: 'in transit' }));
  fn.register('log_audit', () => ({ ok: true }));
  fn.register('cancel_order', () => {
    cancelCalled = true;
    return { ok: true };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return { tools, cancelCalled: () => cancelCalled };
}

async function main() {
  console.log('=== pre_tool_call / post_tool_call hooks ===');

  const doc = compileAgent();

  // --- post_tool_call: looking up an order auto-logs an audit entry ---
  console.log(
    '\n--- post_tool_call: audit logging after a successful lookup ---'
  );
  const scenario1 = buildTools();
  const runtime1 = new Runtime({
    doc,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'lookup', arguments: {} }] },
      { text: 'Your order is in transit.' },
    ]),
    tools: scenario1.tools,
  });
  const events1: RuntimeEvent[] = [];
  runtime1.on(e => events1.push(e));

  const result1 = await runtime1.turn('Where is my order?');
  console.log(`  assistant: "${result1.assistantText.trim()}"`);
  assert(
    runtime1.state.get('audit_log') === 'lookup logged',
    'post_tool_call wrote the audit log entry after the lookup succeeded'
  );
  assert(
    events1.some(e => e.kind === 'phase-start' && e.phase === 'post_tool_call'),
    'a post_tool_call phase-start event was emitted'
  );

  // --- pre_tool_call: cancelling is intercepted BEFORE it runs ---
  console.log('\n--- pre_tool_call: escalate before the cancellation runs ---');
  const scenario2 = buildTools();
  const runtime2 = new Runtime({
    doc,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'cancel', arguments: {} }] },
    ]),
    tools: scenario2.tools,
  });
  const events2: RuntimeEvent[] = [];
  runtime2.on(e => events2.push(e));

  const result2 = await runtime2.turn('Cancel my order.');
  assert(
    !scenario2.cancelCalled(),
    'cancel_order adapter was never invoked — pre_tool_call pre-empted it'
  );
  assert(
    result2.finalNode === 'human_review',
    'the turn handed off to the human_review node before the tool ran'
  );
  assert(
    events2.some(e => e.kind === 'phase-start' && e.phase === 'pre_tool_call'),
    'a pre_tool_call phase-start event was emitted'
  );

  console.log('\nAll pre_tool_call / post_tool_call checks passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
