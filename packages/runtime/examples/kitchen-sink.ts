#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * Example — kitchen sink: most of the runtime's features, one agent
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A "Travel Concierge" agent that touches most of what `@agentscript/
 * runtime` can do, wired together the way a real integration would combine
 * them rather than as isolated snippets:
 *
 *   • Check_Weather   → delegate://weather_agent   (delegation-as-tool)
 *   • Book_Flight     → require_user_confirmation + a nested
 *                       `run @actions.Log_Booking` (post_tool_call)
 *   • Cancel_Booking  → a pre_tool_call hook that hands off to an
 *                       `escalation` node instead of letting the
 *                       cancellation run at all
 *   • middleware      → a beforeToolCall confirmation gate and an
 *                       afterToolCall audit logger, so the "compiled hook
 *                       vs. host middleware" distinction stays concrete
 *   • guardrails + structuredOutput → the trip summary turn is forced
 *                       through a JSON Schema guardrail with
 *                       exhaustionPolicy: 'last-response'
 *   • tracing         → an InMemorySpanExporter captures the span tree for
 *                       the whole run
 *   • checkpoint/restore → after booking, the runtime is checkpointed,
 *                       thrown away, and rebuilt via Runtime.fromCheckpoint
 *                       to simulate a process restart mid-conversation
 *
 * Deliberately NOT covered here: background subagents and swarm fan-out.
 * Both are real runtime features, but folding them into this same example
 * would trade readability for coverage without teaching anything new about
 * this PR's actual subject (confirmation + tool hooks). See the focused
 * `require-confirmation.ts` / `tool-hooks.ts` examples for those two, and
 * the test suite (`background-*.test.ts`, `swarm-*.test.ts`) for the rest.
 *
 * Run:  pnpm --filter @agentscript/runtime example:kitchen-sink
 */

