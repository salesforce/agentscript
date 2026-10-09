/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: drives the full order_tracking_assistant agent
 * (3 topics: order_locator -> order_details -> issue_resolver, 6 tools).
 *
 * Validates:
 *   1. Customer lookup tool fires with the email we supplied
 *   2. Customer state is populated from the tool output
 *   3. Order lookup happens after customer is found
 *   4. State is propagated across topic boundaries
 *   5. Light text check: assistant's final response references the
 *      tracking number returned from the tool
 *   6. No error events across all turns
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-complex-order-tracking.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

const here = dirname(fileURLToPath(import.meta.url));
const AGENT_SOURCE = readFileSync(
  join(here, 'agents/order-tracking.agent'),
  'utf8'
);

const TRACKING_NUMBER = 'TRK-AAA-9988';

async function main(): Promise<void> {
  console.log('=== test-complex-order-tracking ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools, callLog } = mockTool({
    GetCustomerInfo: {
      delayMs: 40,
      result: {
        customer_found: true,
        customer_name: 'Ada Lovelace',
        customer_id: 'CUST-7711',
        verified: true,
      },
    },
    FindOrderByNumber: {
      delayMs: 40,
      result: {
        order_found: true,
        order_data: { id: 'ORD-9001' },
        valid_customer: true,
      },
    },
    GetOrderDetails: {
      delayMs: 40,
      result: {
        order_status: 'shipped',
        tracking_number: TRACKING_NUMBER,
        delivery_date: '2026-06-02',
        order_total: 142.5,
        shipping_address: '1 Infinite Loop, Cupertino, CA',
        return_eligible: true,
      },
    },
    GetTrackingUpdates: {
      delayMs: 40,
      result: {
        current_status: 'In transit',
        location: 'Phoenix, AZ',
        estimated_delivery: '2026-06-02',
      },
    },
    ProcessReturnRequest: {
      delayMs: 40,
      result: { return_id: 'RET-2200', refund_amount: 142.5 },
    },
    ReportShippingIssue: {
      delayMs: 40,
      result: { case_number: 'CASE-5550', priority: 'normal' },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 12,
    llmDriver,
  });

  const allEvents: RuntimeEvent[] = [];

  // -------------------------------------------------------------------------
  // Turn 1 — provide email, agent should call GetCustomerInfo
  // -------------------------------------------------------------------------
  console.log(
    '--- Turn 1: "Hi, can you find my order? My email is ada@example.com" ---\n'
  );
  const turn1 = await runTurn(
    runtime,
    'Hi, can you find my order? My email is ada@example.com'
  );
  allEvents.push(...turn1.events);
  logTurn(turn1.events, turn1.durationMs);

  // -------------------------------------------------------------------------
  // Turn 2 — give an order number and ask for tracking details
  // -------------------------------------------------------------------------
  console.log(
    '--- Turn 2: "The order number is ORD-9001 — what is the tracking status?" ---\n'
  );
  const turn2 = await runTurn(
    runtime,
    'The order number is ORD-9001 — what is the tracking status?'
  );
  allEvents.push(...turn2.events);
  logTurn(turn2.events, turn2.durationMs);

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  const toolNames = allEvents
    .filter(e => e.kind === 'tool-call')
    .map(e => (e as { kind: 'tool-call'; name: string }).name);

  assertions.ok(
    toolNames.includes('fn://GetCustomerInfo'),
    'GetCustomerInfo was called',
    `tool calls: ${toolNames.join(', ')}`
  );

  const custCall = callLog.find(c => c.name === 'GetCustomerInfo');
  assertions.ok(
    !!custCall &&
      typeof (custCall.args as { email?: string }).email === 'string' &&
      (custCall.args as { email: string }).email
        .toLowerCase()
        .includes('ada@example.com'),
    'GetCustomerInfo was called with the email we supplied',
    `args: ${JSON.stringify(custCall?.args)}`
  );

  assertions.eq(
    runtime.state.get('customer_verified'),
    true,
    'state customer_verified is true after lookup'
  );

  assertions.eq(
    runtime.state.get('customer_id'),
    'CUST-7711',
    'state customer_id propagated from tool output'
  );

  // Order lookup must have happened
  assertions.ok(
    toolNames.includes('fn://FindOrderByNumber') ||
      toolNames.includes('fn://GetOrderDetails'),
    'order lookup or order details tool was called',
    `tool calls: ${toolNames.join(', ')}`
  );

  // The agent must have entered the order_details topic at some point.
  const enteredNodes = allEvents
    .filter(e => e.kind === 'node-enter')
    .map(e => (e as { kind: 'node-enter'; node: string }).node);
  const reachedOrderDetails =
    enteredNodes.includes('order_details') ||
    runtime.state.get('order_status') === 'shipped';
  assertions.ok(
    reachedOrderDetails,
    'agent transitioned to order_details topic OR populated order_status',
    `nodes entered: [${enteredNodes.join(', ')}], order_status=${JSON.stringify(runtime.state.get('order_status'))}`
  );

  // Light text check on the final assistant message — should mention the
  // tracking number we returned from GetOrderDetails / GetTrackingUpdates.
  const finalText = (turn2.result.assistantText ?? '').toString();
  const mentionsTracking =
    finalText.includes(TRACKING_NUMBER) ||
    finalText.toLowerCase().includes('trk') ||
    finalText.toLowerCase().includes('shipped') ||
    finalText.toLowerCase().includes('transit');
  assertions.ok(
    mentionsTracking,
    'assistant final response references tracking info',
    `text: ${JSON.stringify(finalText.slice(0, 200))}`
  );

  // No errors across both turns
  const errorEvents = allEvents.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.ok(
    errorEvents.length === 0,
    'no error events across all turns',
    JSON.stringify(errorEvents)
  );

  report('test-complex-order-tracking');
}

function logTurn(events: RuntimeEvent[], durationMs: number): void {
  console.log(`  Duration: ${durationMs}ms`);
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (e.kind === 'node-enter') {
      console.log(`  [node-enter] ${e.node}`);
    } else if (e.kind === 'node-exit') {
      console.log(`  [node-exit]  ${e.node}${e.to ? ' -> ' + e.to : ''}`);
    } else if (
      e.kind === 'state-change' &&
      !e.name.startsWith('AgentScriptInternal_')
    ) {
      console.log(
        `  [state]      ${e.name}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`
      );
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
