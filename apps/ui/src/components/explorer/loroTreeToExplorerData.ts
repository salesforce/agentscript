/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Loro CST to Explorer Tree Data Transformer
 *
 * Converts the CST (AgentScriptNode) from LoroCSTContext to tree data
 * structure for the Explorer panel.
 *
 * Key differences from astToTreeData:
 * - Driven by CST structure, not validated AST
 * - Always shows all singleton blocks (even if not in document)
 * - Works even when parsing has errors (uses last good Loro state)
 */

// CST node types (used for generic CST)
interface AgentScriptNode {
  type: string;
  fieldName?: string;
  content?: string;
  text?: string;
  children: AgentScriptNode[];
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

const getSingletonBlockTypes = () => [
  { type: 'system', label: 'System' },
  { type: 'config', label: 'Config' },
  { type: 'variables', label: 'Variables' },
  { type: 'actions', label: 'Actions' },
];
const getExplorerGroups = () =>
  [] as Array<{
    group: string;
    label: string;
    blockTypes: Array<{ type: string }>;
  }>;

export interface TreeNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    isStartAgent?: boolean;
    // For nested items (like actions), the parent block type and name
    parentType?: string;
    parentName?: string;
    // Position info for editor navigation
    startPosition?: { row: number; column: number };
    endPosition?: { row: number; column: number };
    // Reference to the CST node
    cstNode?: AgentScriptNode;
  };
  children?: TreeNode[];
}

/**
 * Get singleton block types from the schema-constraints (single source of truth)
 */
const SINGLETON_BLOCKS = getSingletonBlockTypes();

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
 * Get text content from a node (for leaf nodes)
 */
function getNodeContent(node: AgentScriptNode): string {
  return node.content ?? node.text ?? '';
}

/**
 * Find a child node by field name
 */
function findChildByField(
  node: AgentScriptNode,
  fieldName: string
): AgentScriptNode | null {
  for (const child of node.children) {
    if (child.fieldName === fieldName) {
      return child;
    }
  }
  return null;
}

/**
 * Find all children by type
 */
function findChildrenByType(
  node: AgentScriptNode,
  type: string
): AgentScriptNode[] {
  return node.children.filter(child => child.type === type);
}

/**
 * Extract block type from a block node
 * The block_type child contains the type (e.g., "topic", "start_agent")
 */
function getBlockType(blockNode: AgentScriptNode): string | null {
  // First, look for block_type field
  const blockTypeNode = findChildByField(blockNode, 'type');
  if (blockTypeNode) {
    const content = getNodeContent(blockTypeNode);
    if (content) return content;

    // Or check its children for identifier
    for (const child of blockTypeNode.children) {
      if (child.type === 'identifier') {
        const text = getNodeContent(child);
        if (text) return text;
      }
    }
  }

  // Fallback: look for block_type node by type (not field name)
  for (const child of blockNode.children) {
    if (child.type === 'block_type') {
      const content = getNodeContent(child);
      if (content) return content;
    }
  }

  // If no explicit block_type, the first identifier might be the block key (singleton)
  return null;
}

/**
 * Extract block name/key from a block node
 * The key field contains the block name
 */
function getBlockName(blockNode: AgentScriptNode): string | null {
  // Look for key field
  const keyNode = findChildByField(blockNode, 'key');
  if (keyNode) {
    const content = getNodeContent(keyNode);
    if (content) return content;
  }

  // Fallback: look for first identifier that's not block_type
  for (const child of blockNode.children) {
    if (child.type === 'identifier' && child.fieldName !== 'type') {
      const content = getNodeContent(child);
      if (content) return content;
    }
  }

  return null;
}

