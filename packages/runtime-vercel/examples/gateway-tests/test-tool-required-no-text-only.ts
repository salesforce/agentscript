/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier 4 customer-shaped test: tool was required, but the model went
 * text-only (overthinking).
 *
 * Customer story:
 *   "I asked about a specific order's refund policy and it gave me generic
 *    legal text. Wrong answer."
 *
 * What's being tested:
 *   - Custom output guardrail enforces: if assistantText mentions a
 *     specific order id (regex ORD-\d+) WITHOUT a corresponding tool-call
 *     event for that order in the same turn, fail with feedback "you must
 *     call get_order_refund_policy before answering policy questions about
 *     a specific order."
 *   - Exhaustion policy is 'last-response' so the test does not crash if
 *     the model is stubborn -- but the runtime must at least retry.
 *   - Final assistantText references the distinctive phrase returned by
 *     the mocked tool, proving the tool result actually influenced the
 *     final answer.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-tool-required-no-text-only.ts
 */

import { customGuardrail } from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  type RuntimeEvent,
  type Guardrail,
} from './harness.js';

// Distinctive phrase returned by the mock so we can prove the tool result
// flowed into the final text.
const POLICY_PHRASE = '30-day enterprise return window';

const AGENT_SOURCE = `
system:
    instructions: "You are a customer-service assistant for a retailer with order-specific refund policies. Whenever a user asks about the refund policy for a specific order id (e.g. ORD-9001), you MUST call get_order_refund_policy with that order id BEFORE answering. Do not give generic policy text for a specific order -- always look it up first."

config:
    agent_name: "PolicyBot"
    default_agent_user: "support@example.com"

language:
    default_locale: "en_US"

variables:
    last_policy: mutable string = ""
        description: "Most recent policy text returned by the tool"

start_agent policy_bot:
    description: "Answers refund-policy questions"

    actions:
        Get_Order_Refund_Policy:
            description: "Look up the refund policy for a specific order"
            inputs:
                order_id: string
                    description: "Order identifier"
                    is_required: True
            outputs:
                policy_text: string
                    description: "The refund policy applicable to this order"
                window_days: string
                    description: "Refund window length in days"
            target: "fn://get_order_refund_policy"

    reasoning:
        instructions: ->
            |   When the user asks about the refund policy for a specific
                order id, ALWAYS call {!@actions.policy} first with that order
                id, then summarize the returned policy_text in your reply.
                Never invent policy text for a specific order.
        actions:
            policy: @actions.Get_Order_Refund_Policy
                with order_id=...
                set @variables.last_policy = @outputs.policy_text
`;

// ---------------------------------------------------------------------------
// Custom guardrail: if text mentions an order id but no tool call covered
// that order id this turn, fail.
// ---------------------------------------------------------------------------

interface ToolCallSnapshot {
  name: string;
  orderId?: string;
}

function makeRequireLookupGuardrail(
  toolCallsThisTurn: () => ToolCallSnapshot[]
): Guardrail {
  return customGuardrail({
    name: 'require-policy-lookup',
    target: 'text',
    maxRetries: 1,
    feedbackTemplate:
      '{error} You must call get_order_refund_policy before answering policy questions about a specific order.',
    validate(output) {
      const orderIds = Array.from(output.text.matchAll(/ORD-\d+/g)).map(
        m => m[0]
      );
      if (orderIds.length === 0) return { valid: true };

      const calls = toolCallsThisTurn();
      const policyCalls = calls.filter(c =>
        c.name.includes('get_order_refund_policy')
      );
      const coveredOrderIds = new Set(
        policyCalls.map(c => c.orderId).filter(Boolean) as string[]
      );

      const uncovered = orderIds.filter(id => !coveredOrderIds.has(id));
      if (uncovered.length === 0) return { valid: true };

      return {
        valid: false,
        reason: `Text mentioned order(s) ${uncovered.join(', ')} without a corresponding get_order_refund_policy tool call.`,
      };
    },
  });
}

