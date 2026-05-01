/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Template-parsing functions extracted from Parser class.
 *
 * Each function takes a ParserContext as its first parameter, following
 * the same free-function pattern as parse-statements.ts and expressions.ts.
 *
 * Template indentation state (templateOuterIndent) is computed locally in
 * parseTemplate and passed as an explicit parameter to templateContinues.
 */

import { TokenKind } from './token.js';
import { CSTNode } from './cst-node.js';
import {
  makeEmptyError,
  makeMissing,
  synchronize,
  isAtEnd,
} from './recovery.js';
import { parseExpression, wrapExpression } from './expressions.js';
import type { ParserContext } from './parser.js';

// ---------------------------------------------------------------------------
// Exported template parsers
// ---------------------------------------------------------------------------

/**
 * Parse a template starting with `|`.
 * Consumes tokens from the lexer stream, treating everything as template content
 * except `{!...}` breaks which are parsed as template expressions.
 */
export function parseTemplate(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('template');

  // Compute the indent level of the line containing `|`.
  // Tree-sitter uses *array_back(&scanner->indents) — the top of the indent
  // stack, which equals the line indent. We scan backward in the source to
  // measure the leading whitespace on this line.
  const pipeOffset = ctx.peekOffset();
  let lineStart = pipeOffset;
  while (
    lineStart > 0 &&
    ctx.source.charCodeAt(lineStart - 1) !== 10 /* \n */
  ) {
    lineStart--;
  }
  let templateOuterIndent = 0;
  for (let i = lineStart; i < pipeOffset; i++) {
    const ch = ctx.source.charCodeAt(i);
    if (ch === 32 /* space */) templateOuterIndent += 1;
    else if (ch === 9 /* tab */) templateOuterIndent += 3;
    else break;
  }

  // Consume the | token and track position right after it
  const pipeToken = ctx.consume();
  ctx.addAnonymousChild(node, pipeToken);

  // If there are tokens on the same line after |, pass afterPipeOffset
  // so whitespace between | and {! is captured as template_content.
  // If the line is empty after |, don't pass it (avoids phantom content).
  const hasContentOnSameLine =
    !isAtEnd(ctx) &&
    ctx.peekKind() !== TokenKind.NEWLINE &&
    ctx.peekKind() !== TokenKind.INDENT &&
    ctx.peekKind() !== TokenKind.DEDENT;

  if (hasContentOnSameLine) {
    const afterPipeOffset = pipeToken.startOffset + 1;
    gatherTemplateContentLine(ctx, node, afterPipeOffset);
  }

  // Consume NEWLINE if present
  if (ctx.peekKind() === TokenKind.NEWLINE) {
    ctx.consume();
  }

  // If there's an INDENT, the template continues on indented lines.
  // Templates consume ALL indented content until we fully return to the
  // base indent. We track indent depth: each INDENT increments, each
  // DEDENT decrements. When depth reaches 0, a final DEDENT exits.
  // Mid-template DEDENTs (under-indented continuation lines) are consumed
  // as content.
  if (ctx.peekKind() === TokenKind.INDENT) {
    ctx.consume(); // outer INDENT
    let indentDepth = 1;
    while (!isAtEnd(ctx)) {
      const tok = ctx.peek();
      if (tok.kind === TokenKind.DEDENT) {
        indentDepth--;
        ctx.consume();
        if (indentDepth <= 0) {
          // Check if template continues with under-indented content.
          // If the next meaningful token is content (not EOF/DEDENT),
          // the template has under-indented continuation lines.
          if (templateContinues(ctx, templateOuterIndent)) {
            // Re-enter: consume content at the new (lower) indent
            indentDepth = 0; // will re-increment on next INDENT
            continue;
          }
          break;
        }
      } else if (tok.kind === TokenKind.INDENT) {
        indentDepth++;
        ctx.consume();
      } else if (tok.kind === TokenKind.NEWLINE) {
        ctx.consume();
      } else {
        // When at the template's base indent depth, check if the next
        // token should continue the template (e.g. comments at the base
        // level should not be absorbed as template content).
        if (indentDepth <= 0 && !templateContinues(ctx, templateOuterIndent)) {
          break;
        }
        // For continuation lines, start the content from the end of the
        // last template child so that newlines + indentation between a
        // template_expression and the next template_content are preserved
        // in the source text.  (mergeTemplateContent handles this for
        // consecutive template_content nodes, but not across expressions.)
        const lastChild =
          node.children.length > 0
            ? node.children[node.children.length - 1]!
            : null;
        const gapOffset =
          lastChild && lastChild.endOffset < ctx.peekOffset()
            ? lastChild.endOffset
            : undefined;
        const gapPos =
          gapOffset !== undefined ? lastChild!.endPosition : undefined;
        gatherTemplateContentLine(ctx, node, gapOffset, gapPos);
      }
    }
  }

  // Merge consecutive template_content children into single nodes.
  // Tree-sitter produces one template_content per contiguous text span;
  // our line-by-line parsing creates one per line.
  mergeTemplateContent(ctx, node);

  ctx.finishNode(node, startTok);
  return node;
}

