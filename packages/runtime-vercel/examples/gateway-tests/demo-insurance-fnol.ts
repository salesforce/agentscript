/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demo: Insurance — First-Notice-of-Loss state machine
 *
 * What it shows:
 *   A 5-topic FNOL workflow with a conditional branch:
 *
 *     intake -> coverage_check -> damage_assessment
 *                                    |
 *                                    +-- (score > 0.6) -> fraud_review -> settlement_offer
 *                                    +-- (score <= 0.6) ----------------> settlement_offer
 *
 *   Two scenarios run back-to-back as fresh Runtime instances:
 *     (a) low-severity windshield claim: SKIPS fraud_review
 *     (b) high-severity fire claim: TAKES fraud_review
 *
 * Wow moment:
 *   Hand-drawn ASCII state diagram, then the actual handoff trail per
 *   scenario with explicit "skipped fraud_review" annotation.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/demo-insurance-fnol.ts
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
    instructions: "You are an insurance FNOL (first notice of loss) intake bot. Walk the policyholder through intake, coverage check, damage assessment. If the damage assessment yields a fraud_score > 0.6 (set in state by the assessment tool), transition to fraud_review BEFORE settlement_offer. Otherwise go directly to settlement_offer. Use the tools — don't skip steps."

config:
    agent_name: "FnolBot"
    default_agent_user: "claims@example.com"

language:
    default_locale: "en_US"

variables:
    claim_id: mutable string = ""
        description: "Generated claim id"
    policy_number: mutable string = ""
        description: "Policyholder policy number"
    incident_type: mutable string = ""
        description: "Incident type (windshield, fire, collision)"
    coverage_ok: mutable boolean = False
        description: "Whether coverage is in force"
    severity: mutable string = ""
        description: "Severity rank: low, medium, high"
    fraud_score: mutable number = 0
        description: "Fraud score 0-1"
    fraud_cleared: mutable boolean = False
        description: "Whether fraud review cleared"
    settlement_offer: mutable number = 0
        description: "Final settlement offer USD"

start_agent intake:
    description: "Capture incident type and policy number"

    actions:
        Open_Claim:
            description: "Open a claim record from incident type + policy number"
            inputs:
                incident_type: string
                    description: "Incident category"
                    is_required: True
                policy_number: string
                    description: "Policy number"
                    is_required: True
            outputs:
                claim_id: string
                    description: "Generated claim id"
            target: "fn://OpenClaim"

    reasoning:
        instructions: ->
            |   Call {!@actions.open} with the captured incident_type and
            |   policy_number, then transition to coverage_check.
        actions:
            open: @actions.Open_Claim
                with incident_type=@variables.incident_type
                with policy_number=@variables.policy_number
                set @variables.claim_id = @outputs.claim_id

            go_coverage: @utils.transition to @topic.coverage_check
                description: "Move to coverage verification"

topic coverage_check:
    description: "Verify coverage is in force"

    actions:
        Verify_Coverage:
            description: "Verify policy coverage"
            inputs:
                policy_number: string
                    description: "Policy number"
                    is_required: True
                incident_type: string
                    description: "Incident category"
                    is_required: True
            outputs:
                covered: boolean
                    description: "Whether the incident is covered"
            target: "fn://VerifyCoverage"

    reasoning:
        instructions: ->
            |   Call {!@actions.verify}, capture coverage_ok, then transition
            |   to damage_assessment.
        actions:
            verify: @actions.Verify_Coverage
                with policy_number=@variables.policy_number
                with incident_type=@variables.incident_type
                set @variables.coverage_ok = @outputs.covered

            go_assess: @utils.transition to @topic.damage_assessment
                description: "Move to damage assessment"

