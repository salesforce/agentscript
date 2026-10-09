/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: multi-agent handoffs (node transitions), subagent routing.
 *
 * Validates:
 *   1. A router agent transitions to the correct subagent based on user intent
 *   2. The target subagent's tool (search_flights) is called after the handoff
 *   3. The wrong subagent's tool (lookup_order) is NOT called
 *   4. The final node is travel_agent (not router or order_agent)
 *   5. No errors emitted during the turn
 *
 * Architecture:
 *   start_agent router  --[go_to_travel]--> subagent travel_agent  (search_flights)
 *                       --[go_to_orders]--> subagent order_agent   (lookup_order)
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-multi-agent-handoff.ts
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
    instructions: "You are a routing assistant. Route travel questions (flights, hotels) to the travel agent and order questions to the order agent. Always route immediately without asking follow-up questions."

config:
    agent_name: "RouterHandoffTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    destination: mutable string = ""
        description: "Travel destination"
    flight_result: mutable string = ""
        description: "Flight search result"
    order_result: mutable string = ""
        description: "Order lookup result"

start_agent router:
    description: "Routes user requests to the appropriate specialist agent"

    reasoning:
        instructions: ->
            |   You are a request router. Analyze the user's message:
                - If they ask about flights, travel, or hotels, immediately call {!@actions.go_to_travel}.
                - If they ask about orders, tracking, or deliveries, immediately call {!@actions.go_to_orders}.
                Do NOT answer the question yourself. Always route to a specialist.
        actions:
            go_to_travel: @utils.transition to @subagent.travel_agent
                description: "Route to the travel specialist for flight and hotel queries"

            go_to_orders: @utils.transition to @subagent.order_agent
                description: "Route to the order specialist for order and delivery queries"

subagent travel_agent:
    description: "Searches flights for the user"

    actions:
        Search_Flights:
            description: "Search for flights to a destination"
            inputs:
                destination: string
                    description: "Destination city or airport"
                    is_required: True
                travel_date: string
                    description: "Desired travel date"
                    is_required: False
            outputs:
                flight: string
                    description: "Flight number"
                price: number
                    description: "Price in USD"
                departure: string
                    description: "Departure time"
            target: "fn://search_flights"

    reasoning:
        instructions: ->
            |   Search for flights using {!@actions.find_flight}.
                The user wants to go to: {! @variables.destination }.
                Call the search tool with the destination from the user's message.
        actions:
            find_flight: @actions.Search_Flights
                with destination=...
                with travel_date=...
                set @variables.flight_result = @outputs.flight

subagent order_agent:
    description: "Looks up order status"

    actions:
        Lookup_Order:
            description: "Look up an order by number"
            inputs:
                order_number: string
                    description: "The order number to look up"
                    is_required: True
            outputs:
                status: string
                    description: "Current order status"
                updated_at: string
                    description: "Last update date"
            target: "fn://lookup_order"

    reasoning:
        instructions: ->
            |   Look up the user's order using {!@actions.find_order}.
                Call the tool with the order number from the user's message.
        actions:
            find_order: @actions.Lookup_Order
                with order_number=...
                set @variables.order_result = @outputs.status
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-multi-agent-handoff ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Mock tools with delays
  const { tools } = mockTool({
    search_flights: {
      delayMs: 200,
      result: { flight: 'AA-100', price: 450, departure: '10:30 AM' },
    },
    lookup_order: {
      delayMs: 100,
      result: { status: 'delivered', date: '2024-01-15' },
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
  console.log('> user: I need to find a flight to Paris\n');

  const capture = await runTurn(runtime, 'I need to find a flight to Paris');

  console.log(`  Duration: ${capture.durationMs}ms`);
  console.log(`  Final node: ${capture.result.finalNode}`);

  // Log captured events for diagnostics
  const nodeTrail: string[] = [];
  const handoffs: Array<{ from: string; to: string }> = [];

  for (const e of capture.events) {
    if (e.kind === 'node-enter') {
      nodeTrail.push(e.node);
      console.log(`  [node-enter] ${e.node}`);
    } else if (e.kind === 'node-exit' && e.to) {
      handoffs.push({ from: e.node, to: e.to });
      console.log(`  [handoff]    ${e.node} -> ${e.to}`);
    } else if (e.kind === 'tool-call') {
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
  console.log(`  Node trail: [${nodeTrail.join(' -> ')}]`);
  console.log('');

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------

  // 1. Handoff occurred from router to travel_agent.
  //    Check node-exit events for the handoff, OR verify the node trail
  //    shows router followed by travel_agent.
  const handoffViaEvent = handoffs.some(
    h => h.from === 'router' && h.to === 'travel_agent'
  );
  const routerIdx = nodeTrail.indexOf('router');
  const travelIdx = nodeTrail.indexOf('travel_agent');
  const handoffViaTrail =
    routerIdx >= 0 && travelIdx >= 0 && routerIdx < travelIdx;
  assertions.ok(
    handoffViaEvent || handoffViaTrail,
    'handoff from router to travel_agent',
    `handoff events: ${JSON.stringify(handoffs)}, node trail: [${nodeTrail.join(' -> ')}]`
  );

  // 2. search_flights was called (may need a follow-up turn after handoff)
  let flightCalled = capture.events.some(
    e => e.kind === 'tool-call' && e.name === 'fn://search_flights'
  );

  if (!flightCalled) {
    // After handoff the new node may need another turn to trigger the tool
    console.log('\n--- Turn 2: follow-up after handoff ---\n');
    const capture2 = await runTurn(
      runtime,
      'Yes, find me a flight to Paris please'
    );
    console.log(`  Duration: ${capture2.durationMs}ms`);
    for (const e of capture2.events) {
      if (e.kind === 'tool-call')
        console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
      else if (e.kind === 'tool-result')
        console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    }
    flightCalled = capture2.events.some(
      e => e.kind === 'tool-call' && e.name === 'fn://search_flights'
    );
  }

  assertions.ok(
    flightCalled,
    'search_flights was called',
    `tool calls: ${
      [...capture.events]
        .filter(e => e.kind === 'tool-call')
        .map(e => (e.kind === 'tool-call' ? e.name : ''))
        .join(', ') || '(none)'
    }`
  );

  // 3. lookup_order was NOT called (correct routing)
  const orderCalled = capture.events.some(
    e => e.kind === 'tool-call' && e.name === 'fn://lookup_order'
  );
  assertions.ok(!orderCalled, 'lookup_order was NOT called (correct routing)');

  // 4. Final node is travel_agent
  assertions.eq(
    capture.result.finalNode,
    'travel_agent',
    'final node is travel_agent'
  );

  // 5. No error events
  const errorEvents = capture.events.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.eq(errorEvents.length, 0, 'no error events emitted');

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  report('test-multi-agent-handoff');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
