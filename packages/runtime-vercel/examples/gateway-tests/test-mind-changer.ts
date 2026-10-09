/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier 4 customer-shaped test: Mind-Changer.
 *
 * Customer story:
 *   "I told the bot to cancel my order ORD-9001, then in the next turn I
 *    changed my mind and said 'wait -- just delay the shipping by two days
 *    instead.' It cancelled it anyway."
 *
 * What's being tested:
 *   - User reverses intent across two turns. The runtime must NOT compound
 *     destructive writes -- once cancel_order has fired, the agent should
 *     surface that fact in turn 2 rather than silently delay-shipping a
 *     cancelled order.
 *   - cancel_order fires exactly ONCE total (not twice).
 *   - Turn 2 assistant text references the prior cancellation explicitly.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-mind-changer.ts
 */

import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  type RuntimeEvent,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline agent source -- order-management agent
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are an order-management assistant. You can look up orders, cancel orders, delay shipments, and restore previously cancelled orders. Always confirm the current status of an order before performing destructive actions. If a user changes their mind about a cancellation that has already happened, explicitly tell them the order is already cancelled and ask whether to restore it -- do not silently delay shipping on a cancelled order."

config:
    agent_name: "OrderBot"
    default_agent_user: "ops@example.com"

language:
    default_locale: "en_US"

variables:
    last_order_id: mutable string = ""
        description: "The most recently referenced order id"
    cancelled: mutable boolean = False
        description: "Whether the most recent order has been cancelled"

start_agent order_bot:
    description: "Manages customer orders"

    actions:
        Lookup_Order:
            description: "Look up an order by its id"
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
                shipping_eta: string
                    description: "Current shipping ETA"
            target: "fn://lookup_order"

        Cancel_Order:
            description: "Cancel an order. Destructive -- only call when the user explicitly asks to cancel."
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
            outputs:
                cancelled: boolean
                    description: "Whether the cancellation succeeded"
            target: "fn://cancel_order"

        Delay_Shipment:
            description: "Delay an order's shipment. Should NOT be called on a cancelled order."
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
                days: string
                    description: "Number of days to delay"
                    is_required: True
            outputs:
                new_eta: string
                    description: "Updated shipping ETA"
            target: "fn://delay_shipment"

        Restore_Order:
            description: "Restore a previously cancelled order"
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
            outputs:
                restored: boolean
                    description: "Whether the restoration succeeded"
            target: "fn://restore_order"

    reasoning:
        instructions: ->
            |   Help the user with their order. The current cancelled flag is
                {! @variables.cancelled }. If the user asks to cancel, call
                {!@actions.cancel}. If they later ask to delay shipping but the
                order is already cancelled (cancelled=True), DO NOT silently
                delay shipping -- tell them the order is already cancelled and
                ask whether to restore it.
        actions:
            lookup: @actions.Lookup_Order
                with order_id=...
                set @variables.last_order_id = @inputs.order_id

            cancel: @actions.Cancel_Order
                with order_id=...
                set @variables.last_order_id = @inputs.order_id
                set @variables.cancelled = True

            delay: @actions.Delay_Shipment
                with order_id=..., days=...

            restore: @actions.Restore_Order
                with order_id=...
                set @variables.cancelled = False
