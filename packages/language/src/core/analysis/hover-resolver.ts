/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Platform-agnostic hover resolution for AgentScript CST nodes.
 *
 * Both the LSP (SyntaxNode) and Monaco (SerializedNode) hover providers
 * share the same resolution logic through the generic {@link NodeAccessor}
 * interface.  Each platform supplies a small accessor that maps its tree
 * API to the operations this module needs.
 */

import type { FieldMetadata, KeywordInfo } from '../types.js';
import {
  resolveSchemaField,
  findKeywordInfo,
  type SchemaFieldInfo,
} from './schema-hover.js';
import { keywordNames } from '../types.js';

// ---------------------------------------------------------------------------
// Node accessor – the only thing each platform must implement
// ---------------------------------------------------------------------------

/**
 * Thin abstraction over CST node access.
 *
 * `SyntaxNode` (parser native) and `SerializedNode` (web-worker
 * serialized) expose positions and children differently.  Rather than
 * wrapping every node, callers pass a stateless accessor object.
 */
export interface NodeAccessor<N> {
  /** Node grammar type (e.g. `"id"`, `"mapping_element"`). */
  type(node: N): string;
  /** Full source text spanned by the node. */
  text(node: N): string;
  /** All direct children (named + anonymous). */
  children(node: N): readonly N[];
  /** Named children only. */
  namedChildren(node: N): readonly N[];

  // Position (0-based)
  startLine(node: N): number;
  startColumn(node: N): number;
  endLine(node: N): number;
  endColumn(node: N): number;

  /**
   * Return the first child whose grammar field name is `name`, or `null`.
   *
   * - SyntaxNode: `node.childForFieldName(name)`
   * - SerializedNode: `node.children.find(c => c.fieldName === name)`
   */
  childByFieldName(node: N, name: string): N | null;
}

// ---------------------------------------------------------------------------
// Hover result types (platform-neutral)
// ---------------------------------------------------------------------------

export interface HoverRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export interface SchemaFieldHover {
  kind: 'field';
  key: string;
  path: string[];
  metadata: FieldMetadata;
  range: HoverRange;
  modifiers?: readonly KeywordInfo[];
  primitiveTypes?: readonly KeywordInfo[];
}

export interface KeywordHover {
  kind: 'modifier' | 'type';
  keyword: string;
  info: KeywordInfo | undefined;
  range: HoverRange;
}

export type HoverResult = SchemaFieldHover | KeywordHover;

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Resolve hover information at a 0-based position in a CST.
 *
 * This is the single implementation shared by the LSP and Monaco hover
 * providers.  All tree-API differences are handled by the `accessor`.
 */