topic damage_assessment:
    description: "Assess damage and compute fraud score"

    actions:
        Assess_Damage:
            description: "Assess damage and compute fraud_score"
            inputs:
                claim_id: string
                    description: "Claim id"
                    is_required: True
                incident_type: string
                    description: "Incident type"
                    is_required: True
            outputs:
                severity: string
                    description: "low, medium, high"
                fraud_score: number
                    description: "Fraud score 0-1"
            target: "fn://AssessDamage"

    reasoning:
        instructions: ->
            |   Call {!@actions.assess}, capture severity and fraud_score.
            |   If @variables.fraud_score > 0.6, transition to fraud_review.
            |   Otherwise transition to settlement_offer directly.
        actions:
            assess: @actions.Assess_Damage
                with claim_id=@variables.claim_id
                with incident_type=@variables.incident_type
                set @variables.severity = @outputs.severity
                set @variables.fraud_score = @outputs.fraud_score

            go_fraud_review: @utils.transition to @topic.fraud_review
                description: "Move to fraud review (high score path)"
                available when @variables.fraud_score > 0.6

            go_settlement: @utils.transition to @topic.settlement_offer
                description: "Move directly to settlement (low score path)"
                available when @variables.fraud_score <= 0.6

    after_reasoning:
        if @variables.fraud_score > 0.6:
            transition to @topic.fraud_review
        if @variables.fraud_score <= 0.6:
            transition to @topic.settlement_offer

topic fraud_review:
    description: "Run fraud review for high-score claims"

    actions:
        Run_Fraud_Review:
            description: "Run a fraud review on the claim"
            inputs:
                claim_id: string
                    description: "Claim id"
                    is_required: True
                fraud_score: number
                    description: "Computed fraud score"
                    is_required: True
            outputs:
                cleared: boolean
                    description: "Whether the claim cleared fraud review"
            target: "fn://RunFraudReview"

    reasoning:
        instructions: ->
            |   Call {!@actions.review} with the claim id and fraud score.
            |   Then transition to settlement_offer.
        actions:
            review: @actions.Run_Fraud_Review
                with claim_id=@variables.claim_id
                with fraud_score=@variables.fraud_score
                set @variables.fraud_cleared = @outputs.cleared

            go_settlement: @utils.transition to @topic.settlement_offer
                description: "Move to settlement offer"

topic settlement_offer:
    description: "Compute and offer settlement"

    actions:
        Offer_Settlement:
            description: "Compute and present a settlement offer"
            inputs:
                claim_id: string
                    description: "Claim id"
                    is_required: True
                severity: string
                    description: "Severity"
                    is_required: True
            outputs:
                offer: number
                    description: "Settlement amount USD"
            target: "fn://OfferSettlement"

    reasoning:
        instructions: ->
            |   Call {!@actions.offer} with the claim id and severity, then
            |   summarize the offer for the user.
        actions:
            offer: @actions.Offer_Settlement
                with claim_id=@variables.claim_id
                with severity=@variables.severity
                set @variables.settlement_offer = @outputs.offer
`;

const STATE_DIAGRAM = `
  +----------+    +----------------+    +-------------------+
  | intake   |--->| coverage_check |--->| damage_assessment |
  +----------+    +----------------+    +-------------------+
                                               |
                            score > 0.6 -------+------- score <= 0.6
                                |                              |
                                v                              v
                     +-----------------+           +-------------------+
                     | fraud_review    |---------->| settlement_offer  |
                     +-----------------+           +-------------------+
