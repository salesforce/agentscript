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
import { parseMapping } from './parse-mapping.js';
import { parseSequence } from './parse-sequence.js';
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
    case 'say':
    case 'transition':
    case 'escalate':
    case 'end_session':
      return true;
    case 'with':
      // "with" is a statement only if not followed by colon (which would make it a key)
      return ctx.peekAt(1).kind !== TokenKind.COLON;
    case 'when':
      // "when" is a statement only if not followed by colon (which would make it a key)
      return ctx.peekAt(1).kind !== TokenKind.COLON;
    case 'render':
    case 'show_and_return':
      return ctx.peekAt(1).kind === TokenKind.COLON;
    case 'available':
      return (
        ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === 'when'
      );
    case 'ask':
      // "ask for" is a two-word statement keyword (mirrors "available when").
      // A bare "ask" not followed by "for" is not a statement start.
      return (
        ctx.peekAt(1).kind === TokenKind.ID && ctx.peekAt(1).text === 'for'
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
      case 'say':
        return parseSayStatement(ctx);
      case 'transition':
        return parseTransitionStatement(ctx);
      case 'escalate':
        return parseEscalateStatement(ctx);
      case 'end_session':
        return parseEndSessionStatement(ctx);
      case 'ask':
        // "ask for" — two-word statement keyword (mirrors "available when").
        if (
          ctx.peekAt(1).kind === TokenKind.ID &&
          ctx.peekAt(1).text === 'for'
        ) {
          return parseCollectStatement(ctx, parseTemplate);
        }
        break;
      case 'with':
        return parseWithStatement(ctx);
      case 'when':
        if (ctx.peekAt(1).kind !== TokenKind.COLON) {
          return parseWhenStatement(ctx, parseTemplate);
        }
        break;
      case 'render':
        if (ctx.peekAt(1).kind === TokenKind.COLON) {
          return parseRenderStatement(ctx, parseTemplate);
        }
        break;
      case 'show_and_return':
        if (ctx.peekAt(1).kind === TokenKind.COLON) {
          return parseShowAndReturnStatement(ctx);
        }
        break;
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
      case 'for':
        // Orphan else (without preceding if) or unsupported for → wrap in ERROR
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
 * Shared colon → procedure body sequence for if / else if / else.
 * Consumes colon (with recovery), inline comment, extra inline tokens,
 * then INDENT → procedure → DEDENT, and trailing NEWLINE.
 *
 * A missing colon is always a syntax error — every one of `if`, `else if`
 * and `else` requires it, matching the tree-sitter grammar (which lists `:`
 * as a mandatory token in all three rules). Otherwise a colon-less `else`
 * would parse as a valid `else_clause`, diverging from tree-sitter.
 *
 * @param errorOnMissingBody - if true, insert ERROR when the colon has no
 *   indented body (used by `if`; else if / else silently accept a missing
 *   body, e.g. while the author is still typing the block).
 */
function parseColonAndProcedureBody(
  ctx: ParserContext,
  node: CSTNode,
  row: number,
  errorOnMissingBody: boolean,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): void {
  // Colon (or recovery) — required for if / else if / else alike.
  // Insert a MISSING `:` node (not an empty ERROR) so the diagnostic reads
  // "Missing :" and anchors to the end of the condition/keyword, matching
  // tree-sitter (which lists `:` as a required token) and the mapping parser.
  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  } else {
    node.appendChild(makeMissing(ctx, ':'));
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

  // `else if` chain links — match `else` followed by `if` on the same row
  while (
    ctx.peekKind() === TokenKind.ID &&
    ctx.peek().text === 'else' &&
    ctx.peekAt(1).kind === TokenKind.ID &&
    ctx.peekAt(1).text === 'if'
  ) {
    const elseIf = parseElseIfClause(ctx, parseTemplate);
    if (elseIf) node.appendChild(elseIf, 'alternative');
  }

  // Plain `else` clause
  if (ctx.peekKind() === TokenKind.ID && ctx.peek().text === 'else') {
    const elseClause = parseElseClause(ctx, parseTemplate);
    if (elseClause) node.appendChild(elseClause, 'alternative');
  }

  ctx.finishNode(node, startTok);
  return node;
}

function parseElseIfClause(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('else_if_clause');

  // `else` keyword
  ctx.addAnonymousChild(node, ctx.consume());
  // `if` keyword
  ctx.addAnonymousChild(node, ctx.consume());

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

/**
 * Parse `ask for @variables.X <INDENT> instructions: "..." <DEDENT>`.
 *
 * Produces a `collect_statement` node with a `target` field (the variable
 * expression) and a `body` field holding a `mapping` (with the `instructions:`
 * element). Mirrors the tree-sitter grammar's collect_statement rule: `ask for`
 * is a two-word operator (like `available when`), so there is no colon after the
 * target. (The CST node retains its internal `collect_statement` name.)
 */
export function parseCollectStatement(
  ctx: ParserContext,
  _parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('collect_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // ask
  ctx.addAnonymousChild(node, ctx.consume()); // for

  // Target expression (e.g. @variables.patient_city)
  // Builder temporarily inserts `@...` while the user is choosing a
  // reference. Recover like tree-sitter: diagnose the `@`, use `...` as the
  // placeholder target, and keep the indented collect body attached. If the
  // ellipsis is left unconsumed, its INDENT/DEDENT pair can terminate the
  // surrounding mapping early and make later blocks appear invalid.
  if (
    ctx.peekKind() === TokenKind.AT &&
    ctx.peekAt(1).kind === TokenKind.ELLIPSIS
  ) {
    const atToken = ctx.consume();
    const atLeaf = tokenToAutoLeaf(atToken, ctx.source, atToken.startOffset);
    node.appendChild(
      makeErrorNode(
        ctx.source,
        [atLeaf],
        atToken.startOffset,
        atToken.startOffset + atToken.text.length,
        atToken.start,
        atToken.end
      )
    );
    const target = parseExpression(ctx, 0);
    if (target) {
      node.appendChild(wrapExpression(ctx, target), 'target');
    }
  } else if (!ctx.isAtSyncPoint()) {
    const target = parseExpression(ctx, 0);
    if (target) {
      node.appendChild(wrapExpression(ctx, target), 'target');
    } else {
      addMissingTarget(ctx, node);
    }
  } else {
    addMissingTarget(ctx, node);
  }

  // Inline comment after the target (before the indented body). `ask for` is
  // an operator like `available when`, so there is no colon between the target
  // and body.
  if (ctx.peekKind() === TokenKind.COMMENT) {
    node.appendChild(ctx.consumeNamed('comment'));
  }

  // Indented body mapping (holds `message:`)
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    consumeCommentsAndSkipNewlines(ctx, node);
    const body = parseMapping(ctx, parseSequence);
    if (body) node.appendChild(body, 'body');
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  } else {
    node.appendChild(makeEmptyError(ctx));
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

/** Parse a workflow `say "..."` directive with direct reference interpolation. */
export function parseSayStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('say_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // say

  if (ctx.peekKind() === TokenKind.STRING && ctx.peek().text.startsWith('"')) {
    node.appendChild(parseSayString(ctx), 'value');
  } else if (!ctx.isAtSyncPoint()) {
    const token = ctx.consume();
    const leaf = tokenToAutoLeaf(token, ctx.source, token.startOffset);
    node.appendChild(
      makeErrorNode(
        ctx.source,
        [leaf],
        token.startOffset,
        token.startOffset + token.text.length,
        token.start,
        token.end
      )
    );
    const trailing = synchronizeRow(ctx, startTok.start.row);
    if (trailing) node.appendChild(trailing);
  } else {
    node.appendChild(makeEmptyError(ctx));
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}

/** Split the lexer's whole-string token into a say-specific CST. */
function parseSayString(ctx: ParserContext): CSTNode {
  const token = ctx.peek();
  const node = ctx.startNode('say_string');
  const text = token.text;
  const tokenOffset = token.startOffset;
  const row = token.start.row;
  const column = token.start.column;
  ctx.consume();

  const positions: Array<{ row: number; column: number }> = [];
  let currentRow = row;
  let currentColumn = column;
  for (let index = 0; index < text.length; index++) {
    positions.push({ row: currentRow, column: currentColumn });
    if (text.charCodeAt(index) === 10) {
      currentRow++;
      currentColumn = 0;
    } else {
      currentColumn++;
    }
  }
  positions.push({ row: currentRow, column: currentColumn });
  const position = (index: number) => positions[index]!;
  const appendLeaf = (
    type: string,
    start: number,
    end: number,
    isNamed = true,
    parent: CSTNode = node,
    fieldName?: string
  ) => {
    parent.appendChild(
      new CSTNode(
        type,
        ctx.source,
        tokenOffset + start,
        tokenOffset + end,
        position(start),
        position(end),
        isNamed
      ),
      fieldName
    );
  };

  appendLeaf('"', 0, 1, false);

  const hasClosingQuote = hasUnescapedClosingQuote(text);
  const contentEnd = hasClosingQuote ? text.length - 1 : text.length;
  let index = 1;
  let contentStart = index;

  const flushContent = (end: number) => {
    if (end <= contentStart) return;
    appendLeaf('say_string_content', contentStart, end);
  };

  while (index < contentEnd) {
    if (text[index] === '\\' && index + 1 < contentEnd) {
      flushContent(index);
      const escapeEnd = index + 2;
      const validEscape = /["'\\nrt0]/.test(text[index + 1]!);
      if (validEscape) {
        appendLeaf('escape_sequence', index, escapeEnd);
      } else {
        node.appendChild(
          new CSTNode(
            'ERROR',
            ctx.source,
            tokenOffset + index,
            tokenOffset + escapeEnd,
            position(index),
            position(escapeEnd),
            true,
            true
          )
        );
      }
      index = escapeEnd;
      contentStart = index;
      continue;
    }

    if (text[index] === '{' && text[index + 1] === '!') {
      flushContent(index);
      const close = text.indexOf('}', index + 2);
      if (close === -1 || close >= contentEnd) {
        node.appendChild(
          new CSTNode(
            'ERROR',
            ctx.source,
            tokenOffset + index,
            tokenOffset + contentEnd,
            position(index),
            position(contentEnd),
            true,
            true
          )
        );
        index = contentEnd;
        contentStart = index;
        break;
      }

      const inner = text.slice(index + 2, close);
      const match = inner.match(
        /^\s*@([a-zA-Z_][a-zA-Z0-9_]*)\s*\.\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*$/
      );
      if (!match) {
        node.appendChild(
          new CSTNode(
            'ERROR',
            ctx.source,
            tokenOffset + index,
            tokenOffset + close + 1,
            position(index),
            position(close + 1),
            true,
            true
          )
        );
      } else {
        const interpolation = new CSTNode(
          'say_interpolation',
          ctx.source,
          tokenOffset + index,
          tokenOffset + close + 1,
          position(index),
          position(close + 1)
        );
        appendLeaf('{!', index, index + 2, false, interpolation);

        const atIndex = index + 2 + inner.indexOf('@');
        const namespace = match[1]!;
        const property = match[2]!;
        const namespaceNode = new CSTNode(
          'at_id',
          ctx.source,
          tokenOffset + atIndex,
          tokenOffset + atIndex + namespace.length + 1,
          position(atIndex),
          position(atIndex + namespace.length + 1)
        );
        appendLeaf('@', atIndex, atIndex + 1, false, namespaceNode);
        appendLeaf(
          'id',
          atIndex + 1,
          atIndex + namespace.length + 1,
          true,
          namespaceNode
        );

        const dotIndex = text.indexOf('.', atIndex + namespace.length + 1);
        const propertyIndex = text.indexOf(property, dotIndex + 1);
        const reference = new CSTNode(
          'say_reference',
          ctx.source,
          tokenOffset + atIndex,
          tokenOffset + propertyIndex + property.length,
          position(atIndex),
          position(propertyIndex + property.length)
        );
        reference.appendChild(namespaceNode, 'namespace');
        appendLeaf('.', dotIndex, dotIndex + 1, false, reference);
        appendLeaf(
          'id',
          propertyIndex,
          propertyIndex + property.length,
          true,
          reference,
          'property'
        );
        interpolation.appendChild(reference, 'reference');
        appendLeaf('}', close, close + 1, false, interpolation);
        node.appendChild(interpolation);
      }

      index = close + 1;
      contentStart = index;
      continue;
    }

    // Match tree-sitter's token boundary: a lone `{` is one text part,
    // while `{!` remains reserved for interpolation.
    if (text[index] === '{') {
      flushContent(index);
      appendLeaf('say_string_content', index, index + 1);
      index += 1;
      contentStart = index;
      continue;
    }

    index += 1;
  }

  flushContent(index);
  if (hasClosingQuote) {
    appendLeaf('"', text.length - 1, text.length, false);
  } else {
    const missingPosition = position(text.length);
    node.appendChild(
      new CSTNode(
        '"',
        ctx.source,
        tokenOffset + text.length,
        tokenOffset + text.length,
        missingPosition,
        missingPosition,
        false,
        false,
        true
      )
    );
  }

  ctx.finishNode(node, token);
  return node;
}

function hasUnescapedClosingQuote(text: string): boolean {
  if (text.length <= 1 || !text.endsWith('"')) return false;

  let precedingBackslashes = 0;
  for (
    let index = text.length - 2;
    index >= 0 && text[index] === '\\';
    index--
  ) {
    precedingBackslashes++;
  }
  return precedingBackslashes % 2 === 0;
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

export function parseEscalateStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('escalate_statement');
  ctx.addAnonymousChild(node, ctx.consume()); // escalate
  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
  ctx.finishNode(node, startTok);
  return node;
}

export function parseEndSessionStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('end_session_statement');
  ctx.addAnonymousChild(node, ctx.consume()); // end_session
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

export function parseWhenStatement(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('when_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // when

  const subject = parseExpression(ctx, 0);
  if (subject) {
    node.appendChild(wrapExpression(ctx, subject), 'subject');
  }

  // Optional indented body (procedure)
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    consumeCommentsAndSkipNewlines(ctx, node);
    const proc = parseProcedure(ctx, parseTemplate);
    if (proc) node.appendChild(proc, 'body');
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

export function parseRenderStatement(
  ctx: ParserContext,
  parseTemplate?: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('render_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // render

  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  }

  const value = parseExpression(ctx, 0);
  if (value) node.appendChild(wrapExpression(ctx, value), 'value');

  // Optional indented body (procedure) — holds nested `show_and_return:` clause.
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    consumeCommentsAndSkipNewlines(ctx, node);
    const proc = parseProcedure(ctx, parseTemplate);
    if (proc) node.appendChild(proc, 'body');
    consumeCommentsAndSkipNewlines(ctx, node);
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  }

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
}

export function parseShowAndReturnStatement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('show_and_return_statement');

  ctx.addAnonymousChild(node, ctx.consume()); // show_and_return

  if (ctx.peekKind() === TokenKind.COLON) {
    ctx.addAnonymousChild(node, ctx.consume());
  }

  const value = parseExpression(ctx, 0);
  if (value) node.appendChild(wrapExpression(ctx, value), 'value');

  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  ctx.finishNode(node, startTok);
  return node;
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