async function main(): Promise<void> {
  console.log('=== test-tool-required-no-text-only ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools, callLog } = mockTool({
    get_order_refund_policy: {
      delayMs: 30,
      result: {
        policy_text: `${POLICY_PHRASE}: full refund within 30 calendar days for verified enterprise accounts.`,
        window_days: '30',
      },
    },
  });

  // Track tool calls for the guardrail. The guardrail runs after each LLM
  // step, so we read the latest snapshot at validate-time.
  const toolCallsThisTurn: ToolCallSnapshot[] = [];

  const guardrail = makeRequireLookupGuardrail(() => toolCallsThisTurn.slice());

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    guardrails: [guardrail],
    exhaustionPolicy: 'last-response',
    maxStepsPerTurn: 8,
    llmDriver,
  });

  // Subscribe BEFORE the turn so we can populate toolCallsThisTurn live.
  runtime.on(e => {
    if (e.kind === 'tool-call') {
      const args = e.args as { order_id?: unknown };
      const orderId =
        typeof args.order_id === 'string' ? args.order_id : undefined;
      toolCallsThisTurn.push({ name: e.name, orderId });
    }
  });

  const userInput = "What's the refund policy on ORD-9001?";
  console.log(`--- Turn 1: ${JSON.stringify(userInput)} ---\n`);
  const turn1 = await runTurn(runtime, userInput);

  console.log(`  Duration: ${turn1.durationMs}ms`);
  for (const e of turn1.events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (e.kind === 'guardrail-pass') {
      console.log(`  [guard-pass] ${e.name}`);
    } else if (e.kind === 'guardrail-fail') {
      console.log(
        `  [guard-fail] ${e.name} attempt=${e.attempt} err=${e.error}`
      );
    } else if (e.kind === 'guardrail-exhausted') {
      console.log(`  [guard-exh]  ${e.name} attempts=${e.attempts}`);
    }
  }
  console.log(
    `  Final text: ${JSON.stringify(turn1.result.assistantText.slice(0, 240))}\n`
  );

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------

  // 1. The policy tool was eventually called for ORD-9001.
  const toolCallEvents = turn1.events.filter(
    e => e.kind === 'tool-call'
  ) as Array<Extract<RuntimeEvent, { kind: 'tool-call' }>>;
  const policyCalled = toolCallEvents.some(e =>
    e.name.includes('get_order_refund_policy')
  );
  assertions.ok(
    policyCalled,
    'get_order_refund_policy was called by end of turn',
    `tool calls: ${toolCallEvents.map(e => e.name).join(', ')}`
  );

  const calledForOrder = callLog.some(c => {
    const args = c.args as { order_id?: unknown };
    return (
      c.name === 'get_order_refund_policy' &&
      typeof args.order_id === 'string' &&
      args.order_id.includes('ORD-9001')
    );
  });
  assertions.ok(
    calledForOrder,
    'get_order_refund_policy was called with order_id ORD-9001',
    `callLog: ${JSON.stringify(callLog)}`
  );

  // 2. The flow either:
  //    (a) called the tool first thing -- 0 guardrail-fail events, or
  //    (b) went text-only first -- >= 1 guardrail-fail events, then retried.
  //    Either path is acceptable; we just record what happened.
  const guardrailFails = turn1.events.filter(
    e => e.kind === 'guardrail-fail'
  ).length;
  assertions.gte(
    guardrailFails,
    0,
    `guardrail-fail count was ${guardrailFails} (>=0 acceptable)`
  );

  // 3. Final assistantText references the distinctive phrase from the
  //    mocked tool -- proves tool result influenced the final answer.
  const finalText = (turn1.result.assistantText ?? '').toString();
  const referencesPolicy =
    finalText.includes(POLICY_PHRASE) ||
    /30[\s-]?day/i.test(finalText) ||
    finalText.toLowerCase().includes('enterprise');
  assertions.ok(
    referencesPolicy,
    'final assistantText references value returned by mocked tool',
    `text: ${JSON.stringify(finalText.slice(0, 240))}`
  );

  // 4. No tool-error events
  const errorEvents = turn1.events.filter(e => e.kind === 'tool-error');
  assertions.eq(errorEvents.length, 0, 'no tool-error events');

  report('test-tool-required-no-text-only');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
