/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CSTNode } from '~/lib/cst-helpers';
import type { SerializedNode } from '~/store/source';

/**
 * Tree node structure for the debug CST viewer
 * Compatible with existing TreeView component
 */
export interface CSTDebugTreeNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    // CST-specific debug info
    cstNodeType: string;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    fieldName?: string;
    isNamed: boolean;
    hasError: boolean;
    isMissing: boolean;
    text?: string; // For future use (truncated preview)
  };
  children?: CSTDebugTreeNode[];
}

/**
 * Convert CST to a debug tree structure showing ALL nodes
 * @param cst - The CST (SerializedNode or CSTNode)
 * @returns Array of tree nodes for the TreeView component
 */

// Type for CST input - can be SerializedNode or CSTNode
type CSTInput = CSTNode | SerializedNode;

export function cstToDebugTree(cst: CSTInput): CSTDebugTreeNode[] {
  if (!cst) {
    return [];
  }

  // Handle SerializedNode and CSTNode
  let rootNode: CSTNode;
  if ('type' in cst && cst.type) {
    rootNode = cst as unknown as CSTNode;
  } else {
    return [];
  }

  // Convert the entire tree recursively
  const convertNode = (node: CSTNode, path: string = '0'): CSTDebugTreeNode => {
    const currentId = path;

    const treeNode: CSTDebugTreeNode = {
      id: currentId,
      data: {
        label: node.type, // Simple label, enhanced in the panel
        blockType: 'cst-node', // Generic type for all CST nodes
        cstNodeType: node.type,
        range: node.range,
        fieldName: node.fieldName,
        isNamed: node.isNamed ?? false,
        hasError: node.hasError ?? false,
        isMissing: node.isMissing ?? false,
        text: node.text, // Store for future use (can truncate in display)
      },
    };

    // Recursively convert children
    if (node.children && node.children.length > 0) {
      treeNode.children = node.children.map((child, index) =>
        convertNode(child, `${currentId}-${index}`)
      );
    }

    return treeNode;
  };

  return [convertNode(rootNode, '0')];
}

/**
 * Find a CST node by its ID in the debug tree
 * @param tree - The debug tree
 * @param nodeId - The node ID to find
 * @returns The debug tree node if found
 */
export function findDebugTreeNodeById(
  tree: CSTDebugTreeNode[],
  nodeId: string
): CSTDebugTreeNode | undefined {
  for (const node of tree) {
    if (node.id === nodeId) {
      return node;
    }
    if (node.children) {
      const found = findDebugTreeNodeById(node.children, nodeId);
      if (found) return found;
    }
  }
  return undefined;
}

/**
 * Get all node IDs that have errors (for auto-expansion)
 * @param tree - The debug tree
 * @returns Array of node IDs that have errors
 */
export function getErrorNodeIds(tree: CSTDebugTreeNode[]): string[] {
  const errorIds: string[] = [];

  const traverse = (nodes: CSTDebugTreeNode[]) => {
    for (const node of nodes) {
      if (node.data.hasError) {
        errorIds.push(node.id);
      }
      if (node.children) {
        traverse(node.children);
      }
    }
  };

  traverse(tree);
  return errorIds;
}

/**
 * Find the CST node at a specific cursor position
 * Returns the smallest (most specific) node that contains the position
 * @param tree - The debug tree
 * @param line - 0-based line number
 * @param character - 0-based character number
 * @returns The most specific node at that position, or undefined
 */
export function findNodeAtPosition(
  tree: CSTDebugTreeNode[],
  line: number,
  character: number
): CSTDebugTreeNode | undefined {
  let bestMatch: CSTDebugTreeNode | undefined = undefined;

  const traverse = (nodes: CSTDebugTreeNode[]) => {
    for (const node of nodes) {
      const { range } = node.data;

      // Check if position is within this node's range
      const afterStart =
        line > range.start.line ||
        (line === range.start.line && character >= range.start.character);
      const beforeEnd =
        line < range.end.line ||
        (line === range.end.line && character <= range.end.character);

      if (afterStart && beforeEnd) {
        // This node contains the position
        // Update bestMatch (will be overwritten by more specific children)
        bestMatch = node;

        // Continue searching children for a more specific match
        if (node.children) {
          traverse(node.children);
        }
      }
    }
  };

  traverse(tree);
  return bestMatch;
}

/**
 * Get the path of node IDs from root to a specific node
 * Used for expanding only the necessary parent nodes
 * @param tree - The debug tree
 * @param targetNodeId - The node ID to find the path to
 * @returns Array of node IDs representing the path (e.g., ['0', '0-1', '0-1-3'])
 */
// ---------------------------------------------------------------------------
// TreeView conversion — shared between Script and Component pages
// ---------------------------------------------------------------------------

export interface CSTTreeViewNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    [key: string]: unknown;
  };
  children?: CSTTreeViewNode[];
}

/**
 * Convert a CSTDebugTreeNode to the TreeView component's expected format.
 */
export function convertCstToTreeViewNode(
  node: CSTDebugTreeNode
): CSTTreeViewNode {
  let mainLabel = node.data.fieldName
    ? `${node.data.fieldName}: ${node.data.cstNodeType}`
    : node.data.cstNodeType;
  if (node.data.hasError) mainLabel += ' [error]';
  if (node.data.isMissing) mainLabel += ' [missing]';

  const text = node.data.text;
  const secondaryLabel = text
    ? text.length > 50
      ? text.split('\n')[0].trim().slice(0, 50) + '...'
      : text.split('\n')[0].trim()
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
      range: node.data.range,
    },
    children: node.children?.map(convertCstToTreeViewNode),
  };
}

export function getPathToNode(
  tree: CSTDebugTreeNode[],
  targetNodeId: string
): string[] {
  const path: string[] = [];

  const traverse = (
    nodes: CSTDebugTreeNode[],
    currentPath: string[]
  ): boolean => {
    for (const node of nodes) {
      const newPath = [...currentPath, node.id];

      if (node.id === targetNodeId) {
        // Found the target node
        path.push(...newPath);
        return true;
      }

      if (node.children) {
        if (traverse(node.children, newPath)) {
          return true;
        }
      }
    }
    return false;
  };

  traverse(tree, []);
  return path;
}
