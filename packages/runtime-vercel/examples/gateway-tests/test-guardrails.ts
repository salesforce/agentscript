/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: Output guardrails validate LLM responses.
 *
 * Test A: A content-policy guardrail with words the model would never say
 *         should PASS (no violation).
 * Test B: A regex guardrail requiring an impossible string should FAIL
 *         and throw GuardrailExhaustionError after retries.
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-guardrails.ts
 */

import {
  contentPolicyGuardrail,
  regexGuardrail,
  GuardrailExhaustionError,
} from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  assertions,
  report,
  ToolRegistry,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline .agent source — polite greeter (no tools needed)
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are a polite assistant. Always respond warmly to greetings. Never use profanity. Keep responses under two sentences."

config:
    agent_name: "GreeterBot"
    default_agent_user: "greeter@example.com"

language:
    default_locale: "en_US"

variables:
    mood: mutable string = "neutral"
        description: "Current user mood"

start_agent greeter:
    description: "Responds politely to user greetings"

    reasoning:
        instructions: ->
            |   Respond politely to the user's greeting in one or two sentences.
                Do not call any tools.
`;

// ---------------------------------------------------------------------------
// Test A: Guardrail that should PASS
// ---------------------------------------------------------------------------

async function testGuardrailPass(): Promise<void> {
  console.log('--- Test A: Content-policy guardrail (should pass) ---\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  // Guardrail blocks words the LLM would never produce in a greeting response.
  const guardrail = contentPolicyGuardrail({
    blocklist: ['XYZZY_FORBIDDEN', 'NEVER_SAY_THIS'],
    name: 'test-content-policy',
    maxRetries: 1,
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools: new ToolRegistry(),
    guardrails: [guardrail],
    maxStepsPerTurn: 5,
    llmDriver,
  });

  console.log('> user: Hello! How are you today?\n');

  let errorThrown: Error | undefined;
  let capture;

  try {
    capture = await runTurn(runtime, 'Hello! How are you today?');
  } catch (err) {
    errorThrown = err as Error;
  }

  // Assertions
  assertions.ok(
    errorThrown === undefined,
    'No error thrown (guardrail passed)',
    errorThrown ? `error: ${errorThrown.message}` : undefined
  );

  if (capture) {
    assertions.truthy(
      capture.result.assistantText.length > 0,
      'Response text is non-empty'
    );

    // Check that guardrail-pass event was emitted
    const guardrailPassEvents = capture.events.filter(
      e => e.kind === 'guardrail-pass'
    );
    assertions.gte(
      guardrailPassEvents.length,
      1,
      'At least one guardrail-pass event emitted'
    );

    // Check that no guardrail-fail events occurred
    const guardrailFailEvents = capture.events.filter(
      e => e.kind === 'guardrail-fail'
    );
    assertions.eq(
      guardrailFailEvents.length,
      0,
      'No guardrail-fail events (clean pass)'
    );
  }
}

// ---------------------------------------------------------------------------
// Test B: Guardrail that should FAIL (impossible requirement)
// ---------------------------------------------------------------------------

async function testGuardrailFail(): Promise<void> {
  console.log('\n--- Test B: Regex guardrail (should fail and exhaust) ---\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  // This guardrail requires the response to contain an impossible string.
  // The LLM will never produce it, so it will exhaust all retries.
  const impossibleGuardrail = regexGuardrail({
    pattern: /IMPOSSIBLE_STRING_XYZ/,
    name: 'impossible-regex',
    maxRetries: 1,
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools: new ToolRegistry(),
    guardrails: [impossibleGuardrail],
    exhaustionPolicy: 'throw',
    maxStepsPerTurn: 5,
    llmDriver,
  });

  console.log('> user: Hello!\n');

  const err = await assertions.throwsAsync(
    () => runTurn(runtime, 'Hello!').then(c => c.result),
    'GuardrailExhaustionError is thrown after retries'
  );

  if (err) {
    assertions.instanceOf(
      err,
      GuardrailExhaustionError,
      'Error is a GuardrailExhaustionError instance'
    );

    if (err instanceof GuardrailExhaustionError) {
      assertions.eq(
        err.guardrailName,
        'impossible-regex',
        'Error references the correct guardrail name'
      );
      assertions.gte(
        err.attempts,
        2,
        'Error reports >= 2 attempts (initial + retries)'
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-guardrails.ts ===\n');

  const cfg = createGatewayConfig();
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  await testGuardrailPass();
  await testGuardrailFail();

  report('test-guardrails');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
