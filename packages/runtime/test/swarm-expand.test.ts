/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the swarm's pure logic: item→prompt expansion (with all its
 * validation) and the <agent_swarm_result> aggregation shape. Ported behavior
 * from the reference agent's AgentSwarm — kept Runtime-free so the rules are exercised in
 * isolation.
 */

import { describe, it, expect } from 'vitest';
import {
  expandSwarmItems,
  renderSwarmResults,
  SwarmExpansionError,
  MAX_SWARM_SUBAGENTS,
  type SwarmRunResult,
  type SwarmSpec,
} from '../src/swarm/index.js';

describe('expandSwarmItems', () => {
  it('replaces every {{item}} occurrence and assigns 1-based indices', () => {
    const specs = expandSwarmItems(
      ['a.ts', 'b.ts'],
      'Review {{item}} then re-check {{item}} again.'
    );
    expect(specs).toEqual<SwarmSpec[]>([
      {
        index: 1,
        item: 'a.ts',
        prompt: 'Review a.ts then re-check a.ts again.',
      },
      {
        index: 2,
        item: 'b.ts',
        prompt: 'Review b.ts then re-check b.ts again.',
      },
    ]);
  });

  it('trims items and the template, dropping empty items', () => {
    const specs = expandSwarmItems(
      ['  x  ', '', '   ', 'y'],
      '  Summarize {{item}}  '
    );
    expect(specs.map(s => s.item)).toEqual(['x', 'y']);
    expect(specs[0].prompt).toBe('Summarize x');
  });

  it('rejects fewer than 2 items', () => {
    expect(() => expandSwarmItems(['only'], 'do {{item}}')).toThrow(
      SwarmExpansionError
    );
    expect(() => expandSwarmItems([], 'do {{item}}')).toThrow(/at least 2/);
  });

  it('rejects more than the max subagent count', () => {
    const many = Array.from(
      { length: MAX_SWARM_SUBAGENTS + 1 },
      (_, i) => `item-${i}`
    );
    expect(() => expandSwarmItems(many, 'do {{item}}')).toThrow(
      new RegExp(`at most ${MAX_SWARM_SUBAGENTS}`)
    );
  });

  it('accepts exactly the max subagent count', () => {
    const many = Array.from(
      { length: MAX_SWARM_SUBAGENTS },
      (_, i) => `item-${i}`
    );
    expect(expandSwarmItems(many, 'do {{item}}')).toHaveLength(
      MAX_SWARM_SUBAGENTS
    );
  });

  it('requires a non-empty template', () => {
    expect(() => expandSwarmItems(['a', 'b'], '   ')).toThrow(/required/);
  });

  it('requires the {{item}} placeholder', () => {
    expect(() => expandSwarmItems(['a', 'b'], 'no placeholder here')).toThrow(
      /\{\{item\}\}/
    );
  });

  it('rejects duplicate expanded prompts, naming the offending 1-based indices', () => {
    // Two identical items expand to the same prompt.
    expect(() => expandSwarmItems(['dup', 'dup'], 'do {{item}}')).toThrow(
      /items 1 and 2/
    );
  });

  it('allows distinct items that happen to trim to the same value to collide', () => {
    // ' dup ' and 'dup' both trim to 'dup' → duplicate prompt → rejected.
    expect(() => expandSwarmItems([' dup ', 'dup'], 'x {{item}}')).toThrow(
      SwarmExpansionError
    );
  });
});

describe('renderSwarmResults', () => {
  const spec = (index: number, item: string): SwarmSpec => ({
    index,
    item,
    prompt: `p-${item}`,
  });

  it('renders a summary and one subagent block per result, in input order', () => {
    const results: SwarmRunResult[] = [
      {
        spec: spec(1, 'a'),
        agentId: 'agent-1',
        status: 'completed',
        result: 'report A',
      },
      {
        spec: spec(2, 'b'),
        agentId: 'agent-2',
        status: 'failed',
        error: 'boom',
      },
    ];
    const xml = renderSwarmResults(results);
    expect(xml).toContain('<agent_swarm_result>');
    expect(xml).toContain('<summary>completed: 1, failed: 1</summary>');
    expect(xml).toContain(
      '<subagent agent_id="agent-1" item="a" outcome="completed">report A</subagent>'
    );
    expect(xml).toContain(
      '<subagent agent_id="agent-2" item="b" outcome="failed">boom</subagent>'
    );
    expect(xml.trim().endsWith('</agent_swarm_result>')).toBe(true);
    // Input order preserved.
    expect(xml.indexOf('agent-1')).toBeLessThan(xml.indexOf('agent-2'));
  });

  it('omits zero-count outcomes from the summary', () => {
    const results: SwarmRunResult[] = [
      {
        spec: spec(1, 'a'),
        agentId: 'agent-1',
        status: 'completed',
        result: 'ok',
      },
      {
        spec: spec(2, 'b'),
        agentId: 'agent-2',
        status: 'completed',
        result: 'ok',
      },
    ];
    expect(renderSwarmResults(results)).toContain(
      '<summary>completed: 2</summary>'
    );
  });

  it('falls back to "unknown error" for a non-completed result with no error', () => {
    const results: SwarmRunResult[] = [
      { spec: spec(1, 'a'), agentId: 'agent-1', status: 'aborted' },
      {
        spec: spec(2, 'b'),
        agentId: 'agent-2',
        status: 'completed',
        result: 'ok',
      },
    ];
    expect(renderSwarmResults(results)).toContain(
      '<subagent agent_id="agent-1" item="a" outcome="aborted">unknown error</subagent>'
    );
  });

  it('XML-escapes the item attribute only (not the body)', () => {
    const results: SwarmRunResult[] = [
      {
        spec: spec(1, 'a & "b" <c>'),
        agentId: 'agent-1',
        status: 'completed',
        result: 'body with <raw> & "quotes"',
      },
      {
        spec: spec(2, 'z'),
        agentId: 'agent-2',
        status: 'completed',
        result: 'ok',
      },
    ];
    const xml = renderSwarmResults(results);
    expect(xml).toContain('item="a &amp; &quot;b&quot; &lt;c&gt;"');
    // Body is passed through verbatim.
    expect(xml).toContain('body with <raw> & "quotes"');
  });

  it('omits the agent_id attribute when none was assigned', () => {
    const results: SwarmRunResult[] = [
      { spec: spec(1, 'a'), status: 'failed', error: 'x' },
      { spec: spec(2, 'b'), status: 'failed', error: 'y' },
    ];
    const xml = renderSwarmResults(results);
    expect(xml).toContain('<subagent item="a" outcome="failed">x</subagent>');
    expect(xml).not.toContain('agent_id=');
  });
});
