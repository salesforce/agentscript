/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Pratt expression parser for AgentScript.
 *
 * Precedence levels (matching grammar.js):
 *  0: ternary (X if C else Y) — right-associative
 *  1: or
 *  2: and
 *  3: not (prefix)
 *  4: ==, !=, <, >, <=, >=, is, is not, = (comparison)
 *  5: +, - (binary)
 *  6: *, /
 *  7: +, - (unary prefix)
 *  8: call, member, subscript (postfix)
 *  9: parenthesized (atomic)
 */

import { TokenKind } from './token.js';
import { CSTNode } from './cst-node.js';
import type { ParserContext } from './parser.js';

// Hoisted constants — avoid per-call allocation
// Must match ESCAPE_TABLE in @agentscript/language (packages/language/src/core/string-escapes.ts)
const VALID_ESCAPES = new Set(['"', "'", '\\', 'n', 'r', 't', '0']);

const KEY_STOP_KEYWORDS = new Set([
  'if',
  'elif',
  'else',
  'run',
  'set',
  'with',
  'to',
  'transition',
  'available',
  'and',
  'or',
  'not',
  'is',
  'True',
  'False',
  'None',
  'mutable',
  'linked',
  'empty',
]);

/** Create a MISSING id wrapped in atom → expression at the current parser position. */
function makeMissingArgument(ctx: ParserContext): CSTNode {
  const offset = ctx.peekOffset();
  const pos = ctx.peek().start;
  const missingId = new CSTNode(
    'id',
    ctx.source,
    offset,
    offset,
    pos,
    pos,
    true,
    false,
    true
  );
  const atom = new CSTNode('atom', ctx.source, offset, offset, pos, pos);
  atom.appendChild(missingId);
  const expr = new CSTNode('expression', ctx.source, offset, offset, pos, pos);
  expr.appendChild(atom);
  return expr;
}

/** Create an empty ERROR node at the current parser position. */
function makeEmptyError(ctx: ParserContext): CSTNode {
  const tok = ctx.peek();
  const offset = ctx.peekOffset();
  return new CSTNode(
    'ERROR',
    ctx.source,
    offset,
    offset,
    tok.start,
    tok.start,
    true,
    true
  );
}

export function parseExpression(
  ctx: ParserContext,
  minPrec = 0
): CSTNode | null {
  let left = parsePrefix(ctx);
  if (!left) return null;

  while (true) {
    // Fast path: sync points (NEWLINE/DEDENT/EOF) are never infix operators.
    // This avoids the infixPrecedence() lookup in the most common case for mappings.
    const nextKind = ctx.peekKind();
    if (
      nextKind === TokenKind.NEWLINE ||
      nextKind === TokenKind.DEDENT ||
      nextKind === TokenKind.EOF
    )
      break;

    const prec = infixPrecedence(ctx);
    if (prec < minPrec) break;

    const result = parseInfix(ctx, left, prec);
    if (!result) break;
    left = result;
  }

  return left;
}

function parsePrefix(ctx: ParserContext): CSTNode | null {
  const tok = ctx.peek();

  // not (precedence 3)
  if (tok.kind === TokenKind.ID && tok.text === 'not') {
    return parseUnary(ctx, 'not', 3);
  }

  // Unary + / - (precedence 7)
  if (tok.kind === TokenKind.PLUS || tok.kind === TokenKind.MINUS) {
    const op = tok.text;
    return parseUnary(ctx, op, 7);
  }

  // Spread *expr (precedence 7)
  if (tok.kind === TokenKind.STAR) {
    return parseSpread(ctx);
  }

  // Parenthesized expression
  if (tok.kind === TokenKind.LPAREN) {
    return parseParenthesized(ctx);
  }

  // Atom
  return parseAtom(ctx);
}

function parseUnary(
  ctx: ParserContext,
  _op: string,
  prec: number
): CSTNode | null {
  const startTok = ctx.peek();
  const node = ctx.startNode('unary_expression');
  ctx.addAnonymousChild(node, ctx.consume()); // operator

  const operand = parseExpression(ctx, prec + 1);
  if (operand) {
    node.appendChild(wrapExpression(ctx, operand));
  }
  ctx.finishNode(node, startTok);
  return node;
}