import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  MemoryCheckpointStore,
  InMemorySpanExporter,
  jsonSchemaGuardrail,
} from '../src/index.js';
import type { Middleware, RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './_shared/scripted-llm.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const CONCIERGE = `
system:
    instructions: "You are a travel concierge."

config:
    agent_name: "TravelConcierge"
    default_agent_user: "bot@example.com"

variables:
    booking_log: mutable string = ""
        description: "records booking audit entries"

start_agent main:
    description: "Books trips, checking weather and confirming sensitive actions"

    actions:
        Check_Weather:
            description: "Check the weather at a destination"
            inputs:
                destination: string
                    description: "City to check"
            outputs:
                result: string
                    description: "Weather report"
            target: "delegate://weather_agent"
        Book_Flight:
            description: "Book a flight"
            target: "fn://book_flight"
            require_user_confirmation: True
        Log_Booking:
            description: "Record a booking audit entry"
            target: "fn://log_booking"
        Cancel_Booking:
            description: "Cancel a booking"
            target: "fn://cancel_booking"

    reasoning:
        instructions: ->
            | Help the traveler plan and book their trip.
        actions:
            check_weather: @actions.Check_Weather
                with destination=...
            book: @actions.Book_Flight
                run @actions.Log_Booking
                    set @variables.booking_log = "booking logged"
            cancel: @actions.Cancel_Booking
subagent weather_agent:
    description: "Reports weather for a destination"
    reasoning:
        instructions: ->
            | Report the weather for the requested destination.
subagent escalation:
    description: "Escalated to a human before cancelling a booking"
    reasoning:
        instructions: ->
            | This cancellation needs a human to look at it.
`;

function compileAgent() {
  const { output, diagnostics } = compileSource(CONCIERGE);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  assert(errors.length === 0, 'TravelConcierge agent compiles cleanly');

  // No compiler producer for pre_tool_call yet — set it directly on the
  // compiled node, same technique as `tool-hooks.ts` / `test/pre-tool-call.test.ts`.
  const mainNode = output.agent_version.nodes.find(
    (n: { developer_name: string }) => n.developer_name === 'main'
  ) as { pre_tool_call?: unknown };
  mainNode.pre_tool_call = [
    {
      target: 'Cancel_Booking',
      actions: [{ type: 'handoff', target: 'escalation' }],
    },
  ];

  return output;
}

function buildTools() {
  let bookCalled = false;
  let cancelCalled = false;
  const auditTrail: string[] = [];
  const fn = new FnAdapter();
  fn.register('book_flight', () => {
    bookCalled = true;
    return { confirmation: 'BK-100' };
  });
  fn.register('log_booking', () => ({ ok: true }));
  fn.register('cancel_booking', () => {
    cancelCalled = true;
    return { ok: true };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return {
    tools,
    auditTrail,
    bookCalled: () => bookCalled,
    cancelCalled: () => cancelCalled,
  };
}

/** Blocks any tool call the compiled IR flagged `require_user_confirmation`. */
const confirmationGate: Middleware = {
  name: 'confirmation-gate',
  beforeToolCall(ctx) {
    if (ctx.requireConfirmation) {
      console.log(
        `  [middleware] ⚠ blocking "${ctx.toolName}" — needs confirmation`
      );
      return { abort: { result: { error: 'confirmation required' } } };
    }
  },
};

function makeAuditLogger(trail: string[]): Middleware {
  return {
    name: 'audit-logger',
    afterToolCall(ctx) {
      trail.push(`${ctx.toolName} -> ${JSON.stringify(ctx.result)}`);
    },
  };
}

const TRIP_SUMMARY_SCHEMA = {
  type: 'object',
  required: ['destination', 'status'],
  properties: {
    destination: { type: 'string' },
    status: { type: 'string' },
  },
};

async function main() {
  console.log('=== kitchen sink: Travel Concierge ===');

  const doc = compileAgent();
  const exporter = new InMemorySpanExporter();
  const scenario = buildTools();

  // --- Turn 1: book a flight. Confirmation blocks it; weather check and
  // audit logging both run, so the two hook mechanisms sit side by side.
  console.log(
    '\n--- turn 1: check weather, then attempt to book (blocked by confirmation) ---'
  );
  const llm1 = new ScriptedLlm([
    {
      toolCalls: [
        {
          id: 'c1',
          name: 'check_weather',
          arguments: { destination: 'Lisbon' },
        },
      ],
    },
    { text: 'Sunny in Lisbon.' },
  ]);
  const runtime1 = new Runtime({
    doc,
    llm: llm1,
    tools: scenario.tools,
    middleware: [confirmationGate, makeAuditLogger(scenario.auditTrail)],
    tracing: { enabled: true, exporter },
  });
  const events1: RuntimeEvent[] = [];
  runtime1.on(e => events1.push(e));

  const result1 = await runtime1.turn('What is the weather like in Lisbon?');
  console.log(`  assistant: "${result1.assistantText.trim()}"`);
  assert(
    result1.finalNode === 'main',
    'delegation-as-tool returned control to main'
  );
  assert(
    scenario.auditTrail.some(e => e.startsWith('check_weather')),
    'afterToolCall audit logger recorded the delegated weather check'
  );

  // --- Checkpoint after turn 1, then restore into a brand-new Runtime,
  // simulating a process restart mid-conversation.
  console.log(
    '\n--- checkpoint after turn 1, restore into a fresh runtime ---'
  );
  const cp = runtime1.checkpoint({ id: 'trip-1' });
  const store = new MemoryCheckpointStore();
  await store.save(cp);
  const loaded = await store.load(cp.id);
  assert(
    loaded !== null,
    'checkpoint round-tripped through MemoryCheckpointStore'
  );

  const llm2 = new ScriptedLlm([
    { toolCalls: [{ id: 'c2', name: 'book', arguments: {} }] },
    { text: 'I could not book without confirmation.' },
  ]);
  const runtime2 = Runtime.fromCheckpoint(
    {
      doc,
      llm: llm2,
      tools: scenario.tools,
      middleware: [confirmationGate, makeAuditLogger(scenario.auditTrail)],
    },
    loaded!
  );
  assert(
    runtime2.currentNodeName === cp.currentNode,
    'restored runtime resumed on the same node the checkpoint captured'
  );

  // --- Turn 2 on the restored runtime: booking is blocked by the
  // confirmation gate, so Log_Booking's post_tool_call chain never fires.
  const result2 = await runtime2.turn('Book the flight.');
  console.log(`  assistant: "${result2.assistantText.trim()}"`);
  assert(
    !scenario.bookCalled(),
    'book_flight adapter was never invoked — confirmation blocked it'
  );
  assert(
    runtime2.state.get('booking_log') === '',
    'post_tool_call chain (Log_Booking) never ran, since the tool call itself was aborted'
  );

  // --- Turn 3: cancel — pre_tool_call escalates to a human before the tool
  // call or beforeToolCall middleware ever see it.
  console.log(
    '\n--- turn 3: cancel a booking (pre-empted by pre_tool_call) ---'
  );
  const llm3 = new ScriptedLlm([
    { toolCalls: [{ id: 'c3', name: 'cancel', arguments: {} }] },
  ]);
  const runtime3 = new Runtime({
    doc,
    llm: llm3,
    tools: scenario.tools,
    middleware: [confirmationGate, makeAuditLogger(scenario.auditTrail)],
  });
  const result3 = await runtime3.turn('Cancel my booking.');
  assert(
    !scenario.cancelCalled(),
    'cancel_booking adapter was never invoked — pre_tool_call pre-empted it'
  );
  assert(
    result3.finalNode === 'escalation',
    'the turn handed off to the escalation node'
  );

  // --- Turn 4: a structured trip summary, enforced by a JSON Schema
  // guardrail with a graceful exhaustion policy.
  console.log(
    '\n--- turn 4: structured trip summary (guardrails + structuredOutput) ---'
  );
  const llm4 = new ScriptedLlm([
    { text: '{"destination": "Lisbon", "status": "planned"}' },
  ]);
  const runtime4 = new Runtime({
    doc,
    llm: llm4,
    tools: scenario.tools,
    guardrails: [
      jsonSchemaGuardrail({
        schema: TRIP_SUMMARY_SCHEMA,
        name: 'trip-summary',
      }),
    ],
    exhaustionPolicy: 'last-response',
    structuredOutput: { schema: TRIP_SUMMARY_SCHEMA, strategy: 'native' },
  });
  const result4 = await runtime4.turn('Summarize the trip so far.');
  assert(
    result4.parsed !== undefined && result4.parsed.valid,
    'trip summary parsed as valid structured output'
  );
  assert(
    JSON.stringify(result4.parsed!.data) ===
      JSON.stringify({ destination: 'Lisbon', status: 'planned' }),
    'structured output matched the schema-enforced shape'
  );

  // --- Tracing: print the span tree captured across turn 1.
  console.log('\n--- captured spans (turn 1) ---');
  const spans = exporter.getSpans();
  assert(spans.length > 0, 'tracing captured at least one span');
  for (const span of spans) {
    console.log(`  ${span.name} [${span.status}]`);
  }

  console.log('\nAll kitchen-sink checks passed.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
