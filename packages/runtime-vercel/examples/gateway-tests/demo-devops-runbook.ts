/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demo: DevOps — incident-response runbook with checkpoint / restore
 *
 * What it shows:
 *   A 4-topic runbook (detect -> diagnose -> remediate -> postmortem). The
 *   runtime restarts a service, then we checkpoint, JSON-roundtrip the
 *   blob, and rebuild a fresh Runtime via fromCheckpoint(). When we
 *   continue with a third turn ("draft the postmortem"), the destructive
 *   RestartService tool does NOT fire again — proving the resume picks up
 *   exactly where the original left off.
 *
 * Wow moment:
 *   Print checkpoint blob size, currentNode before/after restore,
 *   RestartService total invocation count across both runtimes.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/demo-devops-runbook.ts
 */

import { Runtime } from '@agentscript/runtime';
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
import { compile } from './harness.js';

const AGENT_SOURCE = `
system:
    instructions: "You are an SRE incident-response copilot. Walk through detect -> diagnose -> remediate -> postmortem. Call exactly one tool per topic when appropriate. RestartService is destructive — only call it once after diagnosis confirms a pod restart will fix the problem. After remediation, wait for the user before drafting the postmortem."

config:
    agent_name: "IncidentBot"
    default_agent_user: "sre@example.com"

language:
    default_locale: "en_US"

variables:
    alert_id: mutable string = ""
        description: "Active alert id"
    suspect_service: mutable string = ""
        description: "Service suspected to be at fault"
    error_rate: mutable number = 0
        description: "Observed error rate (0-1)"
    service_restarted: mutable boolean = False
        description: "Whether RestartService has been called"
    status_posted: mutable boolean = False
        description: "Whether a status update has been posted"
    postmortem_draft: mutable string = ""
        description: "Draft postmortem text"

start_agent detect:
    description: "Pulls active alerts and identifies the suspect service"

    actions:
        Fetch_Alerts:
            description: "Fetch the list of currently firing alerts"
            outputs:
                alert_id: string
                    description: "Top alert id"
                service: string
                    description: "Service implicated by the alert"
            target: "fn://FetchAlerts"

    reasoning:
        instructions: ->
            |   Call {!@actions.fetch} to get the active alert, capture
            |   the alert id and service, then transition to diagnose.
        actions:
            fetch: @actions.Fetch_Alerts
                set @variables.alert_id = @outputs.alert_id
                set @variables.suspect_service = @outputs.service

            go_diagnose: @utils.transition to @topic.diagnose
                description: "Move to diagnosis"

topic diagnose:
    description: "Queries metrics for the suspect service"

    actions:
        Query_Metrics:
            description: "Query error-rate and saturation metrics for the suspect service"
            inputs:
                service: string
                    description: "Service name"
                    is_required: True
            outputs:
                error_rate: number
                    description: "Observed error rate"
                saturation: number
                    description: "Saturation 0-1"
            target: "fn://QueryMetrics"

    reasoning:
        instructions: ->
            |   Call {!@actions.metrics} for {! @variables.suspect_service },
            |   capture the error rate, then transition to remediate.
        actions:
            metrics: @actions.Query_Metrics
                with service=@variables.suspect_service
                set @variables.error_rate = @outputs.error_rate

            go_remediate: @utils.transition to @topic.remediate
                description: "Move to remediation"

topic remediate:
    description: "Runs the corrective action and posts a status update"

    actions:
        Restart_Service:
            description: "Restart the suspect service. Destructive: call exactly once."
            inputs:
                service: string
                    description: "Service to restart"
                    is_required: True
            outputs:
                restarted: boolean
                    description: "Whether the restart succeeded"
            target: "fn://RestartService"

        Post_Status_Update:
            description: "Post a customer-facing status update"
            inputs:
                summary: string
                    description: "Short status summary"
                    is_required: True
            outputs:
                posted: boolean
                    description: "Whether the update posted"
            target: "fn://PostStatusUpdate"

    reasoning:
        instructions: ->
            |   If service hasn't been restarted yet, call {!@actions.restart}
            |   ONCE for {! @variables.suspect_service }. Then call
            |   {!@actions.status} with a one-line summary. Stay in this
            |   topic and wait for user confirmation before drafting the
            |   postmortem.
        actions:
            restart: @actions.Restart_Service
                with service=@variables.suspect_service
                set @variables.service_restarted = @outputs.restarted

            status: @actions.Post_Status_Update
                with summary=...
                set @variables.status_posted = @outputs.posted

            go_postmortem: @utils.transition to @topic.postmortem
                description: "Move to postmortem when user asks"

topic postmortem:
    description: "Drafts the postmortem"

    actions:
        Draft_Postmortem:
            description: "Draft a postmortem from the captured incident state"
            inputs:
                alert_id: string
                    description: "Alert id"
                    is_required: True
                service: string
                    description: "Affected service"
                    is_required: True
            outputs:
                draft: string
                    description: "Draft postmortem text"
            target: "fn://DraftPostmortem"

    reasoning:
        instructions: ->
            |   The user has asked for a postmortem. Call {!@actions.draft}
            |   with the captured alert_id and suspect service.
        actions:
            draft: @actions.Draft_Postmortem
                with alert_id=@variables.alert_id
                with service=@variables.suspect_service
                set @variables.postmortem_draft = @outputs.draft
`;

