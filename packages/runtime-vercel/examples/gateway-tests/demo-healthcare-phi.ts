/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demo: Healthcare — PHI output guardrail with retry
 *
 * What it shows:
 *   A patient leaks PHI in their first message (DOB and SSN). An output
 *   guardrail (regex blocklist for SSN + DOB patterns) catches it on the
 *   first model attempt and forces the model to regenerate without the
 *   PHI. The retry buffer never lands in runtime.history.
 *
 * Wow moment:
 *   Print [guardrail-fail] / [guardrail-pass] events as they happen, then
 *   show the final assistantText with no SSN or DOB and confirm
 *   runtime.history is clean of synthetic feedback messages.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/demo-healthcare-phi.ts
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
} from './harness.js';

const AGENT_SOURCE = `
system:
    instructions: "You are a clinical intake assistant. Capture symptoms and urgency. NEVER include the patient's social security number, date of birth, or any digit-formatted personal identifier in your responses. If the user volunteered a SSN or DOB, simply acknowledge that you've recorded their identity privately and continue. Do not echo any 9-digit SSN or any MM/DD/YYYY date. Speak generally."

config:
    agent_name: "ClinicalIntakeBot"
    default_agent_user: "intake@hospital.example.com"

language:
    default_locale: "en_US"

variables:
    chief_complaint: mutable string = ""
        description: "Patient's main symptom in plain language"
    urgency_level: mutable string = ""
        description: "Triage urgency: routine, urgent, emergent"
    appointment_id: mutable string = ""
        description: "Booked appointment id"

start_agent intake:
    description: "Captures the patient's chief complaint without echoing PHI"

    actions:
        Record_Symptoms:
            description: "Record the chief complaint in plain clinical language (no PHI)"
            inputs:
                complaint: string
                    description: "Plain-language chief complaint"
                    is_required: True
            outputs:
                recorded: boolean
                    description: "Whether the symptom was recorded"
            target: "fn://record_symptoms"

        Move_To_Triage:
            description: "Hand off to triage once the chief complaint is captured"
            target: "fn://utils_noop"

    reasoning:
        instructions: ->
            |   Acknowledge the patient briefly. Call {!@actions.record} with
            |   their plain-language complaint (do NOT include SSN or DOB).
            |   Then transition to triage with {!@actions.go_triage}.
        actions:
            record: @actions.Record_Symptoms
                with complaint=...
                set @variables.chief_complaint = "recorded"

            go_triage: @utils.transition to @topic.triage
                description: "Hand off to triage"

topic triage:
    description: "Scores urgency and books an appointment"

    actions:
        Score_Urgency:
            description: "Score urgency based on chief complaint"
            inputs:
                complaint: string
                    description: "Recorded complaint"
                    is_required: True
            outputs:
                level: string
                    description: "routine | urgent | emergent"
            target: "fn://score_urgency"

        Book_Appointment:
            description: "Book an appointment for the patient"
            inputs:
                level: string
                    description: "Urgency level"
                    is_required: True
            outputs:
                appointment_id: string
                    description: "Generated appointment id"
                window: string
                    description: "Appointment window (e.g. today/30min)"
            target: "fn://book_appointment"

    reasoning:
        instructions: ->
            |   Call {!@actions.score} with the recorded complaint, then
            |   {!@actions.book} with the urgency level. Do NOT mention
            |   SSN, DOB, or any 9-digit / MM/DD/YYYY identifier in your
            |   reply. Speak generally and confirm the appointment.
        actions:
            score: @actions.Score_Urgency
                with complaint=@variables.chief_complaint
                set @variables.urgency_level = @outputs.level

            book: @actions.Book_Appointment
                with level=@variables.urgency_level
                set @variables.appointment_id = @outputs.appointment_id
`;

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const DOB_PATTERN = /\b\d{2}\/\d{2}\/(?:19|20)\d{2}\b/;

