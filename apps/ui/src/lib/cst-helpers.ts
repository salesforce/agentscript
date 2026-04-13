/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Helper utilities for extracting data from CST nodes
 */

import type { Location, Comment, TypeInfo } from '~/lib/ast-schemas';

/**
 * CST Node structure (simplified interface)
 */
export interface CSTNode {
  type: string;
  text?: string;
  fieldName?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: CSTNode[];
  isNamed?: boolean;
  hasError?: boolean;
  isMissing?: boolean;
}

/**
 * Extract position/location from a CST node
 */
export function extractLocation(node: CSTNode): Location {
  return node.range;
}

/**
 * Find all comment nodes that are associated with the given node
 * Comments are considered associated if they appear immediately before the node
 */
export function findAssociatedComments(
  node: CSTNode,
  parentChildren?: CSTNode[]
): Comment[] {
  if (!parentChildren) {
    return [];
  }

  const comments: Comment[] = [];
  const nodeIndex = parentChildren.indexOf(node);

  if (nodeIndex === -1) {
    return comments;
  }

  // Look backwards from the current node for comments
  for (let i = nodeIndex - 1; i >= 0; i--) {
    const sibling = parentChildren[i];
    if (!sibling) continue;

    if (sibling.type === 'comment') {
      comments.unshift({
        content: sibling.text || '',
        location: extractLocation(sibling),
      });
    } else if (
      sibling.type !== 'NEWLINE' &&
      sibling.type !== 'INDENT' &&
      sibling.type !== 'DEDENT'
    ) {
      // Stop if we hit a non-comment, non-whitespace node
      break;
    }
  }

  return comments;
}

/**
 * Find a child node by field name
 */
export function findChildByFieldName(
  node: CSTNode,
  fieldName: string
): CSTNode | undefined {
  return node.children?.find(child => child.fieldName === fieldName);
}

/**
 * Find a child node by type
 */
export function findChildByType(
  node: CSTNode,
  type: string
): CSTNode | undefined {
  return node.children?.find(child => child.type === type);
}

/**
 * Find all children nodes by type
 */
export function findChildrenByType(node: CSTNode, type: string): CSTNode[] {
  return node.children?.filter(child => child.type === type) || [];
}

/**
 * Get the text content of a node
 */
export function getNodeText(node: CSTNode | undefined): string | undefined {
  return node?.text;
}

/**
 * Unescape a string value by interpreting escape sequences
 */
function unescapeString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\r/g, '\r')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

/**
 * Extract a string value from a value node
 * Handles quoted strings by removing quotes
 */
export function extractStringValue(
  valueNode: CSTNode | undefined
): string | undefined {
  if (!valueNode) return undefined;

  // If the value node has a string child, use that
  const stringChild = findChildByType(valueNode, 'string');
  if (stringChild?.text) {
    // Remove surrounding quotes and unescape
    const text = stringChild.text;
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return unescapeString(text.slice(1, -1));
    }
    return text;
  }

  // Otherwise use the value node's text directly
  if (valueNode.text) {
    const text = valueNode.text;
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return unescapeString(text.slice(1, -1));
    }
    return text;
  }

  return undefined;
}

/**
 * Extract a boolean value from a value node
 */
export function extractBooleanValue(
  valueNode: CSTNode | undefined
): boolean | undefined {
  if (!valueNode) return undefined;

  const boolChild = findChildByType(valueNode, 'boolean');
  const text = boolChild?.text || valueNode.text;

  if (text === 'True' || text === 'true') return true;
  if (text === 'False' || text === 'false') return false;

  return undefined;
}

/**
 * Extract a number value from a value node
 */
export function extractNumberValue(
  valueNode: CSTNode | undefined
): number | undefined {
  if (!valueNode) return undefined;

  const numChild =
    findChildByType(valueNode, 'number') ||
    findChildByType(valueNode, 'integer') ||
    findChildByType(valueNode, 'float');
  const text = numChild?.text || valueNode.text;

  if (text) {
    const num = Number(text);
    return isNaN(num) ? undefined : num;
  }

  return undefined;
}

/**
 * Extract a list value from a value node
 */
export function extractListValue(
  valueNode: CSTNode | undefined
): unknown[] | undefined {
  if (!valueNode) return undefined;

  const listChild = findChildByType(valueNode, 'list');
  if (!listChild?.children) return undefined;

  const items: unknown[] = [];
  for (const child of listChild.children) {
    if (child.type === 'value') {
      items.push(extractValue(child));
    }
  }

  return items;
}

/**
 * Extract an object value from a value node
 */
