/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  getErrorNodeIds,
  findNodeAtPosition,
  getPathToNode,
  type CSTDebugTreeNode,
} from '~/components/cst-debug/cstToDebugTree';
import { TreeView } from '~/components/explorer/TreeView';
import { cn } from '~/lib/utils';
import { useAppStore } from '~/store';
import { ChevronDown } from 'lucide-react';

interface TreeViewNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    [key: string]: unknown;
  };
  children?: TreeViewNode[];
}

interface CstDebugPanelProps {
  debugTreeData: CSTDebugTreeNode[];
  isScriptView: boolean;
}

export function CstDebugPanel({
  debugTreeData,
  isScriptView,
}: CstDebugPanelProps) {
  const navigate = useNavigate();
  const { agentId } = useParams();
  const monacoEditor = useAppStore(state => state.source.monacoEditor);

  // CST debug expanded state from store
  const cstDebugExpanded = useAppStore(state => state.layout.cstDebugExpanded);
  const toggleCstDebugExpanded = useAppStore(
    state => state.toggleCstDebugExpanded
  );
  const isCstDebugCollapsed = !cstDebugExpanded;

  // Store for CST selection
  const setSelectedCstNodeId = useAppStore(state => state.setSelectedCstNodeId);
  const selectedCstNodeId = useAppStore(
    state => state.layout.selectedCstNodeId
  );

  // Read editor selection for cursor-based CST node highlighting
  const editorSelectionForCst = useAppStore(
    state => state.source.editorSelection
  );

  // Find the CST node at the current cursor position (only in script view)
  const selectedCstNodeAtCursor = useMemo(() => {
    if (!isScriptView || !editorSelectionForCst || !debugTreeData.length) {
      return undefined;
    }

    const { positionRow, positionColumn } = editorSelectionForCst;
    const node = findNodeAtPosition(debugTreeData, positionRow, positionColumn);
    return node?.id;
  }, [isScriptView, editorSelectionForCst, debugTreeData]);

  // Update CST selection when cursor moves
  useEffect(() => {
    if (isScriptView && selectedCstNodeAtCursor) {
      setSelectedCstNodeId(selectedCstNodeAtCursor);
    }
  }, [isScriptView, selectedCstNodeAtCursor, setSelectedCstNodeId]);

  // Get expansion keys for CST debug tree
  // Expand path to the selected node, or fallback to error nodes
  const cstExpandedKeys = useMemo(() => {
    if (selectedCstNodeAtCursor) {
      // Expand only the path to the selected node
      return getPathToNode(debugTreeData, selectedCstNodeAtCursor);
    }

    // Fallback: expand error nodes and root
    const keys = getErrorNodeIds(debugTreeData);
    if (debugTreeData.length > 0) {
      keys.push('0');
    }
    return keys;
  }, [debugTreeData, selectedCstNodeAtCursor]);

  // Clear CST selection when panel is collapsed
  useEffect(() => {
    if (isCstDebugCollapsed && selectedCstNodeId) {
      setSelectedCstNodeId(undefined);
    }
  }, [isCstDebugCollapsed, selectedCstNodeId, setSelectedCstNodeId]);

  const handleNodeSelect = (kind: string, id: string) => {
    // Handle CST debug node selection
    if (kind === 'cst-node') {
      setSelectedCstNodeId(id);
      // Find the node in the debug tree to get position
      const node = findNodeById(debugTreeData, id);
      if (node && node.data.range) {
        navigateToPosition(node.data.range.start);
      }
    }
  };

  // Helper to navigate to a position in the script editor
  const navigateToPosition = (position: {
    line: number;
    character: number;
  }) => {
    // If not in script view, navigate there first
    if (!isScriptView && agentId) {
      void navigate(`/agents/${agentId}/script`);
      // Wait a bit for the editor to mount, then set position
      setTimeout(() => {
        revealPositionInEditor(position);
      }, 100);
    } else {
      // Already in script view, just reveal the position
      revealPositionInEditor(position);
    }
  };

  // Helper to reveal a position in Monaco editor
  const revealPositionInEditor = (position: {
    line: number;
    character: number;
  }) => {
    if (!monacoEditor) return;

    // Cast to any for Monaco editor methods (stored as unknown in Zustand)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editor = monacoEditor as any;

    // Signal that this navigation is from explorer (prevents feedback loop)
    if (editor.__setNavigatingFromExplorer) {
      editor.__setNavigatingFromExplorer();
    }

    // Monaco uses 1-based line/column numbers, range uses 0-based
    const lineNumber = position.line + 1;
    const column = position.character + 1;

    // Set cursor position and reveal it
    editor.setPosition({ lineNumber, column });
    editor.revealPositionInCenter({ lineNumber, column });

    // Focus the editor
    editor.focus();
  };

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden',
        isCstDebugCollapsed ? 'flex-none' : 'flex-1'
      )}
    >
      {/* CST Debug Header - Always visible */}
      <button
        onClick={toggleCstDebugExpanded}
        className="flex h-7 w-full flex-none items-center justify-between border-t border-gray-200 bg-white px-4 transition-colors hover:bg-gray-100 dark:border-[#2b2b2b] dark:bg-[#252526] dark:hover:bg-[#2a2d2e]"
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-700 dark:text-[#cccccc]">
          CST
        </h3>
        <ChevronDown
          className={cn(
            'h-4 w-4 text-gray-600 transition-transform duration-200 dark:text-[#cccccc]',
            isCstDebugCollapsed && 'rotate-180'
          )}
        />
      </button>

      {/* CST Debug Content - Only shown when expanded */}
      {!isCstDebugCollapsed && (
        <div className="flex-1 overflow-y-auto">
          <TreeView
            data={debugTreeData.map(node => convertToTreeViewNode(node))}
            selectedNodeId={selectedCstNodeId}
            onNodeSelect={handleNodeSelect}
            expandedKeys={cstExpandedKeys}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Find a node by ID in the debug tree
 */
function findNodeById(
  nodes: CSTDebugTreeNode[],
  id: string
): CSTDebugTreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Truncate text for preview display - only show first line
 */
function truncateText(text: string, maxLen: number): string {
  // Get only the first line
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen) + '...';
}

/**
 * Convert CSTDebugTreeNode to TreeView's expected TreeNode format
 */
function convertToTreeViewNode(node: CSTDebugTreeNode): TreeViewNode {
  // Build enhanced label with more context
  let mainLabel = '';

  // Show field name if present
  if (node.data.fieldName) {
    mainLabel = `${node.data.fieldName}: ${node.data.cstNodeType}`;
  } else {
    mainLabel = node.data.cstNodeType;
  }

  // Add error/missing indicators
  if (node.data.hasError) {
    mainLabel = `❌ ${mainLabel}`;
  } else if (node.data.isMissing) {
    mainLabel = `⚠️ ${mainLabel}`;
  }

  // Format position label
  const positionLabel = `${node.data.range.start.line}:${node.data.range.start.character}`;

  // Truncate text for preview
  const secondaryLabel = node.data.text
    ? truncateText(node.data.text, 50)
    : undefined;

  return {
    id: node.id,
    data: {
      label: mainLabel,
      blockType: node.data.blockType,
      secondaryLabel,
      cstNodeType: node.data.cstNodeType,
      isNamed: node.data.isNamed,
      hasError: node.data.hasError,
      isMissing: node.data.isMissing,
      positionLabel,
    },
    children: node.children?.map(convertToTreeViewNode),
  };
}
