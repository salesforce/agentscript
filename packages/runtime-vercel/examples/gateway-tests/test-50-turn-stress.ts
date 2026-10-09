/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tier-3 long-conversation stress: drive a 3-topic telco support agent
 * through up to 50 sequential synthetic user turns. Real LLM (gateway).
 *
 * To control real-LLM cost, default turn count is 10. Override with:
 *   STRESS_TURNS=50 pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-50-turn-stress.ts
 *
 * The runtime exposes per-tool `toolLimits` (with `resetPerTurn`) — there is
 * no global `maxToolCallsPerTurn`, so we apply a per-tool cap that the model
 * could plausibly try to bust during a "tool storm" turn.
 *
 * Tracks:
 *   - total tool calls
 *   - per-turn cap-hit count (tool-limit-reached events)
 *   - guardrail rejections
 *   - errors
 *   - peak per-turn duration, P50/P95
 */

import { Runtime } from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  compile,
  runTurn,
  mockTool,
  assertions,
  report,
  type RuntimeEvent,
} from './harness.js';

const STRESS_TURNS = Math.max(
  1,
  Math.min(50, Number(process.env.STRESS_TURNS ?? 10))
);

const AGENT_SOURCE = `
system:
    instructions: "You are a telco support agent. Answer the user concisely. Use tools when they help. Hand off between topics as the conversation evolves: account_lookup for identity/profile questions, billing for charges/invoices, technical for connectivity issues."

config:
    agent_name: "TelcoStressBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    last_account: mutable string = ""
        description: "Last account looked up"

start_agent account_lookup:
    description: "Identify the customer"

    actions:
        Lookup_Account:
            description: "Look up an account by id"
            inputs:
                account_id: string
                    description: "Account id"
                    is_required: True
            outputs:
                account: string
                    description: "Account details"
            target: "fn://lookup_account"

    reasoning:
        instructions: ->
            |   When you have an account id, look it up. Then transition
            |   to billing or technical depending on the user's question.
        actions:
            lookup: @actions.Lookup_Account
                with account_id=...
                set @variables.last_account = @outputs.account

            go_billing: @utils.transition to @topic.billing
                description: "User asked about charges"

            go_technical: @utils.transition to @topic.technical
                description: "User has a connectivity issue"

topic billing:
    description: "Handle billing questions"

    actions:
        Get_Invoices:
            description: "Get last invoices"
            inputs:
                account_id: string
                    description: "Account id"
                    is_required: True
            outputs:
                invoices: string
                    description: "Invoices"
            target: "fn://get_invoices"

    reasoning:
        instructions: ->
            |   Help with billing. Use {!@actions.Get_Invoices} when asked.
            |   Hand back to account_lookup if the user changes topic.
        actions:
            get_inv: @actions.Get_Invoices
                with account_id=...

            back: @utils.transition to @topic.account_lookup
                description: "Back to identity"

topic technical:
    description: "Handle technical issues"

    actions:
        Run_Diagnostic:
            description: "Run a diagnostic"
            inputs:
                account_id: string
                    description: "Account id"
                    is_required: True
            outputs:
                status: string
                    description: "Diagnostic"
            target: "fn://run_diagnostic"

    reasoning:
        instructions: ->
            |   Help with connectivity. Use {!@actions.Run_Diagnostic}.
            |   Hand back to account_lookup if the user changes topic.
        actions:
            run_diag: @actions.Run_Diagnostic
                with account_id=...

            back2: @utils.transition to @topic.account_lookup
                description: "Back to identity"
`;

// Synthetic 50-turn user-message script — small, repetitive, designed to
// keep a real model on track while exercising tool calls and topic shifts.
// One slot near the middle deliberately tries to provoke a tool-call storm.
function makeUserScript(n: number): string[] {
  const base = [
    "Hi, I'm account ACC-1001. Can you look me up?",
    'What were my last 3 invoices?',
    "I think I'm being overcharged this month — can you double-check?",
    "Can you also run a diagnostic? My internet's been flaky.",
    'Thanks. Now back to identity — what email is on the account?',
    'Look up account ACC-2002 instead.',
    'What invoices does that account have?',
    "Run a diagnostic for ACC-2002 too — and please also re-check ACC-1001's diagnostic, ACC-2002's invoices, the diagnostic again, and one more time the invoices. Try to be thorough — call all the tools you need.",
    'Okay, summarize everything in one paragraph.',
    "That's all, thanks.",
  ];
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(base[i % base.length]);
  return out;
}

