/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Mapping, block-value, and colinear parsing functions extracted from Parser class.
 *
 * Each function takes a ParserContext as its first parameter, following
 * the same free-function pattern as parse-statements.ts and expressions.ts.
 *
 * To avoid circular dependencies with parse-sequence.ts, parseBlockValue
 * receives parseSequence as a callback parameter.
 */

import { isTokenKind, TokenKind } from './token.js';
import { CSTNode } from './cst-node.js';
import { makeErrorNode, tokenToAutoLeaf } from './errors.js';
import {
  makeEmptyError,
  makeMissing,
  synchronize,
  synchronizeRow,
  recoverToBlockEnd,
  parseOrphanBlock,
  skipNewlines,
  consumeCommentsAndSkipNewlines,
  isAtEnd,
  isTrailingCommentOnly,
} from './recovery.js';
import {
  parseExpression,
  wrapExpression,
  isKeyStart,
  isKeyTokenStart,
  isKeyTokenContinuation,
  parseKey,
  ATOM_TYPES,
} from './expressions.js';
import {
  isStatementStart,
  parseProcedure,
  parseSetStatement,
  parseTransitionStatement,
  parseWithStatement,
  parseAvailableWhenStatement,
  tryParseWithToStatementList,
  parseIfStatement,
  parseRunStatement,
} from './parse-statements.js';
import { parseTemplate, parseTemplateAsColinear } from './parse-templates.js';
import type { ParserContext } from './parser.js';
import invariant from 'tiny-invariant';

/**
 * Maximum tokens to scan ahead when distinguishing a mapping key from an
 * expression. Keys are typically 1-3 words; 10 handles any realistic case
 * with margin. The loop terminates early on COLON, NEWLINE, or non-key tokens,
 * so this limit is a safety cap, not a performance concern.
 */
const MAX_KEY_LOOKAHEAD = 10;

/** Callback type for parseSequence to break circular dependency. */
export type ParseSequenceFn = (ctx: ParserContext) => CSTNode;

// ---------------------------------------------------------------------------
// Exported mapping parsers
// ---------------------------------------------------------------------------

/**
 * Parse a mapping-or-expression at the top level.
 * If the current position starts a mapping, delegates to parseMapping;
 * otherwise parses an expression (possibly an assignment).
 */
export function parseMappingOrExpression(
  ctx: ParserContext,
  parseSequence: ParseSequenceFn
): CSTNode | null {
  // Look ahead: if we see ID/STRING followed by COLON, it's a mapping
  if (isMappingStart(ctx)) {
    return parseMapping(ctx, parseSequence);
  }

  // Otherwise, try expression (or assignment_expression)
  const expr = parseExpression(ctx, 0);
  if (!expr) return null;

  // Check for assignment: expr = expr
  if (isTokenKind(ctx.peek(), TokenKind.EQ)) {
    const node = ctx.startNodeAt('assignment_expression', expr);
    node.appendChild(wrapExpression(ctx, expr), 'left');
    ctx.addAnonymousChild(node, ctx.consumeKind(TokenKind.EQ));
    const right = parseExpression(ctx, 0);
    if (right) node.appendChild(wrapExpression(ctx, right), 'right');
    return node;
  }

  return wrapExpression(ctx, expr);
}

/**
 * Lookahead to determine if the current position starts a mapping (key-value
 * pairs) rather than an expression.
 *
 * Keys are at most a few tokens (1-3 words, possibly with hyphens/dots), so
 * we only need a small lookahead window. The limit exists as a safety cap —
 * it should never be reached on valid input.
 */
export function isMappingStart(ctx: ParserContext): boolean {
  const tok = ctx.peek();

  // Comment at start can begin a mapping (comments are valid mapping items)
  if (tok.kind === TokenKind.COMMENT) return true;

  // Template pipe at start can begin a mapping item (template as statement)
  if (tok.kind === TokenKind.PIPE) return true;

  // Statement keywords (not followed by colon) start mappings
  if (tok.kind === TokenKind.ID && isStatementStart(ctx)) return true;

  // First token must be able to start a key; bail early otherwise.
  if (!isKeyTokenStart(tok.kind)) return false;

  // Scan forward on the same line past key-like tokens (ID, STRING, NUMBER,
  // MINUS, DOT) looking for COLON (normal case), INDENT/ARROW (missing-colon
  // recovery), AT (missing-colon with @-expression value), or STRING/NUMBER
  // after a single ID key (missing-colon with literal value).
  const startRow = tok.start.row;
  for (let i = 1; i < MAX_KEY_LOOKAHEAD; i++) {
    const t = ctx.peekAt(i);
    if (
      t.kind === TokenKind.COLON ||
      t.kind === TokenKind.INDENT ||
      t.kind === TokenKind.ARROW ||
      t.kind === TokenKind.AT
    )
      return true;
    // A STRING or NUMBER immediately after a single ID key suggests
    // a missing colon (e.g., `agent_name "WeatherBot"`).
    // Only trigger this on the first lookahead position (i === 1) to
    // avoid false positives with multi-word keys.
    if (i === 1 && (t.kind === TokenKind.STRING || t.kind === TokenKind.NUMBER))
      return true;
    if (t.kind === TokenKind.EOF || t.start.row !== startRow) return false;
    if (!isKeyTokenContinuation(t.kind)) return false;
  }
  return false;
}

