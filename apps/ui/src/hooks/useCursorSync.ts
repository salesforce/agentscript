/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared cursor ↔ CST/AST sync logic.
 *
 * Computes the CST node and AST path at the current cursor position,
 * derives expanded keys for the CST tree, and provides navigation handlers.
 *
 * Used by both the Script page (via TreeInspectorPanel) and the Component page.
 */

import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  findNodeAtPosition as findCstNodeAtPosition,
  getPathToNode as getCstPathToNode,
  findDebugTreeNodeById,
  type CSTDebugTreeNode,
} from '~/components/cst-debug/cstToDebugTree';
import { findAstPathAtPosition } from '~/components/inspector/findAstPath';

export interface CursorPosition {
  line: number;
  column: number;
}

interface UseCursorSyncOptions {
  /** Current cursor position (0-based line/column), or null if unavailable */
  cursorPosition: CursorPosition | null;
  /** Active inspector mode — CST/AST computations only fire for their respective modes */
  mode: string;
  /** CST debug tree data */
  cstTreeData: CSTDebugTreeNode[];
  /** Parsed AST for path-finding */
  ast: unknown;
  /** Root name for AST path display (e.g., 'AST' or 'Component') */
  astRootName: string;
  /** Callback to navigate the editor to a 0-based position */
  navigateEditor: (pos: { line: number; character: number }) => void;
}

export function useCursorSync({
  cursorPosition,
  mode,
  cstTreeData,
  ast,
  astRootName,
  navigateEditor,
}: UseCursorSyncOptions) {
  // Find CST node at cursor (only when in CST mode)
  const selectedCstNodeAtCursor = useMemo(() => {
    if (mode !== 'cst') return undefined;
    if (!cursorPosition || !cstTreeData.length) return undefined;
    return findCstNodeAtPosition(
      cstTreeData,
      cursorPosition.line,
      cursorPosition.column
    )?.id;
  }, [mode, cursorPosition, cstTreeData]);

  // Find AST path at cursor (only when in AST mode)
  // Debounced to avoid re-rendering the entire ObjectInspector tree on every
  // cursor move — the tree render is expensive (~600ms+).
  const rawAstHighlightPath = useMemo(() => {
    if (mode !== 'ast') return null;
    if (!cursorPosition || !ast) return null;
    return findAstPathAtPosition(
      ast,
      cursorPosition.line,
      cursorPosition.column,
      astRootName
    );
  }, [mode, cursorPosition, ast, astRootName]);

  const [astHighlightPath, setAstHighlightPath] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAstHighlightPath(rawAstHighlightPath);
    }, 150);
    return () => clearTimeout(debounceRef.current);
  }, [rawAstHighlightPath]);

  // Expanded keys: auto-expand path to cursor-selected CST node
  const expandedKeys = useMemo(() => {
    if (mode === 'cst' && selectedCstNodeAtCursor) {
      return getCstPathToNode(cstTreeData, selectedCstNodeAtCursor);
    }
    if (cstTreeData.length > 0) {
      return [cstTreeData[0].id];
    }
    return [];
  }, [mode, cstTreeData, selectedCstNodeAtCursor]);

  // Navigate editor to a CST node's start position
  const navigateToCstNode = useCallback(
    (id: string) => {
      const node = findDebugTreeNodeById(cstTreeData, id);
      if (node?.data.range) {
        navigateEditor(node.data.range.start);
      }
    },
    [cstTreeData, navigateEditor]
  );

  // Navigate editor to an AST range's start position
  const navigateToRange = useCallback(
    (range: { start: { line: number; character: number } }) => {
      navigateEditor(range.start);
    },
    [navigateEditor]
  );

  return {
    selectedCstNodeAtCursor,
    astHighlightPath,
    expandedKeys,
    navigateToCstNode,
    navigateToRange,
  };
}
