/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier 4 customer-shaped test: Three-in-one question.
 *
 * Customer story:
 *   "I asked it three things at once and it only answered the first."
 *
 * What's being tested:
 *   - When the user packs three intents into one message (status lookup,
 *     refund issuance, and a free-text question about hours), the runtime's
 *     parallel dispatch must pick up BOTH tool-backed intents in the same
 *     LLM step. The third intent (hours) has no registered tool -- the
 *     model should answer it from text rather than hallucinating a tool.
 *   - Tool-call timestamps for the two registered tools overlap (parallel
 *     dispatch worked).
 *   - assistantText mentions all three topics in some form.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-three-in-one.ts
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
// Inline agent source -- customer-service agent with parallel dispatch
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are a customer-service assistant. Use parallel dispatch when the user asks multiple things in one message: call ALL relevant tools in a single step rather than one-at-a-time. For questions you do not have a tool for (such as store hours), answer from your general knowledge in the same response. Never invent tool names that have not been declared."

config:
    agent_name: "CSBot"
    default_agent_user: "support@example.com"

language:
    default_locale: "en_US"

variables:
    last_order_status: mutable string = ""
        description: "Most recent order status returned"
    last_refund: mutable string = ""
        description: "Most recent refund result"

start_agent cs_bot:
    description: "Customer-service assistant"

    actions:
        Get_Order_Status:
            description: "Look up the current status of an order"
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
                shipping_eta: string
                    description: "Shipping ETA"
            target: "fn://get_order_status"

        Issue_Partial_Refund:
            description: "Issue a partial refund on an order"
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
                amount: string
                    description: "Refund amount"
                    is_required: True
                reason: string
                    description: "Reason for the refund"
                    is_required: False
            outputs:
                refund_id: string
                    description: "New refund identifier"
                refunded_amount: string
                    description: "Amount refunded"
            target: "fn://issue_partial_refund"

    reasoning:
        instructions: ->
            |   Address every part of the user's request. When multiple intents
                are present, call all relevant tools in parallel using
                {!@actions.status} and {!@actions.refund}. For free-text
                questions like store hours that have no tool, answer from
                general knowledge in the same response.
        actions:
            status: @actions.Get_Order_Status
                with order_id=...
                set @variables.last_order_status = @outputs.status

            refund: @actions.Issue_Partial_Refund
                with order_id=..., amount=..., reason=...
                set @variables.last_refund = @outputs.refund_id
`;

async function main(): Promise<void> {
  console.log('=== test-three-in-one ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Tools have a 200ms delay so we can observe parallel overlap clearly.
  const { tools, callLog } = mockTool({
    get_order_status: {
      delayMs: 200,
      result: { status: 'in_transit', shipping_eta: '2026-06-02' },
    },
    issue_partial_refund: {
      delayMs: 200,
      result: { refund_id: 'REF-7788', refunded_amount: '$9.00' },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 8,
    llmDriver,
    parallel: { strategy: 'always' },
  });

  const userInput =
    "What's the status of ORD-9001, refund my $9 shipping, and what time do you close today?";
  console.log(`--- Turn 1: ${JSON.stringify(userInput)} ---\n`);

  const turn1 = await runTurn(runtime, userInput);
  logTurn(turn1.events, turn1.durationMs);

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------

  const toolCallEvents = turn1.events.filter(
    e => e.kind === 'tool-call'
  ) as Array<Extract<RuntimeEvent, { kind: 'tool-call' }>>;
  const toolNames = toolCallEvents.map(e => e.name);

  // 1. get_order_status fired
  assertions.ok(
    toolNames.some(n => n.includes('get_order_status')),
    'get_order_status fired',
    `tool calls: ${toolNames.join(', ')}`
  );

  // 2. issue_partial_refund fired
  assertions.ok(
    toolNames.some(n => n.includes('issue_partial_refund')),
    'issue_partial_refund fired',
    `tool calls: ${toolNames.join(', ')}`
  );

  // 3. Tool-call timestamps overlap -- parallel dispatch worked.
  //    Use the callLog timestamps (recorded on tool entry) so we measure
  //    when the runtime actually invoked them, not when the events fired.
  const statusEntry = callLog.find(c => c.name === 'get_order_status');
  const refundEntry = callLog.find(c => c.name === 'issue_partial_refund');
  if (statusEntry && refundEntry) {
    const spreadMs = Math.abs(statusEntry.timestamp - refundEntry.timestamp);
    assertions.lt(
      spreadMs,
      100,
      `parallel dispatch: tool-call spread < 100ms (was ${spreadMs}ms)`
    );
  } else {
    assertions.ok(
      false,
      'parallel dispatch: both tools recorded in callLog',
      `status: ${!!statusEntry}, refund: ${!!refundEntry}`
    );
  }

  // 4. parallel-dispatch-start event fired at least once
  const parallelStarts = turn1.events.filter(
    e => e.kind === 'parallel-dispatch-start'
  );
  assertions.gte(
    parallelStarts.length,
    1,
    'parallel-dispatch-start event fired at least once'
  );

  // 5. No tool errors -- the model must NOT have hallucinated a "hours" tool
  const errorEvents = turn1.events.filter(e => e.kind === 'tool-error');
  assertions.eq(
    errorEvents.length,
    0,
    'no tool-error events (no hallucinated tools)'
  );

  // 6. assistantText mentions all three topics (loose checks)
  const text = (turn1.result.assistantText ?? '').toString().toLowerCase();
  const mentionsStatus = /ord-?9001|status|transit|shipping|eta/.test(text);
  const mentionsRefund = /refund|refunded|\$9/.test(text);
  // Model may say "we close at" / "open until" / "hours" / "store hours";
  // also accept generic acknowledgement that hours info isn't available.
  const mentionsHours = /hour|close|open|today|pm|am|24|don't have|cannot/.test(
    text
  );

  assertions.ok(
    mentionsStatus,
    'assistantText mentions order status',
    `text: ${JSON.stringify(text.slice(0, 200))}`
  );
  assertions.ok(
    mentionsRefund,
    'assistantText mentions refund',
    `text: ${JSON.stringify(text.slice(0, 200))}`
  );
  assertions.ok(
    mentionsHours,
    'assistantText addresses hours question (or acknowledges no info)',
    `text: ${JSON.stringify(text.slice(0, 200))}`
  );

  report('test-three-in-one');
}

function logTurn(events: RuntimeEvent[], durationMs: number): void {
  console.log(`  Duration: ${durationMs}ms`);
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (e.kind === 'tool-error') {
      console.log(`  [tool-err]   ${e.name}: ${e.error}`);
    } else if (e.kind === 'parallel-dispatch-start') {
      console.log(`  [par-start]  tools=${e.toolNames.join(', ')}`);
    } else if (e.kind === 'parallel-dispatch-end') {
      console.log(`  [par-end]    tools=${e.toolNames.join(', ')}`);
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
