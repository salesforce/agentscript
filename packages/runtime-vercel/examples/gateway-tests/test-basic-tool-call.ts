/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: basic tool call, argument validation, state mutation.
 *
 * Validates:
 *   1. The LLM calls `lookup_order` when the user asks about an order
 *   2. The tool receives args containing the order number "ORD-123"
 *   3. State variable `order_status` is updated to "shipped" from tool output
 *   4. No errors emitted during the turn
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-basic-tool-call.ts
 */

import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline agent source
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are an order tracking assistant. When the user gives an order number, call the lookup_order tool immediately."

config:
    agent_name: "OrderLookupTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    order_status: mutable string = ""
        description: "Status returned by the lookup tool"

start_agent order_bot:
    description: "Looks up order status on demand"

    actions:
        Lookup_Order:
            description: "Look up an order by its number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
                tracking: string
                    description: "Tracking number"
            target: "fn://lookup_order"

    reasoning:
        instructions: ->
            |   The user wants to check an order. Call {!@actions.lookup}
                with the order number they provide. Report the result.
        actions:
            lookup: @actions.Lookup_Order
                with order_number=...
                set @variables.order_status = @outputs.status
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-basic-tool-call ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Mock tool: lookup_order with 150ms delay
  const { tools, callLog } = mockTool({
    lookup_order: {
      delayMs: 150,
      result: { status: 'shipped', tracking: 'TRK-9876' },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 10,
    llmDriver,
  });

  // -------------------------------------------------------------------------
  // Run turn
  // -------------------------------------------------------------------------
  console.log("> user: What's the status of order ORD-123?\n");

  const capture = await runTurn(runtime, "What's the status of order ORD-123?");

  console.log(`  Duration: ${capture.durationMs}ms`);
  console.log(`  Final node: ${capture.result.finalNode}`);

  // Log captured events for diagnostics
  for (const e of capture.events) {
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
    } else if (e.kind === 'tool-error') {
      console.log(`  [tool-err]   ${e.name}: ${e.error}`);
    }
  }
  console.log('');

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------

  // 1. lookup_order was called (tool-call events use the resolved target: fn://lookup_order)
  const toolCallEvents = capture.events.filter(e => e.kind === 'tool-call');
  const lookupCalled = toolCallEvents.some(
    e => e.kind === 'tool-call' && e.name === 'fn://lookup_order'
  );
  assertions.ok(
    lookupCalled,
    'lookup_order was called',
    `tool-call events: ${toolCallEvents.map(e => (e.kind === 'tool-call' ? e.name : '')).join(', ') || '(none)'}`
  );

  // 2. lookup_order received args containing "ORD-123"
  //    Check the callLog (which logs actual fn:// handler invocations)
  const lookupInvocations = callLog.filter(c => c.name === 'lookup_order');
  const argsContainOrderNumber = lookupInvocations.some(c => {
    const args = c.args as Record<string, unknown>;
    const orderNum = args.order_number;
    return typeof orderNum === 'string' && orderNum.includes('ORD-123');
  });
  assertions.ok(
    argsContainOrderNumber,
    'lookup_order called with order_number containing "ORD-123"',
    `invocations: ${JSON.stringify(lookupInvocations.map(c => c.args))}`
  );

  // 3. State order_status equals "shipped"
  const orderStatus = runtime.state.get('order_status');
  assertions.eq(orderStatus, 'shipped', 'state order_status equals "shipped"');

  // 4. No error events
  const errorEvents = capture.events.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.eq(errorEvents.length, 0, 'no error events emitted');

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  report('test-basic-tool-call');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
