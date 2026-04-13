/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range, CstMeta, SyntaxNode, AstNodeLike } from '../types.js';
import { isAstNodeLike } from '../types.js';
import { StringLiteral } from '../expressions.js';

/** Check if a 0-based line/character position falls within a Range (start inclusive, end exclusive). */
export function isPositionInRange(
  line: number,
  character: number,
  range: Range
): boolean {
  if (line < range.start.line || line > range.end.line) return false;
  if (line === range.start.line && character < range.start.character)
    return false;
  if (line === range.end.line && character >= range.end.character) return false;
  return true;
}

/**
 * Compute a numeric size proxy for a Range (for smallest-range heuristic).
 * Uses a line multiplier so any multi-line range is larger than any single-line range.
 */
const MAX_LINE_LENGTH = 1_000_000;
export function rangeSize(range: Range): number {
  const lines = range.end.line - range.start.line;
  if (lines === 0) return range.end.character - range.start.character;
  return (
    lines * MAX_LINE_LENGTH + (range.end.character - range.start.character)
  );
}

/**
 * Extract a human-readable detail string from an AST node.
 * Used by DocumentSymbol extraction and completion candidates.
 */
export function computeDetail(
  obj: AstNodeLike,
  kind: string | undefined,
  cst: CstMeta
): string | undefined {
  if (kind === 'VariableDeclaration' || kind === 'ParameterDeclaration') {
    const parts: string[] = [];
    const modifier = obj.modifier;
    if (isAstNodeLike(modifier) && modifier.__cst) {
      const text = modifier.__cst.node.text?.trim();
      if (text) parts.push(text);
    }
    const typeVal = obj.type;
    if (isAstNodeLike(typeVal) && typeVal.__cst) {
      const text = typeVal.__cst.node.text?.trim();
      if (text) parts.push(text);
    }
    const defaultValue = obj.defaultValue;
    if (isAstNodeLike(defaultValue) && defaultValue.__cst) {
      const text = defaultValue.__cst.node.text?.trim();
      if (text) parts.push('= ' + text);
    }
    return parts.length > 0 ? parts.join(' ') : undefined;
  }

  if (kind === 'StringLiteral') {
    const value = obj.value;
    if (typeof value === 'string') {
      return value.length > 60 ? value.slice(0, 60) + '...' : value;
    }
    return undefined;
  }
  if (kind === 'TemplateExpression') {
    return getValueText(cst);
  }
  if (kind === 'BooleanValue') {
    const value = obj.value;
    return value === true ? 'True' : value === false ? 'False' : undefined;
  }
  if (kind === 'NumberValue') {
    const value = obj.value;
    return value != null ? String(value) : undefined;
  }
  if (kind === 'ProcedureValue') {
    return '->';
  }

  const label = obj.label;
  if (label instanceof StringLiteral) {
    return label.value;
  }

  return undefined;
}

/**
 * Extract the value text from a CST mapping_element.
 * For TypedMap entries (__cst.node IS the mapping_element), gets the value child text.
 * For Block/NamedBlock (__cst.node is the value node), uses the node text directly.
 */
function getValueText(cst: CstMeta): string | undefined {
  const node = cst.node;

  if (node.type === 'mapping_element') {
    const valueNode = node.childForFieldName('value');
    return valueNode?.text?.trim();
  }

  const text = node.text?.trim();
  if (text && text.length > 80) return text.slice(0, 80) + '...';
  return text || undefined;
}

/**
 * Walk up the CST from a node to find the enclosing mapping_element.
 * Block field values are nested inside atom > mapping_element,
 * so walking up is needed to get proper key ranges.
 */
export function findMappingElement(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node;
  while (current) {
    if (current.type === 'mapping_element') return current;
    current = current.parent;
  }
  return null;
}
