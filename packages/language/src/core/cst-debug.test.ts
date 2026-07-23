/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Test to see the raw CST content
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';

describe('CST raw content', () => {
  it('shows what the template CST node contains', () => {
    const source = `key: ->
        |- item 1
           - nested item`;

    const { rootNode } = parse(source);

    function findNode(node: any, type: string): any {
      if (node.type === type) return node;
      for (const child of node.namedChildren || []) {
        const found = findNode(child, type);
        if (found) return found;
      }
      return null;
    }

    const templateNode = findNode(rootNode, 'template');
    console.log('Template node type:', templateNode.type);
    console.log('Template text:', templateNode.text);
    console.log(
      'Template children:',
      templateNode.namedChildren?.map((c: any) => ({
        type: c.type,
        text: c.text.substring(0, 50),
      }))
    );

    // Look for template_content
    const contentNode = templateNode.namedChildren?.find(
      (c: any) => c.type === 'template_content'
    );
    if (contentNode) {
      console.log('\nTemplate content node text:');
      console.log(JSON.stringify(contentNode.text));

      const lines = contentNode.text.split('\n');
      console.log('\nTemplate content lines:');
      lines.forEach((line: string, i: number) => {
        const spaces = line.match(/^ */)?.[0].length || 0;
        console.log(
          `Line ${i}: ${spaces} spaces, length ${line.length}, "${line}"`
        );
      });
    }

    expect(true).toBe(true);
  });
});