async function main(): Promise<void> {
  console.log('=== demo-healthcare-phi ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools } = mockTool({
    record_symptoms: { delayMs: 20, result: { recorded: true } },
    score_urgency: { delayMs: 20, result: { level: 'urgent' } },
    book_appointment: {
      delayMs: 20,
      result: { appointment_id: 'APT-9921', window: 'today/30min' },
    },
    utils_noop: { delayMs: 5, result: { ok: true } },
  });

  // Custom PHI guardrail. Retries up to 2 times.
  const phiGuardrail = customGuardrail({
    name: 'phi-redaction',
    target: 'text',
    maxRetries: 2,
    feedbackTemplate:
      'Your previous response contained PHI (SSN like NNN-NN-NNNN or DOB like MM/DD/YYYY). Re-write it without any digit-formatted identifiers; speak generally about identity confirmation only.',
    validate(output) {
      const ssn = SSN_PATTERN.test(output.text);
      const dob = DOB_PATTERN.test(output.text);
      if (ssn || dob) {
        return {
          valid: false,
          reason: `PHI detected (${ssn ? 'SSN ' : ''}${dob ? 'DOB' : ''})`,
        };
      }
      return { valid: true };
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    guardrails: [phiGuardrail],
    maxStepsPerTurn: 8,
    llmDriver,
  });

  console.log(
    '--- User: leaks SSN + DOB along with a chest-pain symptom ---\n'
  );
  const turn = await runTurn(
    runtime,
    "I'm John Doe, DOB 03/15/1980, my SSN is 123-45-6789. I have chest pain."
  );

  printEvents(turn.events);

  // -------------------------------------------------------------------------
  // Wow moment
  // -------------------------------------------------------------------------
  const passEvents = turn.events.filter(e => e.kind === 'guardrail-pass');
  const failEvents = turn.events.filter(e => e.kind === 'guardrail-fail');

  const checkpoint = runtime.checkpoint();
  console.log('+----------------------------------------------+');
  console.log('| PHI guardrail outcome                        |');
  console.log('+----------------------------------------------+');
  console.log(`  guardrail-fail attempts : ${failEvents.length}`);
  console.log(`  guardrail-pass events   : ${passEvents.length}`);
  console.log(`  history entries (clean) : ${checkpoint.history.length}`);
  console.log(
    `  appointment booked      : ${runtime.state.get('appointment_id')}`
  );
  console.log(
    `  final text (truncated)  : ${turn.result.assistantText.slice(0, 200)}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  const finalText = turn.result.assistantText ?? '';
  assertions.ok(
    !SSN_PATTERN.test(finalText),
    'final response contains no SSN pattern',
    `text: ${finalText.slice(0, 200)}`
  );
  assertions.ok(
    !DOB_PATTERN.test(finalText),
    'final response contains no DOB pattern',
    `text: ${finalText.slice(0, 200)}`
  );

  // History must not contain synthetic feedback messages from the retry buffer
  const feedbackLeak = checkpoint.history.some(
    m =>
      m.role === 'user' &&
      typeof m.content === 'string' &&
      (m.content.includes('Your previous response contained PHI') ||
        m.content.includes('Your response failed validation'))
  );
  assertions.ok(
    !feedbackLeak,
    'runtime.history contains no synthetic guardrail feedback messages'
  );

  // History also must not contain leaked SSN/DOB from prior model attempts
  const phiLeakInHistory = checkpoint.history.some(
    m =>
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      (SSN_PATTERN.test(m.content) || DOB_PATTERN.test(m.content))
  );
  assertions.ok(
    !phiLeakInHistory,
    'runtime.history has no PHI in any persisted assistant message'
  );

  assertions.gte(
    passEvents.length,
    1,
    'at least one guardrail-pass event emitted'
  );

  report('demo-healthcare-phi');
}

function printEvents(events: RuntimeEvent[]): void {
  let attempt = 0;
  for (const e of events) {
    if (e.kind === 'guardrail-fail') {
      attempt++;
      console.log(`  [guardrail-fail] attempt ${attempt} reason="${e.error}"`);
    } else if (e.kind === 'guardrail-pass') {
      attempt++;
      console.log(`  [guardrail-pass] attempt ${attempt} (${e.name})`);
    } else if (e.kind === 'tool-call') {
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
