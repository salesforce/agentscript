/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Sequence parsing functions extracted from Parser class.
 *
 * Each function takes a ParserContext as its first parameter, following
 * the same free-function pattern as parse-mapping.ts and parse-templates.ts.
 */

import { TokenKind } from './token.js';
import { CSTNode } from './cst-node.js';
import { makeErrorNode } from './errors.js';
import { synchronize, skipNewlines, isAtEnd } from './recovery.js';
import {
  parseMapping,
  parseMappingItem,
  tryParseColinearValue,
  isColinearMappingElement,
  parseColinearMappingElement,
} from './parse-mapping.js';
import type { ParserContext } from './parser.js';

/**
 * Parse a YAML-style sequence (list of `- item` entries).
 *
 * Exported for use by parser.ts dispatch and by parse-mapping.ts
 * via ParseSequenceFn callback.
 */
export function parseSequence(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('sequence');

  while (ctx.peekKind() === TokenKind.DASH_SPACE) {
    const elem = parseSequenceElement(ctx);
    if (elem) node.appendChild(elem);
    skipNewlines(ctx);
  }

  // Non-sequence items remaining at same indent → wrap in ERROR inside sequence
  while (
    !isAtEnd(ctx) &&
    ctx.peekKind() !== TokenKind.DEDENT &&
    ctx.peekKind() !== TokenKind.DASH_SPACE
  ) {
    skipNewlines(ctx);
    if (isAtEnd(ctx) || ctx.peekKind() === TokenKind.DEDENT) break;
    // Try to parse as mapping item and wrap in ERROR
    const parseSeq = (_ctx: ParserContext) => parseSequence(_ctx);
    const item = parseMappingItem(ctx, parseSeq);
    if (item) {
      const errNode = makeErrorNode(
        ctx.source,
        [item],
        item.startOffset,
        item.endOffset,
        item.startPosition,
        item.endPosition
      );
      node.appendChild(errNode);
    } else {
      const err = synchronize(ctx);
      if (err) {
        node.appendChild(err);
      } else {
        ctx.consume();
      }
    }
  }

  ctx.finishNode(node, startTok);
  return node;
}

/**
 * Parse a single sequence element: `- <value>`.
 */
function parseSequenceElement(ctx: ParserContext): CSTNode {
  const startTok = ctx.peek();
  const node = ctx.startNode('sequence_element');

  // Consume "- " or "-"
  ctx.addAnonymousChild(node, ctx.consume());

  const parseSeq = (_ctx: ParserContext) => parseSequence(_ctx);

  // Check for colinear mapping element (key: value on same line)
  if (isColinearMappingElement(ctx)) {
    const mappingElem = parseColinearMappingElement(ctx);
    if (mappingElem) node.appendChild(mappingElem, 'colinear_mapping_element');

    // Optional block value (indented mapping below)
    if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
    if (ctx.peekKind() === TokenKind.INDENT) {
      ctx.consume();
      const blockValue = parseMapping(ctx, parseSeq);
      if (blockValue) node.appendChild(blockValue, 'block_value');
      if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
    }
  } else if (
    ctx.peekKind() === TokenKind.NEWLINE ||
    ctx.peekKind() === TokenKind.EOF ||
    ctx.peekKind() === TokenKind.INDENT
  ) {
    // Bare dash with optional block value below (or immediately indented)
    if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
    if (ctx.peekKind() === TokenKind.INDENT) {
      ctx.consume();
      const blockValue = parseMapping(ctx, parseSeq);
      if (blockValue) node.appendChild(blockValue, 'block_value');
      if (ctx.peekKind() === TokenKind.DEDENT) ctx.consume();
    }
  } else {
    // Colinear value
    const colinear = tryParseColinearValue(ctx);
    if (colinear) {
      if (colinear.errorPrefix) node.appendChild(colinear.errorPrefix);
      node.appendChild(colinear.value, 'colinear_value');
    }
    // Inline comment after value
    if (ctx.peekKind() === TokenKind.COMMENT) {
      node.appendChild(ctx.consumeNamed('comment'));
    }
    if (ctx.peekKind() === TokenKind.NEWLINE) ctx.consume();
  }

  ctx.finishNode(node, startTok);
  return node;
}