/**
 * Parse a mapping (sequence of key-value pairs).
 */
export function parseMapping(
  ctx: ParserContext,
  parseSequence: ParseSequenceFn
): CSTNode {
  const node = ctx.startNode('mapping');

  while (!isAtEnd(ctx)) {
    skipNewlines(ctx);
    const tok = ctx.peek();
    if (tok.kind === TokenKind.DEDENT || tok.kind === TokenKind.EOF) break;

    // Don't consume trailing comments that belong to the parent scope.
    if (tok.kind === TokenKind.COMMENT && isTrailingCommentOnly(ctx)) {
      break;
    }

    const item = parseMappingItem(ctx, parseSequence);
    if (item) {
      node.appendChild(item);
    } else {
      // Can't parse — synchronize (skip to next line)
      const err = synchronize(ctx);
      if (err) {
        node.appendChild(err);
      } else if (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
        // Consume at least one token to avoid infinite loop
        ctx.consume();
      }
    }
  }

  return node;
}

/**
 * Parse a single mapping item (statement, template, comment, or key:value element).
 */
export function parseMappingItem(
  ctx: ParserContext,
  parseSequence: ParseSequenceFn
): CSTNode | null {
  const tok = ctx.peek();

  // Statement keywords always take the statement path (tree-sitter parity).
  // Keywords cannot be used as mapping keys.
  if (tok.kind === TokenKind.ID) {
    switch (tok.text) {
      case 'if':
        return parseIfStatement(ctx, c => parseTemplate(c));
      case 'run':
        return parseRunStatement(ctx, c => parseTemplate(c));
      case 'set':
        return parseSetStatement(ctx);
      case 'transition':
        return parseTransitionStatement(ctx);
      case 'with': {
        if (ctx.peekAt(1).kind !== TokenKind.COLON) {
          return parseWithStatement(ctx);
        }
        break;
      }
      case 'available': {
        if (
          ctx.peekAt(1).kind === TokenKind.ID &&
          ctx.peekAt(1).text === 'when'
        ) {
          return parseAvailableWhenStatement(ctx);
        }
        break;
      }
    }
  }

  // Template
  if (tok.kind === TokenKind.PIPE) {
    return parseTemplate(ctx);
  }

  // Comment
  if (tok.kind === TokenKind.COMMENT) {
    return ctx.consumeNamed('comment');
  }

  // Standalone else/elif/for — wrap in ERROR with parsed body
  if (
    tok.kind === TokenKind.ID &&
    (tok.text === 'else' || tok.text === 'elif' || tok.text === 'for')
  ) {
    return parseOrphanBlock(ctx, c =>
      parseProcedure(c, c2 => parseTemplate(c2))
    );
  }

  // Mapping element (key: value)
  if (isKeyStart(ctx)) {
    return parseMappingElement(ctx, parseSequence);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Exported helpers needed by parse-sequence.ts (T04)
// ---------------------------------------------------------------------------

/**
 * Check if the current position starts a colinear mapping element (key: value
 * on same line after "- ").
 */
export function isColinearMappingElement(ctx: ParserContext): boolean {
  // key: value on same line after "- "
  if (!isKeyStart(ctx)) return false;
  const tok = ctx.peek();

  // Look ahead: ID/STRING then COLON on same line
  const lookahead = 1;
  // Two-word key?
  if (
    ctx.peekAt(lookahead).kind === TokenKind.ID &&
    ctx.peekAt(lookahead).start.row === tok.start.row
  ) {
    const afterSecond = ctx.peekAt(lookahead + 1);
    if (
      afterSecond.kind === TokenKind.COLON &&
      afterSecond.start.row === tok.start.row
    ) {
      return true;
    }
    // Don't eagerly consume two-word key if first word is followed by colon
  }

  const next = ctx.peekAt(lookahead);
  return next.kind === TokenKind.COLON && next.start.row === tok.start.row;
}

/**
 * Parse a colinear mapping element (key: value on the same line as "- ").
 */
export function parseColinearMappingElement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('mapping_element');

  const key = parseKey(ctx);
  if (key) node.appendChild(key, 'key');

  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  }

  const colinear = tryParseColinearValue(ctx);
  if (colinear) {
    if (colinear.errorPrefix) node.appendChild(colinear.errorPrefix);
    node.appendChild(colinear.value, 'colinear_value');
  }

  ctx.finishNode(node, startTok);
  return node;
}

