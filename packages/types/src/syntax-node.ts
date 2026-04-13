/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export interface SyntaxNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  namedChildren: SyntaxNode[];
  children: SyntaxNode[];
  childForFieldName(name: string): SyntaxNode | null;
  childrenForFieldName(name: string): SyntaxNode[];
  parent: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  /** Byte offset of the start of this node in the source text. */
  startOffset?: number;
  /** Byte offset of the end of this node in the source text. */
  endOffset?: number;
  /** Return the field name for the child at the given index, or null. */
  fieldNameForChild?(index: number): string | null;
  /** True if this node is an ERROR node (parse failure). */
  isError?: boolean;
  /** True if this node was inserted by the parser (expected but not found). */
  isMissing?: boolean;
  /** True if this is a "named" node (not anonymous punctuation/keyword). */
  isNamed?: boolean;
  /** True if this node or any descendant has an error. */
  hasError?: boolean;
  /** Return an s-expression string representation of this node (for debugging). */
  toSExp?(): string;
}
