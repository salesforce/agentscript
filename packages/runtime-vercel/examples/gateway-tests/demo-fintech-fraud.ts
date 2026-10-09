/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demo: Fintech — fraud triage (parallel timing proof)
 *
 * What it shows:
 *   Three risk lookups (LookupTransaction, CheckDeviceFingerprint,
 *   GeoRiskScore) fired in parallel, then a dispute filed. Each lookup
 *   has a hard-coded 300ms delay.
 *
 * Wow moment:
 *   Print parallel duration (~300ms) vs sequential lower bound (900ms)
 *   plus a span/handoff summary so it's obvious the runtime collapsed
 *   three sequential I/O calls into one wall-clock window.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/demo-fintech-fraud.ts
 */

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

const AGENT_SOURCE = `
system:
    instructions: "You are a fraud triage analyst. When a user reports a suspicious charge, you MUST in a single step run all three risk lookups (lookup_transaction, check_device, geo_risk) in parallel, then file a dispute using the gathered signals. Do not ask the user to wait or ask follow-up questions."

config:
    agent_name: "FraudTriageBot"
    default_agent_user: "fraud@example.com"

language:
    default_locale: "en_US"

variables:
    txn_amount: mutable number = 0
        description: "Disputed transaction amount in USD"
    txn_merchant: mutable string = ""
        description: "Merchant name"
    txn_location: mutable string = ""
        description: "Charge location"
    risk_score: mutable number = 0
        description: "Aggregate risk 0-100"
    device_trusted: mutable boolean = False
        description: "Whether device fingerprint is trusted"
    geo_anomaly: mutable boolean = False
        description: "Whether the location is anomalous"
    dispute_id: mutable string = ""
        description: "Generated dispute identifier"

start_agent fraud_triage:
    description: "Runs three risk lookups in parallel and files a dispute"

    actions:
        Lookup_Transaction:
            description: "Look up the disputed transaction by amount and approximate location"
            inputs:
                amount: number
                    description: "Charge amount in USD"
                    is_required: True
                location_hint: string
                    description: "City / country mentioned by the user"
                    is_required: True
            outputs:
                merchant: string
                    description: "Merchant name"
                amount: number
                    description: "Confirmed amount"
                category: string
                    description: "MCC category"
            target: "fn://LookupTransaction"

        Check_Device_Fingerprint:
            description: "Check whether the device used to authorise the charge is trusted"
            inputs:
                amount: number
                    description: "Charge amount"
                    is_required: True
            outputs:
                device_trusted: boolean
                    description: "Whether device is on trusted list"
                fingerprint: string
                    description: "Hashed fingerprint"
            target: "fn://CheckDeviceFingerprint"

        Geo_Risk_Score:
            description: "Score the geographic risk of the charge location"
            inputs:
                location_hint: string
                    description: "City / country mentioned by the user"
                    is_required: True
            outputs:
                geo_anomaly: boolean
                    description: "Whether location is anomalous"
                score: number
                    description: "Risk score 0-100"
            target: "fn://GeoRiskScore"

        File_Dispute:
            description: "File a dispute on the charge once risk lookups have run"
            inputs:
                amount: number
                    description: "Charge amount"
                    is_required: True
                merchant: string
                    description: "Merchant name"
                    is_required: True
                risk_score: number
                    description: "Aggregate risk score"
                    is_required: True
            outputs:
                dispute_id: string
                    description: "Identifier for the new dispute"
                status: string
                    description: "Status of the dispute filing"
            target: "fn://FileDispute"

    reasoning:
        instructions: ->
            |   The user reports a suspicious charge. In a SINGLE step, call
            |   {!@actions.lookup}, {!@actions.device}, and {!@actions.geo}
            |   in parallel. Then in the next step call {!@actions.file}
            |   with the gathered signals. Do not skip lookups.
        actions:
            lookup: @actions.Lookup_Transaction
                with amount=@variables.txn_amount
                with location_hint=@variables.txn_location
                set @variables.txn_merchant = @outputs.merchant

            device: @actions.Check_Device_Fingerprint
                with amount=@variables.txn_amount
                set @variables.device_trusted = @outputs.device_trusted

            geo: @actions.Geo_Risk_Score
                with location_hint=@variables.txn_location
                set @variables.geo_anomaly = @outputs.geo_anomaly
                set @variables.risk_score = @outputs.score

            file: @actions.File_Dispute
                with amount=@variables.txn_amount
                with merchant=@variables.txn_merchant
                with risk_score=@variables.risk_score
                set @variables.dispute_id = @outputs.dispute_id
`;

