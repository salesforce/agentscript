/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Utility: Find the AST path at a cursor position
 */

import { isNamedMap } from '@agentscript/language';

interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

interface Position {
  line: number;
  character: number;
}

/**
 * Find the path to the deepest AST node containing the given position.
 * Returns a dot-separated path like "AST.config.default_agent_user"
 */
export function findAstPathAtPosition(
  ast: unknown,
  line: number,
  character: number,
  rootName: string = 'AST'
): string | null {
  if (!ast || typeof ast !== 'object') return null;

  let bestPath: string | null = null;
  let bestRange: Range | null = null;
  const visited = new Set<unknown>();

  function isPositionInRange(pos: Position, range: Range): boolean {
    const afterStart =
      pos.line > range.start.line ||
      (pos.line === range.start.line && pos.character >= range.start.character);
    const beforeEnd =
      pos.line < range.end.line ||
      (pos.line === range.end.line && pos.character <= range.end.character);
    return afterStart && beforeEnd;
  }

  function isRangeSmaller(a: Range, b: Range): boolean {
    const aSize =
      (a.end.line - a.start.line) * 1000 +
      (a.end.character - a.start.character);
    const bSize =
      (b.end.line - b.start.line) * 1000 +
      (b.end.character - b.start.character);
    return aSize < bSize;
  }

  function traverse(value: unknown, path: string): void {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    // Check if this is a NamedMap-like object (container, not a semantic node)
    const isMapLike = isNamedMap(value);

    // Check if this node has a range (skip for Map-like containers)
    if (!Array.isArray(value) && !isMapLike) {
      const obj = value as Record<string, unknown>;
      const cst = obj.__cst as { range: Range } | undefined;
      const range = cst?.range;

      if (range && isPositionInRange({ line, character }, range)) {
        // This node contains the position
        // Update best if this range is smaller (more specific)
        if (!bestRange || isRangeSmaller(range, bestRange)) {
          bestPath = path;
          bestRange = range;
        }
      }
    }

    // Traverse children
    if (Array.isArray(value)) {
      value.forEach((item, i) => {
        traverse(item, `${path}.${i}`);
      });
    } else if (isMapLike) {
      // Handle NamedMap objects (e.g., TypedMap)
      value.forEach((v: unknown, k: string) => {
        traverse(v, `${path}.${k}`);
      });
    } else {
      const obj = value as Record<string, unknown>;
      for (const [key, val] of Object.entries(obj)) {
        if (key.startsWith('_')) continue; // skip __ meta AND _ internal fields
        if (typeof val === 'function') continue;
        traverse(val, `${path}.${key}`);
      }
    }

    // Traverse __children — structural nodes (StatementChild, etc.) that
    // carry their own __cst ranges and __comments
    const obj = (
      isMapLike ? (value as unknown as Record<string, unknown>) : value
    ) as Record<string, unknown>;
    const blockChildren = obj.__children as unknown[] | undefined;
    if (Array.isArray(blockChildren)) {
      blockChildren.forEach((child, i) => {
        traverse(child, `${path}.__children.${i}`);
      });
    }

    // Traverse __comments — they carry their own range directly
    const comments = obj.__comments as unknown[] | undefined;
    if (Array.isArray(comments)) {
      comments.forEach((c, i) => {
        if (c && typeof c === 'object') {
          const commentRange = (c as Record<string, unknown>).range as
            | Range
            | undefined;
          if (
            commentRange &&
            isPositionInRange({ line, character }, commentRange)
          ) {
            if (!bestRange || isRangeSmaller(commentRange, bestRange)) {
              bestPath = `${path}.__comments.${i}`;
              bestRange = commentRange;
            }
          }
        }
      });
    }
  }

  traverse(ast, rootName);
  return bestPath;
}
