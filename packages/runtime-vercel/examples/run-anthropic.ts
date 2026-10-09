/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runnable example: AgentScript agent executing on the Vercel AI SDK with a
 * real Anthropic Claude model. Tool calls, state updates, and handoffs are
 * owned by @agentscript/runtime-vercel's high-level `createAgent`; the SDK
 * just drives the LLM step.
 *
 * Prerequisites:
 *   pnpm add @ai-sdk/anthropic
 *   export ANTHROPIC_API_KEY=sk-ant-...
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/run-anthropic.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'order-tracker.agent'), 'utf8');

// 1. Compile the AgentScript source to the runtime IR.
const { output, diagnostics } = compileSource(source);
const errors = diagnostics.filter(
  d => d.severity === 1 && d.code !== 'invalid-action-target'
);
if (errors.length) {
  console.error('Compile errors:', errors);
  process.exit(1);
}

// 2. Register tool adapters. The compiler rewrites `fn://lookup_order` so the
//    runtime will dispatch into the handler below.
const fn = new FnAdapter();
fn.register('lookup_order', async args => {
  // Pretend this is an ERP call.
  const { order_number } = args as { order_number: string };
  return {
    status: order_number === 'ORD-42' ? 'shipped' : 'unknown order',
  };
});
const tools = new ToolRegistry();
tools.register('fn', fn);

// 3. Create an agent — the Vercel-style high-level factory.
const agent = createAgent({
  doc: output,
  llm: {
    model: anthropic('claude-haiku-4-5'),
    generateText,
  },
  tools,
});

// 4. Stream a turn, subscribe to typed parts (like ai's fullStream).
console.log('> user: I want to check the status of order ORD-42');
const stream = agent.stream('I want to check the status of order ORD-42');

for await (const part of stream.fullStream) {
  switch (part.type) {
    case 'start-step':
      console.log(`  [start-step] ${part.node}`);
      break;
    case 'tool-call':
      console.log(
        `  [tool-call]  ${part.toolName}(${JSON.stringify(part.args)})`
      );
      break;
    case 'tool-result':
      console.log(
        `  [tool-res]   ${part.toolName} -> ${JSON.stringify(part.result)}`
      );
      break;
    case 'tool-error':
      console.error(`  [tool-err]   ${part.toolName}: ${part.error}`);
      break;
    case 'state-change':
      if (!part.name.startsWith('AgentScriptInternal_')) {
        console.log(
          `  [state]      ${part.name}: ${JSON.stringify(part.after)}`
        );
      }
      break;
    case 'text-delta':
      // Real Claude streams many small chunks here — write them through as
      // they arrive so the terminal shows incremental output.
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
console.log(`< assistant: ${result.assistantText}`);
console.log(`  state.order_status = ${agent.state.get('order_status')}`);
