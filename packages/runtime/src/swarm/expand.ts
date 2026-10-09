/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  MAX_SWARM_SUBAGENTS,
  MIN_SWARM_ITEMS,
  SWARM_ITEM_PLACEHOLDER,
  type SwarmRunResult,
  type SwarmSpec,
} from './types.js';

/**
 * Raised when a swarm's inputs don't expand to a valid batch (too few / too
 * many items, a missing/placeholder-less template, or duplicate prompts). The
 * caller surfaces the message to the model so it can correct the call.
 */
export class SwarmExpansionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SwarmExpansionError';
  }
}

/**
 * Expand `items` + a `prompt_template` into N distinct {@link SwarmSpec}s,
 * replacing every `{{item}}` in the template with each item value. Mirrors
 * the reference agent's `createAgentSwarmSpecs` (minus the resume path):
 *
 *  - items and template are trimmed; empty items are dropped.
 *  - at least {@link MIN_SWARM_ITEMS} items are required.
 *  - at most {@link MAX_SWARM_SUBAGENTS} items are allowed.
 *  - the template must contain the `{{item}}` placeholder.
 *  - expanded prompts must be distinct (a swarm of identical children is a
 *    mistake — the reference agent rejects it, and so do we, naming the offending indices).
 *
 * Throws {@link SwarmExpansionError} on any violation (before any child runs).
 */
export function expandSwarmItems(
  items: readonly string[],
  promptTemplate: string
): SwarmSpec[] {
  const trimmedItems = items
    .map(item => item.trim())
    .filter(item => item.length > 0);
  const template = promptTemplate.trim();

  if (trimmedItems.length < MIN_SWARM_ITEMS) {
    throw new SwarmExpansionError(
      `A swarm requires at least ${MIN_SWARM_ITEMS} items (got ${trimmedItems.length}). ` +
        'For a single task, delegate to one subagent instead.'
    );
  }
  if (trimmedItems.length > MAX_SWARM_SUBAGENTS) {
    throw new SwarmExpansionError(
      `A swarm supports at most ${MAX_SWARM_SUBAGENTS} subagents (got ${trimmedItems.length}).`
    );
  }
  if (template.length === 0) {
    throw new SwarmExpansionError(
      'prompt_template is required when items are provided.'
    );
  }
  if (!template.includes(SWARM_ITEM_PLACEHOLDER)) {
    throw new SwarmExpansionError(
      `prompt_template must include the ${SWARM_ITEM_PLACEHOLDER} placeholder.`
    );
  }

  const seenPrompts = new Map<string, number>();
  const specs: SwarmSpec[] = [];
  trimmedItems.forEach((item, i) => {
    // Replace ALL occurrences of the placeholder (split/join, no escaping) —
    // exactly the reference agent's substitution.
    const prompt = template.split(SWARM_ITEM_PLACEHOLDER).join(item);
    const previous = seenPrompts.get(prompt);
    if (previous !== undefined) {
      throw new SwarmExpansionError(
        `Duplicate subagent prompts from items ${previous} and ${i + 1}. ` +
          'A swarm requires distinct subagents.'
      );
    }
    seenPrompts.set(prompt, i + 1);
    specs.push({ index: i + 1, item, prompt });
  });
  return specs;
}

/** Escape a string for safe inclusion in an XML attribute value. */
function escapeXmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/** Comma-join the non-zero outcome counts, e.g. `completed: 3, failed: 1`. */
function renderSummary(
  completed: number,
  failed: number,
  aborted: number
): string {
  const parts: string[] = [];
  if (completed > 0) parts.push(`completed: ${completed}`);
  if (failed > 0) parts.push(`failed: ${failed}`);
  if (aborted > 0) parts.push(`aborted: ${aborted}`);
  return parts.join(', ');
}

/**
 * Render N settled {@link SwarmRunResult}s into a single `<agent_swarm_result>`
 * XML block, faithful to the reference agent's `renderSwarmResults`:
 *
 * ```xml
 * <agent_swarm_result>
 * <summary>completed: 2, failed: 1</summary>
 * <subagent agent_id="agent-3" item="src/a.ts" outcome="completed">…report…</subagent>
 * <subagent agent_id="agent-4" item="src/b.ts" outcome="failed">…error…</subagent>
 * </agent_swarm_result>
 * ```
 *
 * Results are rendered in input order. Only the `item` attribute is escaped
 * (matching the reference agent); the body carries the raw child report or error string.
 */
export function renderSwarmResults(results: readonly SwarmRunResult[]): string {
  const completed = results.filter(r => r.status === 'completed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const aborted = results.filter(r => r.status === 'aborted').length;

  const lines = [
    '<agent_swarm_result>',
    `<summary>${renderSummary(completed, failed, aborted)}</summary>`,
  ];

  for (const result of results) {
    const agentId =
      result.agentId === undefined ? '' : ` agent_id="${result.agentId}"`;
    const item =
      result.spec.item === undefined
        ? ''
        : ` item="${escapeXmlAttribute(result.spec.item)}"`;
    const body =
      result.status === 'completed'
        ? (result.result ?? '')
        : (result.error ?? 'unknown error');
    lines.push(
      `<subagent${agentId}${item} outcome="${result.status}">${body}</subagent>`
    );
  }

  lines.push('</agent_swarm_result>');
  return lines.join('\n');
}
