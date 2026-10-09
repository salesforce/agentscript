/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

type TokenKind =
  | 'number'
  | 'string'
  | 'ident'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'op'
  | 'eof';

export interface Token {
  kind: TokenKind;
  value: string;
  pos: number;
}

const KEYWORDS = new Set([
  'and',
  'or',
  'not',
  'is',
  'in',
  'True',
  'False',
  'None',
  // case-tolerant synonyms (some IRs emit lowercased literals)
  'true',
  'false',
  'null',
]);

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    const pos = i;

    // numbers
    if (isDigit(ch)) {
      let j = i;
      while (j < n && (isDigit(input[j]) || input[j] === '.')) j++;
      tokens.push({ kind: 'number', value: input.slice(i, j), pos });
      i = j;
      continue;
    }
    // strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let out = '';
      while (j < n && input[j] !== quote) {
        if (input[j] === '\\' && j + 1 < n) {
          out += input[j + 1];
          j += 2;
        } else {
          out += input[j];
          j++;
        }
      }
      if (j >= n) throw new Error(`Unterminated string at ${pos}`);
      tokens.push({ kind: 'string', value: out, pos });
      i = j + 1;
      continue;
    }
    // identifiers / keywords
    if (isIdentStart(ch)) {
      let j = i;
      while (j < n && isIdentPart(input[j])) j++;
      const word = input.slice(i, j);
      if (KEYWORDS.has(word)) {
        tokens.push({ kind: 'op', value: word, pos });
      } else {
        tokens.push({ kind: 'ident', value: word, pos });
      }
      i = j;
      continue;
    }
    // punctuation
    if (ch === '.') {
      tokens.push({ kind: 'dot', value: '.', pos });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ kind: 'lparen', value: '(', pos });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ kind: 'rparen', value: ')', pos });
      i++;
      continue;
    }
    if (ch === ',') {
      tokens.push({ kind: 'comma', value: ',', pos });
      i++;
      continue;
    }
    // operators
    const two = input.slice(i, i + 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=') {
      tokens.push({ kind: 'op', value: two, pos });
      i += 2;
      continue;
    }
    if ('+-*/%<>'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch, pos });
      i++;
      continue;
    }
    throw new Error(`Unexpected character "${ch}" at ${pos}`);
  }

  tokens.push({ kind: 'eof', value: '', pos: n });
  return tokens;
}

function isDigit(c: string) {
  return c >= '0' && c <= '9';
}
function isIdentStart(c: string) {
  return /[A-Za-z_]/.test(c);
}
function isIdentPart(c: string) {
  return /[A-Za-z0-9_]/.test(c);
}
