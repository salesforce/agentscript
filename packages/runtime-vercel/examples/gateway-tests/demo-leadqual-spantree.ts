/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demo: Lead qualification with span tree
 *
 * What it shows:
 *   A 3-tool lead-qual agent (EnrichCompany, LookupCRM, ScoreLead) runs
 *   for one turn against the gateway. Spans are captured by an
 *   InMemorySpanExporter and pretty-printed as a tree at the end.
 *
 * Wow moment:
 *   ASCII span tree with timing per span, parent/child indent, and a
 *   one-line summary of total duration. Demonstrates that the runtime
 *   emits OTel-style spans out of the box.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/demo-leadqual-spantree.ts
 */

import { InMemorySpanExporter, Runtime, type Span } from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  compile,
  runTurn,
  mockTool,
  assertions,
  report,
} from './harness.js';

const AGENT_SOURCE = `
system:
    instructions: "You are a B2B lead-qualification copilot. Given details about a prospect, enrich the company, lookup CRM history, and score the lead. Use tools — don't fabricate signals."

config:
    agent_name: "LeadQualBot"
    default_agent_user: "sales@example.com"

language:
    default_locale: "en_US"

variables:
    company_name: mutable string = ""
        description: "Company name"
    crm_history: mutable string = ""
        description: "Captured CRM history"
    lead_score: mutable number = 0
        description: "Final lead score 0-100"
    lead_grade: mutable string = ""
        description: "A | B | C | D"

start_agent leadqual:
    description: "Enrich, lookup, score"

    actions:
        Enrich_Company:
            description: "Enrich a company by name (firmographics)"
            inputs:
                name: string
                    description: "Company name"
                    is_required: True
            outputs:
                industry: string
                    description: "Industry"
                size: number
                    description: "Headcount"
            target: "fn://EnrichCompany"

        Lookup_CRM:
            description: "Lookup the prospect in the CRM by company name"
            inputs:
                name: string
                    description: "Company name"
                    is_required: True
            outputs:
                opportunity_stage: string
                    description: "Open opportunity stage if any"
                last_touched: string
                    description: "Last activity date"
            target: "fn://LookupCRM"

        Score_Lead:
            description: "Score the lead given enrichment + CRM"
            inputs:
                industry: string
                    description: "Industry"
                    is_required: True
                size: number
                    description: "Headcount"
                    is_required: True
                stage: string
                    description: "CRM stage"
                    is_required: True
            outputs:
                score: number
                    description: "Lead score"
                grade: string
                    description: "Grade"
            target: "fn://ScoreLead"

    reasoning:
        instructions: ->
            |   Enrich and lookup in parallel, then score. Captured
            |   company name: {! @variables.company_name }.
        actions:
            enrich: @actions.Enrich_Company
                with name=@variables.company_name

            lookup: @actions.Lookup_CRM
                with name=@variables.company_name
                set @variables.crm_history = @outputs.opportunity_stage

            score: @actions.Score_Lead
                with industry=...
                with size=...
                with stage=...
                set @variables.lead_score = @outputs.score
                set @variables.lead_grade = @outputs.grade
`;

