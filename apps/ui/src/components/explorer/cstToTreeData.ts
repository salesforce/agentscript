/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CSTNode } from '~/lib/cst-helpers';
import {
  extractAllTopLevelBlocks,
  type CSTGenericBlockData,
} from '~/lib/cst-builder-queries';
import {
  findChildrenByType,
  getNodeText,
  findChildByFieldName,
} from '~/lib/cst-helpers';
import type { SerializedNode } from '~/store/source';

export interface TreeNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    isStartAgent?: boolean;
    blockData?: CSTGenericBlockData;
    // CST debug fields (for CST debug tree)
    cstNodeType?: string;
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    fieldName?: string;
    isNamed?: boolean;
    hasError?: boolean;
    isMissing?: boolean;
    text?: string;
    positionLabel?: string;
  };
  children?: TreeNode[];
}

/**
 * Convert CST to tree data structure
 * - Top-level blocks become root nodes
 * - Blocks with identifiers (topic, connection) can have children
 * - start_agent blocks are grouped under topics
 */

// Type for CST input - can be SerializedNode or CSTNode
type CSTInput = CSTNode | SerializedNode;

export function cstToTreeData(cst: CSTInput): TreeNode[] {
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

  // Extract all top-level blocks
  const allBlocks = extractAllTopLevelBlocks(rootNode);

  // Group blocks by type
  const topicBlocks: CSTGenericBlockData[] = [];
  const connectionBlocks: CSTGenericBlockData[] = [];
  const otherBlocks: CSTGenericBlockData[] = [];

  allBlocks.forEach(block => {
    if (block.type === 'topic' || block.type === 'start_agent') {
      topicBlocks.push(block);
    } else if (block.type === 'connection') {
      connectionBlocks.push(block);
    } else {
      otherBlocks.push(block);
    }
  });

  const treeNodes: TreeNode[] = [];

  // Add single blocks first (system, config, variables, etc.)
  otherBlocks.forEach(block => {
    treeNodes.push({
      id: `${block.type}-${block.name}`,
      data: {
        label: block.displayLabel,
        blockType: block.type,
        blockData: block,
      },
    });
  });

  // Add topics group if there are topics
  if (topicBlocks.length > 0) {
    const topicChildren: TreeNode[] = topicBlocks.map(block => {
      const children: TreeNode[] = [];

      // If this topic has nested blocks, add them as children
      if (block.blockCST) {
        const nestedBlocks = findChildrenByType(block.blockCST, 'block');
        nestedBlocks.forEach(nested => {
          const nestedKey =
            getNodeText(findChildByFieldName(nested, 'key')) || 'unknown';
          const nestedType =
            getNodeText(findChildByFieldName(nested, 'type')) || nestedKey;

          // Special handling for actions block - extract individual actions
          if (nestedKey === 'actions') {
            const actionBlocks = findChildrenByType(nested, 'block');
            actionBlocks.forEach(actionBlock => {
              const actionKey =
                getNodeText(findChildByFieldName(actionBlock, 'key')) ||
                'unknown';
              const actionType =
                getNodeText(findChildByFieldName(actionBlock, 'type')) ||
                actionKey;

              children.push({
                id: `${block.name}-action-${actionKey}`,
                data: {
                  label: toDisplayLabel(actionKey),
                  blockType: 'actions',
                  blockData: {
                    type: actionType,
                    name: actionKey,
                    displayLabel: toDisplayLabel(actionKey),
                    range: actionBlock.range,
                  },
                },
              });
            });
          }
          // Don't include certain nested blocks in the tree (like reasoning, system, etc.)
          else if (
            ![
              'reasoning',
              'system',
              'before_reasoning',
              'after_reasoning',
              'reasoning_actions',
            ].includes(nestedKey)
          ) {
            children.push({
              id: `${block.name}-${nestedType}-${nestedKey}`,
              data: {
                label: toDisplayLabel(nestedKey),
                blockType: nestedType,
                blockData: {
                  type: nestedType,
                  name: nestedKey,
                  displayLabel: toDisplayLabel(nestedKey),
                  range: nested.range,
                },
              },
            });
          }
        });
      }

      return {
        id: `${block.type}-${block.name}`,
        data: {
          label: block.displayLabel,
          blockType: block.type,
          isStartAgent: block.isStartAgent,
          blockData: block,
        },
        children: children.length > 0 ? children : undefined,
      };
    });

    treeNodes.push({
      id: 'topics-group',
      data: {
        label: 'Topics',
        blockType: 'group',
        blockData: {
          type: 'group',
          name: 'topics',
          displayLabel: 'Topics',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      },
      children: topicChildren,
    });
  }

  // Add connections group if there are connections
  if (connectionBlocks.length > 0) {
    const connectionChildren: TreeNode[] = connectionBlocks.map(block => {
      const children: TreeNode[] = [];

      // If this connection has nested blocks, add them as children
      if (block.blockCST) {
        const nestedBlocks = findChildrenByType(block.blockCST, 'block');
        nestedBlocks.forEach(nested => {
          const nestedKey =
            getNodeText(findChildByFieldName(nested, 'key')) || 'unknown';
          const nestedType =
            getNodeText(findChildByFieldName(nested, 'type')) || nestedKey;

          children.push({
            id: `${block.name}-${nestedType}-${nestedKey}`,
            data: {
              label: toDisplayLabel(nestedKey),
              blockType: nestedType,
              blockData: {
                type: nestedType,
                name: nestedKey,
                displayLabel: toDisplayLabel(nestedKey),
                range: nested.range,
              },
            },
          });
        });
      }

      return {
        id: `${block.type}-${block.name}`,
        data: {
          label: block.displayLabel,
          blockType: block.type,
          blockData: block,
        },
        children: children.length > 0 ? children : undefined,
      };
    });

    treeNodes.push({
      id: 'connections-group',
      data: {
        label: 'Connections',
        blockType: 'group',
        blockData: {
          type: 'group',
          name: 'connections',
          displayLabel: 'Connections',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      },
      children: connectionChildren,
    });
  }

  return treeNodes;
}

// Helper to convert name to display label
function toDisplayLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