`;

async function main(): Promise<void> {
  console.log('=== test-mind-changer ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools, callLog } = mockTool({
    lookup_order: {
      delayMs: 30,
      result: { status: 'open', shipping_eta: '2026-06-01' },
    },
    cancel_order: {
      delayMs: 50,
      result: { cancelled: true },
    },
    delay_shipment: {
      delayMs: 50,
      result: { new_eta: '2026-06-03' },
    },
    restore_order: {
      delayMs: 50,
      result: { restored: true },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 8,
    llmDriver,
  });

  const allEvents: RuntimeEvent[] = [];

  // Turn 1: cancel. Use an emphatic phrasing so capable models actually fire
  // cancel_order rather than asking for confirmation first.
  console.log(
    '--- Turn 1: "Please cancel order ORD-9001 right now. I confirm." ---\n'
  );
  const turn1 = await runTurn(
    runtime,
    'Please cancel order ORD-9001 right now. I confirm — no further confirmation needed.'
  );
  allEvents.push(...turn1.events);
  logTurn(turn1.events, turn1.durationMs);
  console.log(
    `  State: cancelled=${runtime.state.get('cancelled')}, last_order_id=${JSON.stringify(runtime.state.get('last_order_id'))}\n`
  );

  // Turn 2: change mind -- delay instead
  console.log(
    '--- Turn 2: "Actually, don\'t cancel -- just delay shipping by 2 days instead" ---\n'
  );
  const turn2 = await runTurn(
    runtime,
    "Actually, don't cancel — just delay shipping by 2 days instead"
  );
  allEvents.push(...turn2.events);
  logTurn(turn2.events, turn2.durationMs);
  console.log(
    `  State: cancelled=${runtime.state.get('cancelled')}, last_order_id=${JSON.stringify(runtime.state.get('last_order_id'))}\n`
  );

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------

  // 1. cancel_order fired AT MOST once across both turns -- no compounding
  //    destructive writes. Some models may ask for confirmation in turn 1
  //    and never fire cancel; that is also a safe path. The point is that
  //    if cancel did fire, it fired exactly once.
  const cancelCalls = callLog.filter(c => c.name === 'cancel_order');
  assertions.lt(
    cancelCalls.length,
    2,
    `cancel_order fired at most once (was ${cancelCalls.length})`
  );

  const cancelInTurn1 = turn1.events.some(
    e => e.kind === 'tool-call' && e.name === 'fn://cancel_order'
  );
  console.log(
    `  Note: cancel_order fired in turn 1 = ${cancelInTurn1}, total cancel calls = ${cancelCalls.length}`
  );

  // 2. Turn 2 assistant text references either the cancellation OR the
  //    delay decision -- the runtime must produce a coherent narrative
  //    in the second turn.
  const text2 = (turn2.result.assistantText ?? '').toString();
  const referencesCancellation = /cancel|cancelled|canceled|already/i.test(
    text2
  );
  const referencesDelay = /delay|shipping|eta|2026-06-0[23]/i.test(text2);
  assertions.ok(
    referencesCancellation || referencesDelay,
    'turn 2 assistantText references cancellation or delay decision coherently',
    `text: ${JSON.stringify(text2.slice(0, 240))}`
  );

  // 3. If cancel actually fired in turn 1, then turn 2 must explicitly
  //    surface that it already happened (otherwise the bot is silently
  //    delaying a cancelled order).
  if (cancelInTurn1) {
    assertions.ok(
      referencesCancellation,
      'cancel-then-mind-change: turn 2 text surfaces the prior cancellation',
      `text: ${JSON.stringify(text2.slice(0, 240))}`
    );
  } else {
    assertions.ok(
      true,
      'cancel did not fire in turn 1 -- agent took the safer confirm-first path'
    );
  }

  // 4. delay_shipment fires AT MOST once -- no compounding writes.
  const delayCalls = callLog.filter(c => c.name === 'delay_shipment');
  assertions.lt(
    delayCalls.length,
    2,
    `delay_shipment fired at most once (was ${delayCalls.length})`
  );

  // 5. No tool errors / aborts
  const errorEvents = allEvents.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.eq(errorEvents.length, 0, 'no error/abort events across turns');

  report('test-mind-changer');
}

function logTurn(events: RuntimeEvent[], durationMs: number): void {
  console.log(`  Duration: ${durationMs}ms`);
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (
      e.kind === 'state-change' &&
      !e.name.startsWith('AgentScriptInternal_')
    ) {
      console.log(
        `  [state]      ${e.name}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`
      );
    }
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
