#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Example — require_user_confirmation: gate a sensitive tool call
 * ─────────────────────────────────────────────────────────────────────────
 *
 * An agent author marks an action `require_user_confirmation: True` in the
 * `.agent` DSL. The compiler carries that flag through to the action
 * definition; the runtime surfaces it to `beforeToolCall` middleware as
 * `ctx.requireConfirmation` — it does NOT pause or prompt anyone itself. It
 * is purely informational: a host middleware decides what "confirmation"
 * means (ask a human, check a policy, consult an approval queue, ...) and
 * can `abort` the call before the tool ever runs.
 *
 * This example wires a support-bot agent with one sensitive action
 * (`Refund_Order`) and one plain one (`Lookup_Order`), and a middleware that
 * blocks any call flagged `requireConfirmation`. It proves the gate holds on
 * BOTH tool-dispatch paths the runtime has — sequential and parallel — since
 * they are two independently-wired call sites in `runtime.ts`.
 *
 * Run:  pnpm --filter @agentscript/runtime example:confirmation
 */

import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import type { Middleware } from '../src/index.js';
import { ScriptedLlm } from './_shared/scripted-llm.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const SUPPORT_BOT = `
system:
    instructions: "You are a customer support assistant."

config:
    agent_name: "SupportBot"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "Handles order lookups and refunds"

    actions:
        Lookup_Order:
            description: "Look up an order's status"
            target: "fn://lookup_order"
        Refund_Order:
            description: "Issue a refund for an order"
            target: "fn://refund_order"
            require_user_confirmation: True

    reasoning:
        instructions: ->
            | Help the customer with their order.
        actions:
            lookup: @actions.Lookup_Order
            refund: @actions.Refund_Order
`;

function buildTools() {
  let refundCalled = false;
  const fn = new FnAdapter();
  fn.register('lookup_order', () => ({ status: 'shipped' }));
  fn.register('refund_order', () => {
    refundCalled = true;
    return { confirmation: 'refunded' };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return { tools, refundCalled: () => refundCalled };
}

/** The confirmation gate: block anything the compiled IR flagged as sensitive. */
const confirmationGate: Middleware = {
  name: 'confirmation-gate',
  beforeToolCall(ctx) {
    if (ctx.requireConfirmation) {
      console.log(
        `  [middleware] ⚠ blocking "${ctx.toolName}" — requires user confirmation`
      );
      return { abort: { result: { error: 'confirmation required' } } };
    }
  },
};

async function main() {
  console.log('=== require_user_confirmation ===\n');

  const { output: doc, diagnostics } = compileSource(SUPPORT_BOT);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(errors.length === 0, 'SupportBot agent compiles cleanly');

  // --- Turn 1: a plain lookup — proceeds normally, no gate involved.
  console.log('\n--- turn 1: plain lookup ---');
  const scenario1 = buildTools();
  const runtime1 = new Runtime({
    doc,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'lookup', arguments: {} }] },
      { text: 'Your order has shipped.' },
    ]),
    tools: scenario1.tools,
    middleware: [confirmationGate],
  });
  const result1 = await runtime1.turn('Where is my order?');
  console.log(`  assistant: "${result1.assistantText.trim()}"`);
  assert(true, 'lookup call proceeded without any confirmation prompt');

  // --- Turn 2: a refund — the gate intercepts it before the adapter runs.
  console.log('\n--- turn 2: refund (sequential dispatch) ---');
  const scenario2 = buildTools();
  const runtime2 = new Runtime({
    doc,
    llm: new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'refund', arguments: {} }] },
      { text: 'I could not process the refund without confirmation.' },
    ]),
    tools: scenario2.tools,
    middleware: [confirmationGate],
  });
  const result2 = await runtime2.turn('Please refund my order.');
  console.log(`  assistant: "${result2.assistantText.trim()}"`);
  assert(!scenario2.refundCalled(), 'refund_order adapter was never invoked');

  // --- Turn 3: both calls at once, forced onto the PARALLEL dispatch path —
  // proves the flag surfaces identically on that second, separately-wired
  // code site (`dispatchToolCallIsolated`), not just the sequential one.
  console.log('\n--- turn 3: lookup + refund together (parallel dispatch) ---');
  const scenario3 = buildTools();
  const runtime3 = new Runtime({
    doc,
    llm: new ScriptedLlm([
      {
        toolCalls: [
          { id: 'c1', name: 'lookup', arguments: {} },
          { id: 'c2', name: 'refund', arguments: {} },
        ],
      },
      { text: 'Here is the status; the refund needs confirmation.' },
    ]),
    tools: scenario3.tools,
    middleware: [confirmationGate],
    parallel: { strategy: 'always' },
  });
  const result3 = await runtime3.turn('Check my order and refund it.');
  console.log(`  assistant: "${result3.assistantText.trim()}"`);
  assert(
    !scenario3.refundCalled(),
    'refund_order was blocked on the parallel dispatch path too'
  );

  console.log('\nAll require_user_confirmation checks passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