export function resolveHover<N>(
  root: N,
  line: number,
  character: number,
  schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>,
  accessor: NodeAccessor<N>
): HoverResult | null {
  const target = findNodeAtPosition(root, line, character, accessor);
  if (!target) return null;

  const targetType = accessor.type(target);

  // 1. Modifier keyword hover — derive valid modifiers from the schema
  //    instead of maintaining a hardcoded list.  A modifier is any anonymous
  //    node inside a `variable_declaration` whose text matches a keyword in
  //    the enclosing TypedMap field's `__modifiers`.
  if (findAncestorContext(root, target, 'variable_declaration', accessor)) {
    const result = tryResolveModifierHover(target, root, schema, accessor);
    if (result) return result;
  }

  // 2. Key / type hover (id or string nodes)
  if (targetType === 'id' || targetType === 'string') {
    // 2a. Primitive type hover (id in variable_declaration type field)
    if (targetType === 'id') {
      const typeResult = tryResolveTypeHover(target, root, schema, accessor);
      if (typeResult) return typeResult;
    }

    // 2b. Schema field key hover
    const path = buildSchemaPath(root, target, accessor);
    if (path.length > 0) {
      const resolved = resolveSchemaField(path, schema);
      if (resolved?.field.__metadata) {
        const targetText = getKeyTextGeneric(target, accessor);
        if (targetText === resolved.lastKey) {
          return {
            kind: 'field',
            key: path[path.length - 1],
            path: resolved.resolvedPath,
            metadata: resolved.field.__metadata,
            range: nodeRange(target, accessor),
            modifiers: resolved.field.__modifiers,
            primitiveTypes: resolved.field.__primitiveTypes,
          };
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tree traversal helpers (all generic over N)
// ---------------------------------------------------------------------------

/** Find the deepest node containing the given 0-based position. */
function findNodeAtPosition<N>(
  node: N,
  line: number,
  character: number,
  a: NodeAccessor<N>
): N | null {
  if (
    line < a.startLine(node) ||
    line > a.endLine(node) ||
    (line === a.startLine(node) && character < a.startColumn(node)) ||
    (line === a.endLine(node) && character >= a.endColumn(node))
  ) {
    return null;
  }

  for (const child of a.children(node)) {
    const found = findNodeAtPosition(child, line, character, a);
    if (found) return found;
  }

  return node;
}

/**
 * Build the schema path from `root` to `target` by collecting key texts
 * from each `mapping_element` ancestor along the way.
 */
function buildSchemaPath<N>(root: N, target: N, a: NodeAccessor<N>): string[] {
  const path: string[] = [];

  function walk(node: N): boolean {
    if (node === target) return true;

    for (const child of a.children(node)) {
      if (walk(child)) {
        if (a.type(node) === 'mapping_element') {
          const keyNode = a.childByFieldName(node, 'key');
          if (keyNode) {
            const keys = extractKeyTexts(keyNode, a);
            path.unshift(...keys);
          }
        }
        return true;
      }
    }
    return false;
  }

  walk(root);
  return path;
}

/** Collect all `mapping_element` ancestors from root to target. */
function collectAncestorMappingElements<N>(
  node: N,
  target: N,
  result: N[],
  a: NodeAccessor<N>
): boolean {
  if (node === target) return true;

  for (const child of a.children(node)) {
    if (collectAncestorMappingElements(child, target, result, a)) {
      if (a.type(node) === 'mapping_element') {
        result.unshift(node);
      }
      return true;
    }
  }
  return false;
}

/**
 * Find the nearest ancestor of the given `type` by walking from root
 * toward the target (works without a `.parent` pointer).
 */
function findAncestorContext<N>(
  root: N,
  target: N,
  type: string,
  a: NodeAccessor<N>
): N | null {
  let found: N | null = null;

  function walk(node: N): boolean {
    if (node === target) return true;
    for (const child of a.children(node)) {
      if (walk(child)) {
        if (a.type(node) === type && !found) {
          found = node;
        }
        return true;
      }
    }
    return false;
  }

  walk(root);
  return found;
}

/** Check if `container` positionally contains `target`. */
function containsNode<N>(container: N, target: N, a: NodeAccessor<N>): boolean {
  const startOk =
    a.startLine(target) > a.startLine(container) ||
    (a.startLine(target) === a.startLine(container) &&
      a.startColumn(target) >= a.startColumn(container));
  const endOk =
    a.endLine(target) < a.endLine(container) ||
    (a.endLine(target) === a.endLine(container) &&
      a.endColumn(target) <= a.endColumn(container));
  return startOk && endOk;
}

// ---------------------------------------------------------------------------
// Hover resolution helpers
// ---------------------------------------------------------------------------

function tryResolveModifierHover<N>(
  target: N,
  root: N,
  schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>,
  a: NodeAccessor<N>
): KeywordHover | null {
  const typedMapField = findContainingTypedMapField(target, root, schema, a);
  if (!typedMapField?.__modifiers) return null;

  // Only produce a hover if the node text is actually a modifier defined in
  // the schema — this keeps hover resolution fully dialect-agnostic.
  const modifierNames = keywordNames(typedMapField.__modifiers);
  const text = a.text(target);
  if (!modifierNames.includes(text)) return null;

  const info = findKeywordInfo(text, typedMapField.__modifiers);

  return {
    kind: 'modifier',
    keyword: text,
    info,
    range: nodeRange(target, a),
  };
}

function tryResolveTypeHover<N>(
  target: N,
  root: N,
  schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>,
  a: NodeAccessor<N>
): KeywordHover | null {
  const varDecl = findAncestorContext(root, target, 'variable_declaration', a);
  if (!varDecl) return null;

  const typeField = a.childByFieldName(varDecl, 'type');
  if (!typeField || !containsNode(typeField, target, a)) return null;

  const typedMapField = findContainingTypedMapField(target, root, schema, a);
  if (!typedMapField?.__primitiveTypes) return null;

  const typeNames = keywordNames(typedMapField.__primitiveTypes);
  if (!typeNames.includes(a.text(target))) return null;

  const info = findKeywordInfo(a.text(target), typedMapField.__primitiveTypes);

  return {
    kind: 'type',
    keyword: a.text(target),
    info,
    range: nodeRange(target, a),
  };
}

/**
 * Walk from root to the target, collecting mapping_element ancestors, then
 * resolve the second-to-last one as the TypedMap field in the schema.
 */
function findContainingTypedMapField<N>(
  target: N,
  root: N,
  schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>,
  a: NodeAccessor<N>
): SchemaFieldInfo | null {
  const mappingElements: N[] = [];
  collectAncestorMappingElements(root, target, mappingElements, a);

  if (mappingElements.length < 2) return null;

  const fieldElement = mappingElements[mappingElements.length - 2];

  const path = buildSchemaPath(root, fieldElement, a);
  const keyNode = a.childByFieldName(fieldElement, 'key');
  if (keyNode) {
    path.push(...extractKeyTexts(keyNode, a));
  }

  if (path.length === 0) return null;

  const resolved = resolveSchemaField(path, schema);
  if (!resolved?.field.__isTypedMap) return null;

  return resolved.field;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Extract key text strings from a key node's children. */
function extractKeyTexts<N>(keyNode: N, a: NodeAccessor<N>): string[] {
  return a
    .namedChildren(keyNode)
    .filter(c => a.type(c) === 'id' || a.type(c) === 'string')
    .map(c => getKeyTextGeneric(c, a));
}

/**
 * Get the text value of a key node, handling string nodes with escape
 * sequences the same way `getKeyText` does for native SyntaxNodes.
 */
function getKeyTextGeneric<N>(node: N, a: NodeAccessor<N>): string {
  if (a.type(node) === 'id') return a.text(node);

  if (a.type(node) === 'string') {
    let value = '';
    for (const child of a.namedChildren(node)) {
      if (a.type(child) === 'string_content') {
        value += a.text(child);
      } else if (a.type(child) === 'escape_sequence') {
        const t = a.text(child);
        if (t === '\\"') value += '"';
        else if (t === "\\'") value += "'";
        else if (t === '\\\\') value += '\\';
        else if (t === '\\n') value += '\n';
        else if (t === '\\r') value += '\r';
        else if (t === '\\t') value += '\t';
        else if (t === '\\0') value += '\0';
      }
    }
    return value;
  }

  return a.text(node);
}

/** Build a platform-neutral range from a node. */
function nodeRange<N>(node: N, a: NodeAccessor<N>): HoverRange {
  return {
    start: { line: a.startLine(node), character: a.startColumn(node) },
    end: { line: a.endLine(node), character: a.endColumn(node) },
  };
}
