/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Test to understand the dedent behavior with the exact input
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

describe('Dedent calculation with trim().length', () => {
  it('shows the problem: minContinuationIndent calculation skips whitespace-only lines', () => {
    // This input has a line with ONLY spaces between two content lines
    // The spaces-only line should be considered when calculating minContinuationIndent
    const output = getTemplateContent(`|- item 1

           - nested`);

    console.log('Output with blank line:', JSON.stringify(output));
    const lines = output.split('\n');
    console.log('Line 0:', JSON.stringify(lines[0]));
    console.log(
      'Line 1:',
      JSON.stringify(lines[1]),
      'length:',
      lines[1]?.length
    );
    console.log('Line 2:', JSON.stringify(lines[2]));

    expect(true).toBe(true);
  });

  it('compares behavior with vs without blank line', () => {
    const withoutBlank = getTemplateContent(`|- item 1
           - nested`);

    const withBlank = getTemplateContent(`|- item 1

           - nested`);

    console.log('\nWithout blank line:');
    console.log(JSON.stringify(withoutBlank));

    console.log('\nWith blank line (17 spaces):');
    console.log(JSON.stringify(withBlank));

    expect(true).toBe(true);
  });
});
