/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { parse } from '@agentscript/parser';
import type { SyntaxNode } from '@agentscript/types';
import {
  ESCAPE_TABLE,
  escapeStringValue,
  interpretEscape,
} from './string-escapes.js';
import { StringLiteral } from './expressions.js';
import { getKeyText, quoteKeyName } from './types.js';
import {
  getKeyTextGeneric,
  type NodeAccessor,
} from './analysis/hover-resolver.js';

const syntaxNodeAccessor: NodeAccessor<SyntaxNode> = {
  type: n => n.type,
  text: n => n.text,
  children: n => n.children,
  namedChildren: n => n.namedChildren,
  startLine: n => n.startRow,
  startColumn: n => n.startCol,
  endLine: n => n.endRow,
  endColumn: n => n.endCol,
  childByFieldName: (n, name) => n.childForFieldName(name),
};

function firstOfType(node: SyntaxNode, type: string): SyntaxNode | undefined {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const found = firstOfType(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('string escapes', () => {
  it('interprets an escaped apostrophe', () => {
    expect(interpretEscape("'")).toBe("'");
  });

  it('does not escape ordinary apostrophes in double-quoted output', () => {
    expect(escapeStringValue("don't")).toBe("don't");
  });

  it('decodes exactly the escapes the parser accepts', () => {
    for (let code = 0x20; code < 0x7f; code++) {
      const char = String.fromCharCode(code);
      const source = `x: "\\${char}"`;
      expect(parse(source).rootNode.hasError, source).toBe(
        !ESCAPE_TABLE.has(char)
      );
    }
  });

  it('interprets an escaped forward slash', () => {
    expect(interpretEscape('/')).toBe('/');
  });

  it('does not escape forward slashes in double-quoted output', () => {
    expect(escapeStringValue('https://example.com/docs')).toBe(
      'https://example.com/docs'
    );
  });

  it('quotes key names with the same escaping as string values', () => {
    expect(quoteKeyName('a/b')).toBe('"a/b"');
    expect(quoteKeyName('say "hi"\\\n\t\r\0')).toBe(
      '"say \\"hi\\"\\\\\\n\\t\\r\\0"'
    );
  });

  it('decodes escaped forward slashes in parsed keys and values', () => {
    const { rootNode } = parse('"a\\/b": "https:\\/\\/example.com"');
    const key = firstOfType(rootNode, 'key')!.namedChildren[0]!;
    const value = firstOfType(rootNode, 'expression')!;

    expect(getKeyText(key)).toBe('a/b');
    expect(getKeyTextGeneric(key, syntaxNodeAccessor)).toBe('a/b');
    expect(StringLiteral.parse(firstOfType(value, 'string')!).value).toBe(
      'https://example.com'
    );
  });

  it('preserves double quote, backslash, and newline escaping', () => {
    expect(interpretEscape('"')).toBe('"');
    expect(interpretEscape('\\')).toBe('\\');
    expect(interpretEscape('n')).toBe('\n');
    expect(escapeStringValue('say "hello"\\next\nline')).toBe(
      'say \\"hello\\"\\\\next\\nline'
    );
  });
});
