/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Value-position completions for action-input type declarations.
 *
 * An action definition's `inputs:` block declares parameters as
 * `param_name: <type>`. At the type position (after `param_name: `) the LSP
 * should offer the supported primitive types (string, number, boolean,
 * object, …), mirroring how a `variables:` TypedMap entry offers them.
 *
 * Historically `ActionDefInputBlock` was an intentionally-empty NamedBlock
 * (typed inputs deferred), so primitive-type value-completion never fired at
 * the type position and nothing was offered. These tests pin the now-wanted
 * behaviour: action inputs are a TypedMap of primitive types.
 */

import { describe, it, expect } from 'vitest';
import { getValueCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

const INDENT2 = ' '.repeat(2);
const INDENT4 = ' '.repeat(4);
const INDENT6 = ' '.repeat(6);

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

describe('action input type-position completions', () => {
  it('after `order_id: ` inside an action `inputs:` block suggests primitive types', () => {
    const typeLine = `${INDENT6}order_id: `;
    const source = build(
      'actions:',
      `${INDENT2}lookup_order:`,
      `${INDENT4}kind: "mcp:tool"`,
      `${INDENT4}target: "mcp://conn"`,
      `${INDENT4}tool_name: "lookup"`,
      `${INDENT4}inputs:`,
      typeLine
    );

    const lines = source.split('\n');
    const typeLineIdx = lines.findIndex(l => l === typeLine);
    expect(typeLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(
      source,
      typeLineIdx,
      typeLine.length
    );

    expect(labels).toContain('string');
    expect(labels).toContain('number');
    expect(labels).toContain('boolean');
    expect(labels).toContain('object');
  });

  it('suggested types include the full primitive set (date, datetime, integer, …)', () => {
    const typeLine = `${INDENT6}created_at: `;
    const source = build(
      'actions:',
      `${INDENT2}create_ticket:`,
      `${INDENT4}kind: "a2a:send_message"`,
      `${INDENT4}target: "a2a://conn"`,
      `${INDENT4}inputs:`,
      typeLine
    );

    const lines = source.split('\n');
    const typeLineIdx = lines.findIndex(l => l === typeLine);
    expect(typeLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(
      source,
      typeLineIdx,
      typeLine.length
    );

    expect(labels).toContain('date');
    expect(labels).toContain('datetime');
    expect(labels).toContain('integer');
    expect(labels).toContain('long');
    expect(labels).toContain('currency');
  });
});
