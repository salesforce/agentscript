/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Error-recovery helpers for TypedMap parsing.
 *
 * Extracted from block.ts to keep that module focused on block/factory
 * definitions. All four functions deal with parser ERROR node handling
 * and same-row split detection during TypedMap entry parsing.
 */
import type { SyntaxNode, FieldType } from './types.js';
import {
  withCst,
  getKeyText,
  isKeyNode,
  isSingularFieldType,
} from './types.js';
import type { Expression } from './expressions.js';
import { Identifier } from './expressions.js';
import type { Dialect } from './dialect.js';
import { ErrorBlock, FieldChild, defineFieldAccessors } from './children.js';
import type { BlockChild } from './children.js';
import { ExpressionValue } from './primitives.js';
import type { DiagnosticCollector } from './diagnostics.js';
import type { BlockCore } from './named-map.js';

// Local interface matching TypedDeclarationBase shape from block.ts.
// Using a local interface because TypedDeclarationBase is not exported.
interface TypedDeclarationLike {
  type: Expression;
  defaultValue?: Expression;
  properties?: BlockCore;
  __children: BlockChild[];
}

/**
 * Detect a same-row split in TypedMap parsing.
 *
 * Tree-sitter may split "linkedd string" into two mapping_elements when the
 * first word isn't a valid modifier keyword. The next element's key starts on
 * the same row as our colinear value, meaning it was part of this element's
 * original line.
 *
 * @returns The split info if detected, or `undefined`.
 */
export function detectSameRowSplit(
  elements: SyntaxNode[],
  currentIndex: number,
  colinearNode: SyntaxNode,
  rawDeclType: Expression
):
  | {
      errorPrefix: string;
      declType: Expression;
      mergedElement: SyntaxNode;
      mergedKeyRemainder: string | undefined;
    }
  | undefined {
  if (currentIndex + 1 >= elements.length) return undefined;

  const nextEl = elements[currentIndex + 1];
  const nextKeyNode = nextEl.childForFieldName('key');
  const nextKeyChildren = nextKeyNode?.namedChildren.filter(isKeyNode) ?? [];

  if (
    nextKeyChildren.length < 1 ||
    nextKeyChildren[0].startRow !== colinearNode.startRow
  ) {
    return undefined;
  }

  // Split detected. Current colinear is the invalid modifier,
  // next element's first key id is the actual type.
  const errorPrefix =
    rawDeclType instanceof Identifier ? rawDeclType.name : colinearNode.text;
  const declType = withCst(
    new Identifier(getKeyText(nextKeyChildren[0])),
    nextKeyChildren[0]
  );

  return {
    errorPrefix,
    declType,
    mergedElement: nextEl,
    mergedKeyRemainder:
      nextKeyChildren.length >= 2 ? getKeyText(nextKeyChildren[1]) : undefined,
  };
}

/**
 * Capture ERROR nodes that precede the colinear_value in a mapping_element.
 * Returns the error text and the first ERROR node (for diagnostic range),
 * or `undefined` if none found.
 */
export function captureErrorPrefix(
  element: SyntaxNode,
  colinearNode: SyntaxNode
): { text: string; errorNode: SyntaxNode } | undefined {
  const errorParts: string[] = [];
  let firstErrorNode: SyntaxNode | undefined;
  const colinearRow = colinearNode.startRow;
  const colinearCol = colinearNode.startCol;
  for (const child of element.namedChildren) {
    if (
      child.type === 'ERROR' &&
      (child.startRow < colinearRow ||
        (child.startRow === colinearRow && child.startCol < colinearCol))
    ) {
      errorParts.push(child.text);
      if (!firstErrorNode) {
        firstErrorNode = child;
      }
    }
  }
  return errorParts.length > 0
    ? { text: errorParts.join(' '), errorNode: firstErrorNode! }
    : undefined;
}

/**
 * Detect an ERROR node immediately after the colinear_value on the same row.
 *
 * parser-javascript keeps "linkedd string" inside a single mapping_element: the
 * colinear_value holds "linkedd" and an ERROR node wraps "string". This is
 * the parser-javascript equivalent of the tree-sitter same-row split detected by
 * `detectSameRowSplit`.
 *
 * When found, the colinear value text becomes the error prefix (e.g. the
 * invalid modifier "linkedd") and the ERROR node text becomes the real type.
 */
