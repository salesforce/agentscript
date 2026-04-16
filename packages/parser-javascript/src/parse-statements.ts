/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Statement-parsing functions extracted from Parser class.
 *
 * Each function takes a ParserContext as its first parameter, following
 * the same free-function pattern as recovery.ts and expressions.ts.
 *
 * Functions that call parseProcedure (which in turn calls parseStatement,
 * which may delegate to parseTemplate) accept an optional parseTemplate
 * callback to avoid circular dependency with parser.ts.
 */

import { isTokenKind, TokenKind } from './token.js';
import { CSTNode } from './cst-node.js';
import { makeErrorNode, tokenToAutoLeaf } from './errors.js';
import {
  makeEmptyError,
  addMissingTarget,
  makeMissing,
  synchronize,
  synchronizeRow,
  synchronizeRowUntilColon,
  consumeCommentsAndSkipNewlines,
  skipNewlines,
  isAtEnd,
  isTrailingCommentOnly,
  parseOrphanBlock,
} from './recovery.js';
import { parseExpression, wrapExpression, parseString } from './expressions.js';
import type { ParserContext } from './parser.js';

// ---------------------------------------------------------------------------
// Statement detection
// ---------------------------------------------------------------------------

export function isStatementStart(ctx: ParserContext): boolean {
  const tok = ctx.peek();
  if (tok.kind !== TokenKind.ID) return false;
  switch (tok.text) {
    case 'if':
    case 'run':
    case 'set':
    case 'transition':
      return true;
    case 'with':
      // "with" is a statement only if not followed by colon (which would make it a key)
      return ctx.peekAt(1).kind !== TokenKind.COLON;
    case 'available':
      return (
        ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === 'when'
      );
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Procedure & statement dispatch
// ---------------------------------------------------------------------------

export function parseProcedure(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('procedure');

  while (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
    skipNewlines(ctx);
    if (isAtEnd(ctx) || ctx.peekKind() === TokenKind.DEDENT) break;

    // Don't consume trailing comments that belong to the parent scope
    // (tree-sitter parity: extras at block boundaries attach to the parent).
    if (ctx.peekKind() === TokenKind.COMMENT && isTrailingCommentOnly(ctx)) {
      break;
    }

    const stmt = parseStatement(ctx, parseTemplate);
    if (stmt) {
      node.appendChild(stmt);
    } else {
      const err = synchronize(ctx);
      if (err) {
        node.appendChild(err);
      } else if (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
        ctx.consume();
      }
    }
  }

  // If the procedure is empty, add an ERROR node (Error 07, 34)
  if (node.namedChildren.length === 0) {
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}

export function parseStatement(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode | null {
  const tok = ctx.peek();

  if (tok.kind === TokenKind.ID) {
    switch (tok.text) {
      case 'if':
        return parseIfStatement(ctx, parseTemplate);
      case 'run':
        return parseRunStatement(ctx, parseTemplate);
      case 'set':
        return parseSetStatement(ctx);
      case 'transition':
        return parseTransitionStatement(ctx);
      case 'with':
        return parseWithStatement(ctx);
      case 'available': {
        if (
          ctx.peekAt(1).kind === TokenKind.ID &&
          ctx.peekAt(1).text === 'when'
        ) {
          return parseAvailableWhenStatement(ctx);
        }
        break;
      }
      case 'else':
      case 'elif':
      case 'for':
        // Orphan else/elif (without if) or unsupported for → wrap in ERROR
        return parseOrphanBlock(ctx, c => parseProcedure(c, parseTemplate));
    }
  }

  if (tok.kind === TokenKind.PIPE && parseTemplate) {
    return parseTemplate(ctx);
  }

  if (tok.kind === TokenKind.COMMENT) {
    const comment = ctx.consumeNamed('comment');
    if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
    return comment;
  }

  // Fallback: try parsing as a bare expression (e.g., `...` inside a procedure)
  // This keeps expressions as proper expression nodes instead of ERROR-wrapped tokens.
  const expr = parseExpression(ctx, 0);
  if (expr) {
    const wrapped = wrapExpression(ctx, expr);
    if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
    return wrapped;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared colon → procedure body
// ---------------------------------------------------------------------------

/**
 * Shared colon → procedure body sequence for if/elif/else.
 * Consumes colon (with recovery), inline comment, extra inline tokens,
 * then INDENT → procedure → DEDENT, and trailing NEWLINE.
 *
 * @param errorOnMissingBody - if true, insert ERROR when colon has no
 *   indented body (used by `if`; elif/else silently accept missing body).
 */
function parseColonAndProcedureBody(
  ctx: ParserContext,
  node: CSTNode,
  row: number,
  errorOnMissingBody: boolean,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): void {
  // Colon (or recovery)
  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else if (errorOnMissingBody) {
    node.appendChild(makeEmptyError(ctx));
  }

  // Inline comment after colon
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed('comment'));
  }

  // Absorb extra inline tokens after colon on the same row
  const inlineErr = synchronizeRow(ctx, row);
  if (inlineErr) node.appendChild(inlineErr);

  // Consequence block
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    const proc = parseProcedure(ctx, parseTemplate);
    if (proc) node.appendChild(proc, 'consequence');
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  } else if (
    errorOnMissingBody &&
    (ctx.peekKind() === TokenKind.NEWLINE || ctx.isAtSyncPoint())
  ) {
    node.appendChild(makeEmptyError(ctx));
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
}

// ---------------------------------------------------------------------------
// Individual statement parsers
// ---------------------------------------------------------------------------

export function parseIfStatement(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('if_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // if

  // Condition
  let condition = parseExpression(ctx, 0);

  // Handle single `=` typo (should be `==`): wrap `=` in ERROR,
  // build comparison_expression, then continue parsing normally
  if (condition && ctx.peekKind() === TokenKind.EQ) {
    const eqTok = ctx.consume(); // =
    const right = parseExpression(ctx, 5); // parse right side above comparison
    if (right) {
      // Build: (comparison_expression (expr left) (ERROR =) (expr right))
      const cmp = ctx.startNodeAt('comparison_expression', condition);
      cmp.appendChild(wrapExpression(ctx, condition));
      // Wrap `=` in ERROR
      const eqChild = new CSTNode(
        '=',
        ctx.source,
        eqTok.startOffset,
        eqTok.startOffset + 1,
        eqTok.start,
        eqTok.end,
        false
      );
      const eqErr = makeErrorNode(
        ctx.source,
        [eqChild],
        eqTok.startOffset,
        eqTok.startOffset + 1,
        eqTok.start,
        eqTok.end
      );
      cmp.appendChild(eqErr);
      cmp.appendChild(wrapExpression(ctx, right));
      cmp.finalize();
      condition = cmp;
    }
  }

  if (condition) node.appendChild(wrapExpression(ctx, condition), 'condition');

  // Absorb extra tokens between condition and colon on the same row.
  if (
    condition &&
    ctx.peekKind() !== TokenKind.COLON &&
    !ctx.isAtSyncPoint() &&
    ctx.peekKind() !== TokenKind.INDENT
  ) {
    const condRow = startTok.start.row;
    const err = synchronizeRowUntilColon(ctx, condRow);
    if (err) node.appendChild(err);
  }

  parseColonAndProcedureBody(
    ctx,
    node,
    startTok.start.row,
    true,
    parseTemplate
  );

  // elif clauses (including misspelled 'elseif')
  while (
    ctx.peekKind() === TokenKind.ID &&
    (ctx.peek().text === 'elif' || ctx.peek().text === 'elseif')
  ) {
    const elif = parseElifClause(ctx, parseTemplate);
    if (elif) node.appendChild(elif, 'alternative');
  }

  // else clause
  if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === 'else') {
    const elseClause = parseElseClause(ctx, parseTemplate);
    if (elseClause) node.appendChild(elseClause, 'alternative');
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseElifClause(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('elif_clause');

  const kw = ctx.consume(); // elif or elseif
  if (kw.text === 'elseif') {
    // Wrap misspelled keyword in ERROR
    const kwEnd = kw.startOffset + kw.text.length;
    const leaf = tokenToAutoLeaf(kw, ctx.source, kw.startOffset);
    const errNode = makeErrorNode(
      ctx.source,
      [leaf],
      kw.startOffset,
      kwEnd,
      kw.start,
      kw.end
    );
    node.appendChild(errNode);
  } else {
    ctx.addAnonymousChild(node, kw);
  }

  const condition = parseExpression(ctx, 0);
  if (condition) node.appendChild(wrapExpression(ctx, condition), 'condition');

  // Absorb extra tokens between condition and colon (same as if)
  if (
    condition &&
    ctx.peekKind() !== TokenKind.COLON &&
    !ctx.isAtSyncPoint() &&
    ctx.peekKind() !== TokenKind.INDENT
  ) {
    const condRow = startTok.start.row;
    const err = synchronizeRowUntilColon(ctx, condRow);
    if (err) node.appendChild(err);
  }

  parseColonAndProcedureBody(
    ctx,
    node,
    startTok.start.row,
    false,
    parseTemplate
  );

  ctx.finishNode(node, startTok);
  return node;
}

function parseElseClause(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('else_clause');

  ctx.addAnonymousChild(node, ctx.consume()); // else

  parseColonAndProcedureBody(
    ctx,
    node,
    startTok.start.row,
    false,
    parseTemplate
  );

  ctx.finishNode(node, startTok);
  return node;
}

export function parseRunStatement(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('run_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // run

  // Target expression
  if (!ctx.isAtSyncPoint()) {
    const target = parseExpression(ctx, 0);
    if (target) {
      node.appendChild(wrapExpression(ctx, target), 'target');
    } else {
      addMissingTarget(ctx, node);
    }
  } else {
    // `run` with no target at all → insert ERROR placeholder
    addMissingTarget(ctx, node);
  }

  // Optional indented block (procedure)
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    // Comments before procedure body attach to run_statement
    consumeCommentsAndSkipNewlines(ctx, node);
    const proc = parseProcedure(ctx, parseTemplate);
    if (proc) {
      // If procedure contains an ERROR with `with` keyword (invalid with clause),
      // attach children directly to run_statement so the dialect's
      // error recovery can find them (it looks at run_statement.children).
      const hasWithError = proc.namedChildren.some(
        c => c.isError && c.children.some(cc => cc.type === 'with')
      );
      if (hasWithError) {
        for (const child of proc.namedChildren) {
          node.appendChild(child);
        }
      } else {
        node.appendChild(proc, 'block_value');
      }
    }
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

export function parseSetStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('set_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // set

  // Parse target at precedence 5 (above comparison/=) so = and == aren't consumed
  const target = parseExpression(ctx, 5);

  if (ctx.peekKind() === TokenKind.EQEQ) {
    // set @var == "value" → ERROR: == instead of =
    // Build comparison_expression(target, ==, rhs) and wrap in ERROR
    // Don't add target to node — we're returning an ERROR node instead
    const eqTok = ctx.consume(); // ==
    const rhs = parseExpression(ctx, 0);

    if (target && rhs) {
      const cmp = ctx.startNodeAt(
        'comparison_expression',
        wrapExpression(ctx, target)
      );
      cmp.appendChild(wrapExpression(ctx, target));
      cmp.appendChild(
        new CSTNode(
          eqTok.text,
          ctx.source,
          eqTok.startOffset,
          eqTok.startOffset + 2,
          eqTok.start,
          eqTok.end,
          false
        )
      );
      cmp.appendChild(wrapExpression(ctx, rhs));
      cmp.finalize();
      const wrappedCmp = wrapExpression(ctx, cmp);

      if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
      // Return ERROR instead of set_statement
      return makeErrorNode(
        ctx.source,
        [wrappedCmp],
        wrappedCmp.startOffset,
        wrappedCmp.endOffset,
        wrappedCmp.startPosition,
        wrappedCmp.endPosition
      );
    }
  }

  // Add target to node only after ruling out the == error case
  if (target) node.appendChild(wrapExpression(ctx, target), 'target');

  if (ctx.peekKind() === TokenKind.EQ) {
    ctx.addAnonymousChild(node, ctx.consume()); // =
    const value = parseExpression(ctx, 0);
    if (value) node.appendChild(wrapExpression(ctx, value), 'value');
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

export function parseTransitionStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('transition_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // transition

  // Optional with/to statement list
  const withToList = tryParseWithToStatementList(ctx);
  if (withToList) {
    node.appendChild(withToList, 'with_to_statement_list');
  } else if (
    !ctx.isAtSyncPoint() &&
    ctx.peekKind() !== TokenKind.NEWLINE &&
    ctx.peekKind() !== TokenKind.EOF
  ) {
    // No with/to list found but there are tokens remaining on the same line —
    // likely a missing 'to' keyword (e.g. "transition @topic.greeting").
    // Insert a synthetic with_to_statement_list containing a to_statement
    // with a MISSING 'to' node.
    const listNode = ctx.startNode('with_to_statement_list');
    const toNode = ctx.startNode('to_statement');
    toNode.appendChild(makeMissing(ctx, 'to'));
    const target = parseExpression(ctx, 0);
    if (target) toNode.appendChild(wrapExpression(ctx, target), 'target');
    toNode.finalize();
    listNode.appendChild(toNode);
    listNode.finalize();
    node.appendChild(listNode, 'with_to_statement_list');
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

export function parseWithStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();

  // Check if `with` is followed by a valid param (ID/STRING).
  // If not (e.g., `with ...`), create ERROR containing `with` keyword.
  // The remaining tokens (e.g. `...`) stay unconsumed for the caller.
  if (
    ctx.peekAt(1).kind !== TokenKind.ID &&
    ctx.peekAt(1).kind !== TokenKind.STRING
  ) {
    const withTok = ctx.consume();
    const kwOffset = ctx.currentOffset();
    const withChild = new CSTNode(
      'with',
      ctx.source,
      kwOffset,
      kwOffset + 4,
      withTok.start,
      withTok.end,
      false
    );
    return makeErrorNode(
      ctx.source,
      [withChild],
      kwOffset,
      kwOffset + 4,
      withTok.start,
      withTok.end
    );
  }

  const node = ctx.startNode('with_statement');
  ctx.addAnonymousChild(node, ctx.consume()); // with

  // Parse param=value pairs
  parseWithParams(ctx, node);

  // Inline comment on the with line (e.g. `with city=x # comment`)
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed('comment'));
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

function parseWithParams(ctx: ParserContext, node: CSTNode): void {
  while (!ctx.isAtSyncPoint()) {
    // param
    if (
      ctx.peekKind() === TokenKind.ID ||
      ctx.peekKind() === TokenKind.STRING
    ) {
      if (ctx.peekKind() === TokenKind.STRING) {
        node.appendChild(parseString(ctx), 'param');
      } else {
        node.appendChild(ctx.consumeNamed('id'), 'param');
      }
    } else {
      // Not a valid param — wrap remaining tokens in ERROR inside with_statement
      const err = synchronize(ctx);
      if (err) node.appendChild(err);
      return;
    }

    // =
    if (ctx.peekKind() === TokenKind.EQ) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      // Missing = → insert MISSING
      node.appendChild(makeMissing(ctx, '='));
    }

    // value
    const value = parseExpression(ctx, 0);
    if (value) node.appendChild(wrapExpression(ctx, value), 'value');

    // comma
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }
}

export function parseAvailableWhenStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('available_when_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // available
  ctx.addAnonymousChild(node, ctx.consume()); // when

  const condition = parseExpression(ctx, 0);
  if (condition) node.appendChild(wrapExpression(ctx, condition), 'condition');

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

// ---------------------------------------------------------------------------
// With/To statement list
// ---------------------------------------------------------------------------

export function tryParseWithToStatementList(
  ctx: ParserContext
): CSTNode | null {
  const tok = ctx.peek();
  if (!isTokenKind(tok, TokenKind.ID)) return null;
  if (!['with', 'to'].includes(tok.text)) return null;

  const startTok = tok;
  const node = ctx.startNode('with_to_statement_list');

  while (!ctx.isAtSyncPoint()) {
    if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === 'with') {
      node.appendChild(parseInlineWithStatement(ctx));
    } else if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === 'to') {
      node.appendChild(parseToStatement(ctx));
    } else {
      break;
    }
    if (ctx.peekKind() === TokenKind.COMMA) {
      ctx.addAnonymousChild(node, ctx.consume());
    } else {
      break;
    }
  }

  if (node.children.length === 0) return null;

  ctx.finishNode(node, startTok);
  return node;
}

export function parseInlineWithStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('with_statement');
  ctx.addAnonymousChild(node, ctx.consume()); // with
  parseWithParams(ctx, node);
  ctx.finishNode(node, startTok);
  return node;
}

export function parseToStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('to_statement');
  ctx.addAnonymousChild(node, ctx.consume()); // to

  const target = parseExpression(ctx, 0);
  if (target) {
    node.appendChild(wrapExpression(ctx, target), 'target');
  } else {
    // Missing target → ERROR
    node.appendChild(makeEmptyError(ctx));
  }

  ctx.finishNode(node, startTok);
  return node;
}