`;

interface ScenarioConfig {
  label: string;
  userInput: string;
  policy: string;
  incident: string;
  fraudScoreReturned: number;
  severityReturned: string;
  expectFraudReview: boolean;
}

async function runScenario(s: ScenarioConfig): Promise<void> {
  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  const { tools, callLog } = mockTool({
    OpenClaim: {
      delayMs: 20,
      result: { claim_id: 'CL-' + Math.floor(Math.random() * 90000 + 10000) },
    },
    VerifyCoverage: { delayMs: 20, result: { covered: true } },
    AssessDamage: {
      delayMs: 20,
      result: {
        severity: s.severityReturned,
        fraud_score: s.fraudScoreReturned,
      },
    },
    RunFraudReview: { delayMs: 20, result: { cleared: true } },
    OfferSettlement: {
      delayMs: 20,
      result: { offer: s.severityReturned === 'high' ? 22500 : 480 },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 12,
    llmDriver,
  });

  // Pre-seed structured fields
  runtime.state.set('policy_number', s.policy);
  runtime.state.set('incident_type', s.incident);

  console.log(`--- Scenario: ${s.label} ---`);
  console.log(`  > ${s.userInput}\n`);

  const events: RuntimeEvent[] = [];
  // Two turns: first to start the workflow, second to drive through any
  // remaining hops (some models pause between handoffs).
  const t1 = await runTurn(runtime, s.userInput);
  events.push(...t1.events);
  // Continue to ensure we land on settlement_offer
  const t2 = await runTurn(
    runtime,
    'Please continue with the next step and finalize the offer.'
  );
  events.push(...t2.events);

  const enteredNodes = events
    .filter(e => e.kind === 'node-enter')
    .map(e => (e as { node: string }).node);

  const fraudReviewVisited = enteredNodes.includes('fraud_review');
  const settlementReached = enteredNodes.includes('settlement_offer');

  console.log(`  handoff trail: ${enteredNodes.join(' -> ')}`);
  if (!fraudReviewVisited && s.fraudScoreReturned <= 0.6) {
    console.log(
      `  >> skipped fraud_review (score=${s.fraudScoreReturned} <= 0.6)`
    );
  }
  if (fraudReviewVisited) {
    console.log(`  >> took fraud_review (score=${s.fraudScoreReturned} > 0.6)`);
  }
  console.log(
    `  final state: severity=${runtime.state.get('severity')} ` +
      `offer=$${runtime.state.get('settlement_offer')} ` +
      `fraud_cleared=${runtime.state.get('fraud_cleared')}`
  );
  console.log('');

  // Assertions for this scenario
  assertions.eq(
    fraudReviewVisited,
    s.expectFraudReview,
    `[${s.label}] fraud_review ${
      s.expectFraudReview ? 'TAKEN' : 'SKIPPED'
    } as expected`
  );

  assertions.ok(
    settlementReached,
    `[${s.label}] reached settlement_offer`,
    `nodes: ${enteredNodes.join(', ')}`
  );

  for (const required of ['intake', 'coverage_check', 'damage_assessment']) {
    assertions.ok(
      enteredNodes.includes(required),
      `[${s.label}] entered ${required}`
    );
  }

  // Tool surface check: AssessDamage must have fired
  assertions.ok(
    callLog.some(c => c.name === 'AssessDamage'),
    `[${s.label}] AssessDamage fired`
  );

  if (s.expectFraudReview) {
    assertions.ok(
      callLog.some(c => c.name === 'RunFraudReview'),
      `[${s.label}] RunFraudReview fired (high-score path)`
    );
  } else {
    assertions.ok(
      !callLog.some(c => c.name === 'RunFraudReview'),
      `[${s.label}] RunFraudReview NOT fired (low-score path)`
    );
  }
}

async function main(): Promise<void> {
  console.log('=== demo-insurance-fnol ===\n');

  const cfg = createGatewayConfig();
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}`);
  console.log('\n--- State machine ---');
  console.log(STATE_DIAGRAM);

  // Scenario A: low severity, skips fraud_review
  await runScenario({
    label: '(a) windshield-low-severity',
    userInput:
      'Hi, I need to file a claim. Policy POL-12345. A pebble cracked my windshield on the freeway.',
    policy: 'POL-12345',
    incident: 'windshield',
    fraudScoreReturned: 0.4,
    severityReturned: 'low',
    expectFraudReview: false,
  });

  // Scenario B: high severity, takes fraud_review
  await runScenario({
    label: '(b) fire-high-severity',
    userInput:
      'I need to file a claim. Policy POL-99999. Last night there was a fire in the garage and my car is a total loss.',
    policy: 'POL-99999',
    incident: 'fire',
    fraudScoreReturned: 0.85,
    severityReturned: 'high',
    expectFraudReview: true,
  });

  report('demo-insurance-fnol');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
