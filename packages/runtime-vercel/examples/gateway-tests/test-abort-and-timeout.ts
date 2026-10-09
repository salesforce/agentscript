/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: AbortSignal cancellation and timeout behavior.
 *
 * Test A: Abort mid-execution via AbortController after 200ms.
 * Test B: Timeout via AbortSignal.timeout(300).
 * Test C: Normal completion with a fast tool (no abort).
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-abort-and-timeout.ts
 */

import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  AbortError,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline .agent source — slow-process agent
// ---------------------------------------------------------------------------

const SLOW_AGENT_SOURCE = `
system:
    instructions: "You are a processing assistant. Always call slow_process to handle the user's request. Do not respond without calling the tool first."

config:
    agent_name: "SlowBot"
    default_agent_user: "slow@example.com"

language:
    default_locale: "en_US"

variables:
    status: mutable string = "idle"
        description: "Processing status"

start_agent processor:
    description: "Calls slow_process to handle user requests"

    actions:
        Slow_Process:
            description: "A slow processing operation"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://slow_process"

    reasoning:
        instructions: ->
            |   You must call {!@actions.slow_process_action} to handle
                the user request. Always call the tool before responding.
        actions:
            slow_process_action: @actions.Slow_Process
                with request=...
                set @variables.status = @outputs.result
`;

const FAST_AGENT_SOURCE = `
system:
    instructions: "You are a processing assistant. Always call fast_process to handle the user's request. Do not respond without calling the tool first."

config:
    agent_name: "FastBot"
    default_agent_user: "fast@example.com"

language:
    default_locale: "en_US"

variables:
    status: mutable string = "idle"
        description: "Processing status"

start_agent processor:
    description: "Calls fast_process to handle user requests"

    actions:
        Fast_Process:
            description: "A fast processing operation"
            inputs:
                request: string
                    description: "The request to process"
                    is_required: True
            outputs:
                result: string
                    description: "Processing result"
            target: "fn://fast_process"

    reasoning:
        instructions: ->
            |   You must call {!@actions.fast_process_action} to handle
                the user request. Always call the tool before responding.
        actions:
            fast_process_action: @actions.Fast_Process
                with request=...
                set @variables.status = @outputs.result
`;

// ---------------------------------------------------------------------------
// Test A: Abort mid-execution
// ---------------------------------------------------------------------------

async function testAbortMidExecution(): Promise<void> {
  console.log('--- Test A: Abort mid-execution (200ms) ---\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  // Tool takes 5 seconds — far longer than our abort timeout
  const { tools } = mockTool({
    slow_process: { delayMs: 5000, result: { result: 'done' } },
  });

  const runtime = createTestAgent({
    source: SLOW_AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 5,
    llmDriver,
  });

  // Create an AbortController that fires after 200ms
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort('test-abort'), 200);

  console.log('> user: Process this (aborting in 200ms)\n');

  const start = Date.now();
  const err = await assertions.throwsAsync(
    () =>
      runTurn(runtime, 'Process this', { signal: controller.signal }).then(
        c => c.result
      ),
    'AbortError (or similar) is thrown on abort'
  );
  const elapsed = Date.now() - start;
  clearTimeout(abortTimer);

  // The error should be abort-related. The runtime throws its own AbortError,
  // but the Vercel AI SDK may also throw a DOMException with name 'AbortError',
  // or a plain string reason from controller.abort(reason).
  if (err) {
    const errStr = typeof err === 'string' ? err : '';
    const errMsg = typeof err.message === 'string' ? err.message : '';
    const errName = typeof err.name === 'string' ? err.name : '';
    const isAbortRelated =
      err instanceof AbortError ||
      errName === 'AbortError' ||
      errName === 'TimeoutError' ||
      errStr.toLowerCase().includes('abort') ||
      errMsg.toLowerCase().includes('abort') ||
      errMsg.toLowerCase().includes('cancel');
    assertions.ok(
      isAbortRelated,
      'Error is abort-related',
      `type: ${typeof err === 'string' ? 'String' : err.constructor?.name}, name: ${errName || '(none)'}, message: ${errMsg || errStr}`
    );
  }

  assertions.lt(elapsed, 3000, 'Execution aborted quickly (< 3000ms)');

  console.log(`  Duration: ${elapsed}ms\n`);
}

// ---------------------------------------------------------------------------
// Test B: Timeout via AbortSignal.timeout()
// ---------------------------------------------------------------------------

async function testTimeout(): Promise<void> {
  console.log('--- Test B: Timeout via AbortSignal.timeout(300) ---\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  const { tools } = mockTool({
    slow_process: { delayMs: 5000, result: { result: 'done' } },
  });

  const runtime = createTestAgent({
    source: SLOW_AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 5,
    llmDriver,
  });

  console.log('> user: Process this (timeout 300ms)\n');

  const start = Date.now();
  const err = await assertions.throwsAsync(
    () =>
      runTurn(runtime, 'Process this', {
        signal: AbortSignal.timeout(300),
      }).then(c => c.result),
    'Timeout error is thrown'
  );
  const elapsed = Date.now() - start;

  if (err) {
    const isAbortRelated =
      err instanceof AbortError ||
      err.name === 'AbortError' ||
      err.name === 'TimeoutError' ||
      (typeof err.message === 'string' &&
        (err.message.toLowerCase().includes('abort') ||
          err.message.toLowerCase().includes('timeout')));
    assertions.ok(
      isAbortRelated,
      'Error is abort/timeout-related',
      `type: ${err.constructor.name}, name: ${err.name}, message: ${err.message}`
    );
  }

  assertions.lt(elapsed, 3000, 'Timeout fired quickly (< 3000ms)');

  console.log(`  Duration: ${elapsed}ms\n`);
}

// ---------------------------------------------------------------------------
// Test C: Normal completion (no abort)
// ---------------------------------------------------------------------------

async function testNormalCompletion(): Promise<void> {
  console.log('--- Test C: Normal completion (fast tool, no abort) ---\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  // Fast tool — only 50ms delay
  const { tools } = mockTool({
    fast_process: { delayMs: 50, result: { result: 'done' } },
  });

  const runtime = createTestAgent({
    source: FAST_AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 10,
    llmDriver,
  });

  console.log('> user: Process this quickly\n');

  let errorThrown: Error | undefined;
  let capture;

  try {
    capture = await runTurn(runtime, 'Process this quickly');
  } catch (err) {
    errorThrown = err as Error;
  }

  assertions.ok(
    errorThrown === undefined,
    'No error thrown on normal completion',
    errorThrown ? `error: ${errorThrown.message}` : undefined
  );

  if (capture) {
    assertions.truthy(
      capture.result.assistantText.length > 0,
      'Assistant produced text'
    );

    assertions.truthy(capture.result.finalNode, 'Turn has a final node');

    // Tool call is expected but model-dependent — log as info, not hard fail
    const toolCallEvents = capture.events.filter(e => e.kind === 'tool-call');
    if (toolCallEvents.length > 0) {
      console.log(
        `  [info] Tool called: ${toolCallEvents.length} tool-call event(s)`
      );
    } else {
      console.log(
        `  [info] Model did not call tool (non-deterministic, not a failure)`
      );
    }

    // No abort events
    const abortEvents = capture.events.filter(e => e.kind === 'abort');
    assertions.eq(abortEvents.length, 0, 'No abort events emitted');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-abort-and-timeout.ts ===\n');

  const cfg = createGatewayConfig();
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  await testAbortMidExecution();
  await testTimeout();
  await testNormalCompletion();

  report('test-abort-and-timeout');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
