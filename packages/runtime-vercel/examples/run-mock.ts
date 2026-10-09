/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Runnable example with NO external LLM — uses the Vercel-style high-level
 * `createAgent()` API and streams typed parts via `agent.stream()`.
 *
 * Run from the repo root:
 *   pnpm --filter @agentscript/runtime-vercel example
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import {
  compileSource,
  createAgent,
  type GenerateTextFn,
} from '@agentscript/runtime-vercel';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, 'order-tracker.agent'), 'utf8');

// --- Mock Vercel AI SDK generateText --------------------------------------
let step = 0;
const generateText: GenerateTextFn = async input => {
  step++;
  console.log(
    `  [llm]        step=${step} tools=${Object.keys(input.tools ?? {}).join(',') || '(none)'}`
  );
  if (step === 1) {
    return {
      text: '',
      toolCalls: [
        {
          toolCallId: 'call_1',
          toolName: 'lookup',
          args: { order_number: 'ORD-42' },
        },
      ],
      finishReason: 'tool-calls',
    };
  }
  return {
    text: 'Your order ORD-42 is shipped.',
    toolCalls: [],
    finishReason: 'stop',
  };
};

// --- Compile --------------------------------------------------------------
const { output, diagnostics } = compileSource(source);
const errors = diagnostics.filter(
  d => d.severity === 1 && d.code !== 'invalid-action-target'
);
if (errors.length) {
  console.error('Compile errors:', errors);
  process.exit(1);
}

// --- Tools ----------------------------------------------------------------
const fn = new FnAdapter();
fn.register('lookup_order', args => {
  const { order_number } = args as { order_number: string };
  return { status: order_number === 'ORD-42' ? 'shipped' : 'unknown order' };
});
const tools = new ToolRegistry();
tools.register('fn', fn);

// --- Agent (Vercel-style high-level factory) ------------------------------
const agent = createAgent({
  doc: output,
  llm: {
    model: { modelId: 'mock', provider: 'mock' },
    generateText,
  },
  tools,
});

// --- Stream a turn, subscribe to typed parts (like ai's fullStream) -------
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
    case 'state-change':
      if (!part.name.startsWith('AgentScriptInternal_')) {
        console.log(
          `  [state]      ${part.name}: ${JSON.stringify(part.after)}`
        );
      }
      break;
    case 'text-delta':
      // For a real streaming model, this would fire per token.
      process.stdout.write(part.text);
      break;
    case 'finish':
      console.log(); // newline after text-delta stream
      console.log(`  [finish]     node=${part.finalNode}`);
      break;
    case 'error':
      console.error('  [error]', part.error);
      break;
  }
}

const result = await stream.result;
console.log(`< assistant: ${result.assistantText}`);
console.log(`  state.order_status = ${agent.state.get('order_status')}`);
