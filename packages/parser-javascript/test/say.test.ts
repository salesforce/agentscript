/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { parse } from '../src/index.js';
import type { CSTNode } from '../src/cst-node.js';
import { highlight } from '../src/highlighter.js';

function* walk(node: CSTNode): Generator<CSTNode> {
  yield node;
  for (const child of node.children ?? []) yield* walk(child as CSTNode);
}

function nodes(root: CSTNode, type: string): CSTNode[] {
  return [...walk(root)].filter(node => node.type === type);
}

describe('say statement', () => {
  it('parses plain text, escapes, and multiple direct references', () => {
    const source =
      'say "Order \\"{!@variables.order_id}\\" has reason {!@variables.return_reason}."';
    const { rootNode } = parse(source);

    expect(rootNode.hasError).toBe(false);
    expect(nodes(rootNode, 'say_statement')).toHaveLength(1);
    expect(nodes(rootNode, 'say_interpolation')).toHaveLength(2);
    expect(nodes(rootNode, 'say_reference').map(node => node.text)).toEqual([
      '@variables.order_id',
      '@variables.return_reason',
    ]);
  });

  it('highlights say text and interpolation delimiters', () => {
    const source = 'say "Hello {!@variables.name}"';
    const captures = highlight(parse(source).rootNode);
    expect(captures).toContainEqual(
      expect.objectContaining({ name: 'keyword', text: 'say' })
    );
    expect(captures).toContainEqual(
      expect.objectContaining({ name: 'string', text: 'Hello ' })
    );
    expect(captures).toContainEqual(
      expect.objectContaining({ name: 'punctuation.template', text: '{!' })
    );
    expect(captures).toContainEqual(
      expect.objectContaining({ name: 'punctuation.template', text: '}' })
    );
  });

  it('tracks positions across a raw newline', () => {
    const { rootNode } = parse('say "hello\nworld"');
    const content = nodes(rootNode, 'say_string_content');

    expect(rootNode.hasError).toBe(false);
    expect(content).toHaveLength(1);
    expect(content[0]?.text).toBe('hello\nworld');
    expect(content[0]?.startPosition).toEqual({ row: 0, column: 5 });
    expect(content[0]?.endPosition).toEqual({ row: 1, column: 5 });
  });

  it.each([
    ['missing payload', 'say'],
    ['pipe template', 'say | hello'],
    ['single-quoted payload', "say 'hello'"],
    ['number payload', 'say 42'],
    ['operator interpolation', 'say "{!@variables.x + 1}"'],
    ['nested interpolation', 'say "{!@variables.x.value}"'],
    ['unterminated interpolation', 'say "{!@variables.x"'],
    ['escaped final quote without a closing quote', 'say "hello\\"'],
  ])('rejects %s', (_name, source) => {
    expect(parse(source).rootNode.hasError).toBe(true);
  });
});