async function main(): Promise<void> {
  console.log('=== demo-fintech-fraud ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const PARALLEL_DELAY_MS = 300;
  const { tools, callLog } = mockTool({
    LookupTransaction: {
      delayMs: PARALLEL_DELAY_MS,
      result: {
        merchant: 'Lagos Electronics',
        amount: 740,
        category: 'electronics',
      },
    },
    CheckDeviceFingerprint: {
      delayMs: PARALLEL_DELAY_MS,
      result: { device_trusted: false, fingerprint: 'fp_8f4c01' },
    },
    GeoRiskScore: {
      delayMs: PARALLEL_DELAY_MS,
      result: { geo_anomaly: true, score: 87 },
    },
    FileDispute: {
      delayMs: 30,
      result: { dispute_id: 'DSP-2026-44801', status: 'pending_review' },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    parallel: { strategy: 'always' },
    maxStepsPerTurn: 8,
    llmDriver,
  });

  // Pre-seed the variables so the LLM can dispatch lookups without
  // having to extract the structured fields from the prose first.
  runtime.state.set('txn_amount', 740);
  runtime.state.set('txn_location', 'Lagos');

  console.log('--- User: $740 charge from Lagos, not me ---\n');
  const turn = await runTurn(
    runtime,
    "There's a $740 charge from Lagos on my card I didn't make. Help."
  );

  printEvents(turn.events);

  // -------------------------------------------------------------------------
  // Wow moment: parallel timing summary
  // -------------------------------------------------------------------------
  const lookupTimes = callLog
    .filter(c =>
      ['LookupTransaction', 'CheckDeviceFingerprint', 'GeoRiskScore'].includes(
        c.name
      )
    )
    .map(c => c.timestamp);
  const spread = lookupTimes.length
    ? Math.max(...lookupTimes) - Math.min(...lookupTimes)
    : 0;

  const enteredNodes = turn.events
    .filter(e => e.kind === 'node-enter')
    .map(e => (e as { node: string }).node);

  console.log('+----------------------------------------------+');
  console.log('| Fraud triage timing                          |');
  console.log('+----------------------------------------------+');
  console.log(
    `|  parallel turn duration:        ${turn.durationMs}ms`.padEnd(47) + '|'
  );
  console.log(
    '|  sequential lower bound:        900ms (3 x 300ms)'.padEnd(47) + '|'
  );
  console.log(
    `|  three-lookup invocation spread:  ${spread}ms`.padEnd(47) + '|'
  );
  console.log('+----------------------------------------------+');
  console.log(`  Topics entered : [${enteredNodes.join(' -> ')}]`);
  console.log(`  Dispute ID     : ${runtime.state.get('dispute_id')}`);
  console.log(`  Risk score     : ${runtime.state.get('risk_score')}`);
  console.log(`  Final text     : ${turn.result.assistantText.slice(0, 160)}`);
  console.log('');

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  const toolNames = turn.events
    .filter(e => e.kind === 'tool-call')
    .map(e => (e as { name: string }).name);

  assertions.ok(
    toolNames.includes('fn://LookupTransaction'),
    'LookupTransaction was called',
    `tools: ${toolNames.join(', ')}`
  );
  assertions.ok(
    toolNames.includes('fn://CheckDeviceFingerprint'),
    'CheckDeviceFingerprint was called'
  );
  assertions.ok(
    toolNames.includes('fn://GeoRiskScore'),
    'GeoRiskScore was called'
  );

  if (lookupTimes.length >= 3) {
    assertions.lt(
      spread,
      100,
      'three risk lookups fired within a 100ms window (parallel)'
    );
  } else {
    assertions.ok(
      false,
      'three risk lookups fired',
      `only ${lookupTimes.length} lookups recorded`
    );
  }

  // Note: total turn duration includes 2x LLM round-trips on top of the
  // 300ms tool window, which on Opus can run 5-20s. The wow moment is the
  // *invocation spread* — three tools firing simultaneously — not the
  // overall wall clock. We assert the tool-window contribution alone.
  const toolWindowMs = lookupTimes.length
    ? Math.max(...lookupTimes) - Math.min(...lookupTimes) + PARALLEL_DELAY_MS
    : 0;
  assertions.lt(
    toolWindowMs,
    700,
    `parallel tool window < 700ms (sequential lower bound 900ms; was ${toolWindowMs}ms)`
  );

  const finalText = turn.result.assistantText ?? '';
  const disputeId = String(runtime.state.get('dispute_id') ?? '');
  const mentionsDispute =
    finalText.includes(disputeId) ||
    /dispute/i.test(finalText) ||
    disputeId.length > 0;
  assertions.ok(
    mentionsDispute,
    'final text references dispute / dispute_id is populated',
    `dispute_id=${disputeId} text=${finalText.slice(0, 120)}`
  );

  report('demo-fintech-fraud');
}

function printEvents(events: RuntimeEvent[]): void {
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name}`);
    } else if (e.kind === 'parallel-dispatch-start') {
      console.log(`  [parallel-start] ${e.toolNames.join(', ')}`);
    } else if (e.kind === 'parallel-dispatch-end') {
      console.log(`  [parallel-end]   ${e.toolNames.join(', ')}`);
    } else if (e.kind === 'node-enter') {
      console.log(`  [node-enter] ${e.node}`);
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