export function detectInlineErrorSuffix(
  element: SyntaxNode,
  colinearNode: SyntaxNode,
  rawDeclType: Expression
):
  | {
      errorPrefix: string;
      declType: Expression;
      errorNode: SyntaxNode;
    }
  | undefined {
  const colinearRow = colinearNode.startRow;
  const colinearCol = colinearNode.startCol;
  for (const child of element.namedChildren) {
    if (
      child.type === 'ERROR' &&
      child.startRow === colinearRow &&
      child.startCol > colinearCol
    ) {
      // The ERROR node text is the actual type (e.g. "string")
      const firstId = child.namedChildren.find(c => c.type === 'id');
      const typeText = firstId ? firstId.text : child.text?.trim();
      if (!typeText) continue;

      const errorPrefix =
        rawDeclType instanceof Identifier
          ? rawDeclType.name
          : colinearNode.text;
      const typeNode = firstId ?? child;
      const declType = withCst(new Identifier(typeText), typeNode);

      return { errorPrefix, declType, errorNode: child };
    }
  }
  return undefined;
}

/**
 * Create an ErrorBlock from an ERROR syntax node, if it has non-empty text.
 * Shared by CollectionBlock.parse and parseMappingElements for preserving
 * broken content that parser wrapped in an ERROR node.
 */
export function errorBlockFromNode(node: SyntaxNode): ErrorBlock | undefined {
  const text = node.text?.trim();
  if (!text) return undefined;
  return new ErrorBlock(node.text, node.startCol);
}

/**
 * Merge properties from a split element into a parsed declaration.
 * Handles the block_value from the merged element and any remaining
 * key+colinear property (e.g., "source: @Ref").
 */
export function mergeProperties(
  parsed: TypedDeclarationLike,
  element: SyntaxNode,
  mergedElement: SyntaxNode,
  mergedKeyRemainder: string | undefined,
  propertiesBlock: FieldType,
  dialect: Dialect,
  dc: DiagnosticCollector
): void {
  let blockNode = element.childForFieldName('block_value');
  if (!blockNode) {
    blockNode = element.namedChildren.find(c => c.type === 'mapping') ?? null;
  }

  const mergedBlock =
    mergedElement.childForFieldName('block_value') ??
    mergedElement.namedChildren.find(c => c.type === 'mapping') ??
    null;
  // Prefer the merged element's block since the current element
  // typically has none when a same-row split occurred
  const propBlockNode = blockNode ?? mergedBlock;

  if (propBlockNode) {
    if (!isSingularFieldType(propertiesBlock)) return;
    const propResult = propertiesBlock.parse(propBlockNode, dialect);
    if (propResult.value && typeof propResult.value === 'object') {
      parsed.properties = propResult.value;
      parsed.__children.push(
        new FieldChild('properties', propResult.value, propertiesBlock)
      );
    }
    dc.merge(propResult);
  }

  // The merged element's remaining key + colinear is a property
  // (e.g. "source: @MessagingSession.MessagingEndUserId")
  if (mergedKeyRemainder && parsed.properties) {
    const mergedColinear =
      mergedElement.childForFieldName('colinear_value') ??
      mergedElement.childForFieldName('expression');
    if (mergedColinear) {
      const exprNode =
        mergedColinear.childForFieldName('expression') ?? mergedColinear;
      const propValue = dialect.parseExpression(exprNode);
      const props = parsed.properties;

      // Add to __children and define accessor via existing helper
      const propSchema = propertiesBlock.schema;
      const rawFieldType = propSchema
        ? propSchema[mergedKeyRemainder]
        : undefined;
      const fieldType: FieldType =
        (Array.isArray(rawFieldType) ? rawFieldType[0] : rawFieldType) ??
        ExpressionValue;
      const children = props.__children;
      if (children) {
        const fc = new FieldChild(mergedKeyRemainder, propValue, fieldType);
        children.unshift(fc);
        defineFieldAccessors(props, [fc]);
      }
    }
  }
}
