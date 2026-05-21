/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * CommentAttacher encapsulates the comment attachment state machine
 * shared by parseMappingElements, parseStatementNodes, and RunStatement.parse.
 *
 * The pattern is always:
 * 1. Accumulate leading comments from standalone comment nodes.
 * 2. When a parsed value appears, attach pending leading comments to it.
 * 3. After the loop, convert any remaining pending comments to trailing
 *    on the last parsed value.
 */
import type {
  Comment,
  CommentAttachment,
  CommentTarget,
  Range,
  SyntaxNode,
} from './types.js';
import { isNamedMap, parseCommentNode } from './types.js';
import { ErrorBlock } from './children.js';
import type { Statement } from './statements.js';

/** A comment that has source-location range info (i.e. was parsed from source). */
type RangedComment = Comment & { range: Range };

function hasRange(c: Comment): c is RangedComment {
  return c.range !== undefined;
}

/** Type guard for values with a `statements` array (e.g., ProcedureValueNode). */
function hasProcedureStatements(
  value: unknown
): value is { statements: Statement[] } {
  return (
    value != null &&
    typeof value === 'object' &&
    'statements' in value &&
    Array.isArray((value as { statements: unknown }).statements)
  );
}

export class CommentAttacher {
  private _pending: Comment[] = [];
  private _lastTarget: CommentTarget | undefined;

  /** Accumulate a parsed comment as a pending leading comment. */
  pushLeading(comment: Comment): void {
    this._pending.push(comment);
  }

  /** Parse a CST comment node and accumulate it as pending leading. */
  pushLeadingNode(node: SyntaxNode): void {
    this._pending.push(parseCommentNode(node, 'leading'));
  }

  /**
   * Try to attach a comment node as inline on the last target
   * (same row as the target's CST end). Returns true if attached,
   * false if caller should handle it differently.
   */
  tryAttachInline(
    node: SyntaxNode,
    lastTarget: CommentTarget | undefined
  ): boolean {
    if (!lastTarget?.__cst) return false;
    const { __cst: cst } = lastTarget;
    if (node.startRow === cst.range.end.line) {
      attach(lastTarget, [parseCommentNode(node, 'inline')]);
      return true;
    }
    return false;
  }

  /**
   * Consume pending leading comments (plus optional extras) and attach
   * them to a target. Also updates the internal last-target for later flush.
   */
  consumeOnto(target: CommentTarget, extraComments?: Comment[]): void {
    const comments = extraComments
      ? [...this._pending, ...extraComments]
      : this._pending;
    if (comments.length > 0) {
      attach(target, comments);
    }
    this._pending = [];
    this._lastTarget = target;
  }

  /**
   * Consume pending comments (plus optional extras) onto the first item
   * in an array of targets. Updates the last-target to the last item.
   */
  consumeOntoFirst(targets: CommentTarget[], extraComments?: Comment[]): void {
    if (targets.length === 0) return;
    const comments = extraComments
      ? [...this._pending, ...extraComments]
      : this._pending;
    if (comments.length > 0) {
      attach(targets[0], comments);
    }
    this._pending = [];
    this._lastTarget = targets[targets.length - 1];
  }

  /** Check if there are pending comments. */
  get hasPending(): boolean {
    return this._pending.length > 0;
  }

  /** Discard all pending comments without attaching them anywhere. */
  clearPending(): void {
    this._pending = [];
  }

  /**
   * Drain pending comments as ErrorBlock children into the given array.
   * Each comment becomes an ErrorBlock with its `# text` content preserved.
   * Used by unknown-field handling to preserve comments that would otherwise
   * be lost when UntypedBlock emits from structure instead of raw text.
   */
  drainAsErrorBlocks(target: { push(block: ErrorBlock): void }): void {
    for (const comment of this._pending) {
      const prefix = comment.range ? '#' : '# ';
      const text = `${prefix}${comment.value}`;
      target.push(new ErrorBlock(text, 0));
    }
    this._pending = [];
  }

  /** Replace pending with new comments (e.g., dedented comments for next field).
   *  Callers must pass an owned array (not reused after this call). */
  setPending(comments: Comment[]): void {
    this._pending = comments;
  }