function parseSpread(ctx: ParserContext): CSTNode | null {
  const startTok = ctx.peek();
  const node = ctx.startNode('spread_expression');
  ctx.addAnonymousChild(node, ctx.consume()); // *

  // Bind at precedence 8 (same as postfix call/member/subscript) so
  // *@variables.x parses as *(variables.x), not (*variables).x
  const operand = parseExpression(ctx, 8);
  if (operand) {
    node.appendChild(wrapExpression(ctx, operand), 'expression');
  }
  ctx.finishNode(node, startTok);
  return node;
}

function parseParenthesized(ctx: ParserContext): CSTNode | null {
  const startTok = ctx.peek();
  const node = ctx.startNode('parenthesized_expression');
  ctx.addAnonymousChild(node, ctx.consume()); // (

  const expr = parseExpression(ctx, 0);
  if (expr) {
    node.appendChild(wrapExpression(ctx, expr), 'expression');
  } else if (ctx.peekKind() === TokenKind.RPAREN) {
    // Empty parens () → insert MISSING id
    node.appendChild(makeMissingArgument(ctx), 'expression');
  }

  if (ctx.peekKind() === TokenKind.RPAREN) {
    ctx.addAnonymousChild(node, ctx.consume()); // )
  } else {
    // Unclosed paren → add ERROR node
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseAtom(ctx: ParserContext): CSTNode | null {
  const tok = ctx.peek();

  // Boolean / None constants
  if (
    tok.kind === TokenKind.ID &&
    (tok.text === 'True' || tok.text === 'False' || tok.text === 'None')
  ) {
    const node = ctx.startNode('atom');
    ctx.addAnonymousChild(node, ctx.consume());
    ctx.finishNode(node, tok);
    return node;
  }

  // empty keyword
  if (tok.kind === TokenKind.ID && tok.text === 'empty') {
    const node = ctx.startNode('empty_keyword');
    ctx.addAnonymousChild(node, ctx.consume());
    ctx.finishNode(node, tok);
    return node;
  }

  // @id
  if (tok.kind === TokenKind.AT) {
    return parseAtId(ctx);
  }

  // id
  if (tok.kind === TokenKind.ID) {
    return ctx.consumeNamed('id');
  }

  // number
  if (tok.kind === TokenKind.NUMBER) {
    return ctx.consumeNamed('number');
  }

  // datetime
  if (tok.kind === TokenKind.DATETIME) {
    return ctx.consumeNamed('datetime_literal');
  }

  // string
  if (tok.kind === TokenKind.STRING) {
    return parseString(ctx);
  }

  // ellipsis
  if (tok.kind === TokenKind.ELLIPSIS) {
    return ctx.consumeNamed('ellipsis');
  }

  // list [...]
  if (tok.kind === TokenKind.LBRACKET) {
    return parseList(ctx);
  }

  // dictionary {...}
  if (tok.kind === TokenKind.LBRACE) {
    return parseDictionary(ctx);
  }

  return null;
}

function parseAtId(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('at_id');
  ctx.addAnonymousChild(node, ctx.consume()); // @

  if (ctx.peekKind() === TokenKind.ID) {
    node.appendChild(ctx.consumeNamed('id'));
  } else {
    // @ with no identifier → ERROR
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

export function parseString(ctx: ParserContext): CSTNode {
  const tok = ctx.peek();
  const startTok = tok;
  const node = ctx.startNode('string');

  // The lexer gives us the whole string as one token.
  // We need to break it into children: opening quote, string_content/escape_sequence, closing quote.
  const text = tok.text;
  const tokenOffset = ctx.peekOffset();
  ctx.consume(); // consume the full string token

  const baseRow = startTok.start.row;
  const baseCol = startTok.start.column;

  // Opening quote
  node.appendChild(
    new CSTNode(
      '"',
      ctx.source,
      tokenOffset,
      tokenOffset + 1,
      { row: baseRow, column: baseCol },
      { row: baseRow, column: baseCol + 1 },
      false
    )
  );

  // Parse content between quotes
  let i = 1; // skip opening "
  const quoteChar = text[0]!; // " or '
  const hasClosingQuote =
    text.length > 1 && text[text.length - 1] === quoteChar;
  const contentEnd = hasClosingQuote ? text.length - 1 : text.length;

  let contentStart = i;
  while (i < contentEnd) {
    if (
      text[i] === '\\' &&
      i + 1 < contentEnd &&
      VALID_ESCAPES.has(text[i + 1]!)
    ) {
      // Emit any accumulated content before the escape
      if (i > contentStart) {
        node.appendChild(
          new CSTNode(
            'string_content',
            ctx.source,
            tokenOffset + contentStart,
            tokenOffset + i,
            { row: baseRow, column: baseCol + contentStart },
            { row: baseRow, column: baseCol + i }
          )
        );
      }
      // Emit escape sequence
      const escLen = 2;
      node.appendChild(
        new CSTNode(
          'escape_sequence',
          ctx.source,
          tokenOffset + i,
          tokenOffset + i + escLen,
          { row: baseRow, column: baseCol + i },
          { row: baseRow, column: baseCol + i + escLen }
        )
      );
      i += escLen;
      contentStart = i;
    } else if (
      text[i] === '\\' &&
      i + 1 < contentEnd &&
      !VALID_ESCAPES.has(text[i + 1]!)
    ) {
      // Invalid escape sequence — emit accumulated content, then ERROR
      if (i > contentStart) {
        node.appendChild(
          new CSTNode(
            'string_content',
            ctx.source,
            tokenOffset + contentStart,
            tokenOffset + i,
            { row: baseRow, column: baseCol + contentStart },
            { row: baseRow, column: baseCol + i }
          )
        );
      }
      // Find the extent of the invalid escape: \x followed by remaining word chars
      const escStart = i;
      i += 2; // skip \ and the invalid char
      while (i < contentEnd && /[a-zA-Z0-9_]/.test(text[i]!)) {
        i++;
      }
      const errNode = new CSTNode(
        'ERROR',
        ctx.source,
        tokenOffset + escStart,
        tokenOffset + i,
        { row: baseRow, column: baseCol + escStart },
        { row: baseRow, column: baseCol + i },
        true,
        true
      );
      node.appendChild(errNode);
      contentStart = i;
    } else {
      i++;
    }
  }

  // Emit remaining content
  if (i > contentStart) {
    node.appendChild(
      new CSTNode(
        'string_content',
        ctx.source,
        tokenOffset + contentStart,
        tokenOffset + i,
        { row: baseRow, column: baseCol + contentStart },
        { row: baseRow, column: baseCol + i }
      )
    );
  }

  // Closing quote
  if (hasClosingQuote) {
    node.appendChild(
      new CSTNode(
        quoteChar,
        ctx.source,
        tokenOffset + text.length - 1,
        tokenOffset + text.length,
        { row: baseRow, column: baseCol + text.length - 1 },
        { row: baseRow, column: baseCol + text.length },
        false
      )
    );
  } else {
    // Unclosed string → MISSING closing quote
    // Position at end of string content (where the quote should have been),
    // not at the next token which may be on the next line.
    const missingOffset = tokenOffset + text.length;
    const missingPos = { row: baseRow, column: baseCol + text.length };
    node.appendChild(
      new CSTNode(
        quoteChar,
        ctx.source,
        missingOffset,
        missingOffset,
        missingPos,
        missingPos,
        false,
        false,
        true
      )
    );
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseList(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('list');
  ctx.addAnonymousChild(node, ctx.consume()); // [

  // Lists can span multiple lines — skip whitespace tokens inside [...]
  let _listIndentDepth = 0;
  while (
    ctx.peekKind() !== TokenKind.RBRACKET &&
    ctx.peekKind() !== TokenKind.EOF
  ) {
    if (ctx.peekKind() === TokenKind.NEWLINE) {
      ctx.consume();
      continue;
    }
    if (ctx.peekKind() === TokenKind.INDENT) {
      _listIndentDepth++;
      ctx.consume();
      continue;
    }
    if (ctx.peekKind() === TokenKind.DEDENT) {
      _listIndentDepth--;
      ctx.consume();
      continue;
    }
    const expr = parseExpression(ctx, 0);
    if (expr) {
      node.appendChild(wrapExpression(ctx, expr));
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }

  // Skip whitespace tokens to find the closing ]
  while (
    ctx.peekKind() === TokenKind.NEWLINE ||
    ctx.peekKind() === TokenKind.INDENT ||
    ctx.peekKind() === TokenKind.DEDENT
  ) {
    ctx.consume();
  }

  if (ctx.peekKind() === TokenKind.RBRACKET) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseDictionary(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('dictionary');
  ctx.addAnonymousChild(node, ctx.consume()); // {

  // Dictionaries can span multiple lines
  while (
    ctx.peekKind() !== TokenKind.RBRACE &&
    ctx.peekKind() !== TokenKind.EOF
  ) {
    if (
      ctx.peekKind() === TokenKind.NEWLINE ||
      ctx.peekKind() === TokenKind.INDENT ||
      ctx.peekKind() === TokenKind.DEDENT
    ) {
      ctx.consume();
      continue;
    }
    const pair = parseDictionaryPair(ctx);
    if (pair) {
      node.appendChild(pair);
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }

  if (ctx.peekKind() === TokenKind.RBRACE) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseDictionaryPair(ctx: ParserContext): CSTNode | null {
  const startTok = ctx.peek();
  if (!isKeyStart(ctx)) return null;

  const node = ctx.startNode('dictionary_pair');
  const key = parseKey(ctx);
  if (key) node.appendChild(key, 'key');

  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  }

  const value = parseExpression(ctx, 0);
  if (value) node.appendChild(wrapExpression(ctx, value), 'value');

  ctx.finishNode(node, startTok);
  return node;
}

// --- Infix parsing ---

// Precedence lookup tables (O(1) instead of 20+ if-statements)
const INFIX_PREC_BY_KIND = new Map<TokenKind, number>([
  [TokenKind.LPAREN, 8],
  [TokenKind.DOT, 8],
  [TokenKind.LBRACKET, 8],
  [TokenKind.EQEQ, 4],
  [TokenKind.NEQ, 4],
  [TokenKind.LT, 4],
  [TokenKind.GT, 4],
  [TokenKind.LTE, 4],
  [TokenKind.GTE, 4],
  [TokenKind.PLUS, 5],
  [TokenKind.MINUS, 5],
  [TokenKind.STAR, 6],
  [TokenKind.SLASH, 6],
]);

const INFIX_KEYWORD_PREC = new Map<string, number>([
  ['if', 0],
  ['or', 1],
  ['and', 2],
  ['is', 4],
]);

function infixPrecedence(ctx: ParserContext): number {
  const tok = ctx.peek();
  if (tok.kind === TokenKind.ID) return INFIX_KEYWORD_PREC.get(tok.text) ?? -2;
  return INFIX_PREC_BY_KIND.get(tok.kind) ?? -2;
}

function parseInfix(
  ctx: ParserContext,
  left: CSTNode,
  prec: number
): CSTNode | null {
  const tok = ctx.peek();

  // Call expression: expr(args)
  if (tok.kind === TokenKind.LPAREN && prec === 8) {
    return parseCall(ctx, left);
  }

  // Member expression: expr.id
  if (tok.kind === TokenKind.DOT && prec === 8) {
    return parseMember(ctx, left);
  }

  // Subscript expression: expr[expr]
  if (tok.kind === TokenKind.LBRACKET && prec === 8) {
    return parseSubscript(ctx, left);
  }

  // Ternary: consequence if condition else alternative
  if (tok.kind === TokenKind.ID && tok.text === 'if') {
    return parseTernary(ctx, left);
  }

  // "is not" compound operator
  if (tok.kind === TokenKind.ID && tok.text === 'is') {
    return parseIsExpression(ctx, left);
  }

  // Binary / comparison
  return parseBinaryOrComparison(ctx, left, prec);
}

function parseCall(ctx: ParserContext, func: CSTNode): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt('call_expression', func);
  node.appendChild(wrapExpression(ctx, func), 'function');
  ctx.addAnonymousChild(node, ctx.consume()); // (

  while (ctx.peekKind() !== TokenKind.RPAREN && !ctx.isAtSyncPoint()) {
    const arg = parseExpression(ctx, 0);
    if (arg) {
      node.appendChild(wrapExpression(ctx, arg), 'argument');
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
      // Trailing comma: if `)` follows, insert MISSING id argument
      if (ctx.peekKind() === TokenKind.RPAREN) {
        node.appendChild(makeMissingArgument(ctx), 'argument');
        break;
      }
    } else {
      break;
    }
  }

  if (ctx.peekKind() === TokenKind.RPAREN) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseMember(ctx: ParserContext, object: CSTNode): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt('member_expression', object);
  node.appendChild(wrapExpression(ctx, object));
  ctx.addAnonymousChild(node, ctx.consume()); // .

  if (ctx.peekKind() === TokenKind.ID) {
    node.appendChild(ctx.consumeNamed('id'));
  } else if (ctx.peekKind() === TokenKind.NUMBER) {
    // Error 19: member access with number like @var.123
    const numNode = ctx.consumeNamed('number');
    const errNode = new CSTNode(
      'ERROR',
      ctx.source,
      numNode.startOffset,
      numNode.endOffset,
      numNode.startPosition,
      numNode.endPosition,
      true,
      true
    );
    errNode.appendChild(numNode);
    node.appendChild(errNode);
  } else {
    // Trailing dot with nothing after → ERROR
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseSubscript(ctx: ParserContext, object: CSTNode): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt('subscript_expression', object);
  node.appendChild(wrapExpression(ctx, object));
  ctx.addAnonymousChild(node, ctx.consume()); // [

  const index = parseExpression(ctx, 0);
  if (index) {
    node.appendChild(wrapExpression(ctx, index));
  }

  if (ctx.peekKind() === TokenKind.RBRACKET) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseTernary(ctx: ParserContext, consequence: CSTNode): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNodeAt('ternary_expression', consequence);
  node.appendChild(wrapExpression(ctx, consequence), 'consequence');
  ctx.addAnonymousChild(node, ctx.consume()); // if

  const condition = parseExpression(ctx, 1); // above 'or'
  if (condition) {
    node.appendChild(wrapExpression(ctx, condition), 'condition');
  }

  if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === 'else') {
    ctx.addAnonymousChild(node, ctx.consume()); // else
    const alt = parseExpression(ctx, 0); // right-associative: parse at 0
    if (alt) {
      node.appendChild(wrapExpression(ctx, alt), 'alternative');
    }
  } else {
    // Incomplete ternary: "a if condition" without else → ERROR
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseIsExpression(ctx: ParserContext, left: CSTNode): CSTNode {
  const startTok = ctx.peek();

  // Check for "is not"
  const isNot =
    ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === 'not';
  const nodeType = 'comparison_expression';

  const node = ctx.startNodeAt(nodeType, left);
  node.appendChild(wrapExpression(ctx, left));
  ctx.addAnonymousChild(node, ctx.consume()); // is
  if (isNot) {
    ctx.addAnonymousChild(node, ctx.consume()); // not
  }

  const right = parseExpression(ctx, 5); // above binary +/-
  if (right) {
    node.appendChild(wrapExpression(ctx, right));
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseBinaryOrComparison(
  ctx: ParserContext,
  left: CSTNode,
  prec: number
): CSTNode {
  const tok = ctx.peek();
  const startTok = tok;

  // Determine if this is a comparison or binary expression
  const isComparison =
    tok.kind === TokenKind.EQEQ ||
    tok.kind === TokenKind.NEQ ||
    tok.kind === TokenKind.LT ||
    tok.kind === TokenKind.GT ||
    tok.kind === TokenKind.LTE ||
    tok.kind === TokenKind.GTE ||
    tok.kind === TokenKind.EQ;

  const nodeType = isComparison ? 'comparison_expression' : 'binary_expression';

  const node = ctx.startNodeAt(nodeType, left);
  node.appendChild(wrapExpression(ctx, left));
  ctx.addAnonymousChild(node, ctx.consume()); // operator

  const right = parseExpression(ctx, prec + 1); // left-associative
  if (right) {
    node.appendChild(wrapExpression(ctx, right));
  } else {
    // Incomplete binary/comparison: `3 +` or `@var ==` with no right operand
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

// --- Helpers ---

/**
 * Types that are already wrapped or structural — should NOT get an expression wrapper.
 * Everything else produced by expression parsing gets wrapped.
 */
const SKIP_WRAP_TYPES = new Set(['expression', 'ERROR']);

/**
 * Leaf/literal types that need an intermediate `atom` wrapper before the `expression` wrapper.
 */
export const ATOM_TYPES = new Set([
  'id',
  'number',
  'string',
  'datetime_literal',
  'at_id',
  'list',
  'dictionary',
  'ellipsis',
]);

/**
 * Wrap an expression in an `expression` supertype node if it isn't already one.
 * Tree-sitter wraps most expression children in an (expression ...) wrapper.
 */
export function wrapExpression(ctx: ParserContext, inner: CSTNode): CSTNode {
  if (SKIP_WRAP_TYPES.has(inner.type)) {
    return inner;
  }

  // For atoms, wrap in atom first then expression
  let wrapped = inner;
  if (ATOM_TYPES.has(inner.type)) {
    const atom = new CSTNode(
      'atom',
      ctx.source,
      inner.startOffset,
      inner.endOffset,
      inner.startPosition,
      inner.endPosition
    );
    atom.appendChild(inner);
    wrapped = atom;
  }

  // Now wrap in expression
  const expr = new CSTNode(
    'expression',
    ctx.source,
    wrapped.startOffset,
    wrapped.endOffset,
    wrapped.startPosition,
    wrapped.endPosition
  );
  expr.appendChild(wrapped);
  return expr;
}

export function isKeyStart(ctx: ParserContext): boolean {
  const tok = ctx.peek();
  return isKeyTokenStart(tok.kind);
}

/** Can this token kind begin a key? (ID, STRING, or NUMBER for digit-prefixed keys like `3var`) */
export function isKeyTokenStart(kind: TokenKind): boolean {
  return (
    kind === TokenKind.ID ||
    kind === TokenKind.STRING ||
    kind === TokenKind.NUMBER
  );
}

/** Can this token kind appear within a multi-part key? (key-start tokens plus MINUS/DOT for `my-var`, `a.b`) */
export function isKeyTokenContinuation(kind: TokenKind): boolean {
  return (
    isKeyTokenStart(kind) || kind === TokenKind.MINUS || kind === TokenKind.DOT
  );
}

export function parseKey(ctx: ParserContext): CSTNode | null {
  if (!isKeyStart(ctx)) return null;

  const startTok = ctx.peek();
  const node = ctx.startNode('key');

  // First name — may be a number (digit-starting key like "3var")
  if (ctx.peekKind() === TokenKind.NUMBER) {
    // Digit-starting key: wrap number in ERROR
    const numNode = ctx.consumeNamed('number');
    const errNode = new CSTNode(
      'ERROR',
      ctx.source,
      numNode.startOffset,
      numNode.endOffset,
      numNode.startPosition,
      numNode.endPosition,
      true,
      true
    );
    node.appendChild(errNode);
    // Consume the ID part if present
    if (ctx.peekKind() === TokenKind.ID) {
      node.appendChild(ctx.consumeNamed('id'));
    }
  } else if (ctx.peekKind() === TokenKind.STRING) {
    node.appendChild(parseString(ctx));
  } else {
    node.appendChild(ctx.consumeNamed('id'));
  }

  // Optional second name (two-word keys like "topic greeting")
  // The second word must be on the same line with exactly immediate adjacency
  // (the grammar uses token.immediate(' '))
  if (
    ctx.peekKind() === TokenKind.ID &&
    !ctx.isAtSyncPoint() &&
    ctx.peek().start.row === startTok.start.row
  ) {
    // Check if this could be a keyword that starts a value/statement
    const nextText = ctx.peek().text;
    if (!KEY_STOP_KEYWORDS.has(nextText)) {
      node.appendChild(ctx.consumeNamed('id'));
    }
  }

  ctx.finishNode(node, startTok);
  return node;
}
