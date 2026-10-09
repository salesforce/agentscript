/* eslint-disable no-console, @typescript-eslint/require-await */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: sequential vs parallel timing comparison.
 *
 * Runs the SAME agent twice -- once with parallel dispatch enabled
 * (strategy: 'always') and once disabled (strategy: 'never') -- then
 * compares wall-clock durations to prove the parallel path is actually
 * concurrent.
 *
 * NOTE: This test uses top-level await (no async main() wrapper). This is
 * intentional -- tsx supports top-level await natively, and wrapping would
 * add unnecessary indentation to a file that is already linear.
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-parallel-timing.ts
 */

import {
  createTestAgent,
  mockTool,
  runTurn,
  assertions,
  report,
  type RuntimeEvent,
  type ParallelDispatchOptions,
} from './harness.js';
import { VercelAiSdkDriver } from '@agentscript/runtime-vercel';
import type { GenerateTextFn } from '@agentscript/runtime-vercel';

// ---------------------------------------------------------------------------
// Inline .agent source
// ---------------------------------------------------------------------------

const agentSource = `
system:
    instructions: "You are a processing assistant. Call both tools to process the user's request."

config:
    agent_name: "TimingBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    processing_result: mutable string = ""
        description: "Result of processing"

start_agent processor:
    description: "Processes requests using two tools"

    actions:
        Fast_Tool:
            description: "A fast processing tool"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://fast_tool"

        Slow_Tool:
            description: "A slower processing tool"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://slow_tool"

    reasoning:
        instructions: ->
            |   Call both {!@actions.fast_tool} and {!@actions.slow_tool}
                to process the user's request, then summarize the results.
        actions:
            fast_tool: @actions.Fast_Tool
                with request=...
            slow_tool: @actions.Slow_Tool
                with request=...
`;

// ---------------------------------------------------------------------------
// Mock LLM factory -- returns fresh mock per run
// ---------------------------------------------------------------------------

function createMockLlmDriver(): VercelAiSdkDriver {
  let step = 0;
  const mockGenerateText: GenerateTextFn = async () => {
    step++;
    if (step === 1) {
      return {
        text: '',
        toolCalls: [
          {
            toolCallId: `call_fast_${Date.now()}`,
            toolName: 'fast_tool',
            args: { request: 'process my request' },
          },
          {
            toolCallId: `call_slow_${Date.now()}`,
            toolName: 'slow_tool',
            args: { request: 'process my request' },
          },
        ],
        finishReason: 'tool-calls',
      };
    }
    return {
      text: 'Processing complete.',
      toolCalls: [],
      finishReason: 'stop',
    };
  };

  return new VercelAiSdkDriver({
    model: { modelId: 'mock-timing', provider: 'mock' },
    generateText: mockGenerateText,
  });
}

// ---------------------------------------------------------------------------
// Helper: create agent with a given parallel strategy, run a turn
// ---------------------------------------------------------------------------

interface RunResult {
  durationMs: number;
  events: RuntimeEvent[];
  assistantText: string;
  toolsCalled: string[];
}

async function runWithStrategy(
  strategy: ParallelDispatchOptions['strategy']
): Promise<RunResult> {
  const { tools } = mockTool({
    fast_tool: { delayMs: 50, result: { result: 'fast_done' } },
    slow_tool: { delayMs: 500, result: { result: 'slow_done' } },
  });

  const runtime = createTestAgent({
    source: agentSource,
    tools,
    llmDriver: createMockLlmDriver(),
    parallel: { strategy },
  });

  const { result, events, durationMs } = await runTurn(
    runtime,
    'Process my request'
  );

  const toolsCalled = events
    .filter(e => e.kind === 'tool-call')
    .map(e => (e as { kind: 'tool-call'; name: string }).name);

  return {
    durationMs,
    events,
    assistantText: result.assistantText,
    toolsCalled,
  };
}

// ---------------------------------------------------------------------------
// Run both configurations
// ---------------------------------------------------------------------------

console.log('=== test-parallel-timing ===');
console.log('Tools: fast_tool (50ms), slow_tool (500ms)');
console.log('');

// --- Run 1: parallel enabled ---
console.log('--- Run 1: parallel (strategy: "always") ---');
const parallel = await runWithStrategy('always');
console.log(`  Duration:     ${parallel.durationMs}ms`);
console.log(`  Tools called: ${parallel.toolsCalled.join(', ')}`);
console.log(`  Text:         "${parallel.assistantText.slice(0, 50)}"`);

// --- Run 2: sequential ---
console.log('');
console.log('--- Run 2: sequential (strategy: "never") ---');
const sequential = await runWithStrategy('never');
console.log(`  Duration:     ${sequential.durationMs}ms`);
console.log(`  Tools called: ${sequential.toolsCalled.join(', ')}`);
console.log(`  Text:         "${sequential.assistantText.slice(0, 50)}"`);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

console.log('');

// Run 1: parallel
assertions.gte(parallel.toolsCalled.length, 2, 'parallel: both tools called');
assertions.lt(
  parallel.durationMs,
  700,
  `parallel: duration < 700ms (was ${parallel.durationMs}ms)`
);
assertions.truthy(
  parallel.assistantText.length > 0,
  'parallel: assistant produced text'
);

const parallelDispatchStarts = parallel.events.filter(
  e => e.kind === 'parallel-dispatch-start'
);
assertions.eq(
  parallelDispatchStarts.length,
  1,
  'parallel: parallel-dispatch-start event emitted'
);

// Run 2: sequential
assertions.gte(
  sequential.toolsCalled.length,
  2,
  'sequential: both tools called'
);
assertions.gte(
  sequential.durationMs,
  550,
  `sequential: duration >= 550ms (was ${sequential.durationMs}ms)`
);
assertions.truthy(
  sequential.assistantText.length > 0,
  'sequential: assistant produced text'
);

const seqDispatchStarts = sequential.events.filter(
  e => e.kind === 'parallel-dispatch-start'
);
assertions.eq(
  seqDispatchStarts.length,
  0,
  'sequential: no parallel-dispatch-start event'
);

// Cross-run comparison
assertions.ok(
  parallel.durationMs < sequential.durationMs,
  `parallel (${parallel.durationMs}ms) < sequential (${sequential.durationMs}ms)`
);

// No errors in either run
const parallelErrors = parallel.events.filter(e => e.kind === 'tool-error');
const seqErrors = sequential.events.filter(e => e.kind === 'tool-error');
assertions.eq(parallelErrors.length, 0, 'no errors in parallel run');
assertions.eq(seqErrors.length, 0, 'no errors in sequential run');

// ---------------------------------------------------------------------------
// Timing summary
// ---------------------------------------------------------------------------

console.log('');
console.log('--- Timing comparison ---');
console.log(`  Parallel:   ${parallel.durationMs}ms`);
console.log(`  Sequential: ${sequential.durationMs}ms`);
console.log(
  `  Speedup:    ${(sequential.durationMs / parallel.durationMs).toFixed(1)}x`
);

report('test-parallel-timing');