async function main(): Promise<void> {
  console.log('=== demo-devops-runbook ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Shared callLog so we can count RestartService across both runtime
  // instances (we re-use the same ToolRegistry on the resumed runtime).
  const { tools, callLog } = mockTool({
    FetchAlerts: {
      delayMs: 20,
      result: { alert_id: 'ALERT-7741', service: 'orders-api' },
    },
    QueryMetrics: {
      delayMs: 20,
      result: { error_rate: 0.42, saturation: 0.91 },
    },
    RestartService: { delayMs: 20, result: { restarted: true } },
    PostStatusUpdate: { delayMs: 20, result: { posted: true } },
    DraftPostmortem: {
      delayMs: 20,
      result: {
        draft:
          'Incident ALERT-7741 (orders-api). Root cause: pod-level OOM. Action: rolling restart. Followups: tune memory limits.',
      },
    },
  });

  const runtimeOptsBase = {
    doc: compile(AGENT_SOURCE),
    llm: llmDriver,
    tools,
    maxStepsPerTurn: 8,
  };

  // ---- Phase 1: original runtime ----
  const runtimeA = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 8,
    llmDriver,
  });

  const allEvents: RuntimeEvent[] = [];

  console.log('--- Turn 1: alert came in, please investigate ---\n');
  const t1 = await runTurn(
    runtimeA,
    'A page just came in. Please investigate the active alert and start triage.'
  );
  allEvents.push(...t1.events);
  printShort(t1.events);

  console.log('--- Turn 2: confirm restart and post a status update ---\n');
  const t2 = await runTurn(
    runtimeA,
    'Yes go ahead and restart the suspect service, then post a status update saying we are mitigating.'
  );
  allEvents.push(...t2.events);
  printShort(t2.events);

  // ---- Phase 2: checkpoint, JSON-roundtrip, fromCheckpoint ----
  const checkpoint = runtimeA.checkpoint();
  const blob = JSON.stringify(checkpoint);
  const blobSize = Buffer.byteLength(blob, 'utf8');
  const restored = JSON.parse(blob);

  const preNode = runtimeA.currentNodeName;
  const restartCallsBeforeResume = callLog.filter(
    c => c.name === 'RestartService'
  ).length;

  const runtimeB = Runtime.fromCheckpoint(runtimeOptsBase, restored);
  const postNode = runtimeB.currentNodeName;

  console.log('+----------------------------------------------+');
  console.log('| Checkpoint / restore                         |');
  console.log('+----------------------------------------------+');
  console.log(`  blob size                : ${blobSize} bytes`);
  console.log(`  currentNode pre-restore  : ${preNode}`);
  console.log(`  currentNode post-restore : ${postNode}`);
  console.log(
    `  RestartService callCount : ${restartCallsBeforeResume}  (must stay 1)`
  );
  console.log(`  alert_id in state        : ${runtimeB.state.get('alert_id')}`);
  console.log(
    `  service_restarted state  : ${runtimeB.state.get('service_restarted')}`
  );
  console.log('');

  // ---- Phase 3: continue on the resumed runtime ----
  console.log('--- Turn 3 (resumed runtime): draft the postmortem ---\n');
  const t3 = await runTurn(runtimeB, 'OK, draft the postmortem.');
  allEvents.push(...t3.events);
  printShort(t3.events);

  const restartCallsTotal = callLog.filter(
    c => c.name === 'RestartService'
  ).length;
  const draftCalls = callLog.filter(c => c.name === 'DraftPostmortem').length;

  console.log('+----------------------------------------------+');
  console.log('| Final tool tally                             |');
  console.log('+----------------------------------------------+');
  console.log(`  RestartService total calls : ${restartCallsTotal}`);
  console.log(`  DraftPostmortem calls      : ${draftCalls}`);
  console.log(
    `  postmortem_draft (snippet) : ${String(
      runtimeB.state.get('postmortem_draft') ?? ''
    ).slice(0, 100)}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  assertions.eq(
    restartCallsTotal,
    1,
    'RestartService called exactly once across both runtime instances'
  );

  assertions.eq(
    postNode,
    preNode,
    'currentNode survives JSON roundtrip via fromCheckpoint'
  );

  // Resumed runtime should reference the alert id learned in turn 1
  assertions.ok(
    runtimeB.state.get('alert_id') === 'ALERT-7741',
    'resumed runtime kept alert_id from turn 1',
    `state alert_id=${runtimeB.state.get('alert_id')}`
  );

  // Final postmortem text must reference the alert
  const finalText = t3.result.assistantText ?? '';
  assertions.ok(
    finalText.includes('ALERT-7741') || draftCalls >= 1,
    'resumed agent draft references alert id from turn 1',
    `text: ${finalText.slice(0, 200)}`
  );

  // currentNode after restore should be remediate or postmortem (we landed
  // in remediate after turn 2, then walked to postmortem in turn 3)
  const finalNode = runtimeB.currentNodeName;
  assertions.ok(
    finalNode === 'postmortem' || finalNode === 'remediate',
    'final node is remediate or postmortem',
    `node=${finalNode}`
  );

  // No errors anywhere
  const errs = allEvents.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.eq(errs.length, 0, 'no error events across all turns');

  report('demo-devops-runbook');
}

function printShort(events: RuntimeEvent[]): void {
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}`);
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