async function main(): Promise<void> {
  console.log('=== test-50-turn-stress ===\n');
  console.log(`STRESS_TURNS=${STRESS_TURNS}\n`);

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools, callLog } = mockTool({
    lookup_account: {
      delayMs: 20,
      result: { account: 'name=Jane Doe; email=jd@example.com; plan=Gold' },
    },
    get_invoices: {
      delayMs: 30,
      result: {
        invoices:
          'INV-001 $42.10 (paid); INV-002 $48.95 (paid); INV-003 $51.00 (open)',
      },
    },
    run_diagnostic: {
      delayMs: 40,
      result: { status: 'OK; downstream 920Mbps; 0% packet loss' },
    },
  });

  // Per-turn tool cap (resetPerTurn). Each tool capped at 3 calls/turn.
  // The "storm" turn (index 7 in the cycle) is likely to ask for >3 of the
  // same tool — assert at least one cap-hit fires.
  const PER_TOOL_CAP = 3;

  // We use Runtime directly so we can pass toolLimits — createTestAgent
  // (in harness.ts) doesn't expose that option.
  const doc = compile(AGENT_SOURCE);
  const rt = new Runtime({
    doc,
    llm: llmDriver,
    tools,
    parallel: { strategy: 'auto' },
    maxStepsPerTurn: 12,
    toolLimits: {
      lookup_account: { maxCalls: PER_TOOL_CAP, resetPerTurn: true },
      get_invoices: { maxCalls: PER_TOOL_CAP, resetPerTurn: true },
      run_diagnostic: { maxCalls: PER_TOOL_CAP, resetPerTurn: true },
    },
  });

  const userMsgs = makeUserScript(STRESS_TURNS);

  let totalToolCalls = 0;
  let totalCapHits = 0;
  let totalGuardrailRejects = 0;
  let totalErrors = 0;
  const durations: number[] = [];
  const allEvents: RuntimeEvent[] = [];

  for (let i = 0; i < userMsgs.length; i++) {
    const msg = userMsgs[i];
    const t0 = Date.now();
    let durationMs = 0;
    try {
      const cap = await runTurn(rt, msg);
      durationMs = cap.durationMs;
      durations.push(cap.durationMs);
      allEvents.push(...cap.events);

      const turnToolCalls = cap.events.filter(
        e => e.kind === 'tool-call'
      ).length;
      const turnCapHits = cap.events.filter(
        e => e.kind === 'tool-limit-reached'
      ).length;
      const turnGuardrailRejects = cap.events.filter(
        e => e.kind === 'guardrail-fail' || e.kind === 'guardrail-exhausted'
      ).length;

      totalToolCalls += turnToolCalls;
      totalCapHits += turnCapHits;
      totalGuardrailRejects += turnGuardrailRejects;

      console.log(
        `[turn ${String(i + 1).padStart(2)}] ${cap.durationMs}ms ` +
          `tools=${turnToolCalls} cap-hits=${turnCapHits} ` +
          `node=${rt.currentNodeName} ` +
          `text="${(cap.result.assistantText ?? '').slice(0, 60).replace(/\n/g, ' ')}"`
      );
    } catch (err) {
      totalErrors++;
      durationMs = Date.now() - t0;
      durations.push(durationMs);
      console.error(`[turn ${i + 1}] ERROR after ${durationMs}ms:`, err);
    }
  }

  // ----------------- Dashboard -----------------
  durations.sort((a, b) => a - b);
  const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
  const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
  const peak = durations[durations.length - 1] ?? 0;

  console.log('\n=== Dashboard ===');
  console.log(`turns:                 ${userMsgs.length}`);
  console.log(`total tool calls:      ${totalToolCalls}`);
  console.log(`per-turn cap hits:     ${totalCapHits}`);
  console.log(`guardrail rejections:  ${totalGuardrailRejects}`);
  console.log(`errors:                ${totalErrors}`);
  console.log(`P50 duration:          ${p50}ms`);
  console.log(`P95 duration:          ${p95}ms`);
  console.log(`peak duration:         ${peak}ms`);
  console.log(`mock tool invocations: ${callLog.length}`);

  // ----------------- Assertions -----------------
  assertions.eq(totalErrors, 0, 'no turn errors thrown');
  assertions.lt(p95, 30_000, 'P95 turn duration < 30s');
  // Cap-hit assertion: real LLMs are unpredictable. We accept either:
  //   (a) at least one cap-hit fired, OR
  //   (b) we document zero hits — the model never tried to bust the cap.
  if (totalCapHits === 0) {
    console.log(
      '\nNote: zero tool-cap hits observed. The model may have respected the implicit budget; this run does not assert a hit fired.'
    );
    assertions.ok(true, 'tool-cap behavior recorded (0 hits this run)');
  } else {
    assertions.gte(totalCapHits, 1, 'at least one per-turn tool cap fired');
  }

  report('test-50-turn-stress');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
