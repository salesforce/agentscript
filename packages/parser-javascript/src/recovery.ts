/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Recovery and utility functions extracted from parser.ts.
 *
 * All functions take a ParserContext as their first argument,
 * following the free-function pattern established by expressions.ts.
 */

import { TokenKind } from './token.js';
import { CSTNode } from './cst-node.js';
import { makeErrorNode, tokenToAutoLeaf } from './errors.js';
import type { ParserContext } from './parser.js';

// --- Error recovery ---

/** Create an empty ERROR node at the current position. */
export function makeEmptyError(ctx: ParserContext): CSTNode {
  const offset = ctx.peekOffset();
  const pos = ctx.peek().start;
  return new CSTNode('ERROR', ctx.source, offset, offset, pos, pos, true, true);
}

/** Insert a missing target: `target: (expression (atom (ERROR)))` */
export function addMissingTarget(ctx: ParserContext, node: CSTNode): void {
  const errAtom = makeEmptyError(ctx);
  const atom = new CSTNode(
    'atom',
    ctx.source,
    errAtom.startOffset,
    errAtom.endOffset,
    errAtom.startPosition,
    errAtom.endPosition
  );
  atom.appendChild(errAtom);
  const expr = new CSTNode(
    'expression',
    ctx.source,
    atom.startOffset,
    atom.endOffset,
    atom.startPosition,
    atom.endPosition
  );
  expr.appendChild(atom);
  node.appendChild(expr, 'target');
}

/** Create a MISSING node — an expected token/node that wasn't found in source. */
export function makeMissing(ctx: ParserContext, type: string): CSTNode {
  const offset = ctx.peekOffset();
  const pos = ctx.peek().start;
  return new CSTNode(
    type,
    ctx.source,
    offset,
    offset,
    pos,
    pos,
    true,
    false,
    true
  );
}

/**
 * Parse a standalone else/elif/for (without a preceding if, or unsupported).
 * Wraps the entire block in an ERROR node, preserving parsed statements inside.
 *
 * @param parseProcedure - callback to parse procedure bodies, avoiding circular
 *   dependency with parse-statements.ts
 */
export function parseOrphanBlock(
  ctx: ParserContext,
  parseProcedure: (ctx: ParserContext) => CSTNode
): CSTNode {
  const startOffset = ctx.peekOffset();
  const startPos = ctx.peek().start;
  const children: CSTNode[] = [];

  // Consume keyword and any tokens up to colon/newline.
  // Capture consumed tokens as children of the ERROR for dialect recovery.
  const keywordTok = ctx.consume();
  const kwOffset = ctx.currentOffset();
  children.push(
    new CSTNode(
      keywordTok.text,
      ctx.source,
      kwOffset,
      kwOffset + keywordTok.text.length,
      keywordTok.start,
      keywordTok.end,
      false
    )
  );

  while (
    !ctx.isAtSyncPoint() &&
    !isAtEnd(ctx) &&
    ctx.peekKind() !== TokenKind.COLON
  ) {
    ctx.consume(); // consume but don't add as named children — they're noise
  }
  // Consume colon if present
  if (ctx.peekKind() === TokenKind.COLON) ctx.consume();
  // Consume the body block
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume();
    const proc = parseProcedure(ctx);
    if (proc) {
      for (const child of proc.namedChildren) {
        children.push(child);
      }
    }
    // Consume trailing comments left by parseProcedure's isTrailingCommentOnly guard
    while (
      ctx.peekKind() === TokenKind.COMMENT ||
      ctx.peekKind() === TokenKind.NEWLINE
    ) {
      if (ctx.peekKind() === TokenKind.COMMENT) {
        children.push(ctx.consumeNamed('comment'));
      } else {
        ctx.consume();
      }
    }
    if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
  }
  if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();

  const endOffset =
    children.length > 0
      ? children[children.length - 1]!.endOffset
      : ctx.peekOffset();
  const endPos =
    children.length > 0
      ? children[children.length - 1]!.endPosition
      : ctx.peek().start;

  return makeErrorNode(
    ctx.source,
    children,
    startOffset,
    endOffset,
    startPos,
    endPos
  );
}