async function main(): Promise<void> {
  console.log('=== demo-leadqual-spantree ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools } = mockTool({
    EnrichCompany: {
      delayMs: 180,
      result: { industry: 'SaaS', size: 200 },
    },
    LookupCRM: {
      delayMs: 180,
      result: {
        opportunity_stage: 'discovery',
        last_touched: '2026-04-22',
      },
    },
    ScoreLead: {
      delayMs: 90,
      result: { score: 88, grade: 'A' },
    },
  });

  const exporter = new InMemorySpanExporter();
  const doc = compile(AGENT_SOURCE);
  const runtime = new Runtime({
    doc,
    llm: llmDriver,
    tools,
    maxStepsPerTurn: 8,
    parallel: { strategy: 'always' },
    tracing: {
      enabled: true,
      exporter,
      sampleRate: 1,
    },
  });

  // Pre-seed company name so the LLM doesn't have to extract it from prose.
  runtime.state.set('company_name', 'Acme SaaS');

  console.log(
    '--- Turn 1: a 200-person SaaS evaluating us, budget approved ---\n'
  );
  const turn = await runTurn(
    runtime,
    "We're a 200-person SaaS evaluating your platform; budget approved, decision in 30 days."
  );

  console.log(
    `  Final assistant text: ${turn.result.assistantText.slice(0, 200)}`
  );
  console.log(`  Lead score           : ${runtime.state.get('lead_score')}`);
  console.log(`  Lead grade           : ${runtime.state.get('lead_grade')}`);
  console.log('');

  // ---------------------------------------------------------------------
  // Wow moment: pretty-print span tree
  // ---------------------------------------------------------------------
  // Note: spans are exported when the runtime flushes its tracing context.
  // Most exporters are flushed on turn-end. Try a small drain pause if
  // empty, then read.
  await new Promise(resolve => setTimeout(resolve, 50));
  const spans = [...exporter.getSpans()];

  console.log('--- Span tree ---');
  if (spans.length === 0) {
    console.log('  (no spans captured — exporter empty)');
  } else {
    printSpanTree(spans);
  }
  console.log('');

  // ---------------------------------------------------------------------
  // Assertions
  // ---------------------------------------------------------------------
  assertions.ok(spans.length > 0, 'tracing produced at least one span');

  const turnSpan = spans.find(s => s.name === 'turn');
  assertions.ok(!!turnSpan, '`turn` root span exists');

  const toolSpans = spans.filter(
    s => s.name === 'tool.call' || s.name.includes('tool')
  );
  assertions.gte(toolSpans.length, 2, '>= 2 tool-call spans captured');

  // Every span has endTime >= startTime
  const wellOrdered = spans.every(
    s => s.endTime !== undefined && s.endTime >= s.startTime
  );
  assertions.ok(
    wellOrdered,
    'every span has endTime >= startTime',
    wellOrdered
      ? undefined
      : `bad spans: ${spans
          .filter(
            s => s.endTime === undefined || (s.endTime ?? 0) < s.startTime
          )
          .map(s => s.name)
          .join(', ')}`
  );

  report('demo-leadqual-spantree');
}

function printSpanTree(spans: Span[]): void {
  // Build parent -> children map
  const byId = new Map<string, Span>();
  for (const s of spans) byId.set(s.spanId, s);

  const childrenOf = new Map<string | undefined, Span[]>();
  for (const s of spans) {
    const key = s.parentSpanId;
    if (!childrenOf.has(key)) childrenOf.set(key, []);
    childrenOf.get(key)!.push(s);
  }

  // Sort children by startTime
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => a.startTime - b.startTime);
  }

  // Roots: spans whose parent is undefined or not present in this batch
  const roots = spans.filter(s => !s.parentSpanId || !byId.has(s.parentSpanId));
  roots.sort((a, b) => a.startTime - b.startTime);

  for (const root of roots) {
    walk(root, '', true);
  }

  function walk(span: Span, prefix: string, isLast: boolean): void {
    const branch = isLast ? '└── ' : '├── ';
    const dur =
      span.endTime !== undefined ? `${span.endTime - span.startTime}ms` : '?';
    const attrSummary = summarizeAttrs(span);
    console.log(`${prefix}${branch}${span.name} (${dur})${attrSummary}`);

    const children = childrenOf.get(span.spanId) ?? [];
    const nextPrefix = prefix + (isLast ? '    ' : '│   ');
    for (let i = 0; i < children.length; i++) {
      walk(children[i], nextPrefix, i === children.length - 1);
    }
  }

  function summarizeAttrs(s: Span): string {
    const interesting = ['tool.name', 'node', 'iteration'];
    const parts: string[] = [];
    for (const k of interesting) {
      if (s.attributes[k] !== undefined) {
        parts.push(`${k}=${s.attributes[k]}`);
      }
    }
    return parts.length ? `  [${parts.join(', ')}]` : '';
  }
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
