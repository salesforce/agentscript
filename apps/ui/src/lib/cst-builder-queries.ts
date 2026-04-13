/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * CST Canvas Queries
 * Utilities for extracting canvas-relevant data directly from the CST
 * This allows the canvas to work purely with CST without needing the AST
 */

import type { CSTNode } from './cst-helpers';
import {
  findChildByFieldName,
  findChildByType,
  findChildrenByType,
  getNodeText,
  extractStringValue,
  extractFieldsAsRecord,
} from './cst-helpers';

/**
 * Canvas data structures (CST-derived, not AST)
 */

/**
 * Generic top-level block data
 * Any block at the root level of the CST
 */
export interface CSTGenericBlockData {
  type: string; // The block type (system, config, variables, actions, knowledge, topic, etc.)
  name: string; // The block name/key
  displayLabel: string; // Human-readable label
  isEmpty?: boolean; // For blocks that can be empty
  count?: number; // For blocks that have countable items
  blockCST?: CSTNode; // Raw CST node for the block
  isStartAgent?: boolean; // For topics
  connections?: string[]; // For topics - target topic names
  // Position info for editor mutations
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export interface CSTSystemData {
  type: 'system';
  name: 'system';
  isEmpty: boolean;
  prompt?: string;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTConfigData {
  type: 'config';
  name: 'config';
  isEmpty: boolean;
  fields?: Record<string, unknown>;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTVariablesData {
  type: 'variables';
  name: 'variables';
  isEmpty: boolean;
  count: number;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTKnowledgeData {
  type: 'knowledge';
  name: string;
  displayLabel: string;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTKnowledgeActionData {
  type: 'knowledge_action';
  name: string;
  displayLabel: string;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTLanguageData {
  type: 'language';
  name: string;
  displayLabel: string;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTConnectionData {
  type: 'connection';
  name: string;
  displayLabel: string;
  connectionType?: string;
  blockCST?: CSTNode; // Raw CST node for rendering
}

export interface CSTActionsData {
  type: 'actions';
  name: 'actions';
  isEmpty: boolean;
  count: number;
}

export interface CSTTopicData {
  type: 'topic';
  name: string;
  displayLabel?: string;
  description?: string;
  systemInstructions?: string; // Optional override system.instructions
  systemInstructionsCST?: CSTNode; // CST node for template_content with placeholders
  reasoningInstructions?: string; // reasoning_instructions (full content)
  reasoningInstructionsFormat?: 'pipe' | 'arrow'; // | or ->
  reasoningInstructionsCST?: CSTNode; // For arrow format, the raw CST node structure
  blockCST?: CSTNode; // Raw CST block node for recursive rendering
  isStartAgent: boolean;
  label?: string;
  connections?: string[]; // Names of topics this topic transitions to
  // CST position information for mutations
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  descriptionRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  systemInstructionsRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  reasoningInstructionsRange?: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

export type CSTBlockData =
  | CSTSystemData
  | CSTConfigData
  | CSTVariablesData
  | CSTKnowledgeData
  | CSTKnowledgeActionData
  | CSTLanguageData
  | CSTConnectionData
  | CSTActionsData
  | CSTTopicData;

/**
 * Convert name to display label (my_topic -> My Topic)
 */
function toDisplayLabel(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Extract all top-level blocks from CST (generic approach)
 * This traverses the CST and finds all blocks, creating generic block data
 */
export function extractAllTopLevelBlocks(
  rootNode: CSTNode
): CSTGenericBlockData[] {
  const allBlocks = findChildrenByType(rootNode, 'block');
  const topLevelBlocks: CSTGenericBlockData[] = [];

  allBlocks.forEach(block => {
    const blockKey =
      getNodeText(findChildByFieldName(block, 'key')) || 'unknown';
    const blockType =
      getNodeText(findChildByFieldName(block, 'type')) || blockKey;

    // Count items for blocks with nested fields (variables, actions, etc.)
    const fields = findChildrenByType(block, 'field');
    const nestedBlocks = findChildrenByType(block, 'block');
    const count = fields.length + nestedBlocks.length;
    const isEmpty = count === 0;

    // Check if this is a start agent topic
    const isStartAgent = blockType === 'start_agent';

    // Extract topic connections if applicable
    let connections: string[] | undefined;
    if (blockType === 'topic' || blockType === 'start_agent') {
      connections = extractTopicConnections(block);
    }

    topLevelBlocks.push({
      type: blockType,
      name: blockKey,
      displayLabel: toDisplayLabel(blockKey),
      isEmpty,
      count: count > 0 ? count : undefined,
      blockCST: block,
      isStartAgent,
      connections,
      range: block.range,
    });
  });

  return topLevelBlocks;
}

/**
 * Extract system block data from CST
 */
export function extractSystemData(rootNode: CSTNode): CSTSystemData {
  // Find system block by key
  const allBlocks = findChildrenByType(rootNode, 'block');
  const systemBlock = allBlocks.find(block => {
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockKey === 'system';
  });

  if (!systemBlock) {
    return {
      type: 'system',
      name: 'system',
      isEmpty: true,
    };
  }

  // Try to extract prompt field
  const fields = extractFieldsAsRecord(systemBlock);
  const prompt = fields.prompt;

  return {
    type: 'system',
    name: 'system',
    isEmpty: false,
    prompt: typeof prompt === 'string' ? prompt : undefined,
    blockCST: systemBlock, // Include raw CST node
  };
}

/**
 * Extract config block data from CST
 */
export function extractConfigData(rootNode: CSTNode): CSTConfigData {
  // Find config block by key
  const allBlocks = findChildrenByType(rootNode, 'block');
  const configBlock = allBlocks.find(block => {
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockKey === 'config';
  });

  if (!configBlock) {
    return {
      type: 'config',
      name: 'config',
      isEmpty: true,
    };
  }

  const fields = extractFieldsAsRecord(configBlock);

  return {
    type: 'config',
    name: 'config',
    isEmpty: false,
    fields,
    blockCST: configBlock, // Include raw CST node
  };
}

/**
 * Extract variables block data from CST
 */
export function extractVariablesData(rootNode: CSTNode): CSTVariablesData {
  // Find variables block by key
  const allBlocks = findChildrenByType(rootNode, 'block');
  const variablesBlock = allBlocks.find(block => {
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockKey === 'variables';
  });

  if (!variablesBlock) {
    return {
      type: 'variables',
      name: 'variables',
      isEmpty: true,
      count: 0,
    };
  }

  // Count variable declarations
  const declarations = findChildrenByType(variablesBlock, 'field').filter(
    field => {
      // Check if it has variable_modifier (mutable/linked) to identify variable declarations
      return findChildByType(field, 'variable_modifier') !== undefined;
    }
  );

  return {
    type: 'variables',
    name: 'variables',
    isEmpty: declarations.length === 0,
    count: declarations.length,
    blockCST: variablesBlock, // Include raw CST node
  };
}

/**
 * Extract all knowledge blocks from CST
 */
export function extractKnowledgeBlocks(rootNode: CSTNode): CSTKnowledgeData[] {
  const allBlocks = findChildrenByType(rootNode, 'block');
  const knowledgeBlocks = allBlocks.filter(block => {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockType === 'knowledge' || blockKey === 'knowledge';
  });

  return knowledgeBlocks.map(block => {
    const nameNode = findChildByFieldName(block, 'key');
    const name = getNodeText(nameNode) || 'unknown';

    return {
      type: 'knowledge',
      name,
      displayLabel: toDisplayLabel(name),
      blockCST: block, // Include raw CST node
    };
  });
}

/**
 * Extract all knowledge_action blocks from CST
 */
export function extractKnowledgeActionBlocks(
  rootNode: CSTNode
): CSTKnowledgeActionData[] {
  const allBlocks = findChildrenByType(rootNode, 'block');
  const knowledgeActionBlocks = allBlocks.filter(block => {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockType === 'knowledge_action' || blockKey === 'knowledge_action';
  });

  return knowledgeActionBlocks.map(block => {
    const nameNode = findChildByFieldName(block, 'key');
    const name = getNodeText(nameNode) || 'unknown';

    return {
      type: 'knowledge_action',
      name,
      displayLabel: toDisplayLabel(name),
      blockCST: block, // Include raw CST node
    };
  });
}

/**
 * Extract all language blocks from CST
 */
export function extractLanguageBlocks(rootNode: CSTNode): CSTLanguageData[] {
  const allBlocks = findChildrenByType(rootNode, 'block');
  const languageBlocks = allBlocks.filter(block => {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockType === 'language' || blockKey === 'language';
  });

  return languageBlocks.map(block => {
    const nameNode = findChildByFieldName(block, 'key');
    const name = getNodeText(nameNode) || 'unknown';

    return {
      type: 'language',
      name,
      displayLabel: toDisplayLabel(name),
      blockCST: block, // Include raw CST node
    };
  });
}

/**
 * Extract all connection blocks from CST
 */
export function extractConnectionBlocks(
  rootNode: CSTNode
): CSTConnectionData[] {
  const allBlocks = findChildrenByType(rootNode, 'block');
  const connectionBlocks = allBlocks.filter(block => {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockType === 'connection' || blockKey === 'connection';
  });

  return connectionBlocks.map(block => {
    const nameNode = findChildByFieldName(block, 'key');
    const name = getNodeText(nameNode) || 'unknown';

    // Try to extract connection type
    const fields = extractFieldsAsRecord(block);
    const connectionType = fields.type || fields.connection_type;

    return {
      type: 'connection',
      name,
      displayLabel: toDisplayLabel(name),
      connectionType:
        typeof connectionType === 'string' ? connectionType : undefined,
      blockCST: block, // Include raw CST node
    };
  });
}

/**
 * Extract actions block data from CST
 */
export function extractActionsData(rootNode: CSTNode): CSTActionsData {
  // Find actions block by key
  const allBlocks = findChildrenByType(rootNode, 'block');
  const actionsBlock = allBlocks.find(block => {
    const blockKey = getNodeText(findChildByFieldName(block, 'key'));
    return blockKey === 'actions';
  });

  if (!actionsBlock) {
    return {
      type: 'actions',
      name: 'actions',
      isEmpty: true,
      count: 0,
    };
  }

  // Count action definitions (nested blocks within actions block)
  const actions = findChildrenByType(actionsBlock, 'block');

  return {
    type: 'actions',
    name: 'actions',
    isEmpty: actions.length === 0,
    count: actions.length,
  };
}

/**
 * Extract action names from the reasoning.actions block in CST
 * Actions are defined in reasoning.actions within each topic/start_agent block
 * This searches all topics to collect all unique action names
 */
export function extractActionNames(rootNode: CSTNode): string[] {
  // console.log('[CST] extractActionNames called');

  const allActionNames = new Set<string>();

  // Find all blocks at root level
  const allBlocks = findChildrenByType(rootNode, 'block');
  // console.log('[CST] Found root blocks:', allBlocks.length);

  // Search each topic/start_agent block for reasoning.actions
  for (const block of allBlocks) {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));

    // Only check topic and start_agent blocks
    if (blockType === 'topic' || blockType === 'start_agent') {
      // Find reasoning block within this topic
      const nestedBlocks = findChildrenByType(block, 'block');
      const reasoningBlock = nestedBlocks.find(b => {
        const key = getNodeText(findChildByFieldName(b, 'key'));
        return key === 'reasoning';
      });

      if (reasoningBlock) {
        // Find actions block within reasoning
        const reasoningNestedBlocks = findChildrenByType(
          reasoningBlock,
          'block'
        );
        const actionsBlock = reasoningNestedBlocks.find(b => {
          const key = getNodeText(findChildByFieldName(b, 'key'));
          return key === 'actions';
        });

        if (actionsBlock) {
          // console.log(`[CST] Found actions in topic "${blockKey}"`);
          // Extract action names
          const actionBlocks = findChildrenByType(actionsBlock, 'block');
          actionBlocks.forEach(actionBlock => {
            const keyNode = findChildByFieldName(actionBlock, 'key');
            const actionName = getNodeText(keyNode);
            if (actionName) {
              allActionNames.add(actionName);
            }
          });
        }
      }
    }
  }

  const actionNames = Array.from(allActionNames);
  // console.log('[CST] Final action names:', actionNames);
  return actionNames;
}

/**
 * Extract system.instructions from a topic/start_agent block
 * Looks for a system: block with instructions: field inside
 */
function extractSystemInstructionsFromBlock(block: CSTNode): {
  systemInstructions?: string;
  systemInstructionsCST?: CSTNode;
  systemInstructionsRange?: CSTTopicData['systemInstructionsRange'];
} {
  // Look for "system" block
  if (!block.children) {
    return {};
  }

  for (const child of block.children) {
    if (child.type === 'block') {
      const blockKey = getNodeText(findChildByFieldName(child, 'key'));

      if (blockKey === 'system') {
        // Now look for instructions: field inside the system block
        if (!child.children) continue;

        for (const innerChild of child.children) {
          if (innerChild.type === 'field') {
            const fieldName = getNodeText(
              findChildByFieldName(innerChild, 'name')
            );

            if (fieldName === 'instructions') {
              // Check if this is arrow format (->)
              const hasArrow = innerChild.children?.some(
                c => c.type === 'ARROW'
              );

              if (hasArrow) {
                // Arrow format: return the field node itself as it contains the statements
                const systemInstructions = innerChild.text || '';

                return {
                  systemInstructions,
                  systemInstructionsCST: innerChild, // Return field node for arrow format
                  systemInstructionsRange: innerChild.range,
                };
              } else {
                // Pipe format: look for template_content or multi_line_string with template node
                let valueNode = innerChild.children?.find(
                  c => c.type === 'template_content'
                );

                // If not found, check for multi_line_string that contains a template
                if (!valueNode) {
                  const multiLineNode = innerChild.children?.find(
                    c => c.type === 'multi_line_string'
                  );
                  if (multiLineNode) {
                    // Check if multi_line_string has a template child with template_content
                    const templateNode = multiLineNode.children?.find(
                      c => c.type === 'template'
                    );
                    if (templateNode) {
                      valueNode =
                        templateNode.children?.find(
                          c => c.type === 'template_content'
                        ) || templateNode;
                    } else {
                      valueNode = multiLineNode;
                    }
                  }
                }

                // Fallback to any value node
                valueNode =
                  valueNode || findChildByFieldName(innerChild, 'value');

                // For multi-line content with |, use text directly
                const systemInstructions =
                  valueNode?.text || extractStringValue(valueNode);

                // console.log('[CST] System instructions extraction:', {
                //   nodeType: valueNode?.type,
                //   hasChildren: !!valueNode?.children,
                //   childTypes: valueNode?.children?.map((c: any) => c.type),
                //   text: systemInstructions?.substring(0, 100),
                // });

                return {
                  systemInstructions,
                  systemInstructionsCST: valueNode || undefined, // Return CST node for placeholder rendering
                  systemInstructionsRange: valueNode?.range,
                };
              }
            }
          }
        }
      }
    }
  }

  return {};
}

/**
 * Extract reasoning.instructions from a topic/start_agent block
 * Looks for a reasoning: block with instructions: field inside
 */
function extractReasoningInstructionsFromBlock(block: CSTNode): {
  reasoningInstructions?: string;
  reasoningInstructionsFormat?: 'pipe' | 'arrow';
  reasoningInstructionsCST?: CSTNode;
  reasoningInstructionsRange?: CSTTopicData['reasoningInstructionsRange'];
} {
  // Look for "reasoning" block
  if (!block.children) {
    return {};
  }

  for (const child of block.children) {
    if (child.type === 'block') {
      const blockKey = getNodeText(findChildByFieldName(child, 'key'));

      if (blockKey === 'reasoning') {
        if (!child.children) continue;

        for (const innerChild of child.children) {
          // Handle field-based instructions (arrow ->)
          if (innerChild.type === 'field') {
            const fieldName = getNodeText(
              findChildByFieldName(innerChild, 'name')
            );

            if (fieldName === 'instructions') {
              // For -> format, pass the raw CST node for recursive rendering
              const reasoningInstructions = innerChild.text;

              return {
                reasoningInstructions,
                reasoningInstructionsFormat: 'arrow',
                reasoningInstructionsCST: innerChild, // Pass the entire field node
                reasoningInstructionsRange: innerChild?.range,
              };
            }
          }

          // Handle block-based instructions (pipe |)
          if (innerChild.type === 'block') {
            const innerBlockKey = getNodeText(
              findChildByFieldName(innerChild, 'key')
            );

            if (innerBlockKey === 'instructions') {
              // Look for template_content in the instructions block
              const multiLineNode = innerChild.children?.find(
                c =>
                  c.type === 'template_content' ||
                  c.type === 'multi_line_string' ||
                  c.type === 'template'
              );

              const valueNode =
                multiLineNode || findChildByFieldName(innerChild, 'value');

              const reasoningInstructions =
                valueNode?.text || extractStringValue(valueNode);

              return {
                reasoningInstructions,
                reasoningInstructionsFormat: 'pipe',
                reasoningInstructionsRange: valueNode?.range,
              };
            }
          }
        }
      }
    }
  }

  return {};
}

/**
 * Extract description from a topic/start_agent block
 */
function extractDescriptionFromBlock(block: CSTNode): {
  description?: string;
  descriptionRange?: CSTTopicData['descriptionRange'];
} {
  // Look for a "description" field in the block
  if (!block.children) {
    return {};
  }

  for (const child of block.children) {
    if (child.type === 'field') {
      const nameNode = findChildByFieldName(child, 'name');
      const name = getNodeText(nameNode);

      if (name === 'description') {
        const valueNode = findChildByFieldName(child, 'value');
        const description = extractStringValue(valueNode);

        return {
          description,
          descriptionRange: valueNode?.range,
        };
      }
    }
  }

  return {};
}

/**
 * Extract label from a topic/start_agent block
 */
function extractLabelFromBlock(block: CSTNode): string | undefined {
  const fields = extractFieldsAsRecord(block);
  const label = fields.label;
  return typeof label === 'string' ? label : undefined;
}

/**
 * Extract topic transitions from a block's reasoning sections
 * Looks for @topic.{name} references in reasoning_actions, before_reasoning, after_reasoning
 */
function extractTopicConnections(block: CSTNode): string[] {
  const connections = new Set<string>();

  if (!block.children) {
    return [];
  }

  // Find blocks named reasoning_actions, before_reasoning, after_reasoning, reasoning
  const relevantBlocks = block.children.filter(child => {
    if (child.type === 'block') {
      const blockKey = getNodeText(findChildByFieldName(child, 'key'));
      return [
        'reasoning_actions',
        'before_reasoning',
        'after_reasoning',
        'reasoning',
      ].includes(blockKey || '');
    }
    return false;
  });

  // Extract all text from these blocks and find @topic.{name} references
  for (const relevantBlock of relevantBlocks) {
    const text = relevantBlock.text || '';

    // Regex to match @topic.{name}
    const topicRegex = /@topic\.([a-zA-Z_][a-zA-Z0-9_]*)/g;
    let match;

    while ((match = topicRegex.exec(text)) !== null) {
      connections.add(match[1]);
    }
  }

  return Array.from(connections);
}

/**
 * Extract all topic blocks from CST
 */
export function extractTopicBlocks(rootNode: CSTNode): CSTTopicData[] {
  const topics: CSTTopicData[] = [];

  // Find all block nodes
  const allBlocks = findChildrenByType(rootNode, 'block');

  for (const block of allBlocks) {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));

    // Check if it's a topic or start_agent block
    if (blockType === 'topic' || blockType === 'start_agent') {
      const nameNode = findChildByFieldName(block, 'key');
      const name = getNodeText(nameNode) || 'unknown';

      const { description, descriptionRange } =
        extractDescriptionFromBlock(block);
      const {
        systemInstructions,
        systemInstructionsCST,
        systemInstructionsRange,
      } = extractSystemInstructionsFromBlock(block);
      const { reasoningInstructions, reasoningInstructionsRange } =
        extractReasoningInstructionsFromBlock(block);
      const label = extractLabelFromBlock(block);
      const connections = extractTopicConnections(block);

      topics.push({
        type: 'topic',
        name,
        displayLabel: label || toDisplayLabel(name),
        description,
        systemInstructions,
        systemInstructionsCST,
        reasoningInstructions,
        blockCST: block, // Include raw block CST
        label,
        isStartAgent: blockType === 'start_agent',
        connections: connections.length > 0 ? connections : undefined,
        range: block.range,
        descriptionRange,
        systemInstructionsRange,
        reasoningInstructionsRange,
      });
    }
  }

  return topics;
}

/**
 * Find a specific topic by name from CST
 */
export function findTopicByName(
  rootNode: CSTNode,
  topicName: string
): CSTTopicData | null {
  // Find all block nodes
  const allBlocks = findChildrenByType(rootNode, 'block');

  for (const block of allBlocks) {
    const blockType = getNodeText(findChildByFieldName(block, 'type'));

    // Check if it's a topic or start_agent block
    if (blockType === 'topic' || blockType === 'start_agent') {
      const nameNode = findChildByFieldName(block, 'key');
      const name = getNodeText(nameNode) || 'unknown';

      // Only extract data if this is the topic we're looking for
      if (name === topicName) {
        const { description, descriptionRange } =
          extractDescriptionFromBlock(block);
        const {
          systemInstructions,
          systemInstructionsCST,
          systemInstructionsRange,
        } = extractSystemInstructionsFromBlock(block);
        const {
          reasoningInstructions,
          reasoningInstructionsFormat,
          reasoningInstructionsCST,
          reasoningInstructionsRange,
        } = extractReasoningInstructionsFromBlock(block);
        const label = extractLabelFromBlock(block);
        const connections = extractTopicConnections(block);

        return {
          type: 'topic',
          name,
          displayLabel: label || toDisplayLabel(name),
          description,
          systemInstructions,
          systemInstructionsCST,
          reasoningInstructions,
          reasoningInstructionsFormat,
          reasoningInstructionsCST,
          blockCST: block, // Include raw block CST
          label,
          isStartAgent: blockType === 'start_agent',
          connections: connections.length > 0 ? connections : undefined,
          range: block.range,
          descriptionRange,
          systemInstructionsRange,
          reasoningInstructionsRange,
        };
      }
    }
  }

  return null;
}

/**
 * Find a specific knowledge block by name from CST
 */
export function findKnowledgeByName(
  rootNode: CSTNode,
  knowledgeName: string
): CSTKnowledgeData | null {
  const knowledgeBlocks = extractKnowledgeBlocks(rootNode);
  return knowledgeBlocks.find(k => k.name === knowledgeName) || null;
}

/**
 * Find a specific knowledge_action block by name from CST
 */
export function findKnowledgeActionByName(
  rootNode: CSTNode,
  knowledgeActionName: string
): CSTKnowledgeActionData | null {
  const knowledgeActionBlocks = extractKnowledgeActionBlocks(rootNode);
  return (
    knowledgeActionBlocks.find(k => k.name === knowledgeActionName) || null
  );
}

/**
 * Find a specific language block by name from CST
 */
export function findLanguageByName(
  rootNode: CSTNode,
  languageName: string
): CSTLanguageData | null {
  const languageBlocks = extractLanguageBlocks(rootNode);
  return languageBlocks.find(l => l.name === languageName) || null;
}

/**
 * Find a specific connection block by name from CST
 */
export function findConnectionByName(
  rootNode: CSTNode,
  connectionName: string
): CSTConnectionData | null {
  const connectionBlocks = extractConnectionBlocks(rootNode);
  return connectionBlocks.find(c => c.name === connectionName) || null;
}

/**
 * Find a specific action within a topic's actions block
 */
export function findActionInTopic(
  rootNode: CSTNode,
  topicName: string,
  actionName: string
): { blockCST?: CSTNode; actionData?: Record<string, unknown> } | null {
  // Find the topic first
  const topicData = findTopicByName(rootNode, topicName);
  if (!topicData?.blockCST) return null;

  // Look for actions block within the topic
  const topicChildren = topicData.blockCST.children;
  if (!topicChildren) return null;

  for (const child of topicChildren) {
    if (child.type === 'block') {
      const blockKey = getNodeText(findChildByFieldName(child, 'key'));

      if (blockKey === 'actions') {
        // Found the actions block, now look for the specific action
        const actionBlocks = findChildrenByType(child, 'block');
        const targetAction = actionBlocks.find(actionBlock => {
          const actionKey = getNodeText(
            findChildByFieldName(actionBlock, 'key')
          );
          return actionKey === actionName;
        });

        if (targetAction) {
          return {
            blockCST: targetAction,
            actionData: {
              name: actionName,
              type: 'action',
              topicName: topicName,
            },
          };
        }
      }
    }
  }

  return null;
}

/**
 * Extract all canvas-relevant data from CST
 */
export function extractCanvasData(rootNode: CSTNode) {
  return {
    system: extractSystemData(rootNode),
    config: extractConfigData(rootNode),
    variables: extractVariablesData(rootNode),
    knowledge: extractKnowledgeBlocks(rootNode),
    knowledgeActions: extractKnowledgeActionBlocks(rootNode),
    languages: extractLanguageBlocks(rootNode),
    connections: extractConnectionBlocks(rootNode),
    actions: extractActionsData(rootNode),
    topics: extractTopicBlocks(rootNode),
  };
}
