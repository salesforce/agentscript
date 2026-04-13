/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * CST-walk syntax highlighter for AgentScript.
 *
 * Produces QueryCapture[] matching the tree-sitter highlights.scm rules.
 * Replaces tree-sitter's Query engine with a direct CST walk.
 */

import type { CSTNode } from './cst-node.js';

export interface HighlightCapture {
  name: string;
  text: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

/**
 * Walk the CST and produce highlight captures matching highlights.scm.
 *
 * Tree-sitter query priority: later patterns override earlier ones.
 * We replicate this by first assigning generic captures, then overriding
 * with contextual ones (e.g., id → variable, then key > id → property).
 */
export function highlight(root: CSTNode): HighlightCapture[] {
  const captures: HighlightCapture[] = [];
  walkNode(root, captures);
  return captures;
}

function capture(
  node: CSTNode,
  name: string,
  captures: HighlightCapture[]
): void {
  captures.push({
    name,
    text: node.text,
    startRow: node.startRow,
    startCol: node.startCol,
    endRow: node.endRow,
    endCol: node.endCol,
  });
}

function walkNode(node: CSTNode, captures: HighlightCapture[]): void {
  // --- Named node type-based captures ---
  switch (node.type) {
    case 'comment':
      capture(node, 'comment', captures);
      return; // Don't recurse into comments

    case 'number':
      capture(node, 'number', captures);
      return;

    case 'string':
      capture(node, 'string', captures);
      // Recurse to get escape_sequence captures
      for (const child of node.children) {
        if (child.type === 'escape_sequence') {
          capture(child, 'string.escape', captures);
        }
      }
      return;

    case 'string_content':
      capture(node, 'string', captures);
      return;

    case 'escape_sequence':
      capture(node, 'string.escape', captures);
      return;

    case 'template_content':
      capture(node, 'string', captures);
      return;

    case 'ellipsis':
      capture(node, 'constant.builtin', captures);
      return;

    case 'id':
      captureId(node, captures);
      return;

    case 'at_id':
      captureAtId(node, captures);
      return;

    case 'template_expression':
      captureTemplateExpression(node, captures);
      return;

    case 'variable_declaration':
      captureVariableDeclaration(node, captures);
      return;
  }

  // --- Anonymous node captures (punctuation, keywords, operators) ---
  if (!node.isNamed && node.children.length === 0) {
    captureAnonymous(node, captures);
    return;
  }

  // Recurse into children
  for (const child of node.children) {
    walkNode(child, captures);
  }
}

/** Check if a key node belongs to a root-level mapping element (source_file > mapping > mapping_element > key). */
function isRootLevelKey(keyNode: CSTNode): boolean {
  const mappingElement = keyNode.parent;
  if (mappingElement?.type !== 'mapping_element') return false;
  const mapping = mappingElement.parent;
  if (mapping?.type !== 'mapping') return false;
  return mapping.parent?.type === 'source_file';
}

/** Capture an identifier based on its parent context. */
function captureId(node: CSTNode, captures: HighlightCapture[]): void {
  const parent = node.parent;

  // Constants: True, False, None
  if (node.text === 'True' || node.text === 'False' || node.text === 'None') {
    capture(node, 'constant.builtin', captures);
    return;
  }

  // Inside at_id: @identifier → module (namespace)
  if (parent?.type === 'at_id') {
    capture(node, 'module', captures);
    return;
  }

  // Mapping key: (key (id)) → property, or block keyword/name at root level
  if (parent?.type === 'key') {
    if (isRootLevelKey(parent)) {
      const namedSiblings = parent.namedChildren;
      if (namedSiblings.length > 0 && namedSiblings[0] === node) {
        capture(node, 'keyword.block', captures);
      } else {
        capture(node, 'keyword.block.name', captures);
      }
    } else {
      capture(node, 'key', captures);
    }
    return;
  }

  // Member expression: expr.id → variable (the property after dot)
  if (parent?.type === 'member_expression') {
    // Only the trailing id (not the expression part)
    const parentChildren = parent.namedChildren;
    if (
      parentChildren.length > 0 &&
      parentChildren[parentChildren.length - 1] === node
    ) {
      capture(node, 'variable', captures);
      return;
    }
  }

  // With-statement param: with param=value → variable
  if (parent?.type === 'with_statement') {
    const fieldName = parent.fieldNameForChild(node._childIndex);
    if (fieldName === 'param') {
      capture(node, 'variable', captures);
      return;
    }
  }

  // Default: variable
  capture(node, 'variable', captures);
}

/** Capture @identifier — the @ and the id inside. */
function captureAtId(node: CSTNode, captures: HighlightCapture[]): void {
  for (const child of node.children) {
    if (child.type === '@' || child.text === '@') {
      capture(child, 'decorator', captures);
    } else if (child.type === 'id') {
      capture(child, 'module', captures);
    }
  }
}

/** Capture template expression delimiters {! and }. */
function captureTemplateExpression(
  node: CSTNode,
  captures: HighlightCapture[]
): void {
  for (const child of node.children) {
    if (child.text === '{!') {
      capture(child, 'punctuation.template', captures);
    } else if (child.text === '}') {
      capture(child, 'punctuation.template', captures);
    } else {
      walkNode(child, captures);
    }
  }
}

/** Capture variable declaration modifiers (mutable/linked). */
function captureVariableDeclaration(
  node: CSTNode,
  captures: HighlightCapture[]
): void {
  for (const child of node.children) {
    if (
      !child.isNamed &&
      (child.text === 'mutable' || child.text === 'linked')
    ) {
      capture(child, 'keyword.modifier', captures);
    } else {
      walkNode(child, captures);
    }
  }
}

/** Capture anonymous nodes: keywords, operators, punctuation. */
function captureAnonymous(node: CSTNode, captures: HighlightCapture[]): void {
  const text = node.text;

  // Keywords
  switch (text) {
    case 'if':
    case 'elif':
    case 'else':
    case 'run':
    case 'with':
    case 'set':
    case 'transition':
    case 'available':
    case 'when':
    case 'and':
    case 'or':
    case 'not':
    case 'is':
    case 'to':
      capture(node, 'keyword', captures);
      return;

    case 'mutable':
    case 'linked':
      capture(node, 'keyword.modifier', captures);
      return;

    case 'True':
    case 'False':
    case 'None':
      capture(node, 'constant.builtin', captures);
      return;
  }

  // Operators
  switch (text) {
    case '==':
    case '!=':
    case '<':
    case '>':
    case '<=':
    case '>=':
    case '+':
    case '*':
    case '/':
    case '=':
      capture(node, 'operator', captures);
      return;
    case '-':
      // '-' in sequence dash is punctuation.special, otherwise operator
      if (node.parent?.type === 'sequence_element') {
        capture(node, 'punctuation.special', captures);
      } else {
        capture(node, 'operator', captures);
      }
      return;
  }

  // Punctuation
  switch (text) {
    case ':':
    case '.':
    case ',':
      capture(node, 'punctuation.delimiter', captures);
      return;

    case '[':
    case ']':
    case '{':
    case '}':
      capture(node, 'punctuation.bracket', captures);
      return;

    case '|':
    case '->':
    case '- ':
      capture(node, 'punctuation.special', captures);
      return;

    case '@':
      capture(node, 'decorator', captures);
      return;

    case '"':
      capture(node, 'string', captures);
      return;
  }
}