/**
 * Try to parse a colinear value (template, variable declaration, or expression).
 * Returns the parsed value node and optional error prefix, or null if nothing
 * can be parsed.
 */
export function tryParseColinearValue(ctx: ParserContext): {
  value: CSTNode;
  errorPrefix?: CSTNode;
} | null {
  const tok = ctx.peek();

  // Template
  if (tok.kind === TokenKind.PIPE) {
    return { value: parseTemplateAsColinear(ctx) };
  }

  // Variable declaration: mutable/linked
  if (
    tok.kind === TokenKind.ID &&
    (tok.text === 'mutable' || tok.text === 'linked')
  ) {
    return { value: parseVariableDeclaration(ctx) };
  }

  // Fuzzy modifier: close misspelling of mutable/linked → parse as variable_declaration
  // with the misspelled token wrapped in ERROR
  if (tok.kind === TokenKind.ID && isFuzzyModifier(tok.text)) {
    return { value: parseFuzzyVariableDeclaration(ctx) };
  }

  // expression_with_to: expression followed by optional with/to clauses
  const expr = parseExpression(ctx, 0);
  if (!expr) return null;

  // Check for error prefix: if the expression is a number or digit-starting ID
  // (like "123" or "123bad") AND the next token is an ID on the same line,
  // the first is an error prefix and the second is the real value.
  // Wrap the first in ERROR and re-parse the rest.
  if (
    (expr.type === 'number' ||
      (expr.type === 'id' && /^[0-9]/.test(expr.text))) &&
    ctx.peekKind() === TokenKind.ID &&
    ctx.peek().start.row === expr.startRow
  ) {
    // Wrap number/digit-starting ID in ERROR
    const errNode = makeErrorNode(
      ctx.source,
      [wrapExpression(ctx, expr)],
      expr.startOffset,
      expr.endOffset,
      expr.startPosition,
      expr.endPosition
    );

    // Now re-parse the real colinear value (could be variable_declaration or expression)
    const realValue = tryParseColinearValue(ctx);

    // If we got a real value, return it with the error prefix for the caller to handle.
    if (realValue) {
      return { value: realValue.value, errorPrefix: errNode };
    }

    // No real value — just return the expression as-is
  }

  // Check for with/to statement list
  const withToList = tryParseWithToStatementList(ctx);
  if (withToList) {
    const ewt = ctx.startNodeAt('expression_with_to', expr);
    ewt.appendChild(wrapExpression(ctx, expr), 'expression');
    ewt.appendChild(withToList, 'with_to_statement_list');
    ewt.finalize();
    return { value: ewt };
  }

  // Check for assignment: expr = expr
  if (ctx.peekKind() === TokenKind.EQ) {
    const assign = ctx.startNodeAt('assignment_expression', expr);
    assign.appendChild(wrapExpression(ctx, expr), 'left');
    ctx.addAnonymousChild(assign, ctx.consume()); // =
    const right = parseExpression(ctx, 0);
    if (right) assign.appendChild(wrapExpression(ctx, right), 'right');
    assign.finalize();
    return { value: assign };
  }

  // Plain expression_with_to (just expression, no with/to)
  const ewt = ctx.startNodeAt('expression_with_to', expr);
  ewt.appendChild(wrapExpression(ctx, expr), 'expression');
  return { value: ewt };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from<number>({ length: n + 1 }).fill(0)
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

/**
 * Check if a string is a likely misspelling of 'mutable' or 'linked' (Levenshtein ≤ 2).
 */
function isFuzzyModifier(text: string): boolean {
  return (
    levenshteinDistance(text, 'mutable') <= 2 ||
    levenshteinDistance(text, 'linked') <= 2
  );
}

/**
 * Parse a variable declaration with a misspelled modifier.
 * The misspelled modifier token is wrapped in ERROR, while the rest
 * (type expression + optional default) is parsed normally.
 */
function parseFuzzyVariableDeclaration(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('variable_declaration');

  // Consume misspelled modifier and wrap in ERROR
  const misspelled = ctx.consume();
  const misspelledEnd = misspelled.startOffset + misspelled.text.length;
  const leaf = tokenToAutoLeaf(misspelled, ctx.source, misspelled.startOffset);
  const errNode = makeErrorNode(
    ctx.source,
    [leaf],
    misspelled.startOffset,
    misspelledEnd,
    misspelled.start,
    misspelled.end
  );
  node.appendChild(errNode);

  // type expression
  const typeExpr = parseExpression(ctx, 0);
  if (typeExpr) node.appendChild(wrapExpression(ctx, typeExpr), 'type');

  // Optional default: = expr
  if (ctx.peekKind() === TokenKind.EQ) {
    ctx.addAnonymousChild(node, ctx.consume()); // =
    const defaultExpr = parseExpression(ctx, 0);
    if (defaultExpr)
      node.appendChild(wrapExpression(ctx, defaultExpr), 'default');
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseMappingElement(
  ctx: ParserContext,
  parseSequence: ParseSequenceFn
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('mapping_element');

  const key = parseKey(ctx);
  invariant(key != null, 'We must be at a key start');
  node.appendChild(key, 'key');

  // Colon handling
  if (ctx.peekKind() === TokenKind.COLON) {
    // Consume real colon
    ctx.addAnonymousChild(node, ctx.consumeKind(TokenKind.COLON));
  } else if (
    ctx.peekKind() === TokenKind.INDENT ||
    ctx.peekKind() === TokenKind.ARROW ||
    ctx.peekKind() === TokenKind.ID ||
    ctx.peekKind() === TokenKind.AT ||
    ctx.peekKind() === TokenKind.STRING ||
    ctx.peekKind() === TokenKind.NUMBER
  ) {
    // Insert MISSING colon for recovery
    node.appendChild(makeMissing(ctx, ':'));
  } else {
    // No colon, no recovery, no value
    return node;
  }

  if (ctx.peekKind() === TokenKind.ARROW) {
    parseArrowBody(ctx, node);
  } else if (ctx.peekKind() === TokenKind.INDENT) {
    parseIndentedBlockValue(ctx, node, parseSequence);
  } else {
    parseColinearAndBlock(ctx, node, startTok.start.row, parseSequence);
  }
  return node;
}

/**
 * Parse optional colinear value, inline comment, error synchronization,
 * and trailing indented block or continuation `to` clause.
 */
function parseColinearAndBlock(
  ctx: ParserContext,
  node: CSTNode,
  startRow: number,
  parseSequence: ParseSequenceFn
): void {
  const colinear = tryParseColinearValue(ctx);
  if (colinear) {
    if (colinear.errorPrefix) node.appendChild(colinear.errorPrefix);
    node.appendChild(colinear.value, 'colinear_value');
  }

  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed('comment'));
  }

  // Absorb trailing junk on same row after colinear value (e.g., a broken
  // `tz` that was meant to be `to`).
  if (colinear) {
    const err = synchronizeRow(ctx, startRow);
    if (err) node.appendChild(err);
  } else if (!ctx.isAtSyncPoint() && ctx.peekKind() !== TokenKind.INDENT) {
    const err = synchronize(ctx);
    if (err) node.appendChild(err);
  }

  // Continuation: indented `to` clause on expression_with_to
  // (e.g., `go: @utils.transition\n    to @topic.next`).
  // NOTE: we only absorb `to`, not `with` — an indented `with` is typically
  // a with_statement in a block_value mapping, not a with clause on the expression.
  if (
    colinear?.value.type === 'expression_with_to' &&
    !colinear.value.childForFieldName('with_to_statement_list') &&
    ctx.peekKind() === TokenKind.INDENT &&
    ctx.peekAt(1).kind === TokenKind.ID &&
    ctx.peekAt(1).text === 'to'
  ) {
    ctx.consumeKind(TokenKind.INDENT);
    const withToList = tryParseWithToStatementList(ctx);
    if (withToList) {
      colinear.value.appendChild(withToList, 'with_to_statement_list');
      node.endOffset = colinear.value.endOffset;
      node.endPosition = colinear.value.endPosition;
    }
    ctx.consumeKind(TokenKind.DEDENT);
  } else if (ctx.peekKind() === TokenKind.INDENT) {
    parseIndentedBlockValue(ctx, node, parseSequence);
  }
}

/** Consume `->` and its indented procedure body (shared by normal and missing-colon paths). */
function parseArrowBody(ctx: ParserContext, node: CSTNode): void {
  ctx.addAnonymousChild(node, ctx.consume()); // ->
  // Inline comment after -> (e.g., `instructions: -> # comment`)
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed('comment'));
  }
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume(); // INDENT
    // Comments between -> and procedure body attach to mapping_element
    consumeCommentsAndSkipNewlines(ctx, node);
    const proc = parseProcedure(ctx, c => parseTemplate(c));
    if (proc) node.appendChild(proc, 'block_value');
    // Trailing comments after procedure attach to mapping_element
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  } else {
    // Arrow with no indented body → empty procedure with ERROR
    const emptyProc = ctx.startNode('procedure');
    emptyProc.appendChild(makeEmptyError(ctx));
    ctx.finishNode(emptyProc, ctx.peek());
    node.appendChild(emptyProc, 'block_value');
  }
}

