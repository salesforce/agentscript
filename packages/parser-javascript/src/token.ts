/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/** Token kinds produced by the lexer. */
export enum TokenKind {
  // Synthetic indentation tokens
  NEWLINE = 'NEWLINE',
  INDENT = 'INDENT',
  DEDENT = 'DEDENT',
  EOF = 'EOF',

  // Identifiers & literals
  ID = 'ID',
  NUMBER = 'NUMBER',
  STRING = 'STRING',
  STRING_CONTENT = 'STRING_CONTENT',
  ESCAPE_SEQUENCE = 'ESCAPE_SEQUENCE',
  DATETIME = 'DATETIME',
  TEMPLATE_CONTENT = 'TEMPLATE_CONTENT',

  // Operators
  PLUS = 'PLUS',
  MINUS = 'MINUS',
  STAR = 'STAR',
  SLASH = 'SLASH',
  DOT = 'DOT',
  COMMA = 'COMMA',
  COLON = 'COLON',
  EQ = 'EQ',
  EQEQ = 'EQEQ',
  NEQ = 'NEQ',
  LT = 'LT',
  GT = 'GT',
  LTE = 'LTE',
  GTE = 'GTE',
  ARROW = 'ARROW',
  ELLIPSIS = 'ELLIPSIS',
  PERCENT = 'PERCENT',
  PIPE = 'PIPE',
  AT = 'AT',

  // Delimiters
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  LBRACKET = 'LBRACKET',
  RBRACKET = 'RBRACKET',
  LBRACE = 'LBRACE',
  RBRACE = 'RBRACE',
  TEMPLATE_EXPR_START = 'TEMPLATE_EXPR_START', // {!

  // Sequence
  DASH_SPACE = 'DASH_SPACE', // "- " at start of line

  // Quote characters (for CST fidelity)
  DQUOTE = 'DQUOTE',

  // Special
  COMMENT = 'COMMENT',
  ERROR_TOKEN = 'ERROR_TOKEN',
}

export interface Position {
  row: number;
  column: number;
}

export interface Token<K extends TokenKind = TokenKind> {
  readonly kind: K;
  text: string;
  start: Position;
  end: Position;
  /** Byte offset into the source string where this token starts. */
  startOffset: number;
}

export function isTokenKind<K extends TokenKind>(
  token: Token,
  kind: K
): token is Token<K> {
  return token.kind === kind;
}
