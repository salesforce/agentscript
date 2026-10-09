#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LIVE example 4 — structured-output extraction, enforced against a real model
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Feeds a live OpenAI model a free-form paragraph and forces its reply into
 * a JSON Schema shape via `structuredOutput: { strategy: 'guardrail' }` — the
 * runtime parses the reply, validates it against the schema, and if it
 * doesn't match, feeds the validation error back to the model and retries.
 *
 * This uses the low-level `Runtime` (not `createAgent`) because
 * `structuredOutput`/`guardrails` aren't yet on `CreateAgentOptions` — see
 * `@agentscript/runtime`'s `VercelAiSdkDriver`, exported here for exactly
 * this: driving a low-level `Runtime` with a real Vercel AI SDK model.
 *
 * `strategy: 'native'` (provider JSON mode) is deliberately NOT used here —
 * against gpt-5.6 through this AI-SDK version's `responseFormat` passthrough
 * it does not reliably produce JSON; `'guardrail'` (parse + validate + retry)
 * does, reliably, because it takes the model's raw text and actually checks it.
 *
 * Run:  pnpm --filter @agentscript/runtime-vercel exec tsx examples/live-structured-extraction.ts
 *
 * Skips cleanly (exit 0) if OPENAI_API_KEY isn't set.
 */

import {
  Runtime,
  ToolRegistry,
  jsonSchemaGuardrail,
} from '@agentscript/runtime';
import { compileSource } from '@agentscript/agentforce';
import { VercelAiSdkDriver } from '../src/driver.js';
import { resolveLiveOpenAi, CONFIGURE_HINT } from './_shared/live-openai.js';

const SOURCE = `
system:
    instructions: "Extract structured data from the user's message. Respond with JSON only, no prose."
config:
    agent_name: "Extractor"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "Extracts a structured contact record from free text"
    reasoning:
        instructions: ->
            | Extract the person's name, age, city, and occupation as JSON
              matching the required schema. Output JSON only.
`;

const CONTACT_SCHEMA = {
  type: 'object',
  required: ['name', 'age', 'city', 'occupation'],
  properties: {
    name: { type: 'string' },
    age: { type: 'number' },
    city: { type: 'string' },
    occupation: { type: 'string' },
  },
};

const PARAGRAPHS = [
  'John Doe is a 34 year old engineer living in Lisbon.',
  'Meet Aiko Tanaka, a 28-year-old graphic designer based in Tokyo.',
];

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

  const driver = new VercelAiSdkDriver(live.llm);
  const runtime = new Runtime({
    doc: output,
    llm: driver,
    tools: new ToolRegistry(),
    guardrails: [
      jsonSchemaGuardrail({ schema: CONTACT_SCHEMA, name: 'contact' }),
    ],
    structuredOutput: { schema: CONTACT_SCHEMA, strategy: 'guardrail' },
    exhaustionPolicy: 'last-response',
  });

  for (const paragraph of PARAGRAPHS) {
    console.log(`> "${paragraph}"`);
    const result = await runtime.turn(paragraph);
    if (result.parsed?.valid) {
      console.log(`< parsed: ${JSON.stringify(result.parsed.data)}\n`);
    } else {
      console.log(`< NOT VALID — raw text: ${result.assistantText}\n`);
    }
  }

  console.log('✓ Live structured-output extraction demo complete.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
