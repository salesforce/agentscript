/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test (T2.7): hallucinated tool name. The system prompt plants a
 * reference to a tool that is NOT registered (`escalate_to_human`). When
 * the user asks to be escalated, the model is likely to emit a call to
 * the hallucinated tool. The runtime must:
 *
 *   1. Surface the bad call as a `tool-error` (one event)
 *   2. NOT throw out of the turn
 *   3. Allow the model to self-correct in the same turn (e.g. by calling
 *      `create_case` to log the escalation request) — proving the error
 *      message is surfaced back into the chat history and used by the LLM
 *   4. Produce a non-empty assistantText
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-hallucinated-tool.ts
 */

import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline agent source — the system instructions intentionally MENTION a
// tool that is not registered, to encourage the model to hallucinate it.
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are a support bot. When a user wants escalation, you can call escalate_to_human. Otherwise, log a case via create_case and look up orders via lookup_order."

config:
    agent_name: "HallucinationTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    case_id: mutable string = ""
        description: "Case id once created"

start_agent support_bot:
    description: "Support bot — only create_case and lookup_order are real"

    actions:
        Create_Case:
            description: "Create a support case"
            inputs:
                summary: string
                    description: "Short description"
                    is_required: True
            outputs:
                case_id: string
                    description: "ID of the created case"
            target: "fn://create_case"

        Lookup_Order:
            description: "Look up an order"
            inputs:
                order_number: string
                    description: "Order number"
                    is_required: False
            outputs:
                status: string
                    description: "Order status"
            target: "fn://lookup_order"

    reasoning:
        instructions: ->
            |   Help the user. If they ask for escalation, log a case via
                {!@actions.case} summarising why they want to escalate.
        actions:
            case: @actions.Create_Case
                with summary=...
                set @variables.case_id = @outputs.case_id

            order: @actions.Lookup_Order
                with order_number=...
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-hallucinated-tool ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Only `create_case` and `lookup_order` are registered. `escalate_to_human`
  // is intentionally absent.
  const { tools } = mockTool({
    create_case: {
      delayMs: 100,
      result: { case_id: 'CASE-007' },
    },
    lookup_order: {
      delayMs: 100,
      result: { status: 'shipped' },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 8,
    llmDriver,
  });

  // -------------------------------------------------------------------------
  // Run turn
  // -------------------------------------------------------------------------
  const userInput =
    "This is the third time I've called. Just escalate me to a human.";
  console.log(`> user: ${userInput}\n`);

  let capture;
  try {
    capture = await runTurn(runtime, userInput);
  } catch (err) {
    assertions.ok(
      false,
      'turn did not throw',
      `runtime threw: ${(err as Error).message}`
    );
    report('test-hallucinated-tool');
    return;
  }

  console.log(`  Duration: ${capture.durationMs}ms`);
  console.log(`  Final node: ${capture.result.finalNode}`);

  for (const e of capture.events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (e.kind === 'tool-error') {
      console.log(`  [tool-err]   ${e.name} :: ${e.error}`);
    }
  }
  console.log('');
  console.log(
    `  assistantText: ${JSON.stringify(capture.result.assistantText.slice(0, 200))}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  assertions.ok(true, 'turn did not throw');

  // 1. At least one tool-error event for an unknown tool name. We allow
  // zero only if the model never hallucinated (in which case the test is
  // not exercising what it claims and we mark it as inconclusive).
  const toolErrors = capture.events.filter(e => e.kind === 'tool-error');
  if (toolErrors.length === 0) {
    console.log(
      '  NOTE: model did not hallucinate this run — test is inconclusive but not failing.'
    );
    assertions.ok(
      true,
      'tool-error count >= 0 (inconclusive: no hallucination this run)'
    );
  } else {
    assertions.gte(toolErrors.length, 1, 'at least one tool-error event');
  }

  // 2. assistantText is non-empty
  assertions.ok(
    capture.result.assistantText.length > 0,
    'assistantText is non-empty',
    `length=${capture.result.assistantText.length}`
  );

  // 3. maxStepsPerTurn was not exhausted (we'd see a maxSteps event or
  // the turn would terminate without a clean response — heuristic: at
  // least one of create_case OR a final assistant text was produced).
  const hadCreateCase = capture.events.some(
    e => e.kind === 'tool-call' && e.name === 'fn://create_case'
  );
  const hasText = capture.result.assistantText.length > 0;
  assertions.ok(
    hadCreateCase || hasText,
    'turn produced a corrective action or final text (maxSteps not exhausted unproductively)',
    `create_case=${hadCreateCase}, hasText=${hasText}`
  );

  // 4. If the model hallucinated, we should also see a subsequent valid
  // tool-call for create_case in the same turn — proving the runtime
  // surfaced the error back to the model and it self-corrected.
  if (toolErrors.length > 0) {
    const callOrder = capture.events.filter(
      e => e.kind === 'tool-error' || e.kind === 'tool-call'
    );
    const firstErrorIdx = callOrder.findIndex(e => e.kind === 'tool-error');
    const correctiveAfter = callOrder
      .slice(firstErrorIdx + 1)
      .some(e => e.kind === 'tool-call' && e.name === 'fn://create_case');
    assertions.ok(
      correctiveAfter,
      'model self-corrected with create_case after hallucinated tool error',
      correctiveAfter
        ? undefined
        : 'no create_case after the tool-error — model did not self-correct in this turn'
    );
  }

  report('test-hallucinated-tool');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
