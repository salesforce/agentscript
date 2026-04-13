/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * AST to Tree Data Transformer
 * Converts AgentScript AST to tree data structure for Explorer panel
 *
 * Our dialect uses Maps for named blocks (topics, connections, start_agent)
 * and has position info in __cst.range
 */

import { isNamedMap } from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';

export interface TreeNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    isStartAgent?: boolean;
    // Position info for editor navigation (0-based)
    startPosition?: { row: number; column: number };
    endPosition?: { row: number; column: number };
    // Reference to the AST block for detailed rendering
    astBlock?: unknown;
  };
  children?: TreeNode[];
}

// Interface for CST node with parent navigation
interface CstNode {
  type: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  parent: CstNode | null;
}

// Interface for blocks with __cst metadata
interface BlockWithCst {
  __cst?: {
    node: CstNode;
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  __kind?: string;
  __name?: string;
  label?: { value: string; __kind: string };
  actions?: Map<string, BlockWithCst>;
}

/**
 * Helper to convert name to display label (my_topic -> My Topic)
 */
function toDisplayLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract position from block's __cst
 * The __cst.node might be the mapping content, so we navigate to parent block
 * to get the header line position (e.g., "topic foo:" instead of its content)
 */
function extractPosition(block: BlockWithCst | undefined): {
  startPosition?: { row: number; column: number };
  endPosition?: { row: number; column: number };
} {
  const cst = block?.__cst;
  if (!cst) return {};

  // Navigate to parent node to get header line, not content
  // - Top-level blocks (topic, connection): parent type is 'block'
  // - Nested named blocks (actions): parent type is 'mapping_element'
  let node = cst.node;
  if (
    node?.parent?.type === 'block' ||
    node?.parent?.type === 'mapping_element'
  ) {
    node = node.parent;
  }

  if (node?.startPosition && node?.endPosition) {
    return {
      startPosition: {
        row: node.startRow,
        column: node.startCol,
      },
      endPosition: {
        row: node.endRow,
        column: node.endCol,
      },
    };
  }

  // Fallback to range if node navigation doesn't work
  const range = cst.range;
  return {
    startPosition: { row: range.start.line, column: range.start.character },
    endPosition: { row: range.end.line, column: range.end.character },
  };
}

/**
 * Extract action children from a topic/start_agent block
 * Actions are stored as a NamedMap (Map<string, ActionBlock>)
 */
function extractActions(topicName: string, block: BlockWithCst): TreeNode[] {
  const actions = block.actions;
  if (!actions || !isNamedMap(actions)) return [];

  const children: TreeNode[] = [];
  for (const [actionName, entry] of actions) {
    const actionBlock = entry as BlockWithCst;
    children.push({
      id: `${topicName}-action-${actionName}`,
      data: {
        label: toDisplayLabel(actionName),
        blockType: 'actions',
        ...extractPosition(actionBlock),
        astBlock: actionBlock,
      },
    });
  }
  return children;
}

/**
 * Convert AST to tree data structure for Explorer panel
 * - Top-level blocks become root nodes
 * - Topics and connections can have children (actions)
 * - Invalid blocks (those that failed AST validation) won't appear
 */
export function astToTreeData(ast: AgentScriptAST | null): TreeNode[] {
  if (!ast) {
    return [];
  }

  const treeNodes: TreeNode[] = [];

  // Add singleton blocks (system, config, variables, language, knowledge)
  if (ast.system) {
    treeNodes.push({
      id: 'system',
      data: {
        label: 'System',
        blockType: 'system',
        ...extractPosition(ast.system as BlockWithCst),
        astBlock: ast.system,
      },
    });
  }

  if (ast.config) {
    treeNodes.push({
      id: 'config',
      data: {
        label: 'Config',
        blockType: 'config',
        ...extractPosition(ast.config as BlockWithCst),
        astBlock: ast.config,
      },
    });
  }

  if (ast.variables) {
    treeNodes.push({
      id: 'variables',
      data: {
        label: 'Variables',
        blockType: 'variables',
        ...extractPosition(ast.variables as unknown as BlockWithCst),
        astBlock: ast.variables,
      },
    });
  }

  if (ast.language) {
    treeNodes.push({
      id: 'language',
      data: {
        label: 'Language',
        blockType: 'language',
        ...extractPosition(ast.language as BlockWithCst),
        astBlock: ast.language,
      },
    });
  }

  if (ast.knowledge) {
    treeNodes.push({
      id: 'knowledge',
      data: {
        label: 'Knowledge',
        blockType: 'knowledge',
        ...extractPosition(ast.knowledge as BlockWithCst),
        astBlock: ast.knowledge,
      },
    });
  }

  // Group topics (including start_agent) in __children order (document order)
  const topicChildren: TreeNode[] = [];

  const astWithChildren = ast as unknown as {
    __children?: Array<{
      __type: string;
      key?: string;
      entryName?: string;
      value?: unknown;
    }>;
  };

  if (astWithChildren.__children) {
    for (const child of astWithChildren.__children) {
      if (child.__type !== 'field') continue;
      const blockType = child.key;
      if (
        blockType !== 'topic' &&
        blockType !== 'start_agent' &&
        blockType !== 'subagent'
      )
        continue;

      const name = child.entryName;
      if (!name) continue;

      const typedBlock = child.value as BlockWithCst;
      if (!typedBlock) continue;

      const children = extractActions(name, typedBlock);
      topicChildren.push({
        id: `${blockType}-${name}`,
        data: {
          label: typedBlock.label?.value ?? toDisplayLabel(name),
          blockType,
          ...(blockType === 'start_agent' ? { isStartAgent: true } : {}),
          ...extractPosition(typedBlock),
          astBlock: typedBlock,
        },
        children: children.length > 0 ? children : undefined,
      });
    }
  }

  if (topicChildren.length > 0) {
    treeNodes.push({
      id: 'topics-group',
      data: {
        label: 'Topics',
        blockType: 'group',
      },
      children: topicChildren,
    });
  }

  // Group connected agents (Map<string, ConnectedSubagentBlockInstance>)
  if (
    ast.connected_subagent &&
    isNamedMap(ast.connected_subagent) &&
    ast.connected_subagent.size > 0
  ) {
    const connectedAgentChildren: TreeNode[] = [];
    for (const [name, block] of ast.connected_subagent) {
      connectedAgentChildren.push({
        id: `connected_subagent-${name}`,
        data: {
          label: toDisplayLabel(name),
          blockType: 'connected_subagent',
          ...extractPosition(block as BlockWithCst),
          astBlock: block,
        },
      });
    }

    treeNodes.push({
      id: 'connected-agents-group',
      data: {
        label: 'Connected Agents',
        blockType: 'group',
      },
      children: connectedAgentChildren,
    });
  }

  // Group connections (Map<string, ConnectionBlockInstance>)
  if (ast.connection && isNamedMap(ast.connection) && ast.connection.size > 0) {
    const connectionChildren: TreeNode[] = [];
    for (const [name, block] of ast.connection) {
      connectionChildren.push({
        id: `connection-${name}`,
        data: {
          label: toDisplayLabel(name),
          blockType: 'connection',
          ...extractPosition(block as BlockWithCst),
          astBlock: block,
        },
      });
    }

    treeNodes.push({
      id: 'connections-group',
      data: {
        label: 'Connections',
        blockType: 'group',
      },
      children: connectionChildren,
    });
  }

  return treeNodes;
}

/**
 * Convert a node ID to a URL-friendly path for builder routes.
 *   topic-main              → topic/main
 *   start_agent-main        → start_agent/main
 *   escalation-action-Create_Case → escalation/action/Create_Case
 *   connection-xyz          → connection/xyz
 *   system                  → system  (singletons pass through)
 */
export function nodeIdToBuilderPath(nodeId: string): string {
  if (nodeId.includes('-action-')) {
    const [topicName, actionName] = nodeId.split('-action-');
    return `${topicName}/action/${actionName}`;
  }

  const prefixes = [
    'topic-',
    'start_agent-',
    'connection-',
    'connected_subagent-',
  ];
  for (const prefix of prefixes) {
    if (nodeId.startsWith(prefix)) {
      const type = prefix.slice(0, -1); // drop trailing '-'
      const name = nodeId.slice(prefix.length);
      return `${type}/${name}`;
    }
  }

  return nodeId;
}

/**
 * Find a node by ID in the tree data
 */
export function findTreeNodeById(
  nodes: TreeNode[],
  id: string
): TreeNode | undefined {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.children) {
      const found = findTreeNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}
