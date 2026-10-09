/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full end-to-end test: multi-agent AgentScript (Travel Concierge) with real LLM.
 * Exercises: multiple subagents, handoffs, before_reasoning hooks with state
 * mutations and conditional transitions, available-when guards, multiple fn://
 * tools, and multi-turn conversation.
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/run-gateway-travel.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateText, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';
import type { GenerateTextFn } from '@agentscript/runtime-vercel';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(
    __dirname,
    '../../../apps/ui/src/lib/examples/travel_concierge_playground.agent'
  ),
  'utf8'
);

// ---- Gateway config ---------------------------------------------------------
const gatewayRoot = process.env.ANTHROPIC_BEDROCK_BASE_URL;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN;

if (!gatewayRoot || !authToken) {
  console.error(
    'Missing ANTHROPIC_BEDROCK_BASE_URL or ANTHROPIC_AUTH_TOKEN in environment.'
  );
  process.exit(1);
}

const baseURL = gatewayRoot.replace(/\/bedrock$/, '') + '/v1';
const model = 'claude-haiku-4-5-20251001';

console.log(`Gateway: ${baseURL}`);
console.log(`Model:   ${model}`);
console.log('═'.repeat(70));

// ---- Compile ----------------------------------------------------------------
const { output, diagnostics } = compileSource(source);
const errors = diagnostics.filter(
  d => d.severity === 1 && d.code !== 'invalid-action-target'
);
if (errors.length) {
  console.error('Compile errors:', errors);
  process.exit(1);
}
console.log(
  `✓ Compiled (${diagnostics.length} diagnostics, ${errors.length} errors)`
);

// ---- Tools (same mocks as the playground UI) --------------------------------
const fn = new FnAdapter();

fn.register('search_flights', args => {
  const { destination } = args as { destination?: string };
  console.log(`    [fn://search_flights] destination=${destination}`);
  return {
    flight_number: 'SA-742',
    price_usd: 389,
    carrier: 'Skyline Air',
  };
});

fn.register('search_hotels', args => {
  const { destination, max_price_usd } = args as {
    destination?: string;
    max_price_usd?: number;
  };
  console.log(
    `    [fn://search_hotels] destination=${destination}, budget=${max_price_usd}`
  );
  return {
    hotel_name: `The Grand ${destination ?? 'Hotel'}`,
    nightly_usd: 175,
    rating: 4.3,
  };
});

fn.register('get_weather', args => {
  const { city } = args as { city?: string };
  console.log(`    [fn://get_weather] city=${city}`);
  return {
    summary: `Clear and breezy in ${city ?? 'the area'}`,
    temp_c: 22,
  };
});

fn.register('confirm_booking', args => {
  const { flight_number, hotel_name } = args as {
    flight_number?: string;
    hotel_name?: string;
  };
  console.log(
    `    [fn://confirm_booking] flight=${flight_number}, hotel=${hotel_name}`
  );
  return {
    confirmation_code: 'BK-DEMO42',
    total_usd: 1250,
  };
});

const tools = new ToolRegistry();
tools.register('fn', fn);

// ---- Agent ------------------------------------------------------------------
const openai = createOpenAI({ baseURL, apiKey: authToken });

const agent = createAgent({
  doc: output,
  llm: {
    model: openai.chat(model),
    generateText: generateText as unknown as GenerateTextFn,
    jsonSchema: jsonSchema as unknown as (
      s: Record<string, unknown>
    ) => unknown,
  },
  tools,
  maxStepsPerTurn: 12,
});

// ---- Multi-turn conversation ------------------------------------------------
const turns = [
  'I want to fly to Tokyo next Friday, my budget is $200 per night for a hotel',
  'search for flights please',
  'now find me a hotel',
  'book it!',
];

for (const userMsg of turns) {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`> user: ${userMsg}\n`);

  const stream = agent.stream(userMsg);
  const stateChanges: string[] = [];
  const nodeTrail: string[] = [];

  for await (const part of stream.fullStream) {
    switch (part.type) {
      case 'start-step':
        nodeTrail.push(part.node);
        console.log(`  [→ ${part.node}]`);
        break;
      case 'tool-call':
        console.log(`  [tool]  ${part.toolName}(${JSON.stringify(part.args)})`);
        break;
      case 'tool-result':
        console.log(`  [result] → ${JSON.stringify(part.result)}`);
        break;
      case 'state-change':
        if (!part.name.startsWith('AgentScriptInternal_')) {
          stateChanges.push(`${part.name}: ${JSON.stringify(part.after)}`);
        }
        break;
      case 'text-delta':
        process.stdout.write(part.text);
        break;
      case 'finish':
        break;
      case 'error':
        console.error('\n  [ERROR]', part.error);
        break;
    }
  }

  const result = await stream.result;
  console.log(`\n\n  final node: ${result.finalNode}`);
  if (stateChanges.length > 0) {
    console.log(`  state: ${stateChanges.join(' | ')}`);
  }
}

// ---- Final state check ------------------------------------------------------
console.log(`\n${'═'.repeat(70)}`);
console.log('Final state:');
console.log(`  destination    = ${agent.state.get('destination')}`);
console.log(`  flight_number  = ${agent.state.get('flight_number')}`);
console.log(`  flight_price   = ${agent.state.get('flight_price')}`);
console.log(`  hotel_name     = ${agent.state.get('hotel_name')}`);
console.log(`  hotel_price    = ${agent.state.get('hotel_price')}`);
console.log(`  booked         = ${agent.state.get('booked')}`);
console.log(`  turn_count     = ${agent.state.get('turn_count')}`);

const booked = agent.state.get('booked');
const flight = agent.state.get('flight_number');
const hotel = agent.state.get('hotel_name');

if (booked && flight && hotel) {
  console.log('\n✓ Full multi-agent travel flow completed successfully!');
} else {
  console.error(
    '\n✗ Flow incomplete — expected booked=true with flight + hotel'
  );
  process.exit(1);
}
