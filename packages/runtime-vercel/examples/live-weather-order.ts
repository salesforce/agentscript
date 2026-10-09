#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LIVE example 1 — weather + order tracker (the simplest real-model demo)
 * ─────────────────────────────────────────────────────────────────────────
 *
 * One agent, two independent `fn://` tools, a real OpenAI model deciding on
 * its own which one to call. No mocked LLM anywhere in this file — every
 * decision (which tool, what arguments, how to phrase the answer) comes from
 * the live model.
 *
 * Skips cleanly (exit 0) if OPENAI_API_KEY isn't set, so CI stays green.
 *
 * Run:  pnpm --filter @agentscript/runtime-vercel exec tsx examples/live-weather-order.ts
 */

import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '../src/index.js';
import { resolveLiveOpenAi, CONFIGURE_HINT } from './_shared/live-openai.js';

const SOURCE = `
system:
    instructions: "You are a helpful assistant that can check the weather and look up order status. Be concise."
config:
    agent_name: "HelpBot"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "Answers weather and order-status questions"
    actions:
        Check_Weather:
            description: "Check the current weather for a city"
            inputs:
                city: string
                    description: "City to check"
                    is_required: True
            outputs:
                result: string
            target: "fn://check_weather"
        Lookup_Order:
            description: "Look up an order's shipping status by order number"
            inputs:
                order_number: string
                    description: "The order number, e.g. ORD-42"
                    is_required: True
            outputs:
                result: string
            target: "fn://lookup_order"
    reasoning:
        instructions: ->
            | Help the user with weather or order-status questions. Call the
              right tool for what they ask, then answer in one short sentence.
        actions:
            check_weather: @actions.Check_Weather
                with city=...
            lookup_order: @actions.Lookup_Order
                with order_number=...
`;

const WEATHER: Record<string, { tempC: number; conditions: string }> = {
  paris: { tempC: 17, conditions: 'light rain' },
  tokyo: { tempC: 24, conditions: 'clear skies' },
  lisbon: { tempC: 21, conditions: 'sunny' },
};

const ORDERS: Record<string, string> = {
  'ORD-42': 'shipped, arriving tomorrow',
  'ORD-7': 'still processing',
};

async function main() {
  const live = resolveLiveOpenAi();
  if (!live) {
    console.log(`⏭  Skipping — ${CONFIGURE_HINT}`);
    return;
  }
  console.log(`Live model: openai · ${live.modelId}\n`);

  const { output, diagnostics } = compileSource(SOURCE);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (errors.length) {
    console.error('Compile errors:', errors);
    process.exit(1);
  }

  const fn = new FnAdapter();
  fn.register('check_weather', args => {
    const city = String((args as { city?: string }).city ?? '')
      .trim()
      .toLowerCase();
    const hit = WEATHER[city] ?? { tempC: 20, conditions: 'sunny' };
    console.log(`  [tool] check_weather("${city}") → ${JSON.stringify(hit)}`);
    return hit;
  });
  fn.register('lookup_order', args => {
    const orderNumber = String(
      (args as { order_number?: string }).order_number ?? ''
    );
    const status = ORDERS[orderNumber] ?? 'no record of that order';
    console.log(`  [tool] lookup_order("${orderNumber}") → "${status}"`);
    return { status };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  const agent = createAgent({ doc: output, llm: live.llm, tools });

  const turns = [
    "What's the weather like in Paris right now?",
    'Can you check the status of order ORD-42?',
  ];

  for (const userMsg of turns) {
    console.log(`\n> user: ${userMsg}`);
    const result = await agent.run(userMsg);
    console.log(`< assistant: ${result.assistantText.trim()}`);
  }

  console.log('\n✓ Live weather + order tracker demo complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
