/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tier 2 — T2.5: multi-tenant isolation.
 *
 * Two Runtime instances run concurrently with different state, different
 * guardrails, and different tracing exporters. Each tenant must NOT bleed
 * any state, span, or text into the other tenant's view.
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  InMemorySpanExporter,
  regexGuardrail,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const TENANT_DOC = `
system:
    instructions: "You are a tenant-aware bot."

config:
    agent_name: "TenantBot"
    default_agent_user: "bot@example.com"

variables:
    tenant_id: context string
        description: "The tenant id"
    note: mutable string = ""
        description: "Internal note"

start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Respond to the tenant.
`;

describe('Multi-tenant isolation (T2.5)', () => {
  it('two Runtime instances do not bleed state, spans, or guardrail decisions', async () => {
    const { output } = compileSource(TENANT_DOC);

    // Acme tenant — blocks "secret-acme"
    const acmeExporter = new InMemorySpanExporter();
    const acmeLlm = new ScriptedLlm([
      // First attempt contains a forbidden token; guardrail will retry.
      { text: 'Hello acme — secret-acme leak' },
      { text: 'Hello acme — clean reply' },
    ]);
    const acmeRuntime = new Runtime({
      doc: output,
      llm: acmeLlm,
      tools: new ToolRegistry(),
      context: { tenant_id: 'acme' },
      guardrails: [
        regexGuardrail({
          name: 'block-acme-secret',
          pattern: /secret-acme/,
          invert: true,
          maxRetries: 2,
        }),
      ],
      tracing: { enabled: true, exporter: acmeExporter },
    });

    // Beta tenant — blocks "secret-beta"
    const betaExporter = new InMemorySpanExporter();
    const betaLlm = new ScriptedLlm([
      { text: 'Hello beta — secret-beta leak' },
      { text: 'Hello beta — clean reply' },
    ]);
    const betaRuntime = new Runtime({
      doc: output,
      llm: betaLlm,
      tools: new ToolRegistry(),
      context: { tenant_id: 'beta' },
      guardrails: [
        regexGuardrail({
          name: 'block-beta-secret',
          pattern: /secret-beta/,
          invert: true,
          maxRetries: 2,
        }),
      ],
      tracing: { enabled: true, exporter: betaExporter },
    });

    // Run concurrently
    const [acmeResult, betaResult] = await Promise.all([
      acmeRuntime.turn('hello'),
      betaRuntime.turn('hello'),
    ]);

    // Each tenant got its own clean assistant text
    expect(acmeResult.assistantText).toBe('Hello acme — clean reply');
    expect(betaResult.assistantText).toBe('Hello beta — clean reply');

    // No cross-contamination in final text
    expect(acmeResult.assistantText).not.toMatch(/beta/);
    expect(betaResult.assistantText).not.toMatch(/acme/);

    // Each runtime's state belongs to its tenant
    expect(acmeRuntime.state.get('tenant_id')).toBe('acme');
    expect(betaRuntime.state.get('tenant_id')).toBe('beta');

    // Trace IDs are disjoint between tenant exporters
    const acmeSpans = acmeExporter.getSpans();
    const betaSpans = betaExporter.getSpans();
    expect(acmeSpans.length).toBeGreaterThan(0);
    expect(betaSpans.length).toBeGreaterThan(0);
    const acmeTraceIds = new Set(acmeSpans.map(s => s.traceId));
    const betaTraceIds = new Set(betaSpans.map(s => s.traceId));
    for (const id of acmeTraceIds) {
      expect(betaTraceIds.has(id)).toBe(false);
    }
    // Spans only present in their owning exporter
    const acmeIds = new Set(acmeSpans.map(s => s.spanId));
    const betaIds = new Set(betaSpans.map(s => s.spanId));
    for (const id of acmeIds) expect(betaIds.has(id)).toBe(false);

    // Guardrails applied per-tenant: each runtime saw its own guardrail
    // retry once (the first attempt contained the forbidden token).
    expect(acmeLlm.calls).toHaveLength(2);
    expect(betaLlm.calls).toHaveLength(2);
  });
});
