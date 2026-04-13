/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Adapter that wraps tree-sitter node objects (native or WASM) to conform
 * to the @agentscript/types SyntaxNode interface.
 *
 * A single implementation handles both native tree-sitter nodes and
 * web-tree-sitter (WASM) nodes — the differences are minor:
 *   - `isError` may be absent on web-tree-sitter → fall back to type check
 *   - `previousSibling` may be absent on web-tree-sitter → fall back to null
 *   - children arrays may contain nulls on web-tree-sitter → filter defensively
 *
 * Key differences bridged vs raw tree-sitter:
 *   - Adds flat position fields (startRow, startCol, endRow, endCol)
 *   - Maps startIndex/endIndex → startOffset/endOffset
 *   - Recursively wraps child/parent/sibling references
 *
 * @internal — not part of the public API. Consumers should use parse()
 * and other top-level functions which return SyntaxNode directly.
 */

import type { SyntaxNode } from '@agentscript/types';

/**
 * Minimal subset of a tree-sitter node (native or WASM) that the adapter
 * depends on. Covers both native tree-sitter and web-tree-sitter shapes.
 */
export interface RawTreeSitterNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startIndex: number;
  endIndex: number;
  children: RawTreeSitterNode[];
  namedChildren: RawTreeSitterNode[];
  parent: RawTreeSitterNode | null;
  /** Present on native tree-sitter; may be absent on web-tree-sitter. */
  previousSibling?: RawTreeSitterNode | null;
  childForFieldName(fieldName: string): RawTreeSitterNode | null;
  childrenForFieldName(fieldName: string): RawTreeSitterNode[];
  fieldNameForChild(childIndex: number): string | null;
  isNamed: boolean;
  /** Present on native tree-sitter; may be absent on web-tree-sitter. */
  isError?: boolean;
  isMissing: boolean;
  hasError: boolean;
}

/** Cache to avoid re-wrapping the same node. */
const adapterCache = new WeakMap<RawTreeSitterNode, TreeSitterNodeAdapter>();

/**
 * Wrap a tree-sitter node (native or WASM), returning a cached adapter
 * if one already exists for this node.
 */
export function adaptNode(node: RawTreeSitterNode): SyntaxNode {
  const cached = adapterCache.get(node);
  if (cached) return cached;
  const adapted = new TreeSitterNodeAdapter(node);
  adapterCache.set(node, adapted);
  return adapted;
}

function adaptNodeOrNull(
  node: RawTreeSitterNode | null | undefined
): SyntaxNode | null {
  return node ? adaptNode(node) : null;
}

function adaptNodes(nodes: RawTreeSitterNode[]): SyntaxNode[] {
  return nodes.filter((c): c is RawTreeSitterNode => c != null).map(adaptNode);
}

export class TreeSitterNodeAdapter implements SyntaxNode {
  private _node: RawTreeSitterNode;
  private _children: SyntaxNode[] | null = null;
  private _namedChildren: SyntaxNode[] | null = null;

  constructor(node: RawTreeSitterNode) {
    this._node = node;
    adapterCache.set(node, this);
  }

  get type(): string {
    return this._node.type;
  }

  get text(): string {
    return this._node.text;
  }

  // Flat position fields — derived from tree-sitter's position objects
  get startRow(): number {
    return this._node.startPosition.row;
  }

  get startCol(): number {
    return this._node.startPosition.column;
  }

  get endRow(): number {
    return this._node.endPosition.row;
  }

  get endCol(): number {
    return this._node.endPosition.column;
  }

  // Position objects — pass through directly
  get startPosition(): { row: number; column: number } {
    return this._node.startPosition;
  }

  get endPosition(): { row: number; column: number } {
    return this._node.endPosition;
  }

  // Byte offsets — mapped from tree-sitter's startIndex/endIndex
  get startOffset(): number {
    return this._node.startIndex;
  }

  get endOffset(): number {
    return this._node.endIndex;
  }

  // Tree navigation — lazily cached, recursively wrapped
  get children(): SyntaxNode[] {
    if (!this._children) {
      this._children = adaptNodes(this._node.children);
    }
    return this._children;
  }

  get namedChildren(): SyntaxNode[] {
    if (!this._namedChildren) {
      this._namedChildren = adaptNodes(this._node.namedChildren);
    }
    return this._namedChildren;
  }

  get parent(): SyntaxNode | null {
    return adaptNodeOrNull(this._node.parent);
  }

  get previousSibling(): SyntaxNode | null {
    return adaptNodeOrNull(this._node.previousSibling);
  }

  childForFieldName(name: string): SyntaxNode | null {
    return adaptNodeOrNull(this._node.childForFieldName(name));
  }

  childrenForFieldName(name: string): SyntaxNode[] {
    return adaptNodes(this._node.childrenForFieldName(name));
  }

  fieldNameForChild(index: number): string | null {
    return this._node.fieldNameForChild(index);
  }

  // Boolean flags
  get isError(): boolean {
    return this._node.isError ?? this._node.type === 'ERROR';
  }

  get isMissing(): boolean {
    return this._node.isMissing;
  }

  get isNamed(): boolean {
    return this._node.isNamed;
  }

  get hasError(): boolean {
    return this._node.hasError;
  }

  toSExp(): string {
    return String(this._node);
  }
}
