/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end test for `test/fixtures/triage_concierge.agent`.
 * Exercises router → specialist delegation, before/after_reasoning hooks,
 * and the topic-based summary wrap-up — all deterministic via ScriptedLlm
 * and FnAdapter (no MCP, no network).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  type RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const AGENT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  './fixtures/triage_concierge.agent'
);

function compileTriage() {
  const source = readFileSync(AGENT_PATH, 'utf8');
  const { output, diagnostics } = compileSource(source);
  // `invalid-action-target` warns on `delegate://` and `fn://` schemes the
  // compiler doesn't recognise — same filter pattern as
  // delegation-integration.test.ts and integration-full-pipeline.test.ts.
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (errors.length > 0) {
    throw new Error(`Compile failed: ${JSON.stringify(errors)}`);
  }
  return output;
}

function makeTools(opts: { refundEligible?: boolean } = {}) {
  const fn = new FnAdapter();
  fn.register('lookup_order', async args => {
    const { order_number } = args as { order_number: string };
    return { status: `Order ${order_number} has shipped` };
  });
  fn.register('get_tracking', async args => {
    const { tracking_number } = args as { tracking_number: string };
    return { last_location: `${tracking_number} is in Reno, NV` };
  });
  fn.register('check_refund_eligibility', async () => {
    if (opts.refundEligible === false) {
      return {
        escalation_needed: true,
        reason: 'Order outside the 30-day return window',
      };
    }
    return {
      escalation_needed: false,
      reason: 'Refund approved within the return window',
    };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return tools;
}

describe('Triage concierge — multi-subagent routing', () => {
  it('routes to order specialist and produces a summary', async () => {
    const doc = compileTriage();
    const llm = new ScriptedLlm([
      // Triage: pick the order specialist
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'route_order',
            arguments: { customer_id: 'C-100', order_number: 'ORD-42' },
          },
        ],
      },
      // Order specialist: call lookup_order, then reply
      {
        toolCalls: [
          {
            id: 'tc2',
            name: 'lookup',
            arguments: { order_number: 'ORD-42' },
          },
        ],
      },
      { text: 'Order ORD-42 has shipped.' },
      // Triage's post-delegation reply
      { text: 'Routed to order specialist.' },
      // Summary topic
      { text: 'Your order has shipped — no further action needed.' },
    ]);

    const runtime = new Runtime({ doc, llm, tools: makeTools() });
    runtime.state.set('customer_id', 'C-100');
    const result = await runtime.turn('Where is my order ORD-42?');

    expect(runtime.state.get('intent')).toBe('order');
    expect(runtime.state.get('resolution_text')).toContain('ORD-42');
    expect(runtime.state.get('escalation_needed')).toBe(false);
    // assistantText accumulates the parent post-delegation reply + the
    // summary topic text. The summary phase is what wraps up the turn.
    expect(result.assistantText).toContain(
      'Your order has shipped — no further action needed.'
    );
    expect(result.finalNode).toBe('summary');
  });

  it('routes to shipping specialist without invoking other specialists', async () => {
    const doc = compileTriage();
    let lookupCalls = 0;
    let refundCalls = 0;
    const fn = new FnAdapter();
    fn.register('lookup_order', async () => {
      lookupCalls++;
      return { status: 'unused' };
    });
    fn.register('get_tracking', async args => {
      const { tracking_number } = args as { tracking_number: string };
      return { last_location: `${tracking_number} arrived in Reno, NV` };
    });
    fn.register('check_refund_eligibility', async () => {
      refundCalls++;
      return { escalation_needed: false, reason: 'unused' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'route_shipping',
            arguments: {
              customer_id: 'C-200',
              tracking_number: '1Z-DEMO-42',
            },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'tc2',
            name: 'tracking',
            arguments: { tracking_number: '1Z-DEMO-42' },
          },
        ],
      },
      { text: 'Package arrived in Reno, NV.' },
      { text: 'Routed to shipping specialist.' },
      { text: 'Your shipment is in Reno, NV.' },
    ]);

    const runtime = new Runtime({ doc, llm, tools });
    runtime.state.set('customer_id', 'C-200');
    const result = await runtime.turn('Track 1Z-DEMO-42');

    expect(runtime.state.get('intent')).toBe('shipping');
    expect(runtime.state.get('resolution_text')).toContain('Reno');
    expect(lookupCalls).toBe(0);
    expect(refundCalls).toBe(0);
    expect(result.finalNode).toBe('summary');
  });

  it('refund specialist leaves escalation_needed false when eligible', async () => {
    const doc = compileTriage();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'route_refund',
            arguments: { customer_id: 'C-300', order_number: 'ORD-77' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'tc2',
            name: 'check',
            arguments: { order_number: 'ORD-77' },
          },
        ],
      },
      { text: 'Refund approved.' },
      { text: 'Routed to refund specialist.' },
      { text: 'Your refund has been approved.' },
    ]);

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools({ refundEligible: true }),
    });
    runtime.state.set('customer_id', 'C-300');
    await runtime.turn('Refund ORD-77 please');

    expect(runtime.state.get('intent')).toBe('refund');
    expect(runtime.state.get('escalation_needed')).toBe(false);
    expect(runtime.state.get('resolution_text')).toContain('approved');
  });

  it('refund specialist sets escalation_needed when ineligible', async () => {
    const doc = compileTriage();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'route_refund',
            arguments: { customer_id: 'C-400', order_number: 'ORD-OLD' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'tc2',
            name: 'check',
            arguments: { order_number: 'ORD-OLD' },
          },
        ],
      },
      { text: 'Outside the return window.' },
      { text: 'Routed to refund specialist.' },
      { text: "I'll escalate this to a human agent." },
    ]);

    const runtime = new Runtime({
      doc,
      llm,
      tools: makeTools({ refundEligible: false }),
    });
    runtime.state.set('customer_id', 'C-400');
    const result = await runtime.turn('Refund my year-old order');

    expect(runtime.state.get('intent')).toBe('refund');
    expect(runtime.state.get('escalation_needed')).toBe(true);
    expect(runtime.state.get('resolution_text')).toContain('30-day');
    expect(result.assistantText).toContain('escalate');
  });

  it('emits delegation-start with the chosen specialist', async () => {
    const doc = compileTriage();
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'route_order',
            arguments: { customer_id: 'C-500', order_number: 'ORD-42' },
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'tc2',
            name: 'lookup',
            arguments: { order_number: 'ORD-42' },
          },
        ],
      },
      { text: 'Found it.' },
      { text: 'Done.' },
      { text: 'Summary.' },
    ]);

    const runtime = new Runtime({ doc, llm, tools: makeTools() });
    runtime.state.set('customer_id', 'C-500');
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('Find ORD-42');

    const starts = events.filter(e => e.kind === 'delegation-start');
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      kind: 'delegation-start',
      parentNode: 'triage',
      childNode: 'order_specialist',
    });
  });
});