/**
 * Consume any leftover tokens in an indented block (before DEDENT) as ERROR
 * nodes. Prevents cascading failures when parseBlockValue() only partially
 * consumes the block content (e.g., unquoted multi-word text).
 */
export function recoverToBlockEnd(ctx: ParserContext, parent: CSTNode): void {
  while (!isAtEnd(ctx) && ctx.peekKind() !== TokenKind.DEDENT) {
    if (ctx.peekKind() === TokenKind.NEWLINE) {
      ctx.consume();
      continue;
    }
    // Skip over nested indented blocks within the error zone
    if (ctx.peekKind() === TokenKind.INDENT) {
      ctx.consume();
      recoverToBlockEnd(ctx, parent);
      if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
      continue;
    }
    const err = synchronize(ctx);
    if (err) {
      parent.appendChild(err);
    } else {
      break;
    }
  }
}

/**
 * Synchronize: skip tokens until a stopping condition is met.
 * Returns an ERROR node wrapping the skipped content, or null if
 * nothing was consumed.
 *
 * @param extraStop - optional predicate for additional stop conditions
 *   beyond the default sync points (NEWLINE/DEDENT/EOF)
 */
export function synchronizeUntil(
  ctx: ParserContext,
  extraStop?: (kind: TokenKind, row: number) => boolean
): CSTNode | null {
  if (ctx.isAtSyncPoint() || isAtEnd(ctx)) return null;
  if (extraStop && extraStop(ctx.peekKind(), ctx.peek().start.row)) return null;

  const startOffset = ctx.peekOffset();
  const startPos = ctx.peek().start;
  const children: CSTNode[] = [];

  while (
    !ctx.isAtSyncPoint() &&
    !isAtEnd(ctx) &&
    !(extraStop && extraStop(ctx.peekKind(), ctx.peek().start.row))
  ) {
    const tok = ctx.consume();
    children.push(tokenToAutoLeaf(tok, ctx.source, ctx.currentOffset()));
  }

  if (children.length === 0) return null;

  const last = children[children.length - 1]!;
  return makeErrorNode(
    ctx.source,
    children,
    startOffset,
    last.endOffset,
    startPos,
    last.endPosition
  );
}

/** Skip tokens on the given row until a sync point, INDENT, or COLON. */
export function synchronizeRowUntilColon(
  ctx: ParserContext,
  row: number
): CSTNode | null {
  return synchronizeUntil(
    ctx,
    (kind, r) =>
      kind === TokenKind.INDENT || kind === TokenKind.COLON || r !== row
  );
}

/** Skip tokens on the given row until a sync point or INDENT. */
export function synchronizeRow(
  ctx: ParserContext,
  row: number
): CSTNode | null {
  return synchronizeUntil(
    ctx,
    (kind, r) => kind === TokenKind.INDENT || r !== row
  );
}

/** Skip tokens until the next sync point (NEWLINE/DEDENT/EOF). */
export function synchronize(ctx: ParserContext): CSTNode | null {
  return synchronizeUntil(ctx);
}

// --- Utility ---

export function skipNewlines(ctx: ParserContext): void {
  while (ctx.peekKind() === TokenKind.NEWLINE) {
    ctx.consume();
  }
}

/** Consume comment and newline tokens and attach to parent node. */
export function consumeCommentsAndSkipNewlines(
  ctx: ParserContext,
  parent: CSTNode
): void {
  while (true) {
    if (ctx.peekKind() === TokenKind.COMMENT) {
      parent.appendChild(ctx.consumeNamed('comment'));
    } else if (ctx.peekKind() === TokenKind.NEWLINE) {
      ctx.consume();
    } else {
      break;
    }
  }
}

export function isAtEnd(ctx: ParserContext): boolean {
  return ctx.peekKind() === TokenKind.EOF;
}

/** Check if from current position, there are only comments, newlines, and then EOF/DEDENT. */
export function isTrailingCommentOnly(ctx: ParserContext): boolean {
  let i = 0;
  while (i < 50) {
    const tok = ctx.peekAt(i);
    if (tok.kind === TokenKind.EOF || tok.kind === TokenKind.DEDENT)
      return true;
    if (tok.kind === TokenKind.COMMENT || tok.kind === TokenKind.NEWLINE) {
      i++;
      continue;
    }
    return false;
  }
  return false; // Exceeded lookahead limit
}