function parseVariableDeclaration(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('variable_declaration');

  // mutable or linked
  ctx.addAnonymousChild(node, ctx.consume());

  // Check for duplicate modifier (error case: "mutable linked")
  if (
    ctx.peekKind() === TokenKind.ID &&
    (ctx.peek().text === 'mutable' || ctx.peek().text === 'linked')
  ) {
    // Wrap the extra modifier in ERROR
    const errExpr = parseExpression(ctx, 0);
    if (errExpr) {
      const wrapped = wrapExpression(ctx, errExpr);
      const errNode = makeErrorNode(
        ctx.source,
        [wrapped],
        wrapped.startOffset,
        wrapped.endOffset,
        wrapped.startPosition,
        wrapped.endPosition
      );
      node.appendChild(errNode);
    }
  }

  // type expression
  const typeExpr = parseExpression(ctx, 0);
  if (typeExpr) node.appendChild(wrapExpression(ctx, typeExpr), 'type');

  // Optional default: = expr
  if (ctx.peekKind() === TokenKind.EQ) {
    ctx.addAnonymousChild(node, ctx.consume()); // =
    const defaultExpr = parseExpression(ctx, 0);
    if (defaultExpr)
      node.appendChild(wrapExpression(ctx, defaultExpr), 'default');
  }

  ctx.finishNode(node, startTok);
  return node;
}