/**
 * Parse a template in colinear position (after a colon on the same line).
 * Currently identical to parseTemplate; kept as a separate entry point
 * for semantic clarity and potential future divergence.
 */
export function parseTemplateAsColinear(ctx: ParserContext): CSTNode {
  return parseTemplate(ctx);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Check if the template continues with under-indented content.
 * After a DEDENT brings us to depth 0, if the next meaningful token
 * is content (not EOF, not DEDENT, not a mapping key pattern), the
 * template has continuation lines.
 */
function templateContinues(
  ctx: ParserContext,
  templateOuterIndent: number
): boolean {
  let i = 0;
  while (ctx.peekAt(i).kind === TokenKind.NEWLINE) i++;
  const tok = ctx.peekAt(i);
  // If we see content (ID, etc.) that's NOT a mapping key pattern, continue
  if (tok.kind === TokenKind.EOF || tok.kind === TokenKind.DEDENT) return false;
  // Content deeper than the template's base indent is always template content,
  // regardless of keywords. Matches tree-sitter scanner behavior where
  // indent_length > out_of_template_indent_length keeps content in the template.
  if (tok.start.column > templateOuterIndent) return true;
  // Another pipe starts a new template — don't absorb it
  if (tok.kind === TokenKind.PIPE) return false;
  // If it looks like a mapping key (ID followed by COLON), template is done
  if (tok.kind === TokenKind.ID || tok.kind === TokenKind.STRING) {
    const after = ctx.peekAt(i + 1);
    if (after.kind === TokenKind.COLON) return false;
    // Two-word key check
    if (after.kind === TokenKind.ID) {
      const afterAfter = ctx.peekAt(i + 2);
      if (afterAfter.kind === TokenKind.COLON) return false;
    }
  }
  // Statement keywords terminate template continuation — they're
  // sibling statements, not template content
  if (tok.kind === TokenKind.ID) {
    switch (tok.text) {
      case 'if':
      case 'elif':
      case 'else':
      case 'run':
      case 'set':
      case 'transition':
        return false;
      case 'with':
        // "with" not followed by colon is a statement
        if (ctx.peekAt(i + 1).kind !== TokenKind.COLON) return false;
        break;
      case 'available':
        if (
          ctx.peekAt(i + 1).kind === TokenKind.ID &&
          ctx.peekAt(i + 1).text === 'when'
        )
          return false;
        break;
    }
  }
  // If it looks like a dash (sequence), template is done
  if (tok.kind === TokenKind.DASH_SPACE) return false;
  // Comments at the template's base indent level are not template content
  if (tok.kind === TokenKind.COMMENT) return false;
  // Otherwise, assume it's template continuation
  return true;
}

/** Merge consecutive template_content children into single nodes. */
function mergeTemplateContent(ctx: ParserContext, template: CSTNode): void {
  const merged: CSTNode[] = [];
  let i = 0;
  while (i < template.children.length) {
    const child = template.children[i]!;
    if (child.type === 'template_content') {
      // Find the run of consecutive template_content nodes
      let end = i + 1;
      while (
        end < template.children.length &&
        template.children[end]!.type === 'template_content'
      ) {
        end++;
      }
      if (end > i + 1) {
        // Merge into one node
        const first = template.children[i]!;
        const last = template.children[end - 1]!;
        const mergedNode = new CSTNode(
          'template_content',
          ctx.source,
          first.startOffset,
          last.endOffset,
          first.startPosition,
          last.endPosition
        );
        mergedNode.parent = template;
        merged.push(mergedNode);
        i = end;
      } else {
        merged.push(child);
        i++;
      }
    } else {
      merged.push(child);
      i++;
    }
  }
  template.children = merged;
}

/**
 * Gather a line's worth of template body: zero or more TEMPLATE_CONTENT
 * tokens interleaved with `{!…}` template expressions.
 *
 * The lexer emits template text atomically as TEMPLATE_CONTENT (mirroring
 * tree-sitter's scanner.c), so this function just consumes those tokens and
 * forwards to parseTemplateExpression for the embedded code.
 *
 * `initialOffset`/`initialPos` carry a synthetic start point — used to
 * capture whitespace between the preceding structural token (`|`, `}`, or
 * the previous line's newline) and the first TEMPLATE_CONTENT token so that
 * the final merged template_content span is byte-exact with tree-sitter.
 */
function gatherTemplateContentLine(
  ctx: ParserContext,
  parent: CSTNode,
  initialOffset?: number,
  initialPos?: { row: number; column: number }
): void {
  while (!isAtEnd(ctx)) {
    const tok = ctx.peek();
    if (
      tok.kind === TokenKind.NEWLINE ||
      tok.kind === TokenKind.DEDENT ||
      tok.kind === TokenKind.INDENT ||
      tok.kind === TokenKind.EOF
    ) {
      break;
    }

    if (tok.kind === TokenKind.TEMPLATE_EXPR_START) {
      // If a synthetic start is pending (e.g. whitespace between `|` and
      // `{!` on the same line), emit it as template_content first.
      if (initialOffset !== undefined && initialOffset < tok.startOffset) {
        parent.appendChild(
          new CSTNode(
            'template_content',
            ctx.source,
            initialOffset,
            tok.startOffset,
            initialPos!,
            tok.start
          )
        );
      }
      initialOffset = undefined;
      initialPos = undefined;

      const exprNode = parseTemplateExpression(ctx);
      parent.appendChild(exprNode);
      continue;
    }

    if (tok.kind === TokenKind.TEMPLATE_CONTENT) {
      // If a synthetic start predates this token (captures the leading
      // whitespace / newline-indent before the first char of template
      // content on this line), extend the node to cover it.
      const startOffset =
        initialOffset !== undefined && initialOffset < tok.startOffset
          ? initialOffset
          : tok.startOffset;
      const startPos =
        initialPos !== undefined &&
        initialOffset !== undefined &&
        initialOffset < tok.startOffset
          ? initialPos
          : tok.start;
      parent.appendChild(
        new CSTNode(
          'template_content',
          ctx.source,
          startOffset,
          tok.startOffset + tok.text.length,
          startPos,
          tok.end
        )
      );
      initialOffset = undefined;
      initialPos = undefined;
      ctx.consume();
      continue;
    }

    // Unexpected token — shouldn't happen given the lexer invariants, but
    // skip to avoid infinite looping.
    ctx.consume();
  }
}

function parseTemplateExpression(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('template_expression');

  ctx.addAnonymousChild(node, ctx.consume()); // {!

  const expr = parseExpression(ctx, 0);
  if (expr) {
    node.appendChild(wrapExpression(ctx, expr), 'expression');
  } else {
    // Empty template expression {!} → ERROR for missing expression
    node.appendChild(makeEmptyError(ctx));
  }

  // Consume any extra tokens before } (e.g., unclosed {!@var.name world)
  if (ctx.peekKind() !== TokenKind.RBRACE && !ctx.isAtSyncPoint()) {
    const err = synchronize(ctx);
    if (err) node.appendChild(err);
  }

  if (ctx.peekKind() === TokenKind.RBRACE) {
    ctx.addAnonymousChild(node, ctx.consume()); // }
  } else {
    // Unclosed template expression → MISSING }
    node.appendChild(makeMissing(ctx, '}'));
  }

  ctx.finishNode(node, startTok);
  return node;
}
