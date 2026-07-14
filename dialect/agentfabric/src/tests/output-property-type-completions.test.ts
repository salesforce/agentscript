/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Value-position completions for output-property `type:` declarations.
 *
 * A reasoning/generator node's `outputs.properties.<name>:` block declares
 * each property's JSON-schema type via `type: <keyword>`. At the type
 * position the LSP should offer the 6-keyword JSON-schema subset
 * (string, number, integer, boolean, array, object) — exactly the set
 * the output-structure linter accepts. The action-input `type:` position
 * keeps its full primitive vocabulary (date, datetime, currency, …); the
 * two completion sources must not cross-contaminate.
 *
 * Both top-level properties and nested `items.type:` (array elements)
 * share the same field definition and thus the same completions.
 */

import { describe, it, expect } from 'vitest';
import { getValueCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

const INDENT2 = ' '.repeat(2);
const INDENT4 = ' '.repeat(4);
const INDENT6 = ' '.repeat(6);
const INDENT8 = ' '.repeat(8);
const INDENT10 = ' '.repeat(10);
const INDENT12 = ' '.repeat(12);

const OUTPUT_TYPE_KEYWORDS = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
] as const;

// Keywords present in the action-input primitive set but NOT valid for
// output-structure types. Used to assert the two completion sources do
// not cross-contaminate.
const INPUT_ONLY_KEYWORDS = ['date', 'datetime', 'currency', 'long'] as const;

function valueCompletionLabelsAt(
  source: string,
  line: number,
  character: number
): string[] {
  const ast = parseDocument(source);
  const candidates = getValueCompletions(
    ast,
    line,
    character,
    testSchemaCtx,
    source
  );
  return candidates.map(c => c.name);
}

function build(...lines: string[]): string {
  return ['# @dialect: AGENTFABRIC=1.0-BETA', ...lines].join('\n');
}

function locateLine(source: string, line: string): number {
  const idx = source.split('\n').findIndex(l => l === line);
  expect(idx).toBeGreaterThan(-1);
  return idx;
}

function expectOutputTypeKeywords(labels: string[]): void {
  for (const kw of OUTPUT_TYPE_KEYWORDS) {
    expect(labels).toContain(kw);
  }
}

function expectNoInputOnlyKeywords(labels: string[]): void {
  for (const kw of INPUT_ONLY_KEYWORDS) {
    expect(labels).not.toContain(kw);
  }
}

describe('output property type-position completions', () => {
  it('suggests the 6 JSON-schema types at orchestrator reasoning.outputs.properties.<name>.type:', () => {
    const typeLine = `${INDENT12}type: `;
    const source = build(
      'orchestrator:',
      `${INDENT2}root:`,
      `${INDENT4}reasoning:`,
      `${INDENT6}outputs:`,
      `${INDENT8}properties:`,
      `${INDENT10}order_id:`,
      typeLine
    );

    const labels = valueCompletionLabelsAt(
      source,
      locateLine(source, typeLine),
      typeLine.length
    );

    expectOutputTypeKeywords(labels);
    expectNoInputOnlyKeywords(labels);
  });

  it('suggests the 6 JSON-schema types at subagent reasoning.outputs.properties.<name>.type:', () => {
    const typeLine = `${INDENT12}type: `;
    const source = build(
      'subagent:',
      `${INDENT2}worker:`,
      `${INDENT4}reasoning:`,
      `${INDENT6}outputs:`,
      `${INDENT8}properties:`,
      `${INDENT10}status:`,
      typeLine
    );

    const labels = valueCompletionLabelsAt(
      source,
      locateLine(source, typeLine),
      typeLine.length
    );

    expectOutputTypeKeywords(labels);
    expectNoInputOnlyKeywords(labels);
  });

  it('suggests the 6 JSON-schema types at generator outputs.properties.<name>.type:', () => {
    const typeLine = `${INDENT10}type: `;
    const source = build(
      'generator:',
      `${INDENT2}summarize:`,
      `${INDENT4}outputs:`,
      `${INDENT6}properties:`,
      `${INDENT8}summary:`,
      typeLine
    );

    const labels = valueCompletionLabelsAt(
      source,
      locateLine(source, typeLine),
      typeLine.length
    );

    expectOutputTypeKeywords(labels);
    expectNoInputOnlyKeywords(labels);
  });

  it('suggests the 6 JSON-schema types at nested array `items.type:`', () => {
    const typeLine = `${INDENT12}type: `;
    const source = build(
      'generator:',
      `${INDENT2}summarize:`,
      `${INDENT4}outputs:`,
      `${INDENT6}properties:`,
      `${INDENT8}tags:`,
      `${INDENT10}type: "array"`,
      `${INDENT10}items:`,
      typeLine
    );

    const labels = valueCompletionLabelsAt(
      source,
      locateLine(source, typeLine),
      typeLine.length
    );

    expectOutputTypeKeywords(labels);
    expectNoInputOnlyKeywords(labels);
  });

  it('regression: action input `type:` still offers the full primitive set', () => {
    const typeLine = `${INDENT6}created_at: `;
    const source = build(
      'actions:',
      `${INDENT2}create_ticket:`,
      `${INDENT4}kind: "a2a:send_message"`,
      `${INDENT4}target: "a2a://conn"`,
      `${INDENT4}inputs:`,
      typeLine
    );

    const labels = valueCompletionLabelsAt(
      source,
      locateLine(source, typeLine),
      typeLine.length
    );

    expect(labels).toContain('date');
    expect(labels).toContain('datetime');
    expect(labels).toContain('integer');
    expect(labels).toContain('long');
    expect(labels).toContain('currency');
  });
});