interface BlockInfo {
  type: string;
  name: string;
  displayLabel: string;
  isStartAgent: boolean;
  cstNode: AgentScriptNode;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

/**
 * Extract all top-level blocks from the CST
 */
function extractTopLevelBlocks(cst: AgentScriptNode): BlockInfo[] {
  const blocks: BlockInfo[] = [];

  // Source file children should be blocks
  for (const child of cst.children) {
    if (child.type === 'block') {
      const blockType = getBlockType(child);
      const blockName = getBlockName(child);

      // Skip if we couldn't determine the block info
      if (!blockName) continue;

      // Determine the actual type (use blockName as type for singletons)
      const actualType = blockType || blockName;
      const isStartAgent = actualType === 'start_agent';

      blocks.push({
        type: actualType,
        name: blockName,
        displayLabel: toDisplayLabel(blockName),
        isStartAgent,
        cstNode: child,
        startPosition: child.startPosition,
        endPosition: child.endPosition,
      });
    }
  }

  return blocks;
}

/**
 * Extract actions from a topic's actions block
 */
function extractActionsFromTopic(topicNode: AgentScriptNode): TreeNode[] {
  const actionNodes: TreeNode[] = [];

  // Find the actions block within the topic
  const nestedBlocks = findChildrenByType(topicNode, 'block');
  for (const nested of nestedBlocks) {
    const nestedName = getBlockName(nested);
    if (nestedName === 'actions') {
      // Find all action blocks within the actions block
      const actionBlocks = findChildrenByType(nested, 'block');
      for (const actionBlock of actionBlocks) {
        const actionName = getBlockName(actionBlock);
        if (actionName) {
          actionNodes.push({
            id: `action-${actionName}`, // Temp ID, will be prefixed with topic name
            data: {
              label: toDisplayLabel(actionName),
              blockType: 'actions',
              startPosition: actionBlock.startPosition,
              endPosition: actionBlock.endPosition,
              cstNode: actionBlock,
            },
          });
        }
      }
    }
  }

  return actionNodes;
}

/**
 * Convert CST (from LoroCSTContext) to tree data structure for Explorer panel
 *
 * - Always includes all singleton blocks (system, config, variables, language, knowledge)
 * - Groups topics under "Topics" folder
 * - Groups connections under "Connections" folder
 * - Extracts actions as children of topics
 */
export function loroTreeToExplorerData(
  cst: AgentScriptNode | null
): TreeNode[] {
  const treeNodes: TreeNode[] = [];

  // Extract existing blocks from CST
  const existingBlocks = cst ? extractTopLevelBlocks(cst) : [];
  const existingBlocksByType = new Map<string, BlockInfo>();

  for (const block of existingBlocks) {
    // For singletons, key by type; for others, key by type-name
    const key =
      SINGLETON_BLOCKS.some(s => s.type === block.type) ||
      block.type === block.name
        ? block.type
        : `${block.type}-${block.name}`;
    existingBlocksByType.set(key, block);
  }

  // 1. Always add all singleton blocks (even if not in document)
  for (const singleton of SINGLETON_BLOCKS) {
    const existingBlock = existingBlocksByType.get(singleton.type);

    treeNodes.push({
      id: singleton.type,
      data: {
        label: singleton.label,
        blockType: singleton.type,
        startPosition: existingBlock?.startPosition,
        endPosition: existingBlock?.endPosition,
        cstNode: existingBlock?.cstNode,
      },
    });
  }

  // 2. Add all explorer groups (topics, connections, etc.) from the source of truth
  const explorerGroups = getExplorerGroups();

  for (const groupDef of explorerGroups) {
    const groupBlockTypes = groupDef.blockTypes.map(bt => bt.type);

    // Find blocks that belong to this group
    const groupBlocks = existingBlocks.filter(b =>
      groupBlockTypes.includes(b.type as (typeof groupBlockTypes)[number])
    );

    // Build children for this group
    const groupChildren: TreeNode[] = groupBlocks.map(block => {
      // For topics group, extract actions as children
      const isTopicLike = groupDef.group === 'topics';
      let children: TreeNode[] | undefined;

      if (isTopicLike) {
        const actionChildren = extractActionsFromTopic(block.cstNode);
        children =
          actionChildren.length > 0
            ? actionChildren.map(action => ({
                ...action,
                id: `${block.name}-action-${action.data.label.toLowerCase().replace(/ /g, '_')}`,
                data: {
                  ...action.data,
                  // Store parent info for navigation
                  parentType: block.type,
                  parentName: block.name,
                },
              }))
            : undefined;
      }

      // Generate appropriate ID based on block type
      const nodeId =
        block.type === 'connection'
          ? `connection-${block.name}`
          : `${block.type}-${block.name}`;

      return {
        id: nodeId,
        data: {
          label: block.displayLabel,
          blockType: block.type,
          isStartAgent: block.isStartAgent,
          startPosition: block.startPosition,
          endPosition: block.endPosition,
          cstNode: block.cstNode,
        },
        children,
      };
    });

    // Always show the group (even when empty)
    treeNodes.push({
      id: `${groupDef.group}-group`,
      data: {
        label: groupDef.label,
        blockType: 'group',
      },
      children: groupChildren.length > 0 ? groupChildren : undefined,
    });
  }

  return treeNodes;
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
