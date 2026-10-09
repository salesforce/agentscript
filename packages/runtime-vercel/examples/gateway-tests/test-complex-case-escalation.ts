/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: drives the full case_escalation_bot agent
 * (4 topics: customer_verification -> case_creation -> escalation_assessment
 *  -> case_resolution, 8 tools).
 *
 * Validates:
 *   1. Customer verification fires with the email we supplied
 *   2. State customer_verified flips to true after lookup
 *   3. A support case gets created (CreateSupportCase tool fires)
 *   4. Agent reaches case_creation topic via handoff
 *   5. Light text check: assistant references the case number from
 *      the tool output
 *   6. No error events
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-complex-case-escalation.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  type RuntimeEvent,
} from './harness.js';

const here = dirname(fileURLToPath(import.meta.url));
const AGENT_SOURCE = readFileSync(
  join(here, 'agents/case-escalation.agent'),
  'utf8'
);

const CASE_NUMBER = 'CASE-44312';

async function main(): Promise<void> {
  console.log('=== test-complex-case-escalation ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools, callLog } = mockTool({
    VerifyCustomerIdentity: {
      delayMs: 40,
      result: {
        customer_found: true,
        customer_name: 'Grace Hopper',
        customer_id: 'CUST-VERIFY-9001',
        account_status: 'active',
        verification_level: 'standard',
      },
    },
    GetCustomerCaseHistory: {
      delayMs: 40,
      result: {
        previous_cases: 1,
        recent_case_type: 'technical',
        customer_tier: 'standard',
        escalation_history: false,
      },
    },
    CreateSupportCase: {
      delayMs: 40,
      result: {
        case_number: CASE_NUMBER,
        estimated_resolution: '24h',
        assigned_agent: 'agent_42',
        auto_escalate: false,
      },
    },
    CalculateEscalationScore: {
      delayMs: 40,
      result: {
        escalation_score: 35,
        recommended_tier: '',
        immediate_escalation: false,
      },
    },
    InitiateEscalation: {
      delayMs: 40,
      result: {
        escalation_approved: true,
        assigned_specialist: 'spec_77',
        response_sla: '4h',
        escalation_id: 'ESC-001',
      },
    },
    NotifyCustomer: {
      delayMs: 40,
      result: { notification_sent: true, delivery_method: 'email' },
    },
    ProvideSolution: {
      delayMs: 40,
      result: { solution_text: 'Restart the device.', success: true },
    },
    CloseCase: {
      delayMs: 40,
      result: { closed: true, satisfaction_score: 5 },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 12,
    llmDriver,
  });

  const allEvents: RuntimeEvent[] = [];

  // -------------------------------------------------------------------------
  // Turn 1 — provide email + name + an issue
  // -------------------------------------------------------------------------
  console.log(
    '--- Turn 1: customer email, name, and a billing issue description ---\n'
  );
  const turn1 = await runTurn(
    runtime,
    "Hi, I'm Grace Hopper, email grace@example.com. I have a billing issue — I was double-charged on my last invoice. Please open a case for me."
  );
  allEvents.push(...turn1.events);
  logTurn(turn1.events, turn1.durationMs);

  // -------------------------------------------------------------------------
  // Turn 2 — confirm and proceed
  // -------------------------------------------------------------------------
  console.log('--- Turn 2: please proceed and create the case ---\n');
  const turn2 = await runTurn(
    runtime,
    'Yes, please go ahead and create the case with a clear description of the double charge.'
  );
  allEvents.push(...turn2.events);
  logTurn(turn2.events, turn2.durationMs);

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  const toolNames = allEvents
    .filter(e => e.kind === 'tool-call')
    .map(e => (e as { kind: 'tool-call'; name: string }).name);

  assertions.ok(
    toolNames.includes('fn://VerifyCustomerIdentity'),
    'VerifyCustomerIdentity was called',
    `tool calls: ${toolNames.join(', ')}`
  );

  const verifyCall = callLog.find(c => c.name === 'VerifyCustomerIdentity');
  assertions.ok(
    !!verifyCall &&
      typeof (verifyCall.args as { email?: string }).email === 'string' &&
      (verifyCall.args as { email: string }).email
        .toLowerCase()
        .includes('grace@example.com'),
    'VerifyCustomerIdentity was called with the email we supplied',
    `args: ${JSON.stringify(verifyCall?.args)}`
  );

  assertions.eq(
    runtime.state.get('customer_verified'),
    true,
    'state customer_verified is true after lookup'
  );

  assertions.eq(
    runtime.state.get('customer_id'),
    'CUST-VERIFY-9001',
    'state customer_id propagated from tool output'
  );

  assertions.ok(
    toolNames.includes('fn://CreateSupportCase'),
    'CreateSupportCase was called',
    `tool calls: ${toolNames.join(', ')}`
  );

  const enteredNodes = allEvents
    .filter(e => e.kind === 'node-enter')
    .map(e => (e as { kind: 'node-enter'; node: string }).node);
  assertions.ok(
    enteredNodes.includes('case_creation'),
    'agent handed off to case_creation topic',
    `nodes entered: [${enteredNodes.join(', ')}]`
  );

  // Light text check on the final response — should reference the case number
  // returned by CreateSupportCase or at least mention "case".
  const finalText = (turn2.result.assistantText ?? '').toString();
  const mentionsCase =
    finalText.includes(CASE_NUMBER) ||
    /case[\s#-]*\d+/i.test(finalText) ||
    finalText.toLowerCase().includes('case');
  assertions.ok(
    mentionsCase,
    'assistant final response references the case',
    `text: ${JSON.stringify(finalText.slice(0, 200))}`
  );

  const errorEvents = allEvents.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.ok(
    errorEvents.length === 0,
    'no error events across all turns',
    JSON.stringify(errorEvents)
  );

  report('test-complex-case-escalation');
}

function logTurn(events: RuntimeEvent[], durationMs: number): void {
  console.log(`  Duration: ${durationMs}ms`);
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (e.kind === 'node-enter') {
      console.log(`  [node-enter] ${e.node}`);
    } else if (e.kind === 'node-exit') {
      console.log(`  [node-exit]  ${e.node}${e.to ? ' -> ' + e.to : ''}`);
    } else if (
      e.kind === 'state-change' &&
      !e.name.startsWith('AgentScriptInternal_')
    ) {
      console.log(
        `  [state]      ${e.name}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`
      );
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
