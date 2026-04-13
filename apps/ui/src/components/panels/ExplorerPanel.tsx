/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useMemo, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import {
  astToTreeData,
  findTreeNodeById,
  nodeIdToBuilderPath,
} from '~/components/explorer/astToTreeData';
import type { TreeNode } from '~/components/explorer/astToTreeData';
import { TreeView } from '~/components/explorer/TreeView';
import { cn } from '~/lib/utils';
import { useAppStore } from '~/store';
import { PanelHeader } from '~/components/panels/PanelHeader';
import type { AgentScriptAST } from '~/lib/parser';

interface ExplorerPanelProps {
  className?: string;
}

export function ExplorerPanel({ className }: ExplorerPanelProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { agentId } = useParams();
  const monacoEditor = useAppStore(state => state.source.monacoEditor);

  // Determine which view we're in
  const isScriptView = location.pathname.includes('/script');
  const isBuilderView = location.pathname.includes('/builder');
  const isGraphView = location.pathname.includes('/graph');

  // Store for explorer selection
  const setSelectedNodeId = useAppStore(state => state.setSelectedNodeId);
  const selectedNodeId = useAppStore(state => state.layout.selectedNodeId);

  // Get AST from store for explorer tree (shows only valid blocks)
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;

  // Convert AST to tree data for explorer (only valid blocks appear)
  const treeData = useMemo(() => {
    if (!ast) return [];
    return astToTreeData(ast);
  }, [ast]);

  // Watch editor selection and update explorer selection based on cursor position
  const editorSelection = useAppStore(state => state.source.editorSelection);

  useEffect(() => {
    if (!editorSelection || treeData.length === 0) return;

    const { positionRow: row, positionColumn: column } = editorSelection;

    // Walk the AST-derived tree data to find the deepest node containing the cursor.
    // Tree nodes already carry the correct IDs and position info from the AST,
    // so we don't need to walk the raw CST.
    function findNodeAtPosition(nodes: TreeNode[]): TreeNode | undefined {
      for (const node of nodes) {
        const { startPosition, endPosition } = node.data;
        if (!startPosition || !endPosition) {
          // Group nodes don't have positions — check their children
          if (node.children) {
            const childMatch = findNodeAtPosition(node.children);
            if (childMatch) return childMatch;
          }
          continue;
        }

        const afterStart =
          row > startPosition.row ||
          (row === startPosition.row && column >= startPosition.column);
        const beforeEnd =
          row < endPosition.row ||
          (row === endPosition.row && column <= endPosition.column);

        if (afterStart && beforeEnd) {
          // Check children for a more specific (deeper) match
          if (node.children) {
            const childMatch = findNodeAtPosition(node.children);
            if (childMatch) return childMatch;
          }
          return node;
        }
      }
      return undefined;
    }

    const matchedNode = findNodeAtPosition(treeData);
    if (matchedNode && matchedNode.data.blockType !== 'group') {
      setSelectedNodeId(matchedNode.id);
    }
  }, [editorSelection, treeData, setSelectedNodeId]);

  // Calculate which groups and parent nodes should be expanded based on selected node
  const expandedKeys = useMemo(() => {
    const keys: string[] = [];

    if (selectedNodeId) {
      // If a topic or start_agent is selected, expand topics group
      if (
        selectedNodeId.startsWith('topic-') ||
        selectedNodeId.startsWith('start_agent-')
      ) {
        keys.push('topics-group');
        // Also expand the selected topic itself if it has children
        keys.push(selectedNodeId);
      }
      // If an action under a topic is selected, expand topics group and the parent topic
      else if (selectedNodeId.includes('-action-')) {
        keys.push('topics-group');
        // Extract topic name from action ID (format: "topicName-action-actionName")
        const parts = selectedNodeId.split('-action-');
        if (parts.length >= 2) {
          const topicName = parts[0];
          // Could be either topic or start_agent
          keys.push(`topic-${topicName}`);
          keys.push(`start_agent-${topicName}`);
        }
      }
      // If a connection is selected, expand connections group
      else if (selectedNodeId.startsWith('connection-')) {
        keys.push('connections-group');
        keys.push(selectedNodeId);
      }
    }

    return keys;
  }, [selectedNodeId]);

  // Handle node selection in tree view
  const handleNodeSelect = (kind: string, nodeId: string) => {
    // Don't do anything for group nodes
    if (kind === 'group') {
      return;
    }

    setSelectedNodeId(nodeId);

    // In builder view, navigate to the builder URL with the node ID
    if (isBuilderView && agentId) {
      void navigate(
        `/agents/${agentId}/builder/${nodeIdToBuilderPath(nodeId)}`,
        { replace: true }
      );
      return;
    }

    // In graph view, navigate to the topic detail URL for topic/start_agent nodes
    if (isGraphView && agentId) {
      if (nodeId.startsWith('topic-') || nodeId.startsWith('start_agent-')) {
        const topicName = nodeId.replace(/^(topic|start_agent)-/, '');
        void navigate(`/agents/${agentId}/graph/${topicName}`, {
          replace: true,
        });
      } else {
        // For non-topic nodes, go to the overview
        void navigate(`/agents/${agentId}/graph`, { replace: true });
      }
      return;
    }

    // Navigate to the node's position in Monaco editor
    if (monacoEditor && isScriptView) {
      const node = findTreeNodeById(treeData, nodeId);
      if (node?.data.startPosition) {
        const { row, column } = node.data.startPosition;
        // Monaco uses 1-based line/column numbers
        const lineNumber = row + 1;
        const col = column + 1;

        // Cast to access Monaco editor methods (stored as unknown in Zustand)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const editor = monacoEditor as any;

        // Set a flag to prevent feedback loop
        if (typeof editor.__setNavigatingFromExplorer === 'function') {
          editor.__setNavigatingFromExplorer();
        }

        // Reveal and select the position
        editor.revealPositionInCenter({ lineNumber, column: col });
        editor.setPosition({ lineNumber, column: col });
        editor.focus();
      }
    }
  };

  return (
    <div
      className={cn(
        'flex h-full flex-col overflow-hidden bg-[#fafafd] text-foreground dark:bg-[#191a1b] dark:text-white',
        className
      )}
    >
      {/* Header */}
      <PanelHeader title="EXPLORER" />

      {/* Tree View - Shows AST block structure */}
      <div className="flex-1 overflow-auto">
        <TreeView
          data={treeData}
          onNodeSelect={handleNodeSelect}
          selectedNodeId={selectedNodeId}
          expandedKeys={expandedKeys}
        />
      </div>
    </div>
  );
}
