/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lexer.js';
import { TokenKind } from '../src/token.js';

function tokenize(source: string) {
  return new Lexer(source).tokenize();
}

describe('EOF token', () => {
  const cases = [
    ['empty input', ''],
    ['single line', 'key: value'],
    ['multiline', 'topic foo:\n    label: "bar"'],
    ['trailing newline', 'key: value\n'],
    ['blank lines only', '\n\n\n'],
  ];

  it.each(cases)(
    'exactly one EOF token at the end of the stream (%s)',
    (_label, source) => {
      const tokens = tokenize(source as string);
      const eofTokens = tokens.filter(t => t.kind === TokenKind.EOF);
      expect(eofTokens).toHaveLength(1);
      expect(tokens[tokens.length - 1].kind).toBe(TokenKind.EOF);
    }
  );
});
