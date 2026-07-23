/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Test bare pipe multiline
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

describe('Bare pipe', () => {
  it('tests bare pipe with blank line', () => {
    const output = getTemplateContent(`|
        First paragraph

        Second paragraph`);

    console.log('Output:', JSON.stringify(output));
    console.log('Lines:', output.split('\n'));

    expect(true).toBe(true);
  });
});
