/**
 * Error recovery utilities for the parser.
 *
 * Core invariant: NEWLINE and DEDENT are unconditional synchronization points.
 * No error ever cascades past them.
 */

import { TokenKind, type Token } from './token.js';
import { CSTNode } from './cst-node.js';

/**
 * Create an ERROR node wrapping the given children.
 */
export function makeErrorNode(
  source: string,
  children: CSTNode[],
  startOffset: number,
  endOffset: number,
  startPosition: { row: number; column: number },
  endPosition: { row: number; column: number }
): CSTNode {
  const node = new CSTNode(
    'ERROR',
    source,
    startOffset,
    endOffset,
    startPosition,
    endPosition,
    true,
    true
  );
  for (const child of children) {
    node.appendChild(child);
  }
  return node;
}

/**
 * Create a MISSING node — a node that was expected but not present in the source.
 */
export function makeMissingNode(
  type: string,
  source: string,
  position: { row: number; column: number },
  offset: number
): CSTNode {
  return new CSTNode(
    type,
    source,
    offset,
    offset,
    position,
    position,
    true,
    false,
    true
  );
}

/**
 * Create a leaf node from a token.
 */
export function tokenToLeaf(
  token: Token,
  source: string,
  isNamed: boolean,
  offset: number
): CSTNode {
  return new CSTNode(
    tokenTypeToNodeType(token),
    source,
    offset,
    offset + token.text.length,
    token.start,
    token.end,
    isNamed
  );
}

/** Named token kinds — tokens that become named CST children. */
const NAMED_TOKEN_KINDS: ReadonlySet<TokenKind> = new Set([
  TokenKind.ID,
  TokenKind.NUMBER,
  TokenKind.STRING,
  TokenKind.DATETIME,
  TokenKind.COMMENT,
  TokenKind.ELLIPSIS,
]);

/** Create a leaf CST node from a token, auto-determining isNamed from its kind. */
export function tokenToAutoLeaf(
  token: Token,
  source: string,
  offset: number
): CSTNode {
  return tokenToLeaf(token, source, NAMED_TOKEN_KINDS.has(token.kind), offset);
}

function tokenTypeToNodeType(token: Token): string {
  switch (token.kind) {
    case TokenKind.ID:
      return 'id';
    case TokenKind.NUMBER:
      return 'number';
    case TokenKind.STRING:
      return 'string';
    case TokenKind.DATETIME:
      return 'datetime_literal';
    case TokenKind.COMMENT:
      return 'comment';
    case TokenKind.ELLIPSIS:
      return 'ellipsis';
    default:
      return token.text;
  }
}

/** Check if a token kind is a synchronization point. */
export function isSyncPoint(kind: TokenKind): boolean {
  return (
    kind === TokenKind.NEWLINE ||
    kind === TokenKind.DEDENT ||
    kind === TokenKind.EOF
  );
}
