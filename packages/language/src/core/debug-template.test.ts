/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Debug test to understand the exact normalizeBlanks behavior
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from './dialect.js';

function getTemplateContent(source: string): string {
  const fullSource = `key: ->\n        ${source}`;
  const { rootNode } = parse(fullSource);

  function findNode(node: any, type: string): any {
    if (node.type === type) return node;
    for (const child of node.namedChildren || []) {
      const found = findNode(child, type);
      if (found) return found;
    }
    return null;
  }

  const templateNode = findNode(rootNode, 'template');
  if (!templateNode) {
    throw new Error('No template node found');
  }

  const dialect = new Dialect();
  const expr = dialect.parseExpression(templateNode);

  if ((expr as any).__kind !== 'TemplateExpression') {
    throw new Error(`Expected TemplateExpression, got ${(expr as any).__kind}`);
  }

  return (expr as any).content;
}

describe('Debug normalizeBlankLines', () => {
  it('shows exact output for simple nested case', () => {
    const output = getTemplateContent(`|- item 1
           - nested item`);

    console.log('Output:', JSON.stringify(output));
    console.log(
      'Lines:',
      output
        .split('\n')
        .map(
          (l, i) =>
            `[${i}]: "${l}" (${l.length} chars, ${l.search(/\S/)} spaces)`
        )
    );

    const lines = output.split('\n');
    console.log('Line 0:', JSON.stringify(lines[0]));
    console.log('Line 1:', JSON.stringify(lines[1]));

    // This will show us exactly what we're getting
    expect(true).toBe(true);
  });

  it('shows output for explicit spaces case', () => {
    // Make it very clear what the input is:
    // Line 1: "- item 1" (after dedent from base indent)
    // Line 2: Should be "   - nested" (3 spaces + "- nested")
    const output = getTemplateContent(`|- item 1
           - nested item`);

    const lines = output.split('\n');

    // Count leading spaces on line 2
    const line2Spaces = lines[1]?.match(/^ */)?.[0].length || 0;
    console.log(`Line 2 has ${line2Spaces} leading spaces`);
    console.log(`Line 2 content: "${lines[1]}"`);

    expect(true).toBe(true);
  });
});
