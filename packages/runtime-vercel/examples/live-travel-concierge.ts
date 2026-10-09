#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LIVE example 2 — Travel Concierge with a human-in-the-loop confirmation gate
 * ─────────────────────────────────────────────────────────────────────────
 *
 * A real OpenAI model plans a trip: it can search flights freely, but
 * `Book_Flight` is flagged `require_user_confirmation: true` in the DSL. A
 * `beforeToolCall` middleware sees that flag on `ctx.requireConfirmation` and
 * pauses to ask a real human at the terminal — the tool call is only aborted
 * or allowed based on that answer, never on the model's say-so.
 *
 * Run interactively (you'll be prompted with y/n at the terminal):
 *   pnpm --filter @agentscript/runtime-vercel exec tsx examples/live-travel-concierge.ts
 *
 * Run non-interactively for CI / scripted verification (auto-answers every
 * confirmation the same way):
 *   TRAVEL_AUTO_CONFIRM=y pnpm --filter @agentscript/runtime-vercel exec tsx examples/live-travel-concierge.ts
 *
 * Skips cleanly (exit 0) if OPENAI_API_KEY isn't set.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import type { Middleware } from '@agentscript/runtime';
import { compileSource, createAgent } from '../src/index.js';
import { resolveLiveOpenAi, CONFIGURE_HINT } from './_shared/live-openai.js';

const SOURCE = `
system:
    instructions: "You are a travel concierge. Help the user plan and book a trip. Be concise."
config:
    agent_name: "TravelConcierge"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "Plans trips and books flights"
    actions:
        Search_Flights:
            description: "Search for flights to a destination"
            inputs:
                destination: string
                    description: "Destination city"
                    is_required: True
            outputs:
                result: string
            target: "fn://search_flights"
        Book_Flight:
            description: "Book a flight by its flight number"
            inputs:
                flight_number: string
                    description: "The flight number to book"
                    is_required: True
            outputs:
                result: string
            target: "fn://book_flight"
            require_user_confirmation: True
    reasoning:
        instructions: ->
            | Help the traveler search for flights and book one when they ask.
              Always search before booking.
        actions:
            search: @actions.Search_Flights
                with destination=...
            book: @actions.Book_Flight
                with flight_number=...
`;

const FLIGHTS: Record<string, { flightNumber: string; priceUsd: number }> = {
  tokyo: { flightNumber: 'SA-742', priceUsd: 389 },
  lisbon: { flightNumber: 'SA-118', priceUsd: 245 },
};

/**
 * Asks a real human at the terminal (or auto-answers from
 * `TRAVEL_AUTO_CONFIRM` for scripted runs). Returns true to allow, false to
 * abort the tool call.
 */
async function confirmWithHuman(prompt: string): Promise<boolean> {
  const auto = process.env.TRAVEL_AUTO_CONFIRM;
  if (auto) {
    const allow = /^y/i.test(auto);
    console.log(`  [confirm] ${prompt} → auto-answered "${auto}"`);
    return allow;
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(`  [confirm] ${prompt} (y/n) `);
    return /^y/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/** Blocks any tool call the compiled IR flagged `require_user_confirmation`, pending a real human's answer. */
const confirmationGate: Middleware = {
  name: 'human-confirmation-gate',
  async beforeToolCall(ctx) {
    if (!ctx.requireConfirmation) return;
    const allowed = await confirmWithHuman(
      `Allow "${ctx.toolName}" with ${JSON.stringify(ctx.args)}?`
    );
    if (!allowed) {
      console.log(`  [confirm] ⚠ blocked "${ctx.toolName}"`);
      return { abort: { result: { error: 'user declined confirmation' } } };
    }
    console.log(`  [confirm] ✓ approved "${ctx.toolName}"`);
  },
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

  let bookCalled = false;
  const fn = new FnAdapter();
  fn.register('search_flights', args => {
    const destination = String(
      (args as { destination?: string }).destination ?? ''
    )
      .trim()
      .toLowerCase();
    const hit = FLIGHTS[destination] ?? {
      flightNumber: 'SA-000',
      priceUsd: 300,
    };
    console.log(
      `  [tool] search_flights("${destination}") → ${JSON.stringify(hit)}`
    );
    return hit;
  });
  fn.register('book_flight', args => {
    bookCalled = true;
    const flightNumber = String(
      (args as { flight_number?: string }).flight_number ?? ''
    );
    console.log(`  [tool] book_flight("${flightNumber}") → confirmed`);
    return { confirmation: `BK-${flightNumber}` };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  const agent = createAgent({
    doc: output,
    llm: live.llm,
    tools,
    middleware: [confirmationGate],
  });

  const turns = [
    'I want to fly to Tokyo. What flights are available?',
    'Book that flight for me.',
  ];

  for (const userMsg of turns) {
    console.log(`\n> user: ${userMsg}`);
    const result = await agent.run(userMsg);
    console.log(`< assistant: ${result.assistantText.trim()}`);
  }

  console.log(
    `\n✓ Live Travel Concierge demo complete (book_flight ${bookCalled ? 'ran' : 'was blocked'}).`
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
