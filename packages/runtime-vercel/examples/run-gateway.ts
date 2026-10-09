/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end test: AgentScript compiled → runtime → Vercel AI SDK → LLM Gateway.
 * Uses the internal Salesforce LLM Gateway (OpenAI-compatible endpoint) with
 * Claude Haiku 4.5 to validate that tools, state updates, and streaming all
 * work against a real model.
 *
 * Prerequisites (auto-detected from environment):
 *   ANTHROPIC_BEDROCK_BASE_URL  (gateway root — we strip /bedrock and use /v1)
 *   ANTHROPIC_AUTH_TOKEN         (bearer token for the gateway)
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/run-gateway.ts
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
const source = readFileSync(join(__dirname, 'order-tracker.agent'), 'utf8');

// ---- Gateway config ---------------------------------------------------------
const gatewayRoot = process.env.ANTHROPIC_BEDROCK_BASE_URL;
const authToken = process.env.ANTHROPIC_AUTH_TOKEN;

if (!gatewayRoot || !authToken) {
  console.error(
    'Missing ANTHROPIC_BEDROCK_BASE_URL or ANTHROPIC_AUTH_TOKEN in environment.'
  );
  process.exit(1);
}

// The gateway serves OpenAI-compatible at the root /v1 (strip /bedrock suffix)
const baseURL = gatewayRoot.replace(/\/bedrock$/, '') + '/v1';
const model = 'claude-haiku-4-5-20251001';

console.log(`Gateway: ${baseURL}`);
console.log(`Model:   ${model}`);
console.log('---');

// ---- Compile ----------------------------------------------------------------
const { output, diagnostics } = compileSource(source);
const errors = diagnostics.filter(
  d => d.severity === 1 && d.code !== 'invalid-action-target'
);
if (errors.length) {
  console.error('Compile errors:', errors);
  process.exit(1);
}

// ---- Tools ------------------------------------------------------------------
const fn = new FnAdapter();
fn.register('lookup_order', args => {
  const { order_number } = args as { order_number: string };
  console.log(`  [fn://lookup_order] called with: ${order_number}`); // eslint-disable-line no-console
  return {
    status: order_number === 'ORD-42' ? 'shipped' : 'unknown order',
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
});

// ---- Run (stream mode) ------------------------------------------------------
console.log('> user: I want to check the status of order ORD-42\n');
const stream = agent.stream('I want to check the status of order ORD-42');

for await (const part of stream.fullStream) {
  switch (part.type) {
    case 'start-step':
      console.log(`  [start-step] ${part.node}`);
      break;
    case 'phase-start':
      console.log(`  [phase]      ▶ ${part.phase} (${part.node})`);
      break;
    case 'phase-end':
      console.log(`  [phase]      ◀ ${part.phase} (${part.node})`);
      break;
    case 'tool-call':
      console.log(
        `  [tool-call]  ${part.toolName}(${JSON.stringify(part.args)})`
      );
      break;
    case 'tool-result':
      console.log(
        `  [tool-res]   ${part.toolName} → ${JSON.stringify(part.result)}`
      );
      break;
    case 'tool-error':
      console.error(`  [tool-err]   ${part.toolName}: ${part.error}`);
      break;
    case 'state-change':
      if (!part.name.startsWith('AgentScriptInternal_')) {
        console.log(
          `  [state]      ${part.name}: ${JSON.stringify(part.before)} → ${JSON.stringify(part.after)}`
        );
      }
      break;
    case 'text-delta':
      process.stdout.write(part.text);
      break;
    case 'finish':
      console.log(`\n  [finish]     node=${part.finalNode}`);
      break;
    case 'error':
      console.error('  [error]', part.error);
      break;
  }
}

const result = await stream.result;
console.log(`\n< assistant: ${result.assistantText}`);
console.log(`  state.order_status = ${agent.state.get('order_status')}`);
console.log('\n✓ End-to-end test passed.');