  /** Get the last target that received comments. */
  get lastTarget(): CommentTarget | undefined {
    return this._lastTarget;
  }

  /** Set the last target manually. */
  set lastTarget(target: CommentTarget | undefined) {
    this._lastTarget = target;
  }

  /**
   * Flush any remaining pending comments as trailing on the last target.
   * Call this at the end of a parse loop.
   */
  flush(): void {
    if (this._pending.length > 0 && this._lastTarget) {
      const asTrailing = this._pending.map(c => ({
        ...c,
        attachment: 'trailing' as CommentAttachment,
      }));
      attach(this._lastTarget, asTrailing);
      this._pending = [];
    }
  }
}

/** Append comments to a target node's __comments array. */
export function attach(
  node: CommentTarget | null | undefined,
  comments: Comment[]
): void {
  if (!node || comments.length === 0) return;
  node.__comments = [...(node.__comments ?? []), ...comments];
}

// ---------------------------------------------------------------------------
// Comment routing helpers — called from Dialect.parseMappingElements and
// parseSingularField to classify and place block-level comments relative to
// a parsed value's body.
// ---------------------------------------------------------------------------

/** Extract comments on the same line as an element (inline comments). */
export function parseInlineComments(element: SyntaxNode): Comment[] {
  return element.children
    .filter(c => c.type === 'comment' && c.startRow === element.startRow)
    .map(c => parseCommentNode(c, 'inline'));
}

/** Extract all comment children from an element. */
export function parseElementComments(element: SyntaxNode): Comment[] {
  return element.children
    .filter(c => c.type === 'comment')
    .map(c => parseCommentNode(c));
}

/**
 * Split comments into those before and after a value node's range.
 *
 * Comments without source range info (programmatic comments) are always
 * placed in `beforeBody`. The `afterBody` array is guaranteed to contain
 * only comments with range info, since only comments whose source line
 * falls after the value node can land there.
 */
export function splitContainerComments(
  comments: Comment[],
  valueNode: SyntaxNode | null
): { beforeBody: Comment[]; afterBody: RangedComment[] } {
  if (!valueNode) {
    return { beforeBody: comments, afterBody: [] };
  }

  const beforeBody: Comment[] = [];
  const afterBody: RangedComment[] = [];
  for (const c of comments) {
    const line = c.range?.start.line;
    if (line === undefined) {
      // No source location — treat as before-body (programmatic comment).
      beforeBody.push(c);
      continue;
    }
    if (line < valueNode.startRow) {
      beforeBody.push(c);
      continue;
    }
    if (line > valueNode.endRow) {
      const trailing = { ...c, attachment: 'trailing' as const };
      if (hasRange(trailing)) {
        afterBody.push(trailing);
      }
      continue;
    }
    // Comments inside the body range are treated as before-body container comments.
    beforeBody.push(c);
  }
  return { beforeBody, afterBody };
}

/** Attach comments to the first entry of a TypedMap-like value. */
export function attachToFirstTypedMapEntry(
  value: unknown,
  comments: Comment[]
): void {
  if (comments.length === 0) return;
  if (!isNamedMap(value)) return;

  const iterator = value.entries() as IterableIterator<[string, CommentTarget]>;
  const first = iterator.next();
  if (first.done) return;

  attach(first.value[1], comments);
}

/** Attach comments to the first statement in a procedure-like value. */
export function attachToFirstProcedureStatement(
  value: unknown,
  comments: Comment[]
): void {
  if (comments.length === 0) return;
  if (!hasProcedureStatements(value)) return;
  attach(value.statements[0], comments);
}

/** Attach comments as trailing to the last statement in a procedure-like value. */
export function attachToLastProcedureStatement(
  value: unknown,
  comments: Comment[]
): boolean {
  if (comments.length === 0) return false;
  if (!hasProcedureStatements(value)) return false;

  const lastStmt = value.statements[value.statements.length - 1];
  const tagged = comments.map(c => ({
    ...c,
    attachment: 'trailing' as CommentAttachment,
  }));
  attach(lastStmt, tagged);
  return true;
}