export function extractObjectValue(
  valueNode: CSTNode | undefined
): Record<string, unknown> | undefined {
  if (!valueNode) return undefined;

  const objChild = findChildByType(valueNode, 'object');
  if (!objChild?.children) return undefined;

  const obj: Record<string, unknown> = {};

  for (const child of objChild.children) {
    if (child.type === 'field') {
      const name = findChildByFieldName(child, 'name')?.text;
      const value = findChildByFieldName(child, 'value');
      if (name) {
        obj[name] = extractValue(value);
      }
    }
  }

  return obj;
}

/**
 * Extract a value of any type from a value node
 */
export function extractValue(valueNode: CSTNode | undefined): unknown {
  if (!valueNode) return undefined;

  // Check what type of value this is by looking at children
  if (valueNode.children) {
    for (const child of valueNode.children) {
      switch (child.type) {
        case 'string':
          return extractStringValue(valueNode);
        case 'boolean':
          return extractBooleanValue(valueNode);
        case 'number':
        case 'integer':
        case 'float':
          return extractNumberValue(valueNode);
        case 'list':
          return extractListValue(valueNode);
        case 'object':
          return extractObjectValue(valueNode);
      }
    }
  }

  // Try to infer from the node's text
  const text = valueNode.text;
  if (!text) return undefined;

  // Try boolean
  if (text === 'True' || text === 'true') return true;
  if (text === 'False' || text === 'false') return false;

  // Try number
  const num = Number(text);
  if (!isNaN(num)) return num;

  // Try string (remove quotes if present)
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }

  // Return as-is
  return text;
}

/**
 * Extract type information from a type node
 */
export function extractTypeInfo(typeNode: CSTNode | undefined): TypeInfo {
  if (!typeNode) {
    return { kind: 'primitive', name: 'any' };
  }

  const typeText = typeNode.text || 'any';

  // Check if it's a list type
  if (typeText.startsWith('list[') && typeText.endsWith(']')) {
    const elementTypeText = typeText.slice(5, -1);
    return {
      kind: 'list',
      name: typeText,
      elementType: extractTypeInfo({
        type: 'type',
        text: elementTypeText,
        range: typeNode.range,
      }),
    };
  }

  // Check if it's a primitive type
  const primitiveTypes = [
    'string',
    'number',
    'integer',
    'float',
    'boolean',
    'any',
    'object',
  ];
  if (primitiveTypes.includes(typeText.toLowerCase())) {
    return {
      kind: 'primitive',
      name: typeText,
    };
  }

  // Otherwise it's a complex type
  return {
    kind: 'complex',
    name: typeText,
  };
}

/**
 * Extract all fields from a block as a record
 */
export function extractFieldsAsRecord(
  blockNode: CSTNode
): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  if (!blockNode.children) return record;

  for (const child of blockNode.children) {
    // Handle both "field" and "block" type children
    if (child.type === 'field' || child.type === 'block') {
      const nameNode = findChildByFieldName(child, 'name');
      const keyNode = findChildByFieldName(child, 'key');
      const name = nameNode?.text || keyNode?.text;

      if (!name) continue;

      // If this is a block type, recursively extract its fields
      if (child.type === 'block') {
        const nestedRecord = extractFieldsAsRecord(child);
        record[name] = nestedRecord;
        continue;
      }

      // For field types: Look for nested fields (child fields that appear on later rows)
      const nestedFields = child.children?.filter(
        c =>
          c.type === 'field' &&
          c.range &&
          child.range &&
          c.range.start.line > child.range.start.line
      );

      if (nestedFields && nestedFields.length > 0) {
        // This field has nested fields - recursively extract them
        const nestedRecord: Record<string, unknown> = {};
        for (const nestedField of nestedFields) {
          const nestedName =
            findChildByFieldName(nestedField, 'name')?.text ||
            findChildByFieldName(nestedField, 'key')?.text;
          const nestedValue = findChildByFieldName(nestedField, 'value');
          if (nestedName) {
            nestedRecord[nestedName] = extractValue(nestedValue);
          }
        }
        record[name] = nestedRecord;
      } else {
        // Regular field with a value
        const valueNode = findChildByFieldName(child, 'value');
        record[name] = extractValue(valueNode);
      }
    }
  }

  return record;
}

/**
 * Extract agent_label from config block in the CST
 * Returns undefined if config block doesn't exist or agent_label is not set
 */
export function extractAgentLabel(rootNode: CSTNode): string | undefined {
  // Find config block
  const allBlocks = findChildrenByType(rootNode, 'block');
  const configBlock = allBlocks.find(block => {
    const blockKey = findChildByFieldName(block, 'key')?.text;
    return blockKey === 'config';
  });

  if (!configBlock) return undefined;

  // Extract fields and get agent_label
  const fields = extractFieldsAsRecord(configBlock);
  const agentLabel = fields.agent_label;

  // Return as string if it exists
  return typeof agentLabel === 'string' ? agentLabel : undefined;
}