// --- Block value ---

/** Consume INDENT, parse block value with surrounding comments, recover leftovers, consume DEDENT. */
function parseIndentedBlockValue(
  ctx: ParserContext,
  parent: CSTNode,
  parseSequence: ParseSequenceFn
): void {
  ctx.consume(); // INDENT
  consumeCommentsAndSkipNewlines(ctx, parent);
  const blockValue = parseBlockValue(ctx, parseSequence);
  if (blockValue) parent.appendChild(blockValue, 'block_value');
  consumeCommentsAndSkipNewlines(ctx, parent);
  recoverToBlockEnd(ctx, parent);
  if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
}

function parseBlockValue(
  ctx: ParserContext,
  parseSequence: ParseSequenceFn
): CSTNode | null {
  const tok = ctx.peek();

  // Sequence
  if (tok.kind === TokenKind.DASH_SPACE) {
    return parseSequence(ctx);
  }

  // Empty keyword
  if (tok.kind === TokenKind.ID && tok.text === 'empty') {
    const emptyNode = ctx.startNode('empty_keyword');
    ctx.addAnonymousChild(emptyNode, ctx.consume());
    ctx.finishNode(emptyNode, tok);
    return emptyNode;
  }

  // Mapping — either key:value or statement-starting content
  // isMappingStart() already checks isStatementStart() internally
  if (isMappingStart(ctx)) {
    return parseMapping(ctx, parseSequence);
  }

  // Atom (standalone value in block position)
  return parseAtomBlockValue(ctx);
}

function parseAtomBlockValue(ctx: ParserContext): CSTNode | null {
  const expr = parseExpression(ctx, 0);
  if (!expr) return null;
  // tree-sitter's block_value rule wraps atom-type children in (atom ...)
  if (ATOM_TYPES.has(expr.type)) {
    const atom = new CSTNode(
      'atom',
      ctx.source,
      expr.startOffset,
      expr.endOffset,
      expr.startPosition,
      expr.endPosition
    );
    atom.appendChild(expr);
    return atom;
  }
  return expr;
}
