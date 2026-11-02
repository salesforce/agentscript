/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from './dialect.js';
import { Block } from './block.js';
import { ExpressionSequence } from './sequence.js';
import {
  readStringSequence,
  readStringSequenceValues,
} from './read-sequence.js';

const PromptsBlock = Block('PromptsBlock', {
  items: ExpressionSequence().describe('String entries'),
});

const TestSchema = {
  prompts: PromptsBlock,
};

/** Parse `source` and return the `prompts.items` sequence node. */
function parseItems(source: string): unknown {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;
  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);
  const value = result.value as { prompts?: { items?: unknown } };
  return value.prompts?.items;
}

describe('readStringSequence', () => {
  it('reads YAML sequence syntax', () => {
    const items = parseItems(`
prompts:
    items:
        - "alpha"
        - "beta"
        - "gamma"
`);
    expect(readStringSequenceValues(items as never)).toEqual([
      'alpha',
      'beta',
      'gamma',
    ]);
  });

  it('reads inline list syntax', () => {
    const items = parseItems(`
prompts:
    items: ["one", "two", "three"]
`);
    expect(readStringSequenceValues(items as never)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('returns an empty array for an absent sequence', () => {
    expect(readStringSequence(undefined)).toEqual([]);
  });

  it('attaches a source range to each entry', () => {
    const items = parseItems(`
prompts:
    items: ["a", "b"]
`);
    const entries = readStringSequence(items as never);
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.range).toBeDefined();
      expect(entry.range?.start).toBeDefined();
    }
  });
});
