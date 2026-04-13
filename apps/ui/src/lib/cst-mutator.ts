/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * CST Mutation Utilities
 * Functions that take a CST and return modified AgentScript text
 */

import type { CSTNode } from './cst-helpers';
import type { SerializedNode } from '~/store/source';

// Type for CST input
type CSTInput = SerializedNode;

/**
 * Get the root node from a SerializedNode
 */
function getRootNode(cst: CSTInput): CSTNode {
  return cst as unknown as CSTNode;
}

/**
 * Upsert a field in a block
 * @param cst - The CST (SerializedNode)
 * @param blockName - Name of the block (e.g., 'config', 'system')
 * @param fieldName - Name of the field to upsert (e.g., 'agent_label')
 * @param value - Value to set (string, number, boolean, etc.)
 * @returns Modified AgentScript text
 */
export function upsertFieldInBlock(
  cst: CSTInput,
  blockName: string,
  fieldName: string,
  value: string | number | boolean
): string {
  // Get the root node and source text
  const rootNode = getRootNode(cst);
  const sourceText = rootNode.text || '';
  const lines = sourceText.split('\n');

  // Find the block
  const blocks = findBlocks(rootNode, blockName);

  if (blocks.length === 0) {
    // Block doesn't exist - insert it
    const newBlockText = createBlock(blockName, [[fieldName, value]]);
    return insertBlockAtTop(lines, newBlockText);
  }

  const block = blocks[0];

  // Find the field within the block
  const fields = findFieldsInBlock(block, fieldName);

  if (fields.length > 0) {
    // Field exists - update it
    const field = fields[0];
    const fieldLine = field.range.start.line;
    const line = lines[fieldLine];

    // Find the value part (after the colon)
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const indent = line.substring(0, line.search(/\S/));
      const formattedValue = formatValue(value);
      lines[fieldLine] = `${indent}${fieldName}: ${formattedValue}`;
    }
  } else {
    // Field doesn't exist - insert it in the block
    const blockStartLine = block.range.start.line;
    const indent = '  '; // Standard 2-space indent
    const formattedValue = formatValue(value);
    const newFieldLine = `${indent}${fieldName}: ${formattedValue}`;

    // Insert after the block header line
    lines.splice(blockStartLine + 1, 0, newFieldLine);
  }

  return lines.join('\n');
}

/**
 * Insert a compound field header (e.g. `  system:`) into a block.
 * Unlike upsertFieldInBlock, this inserts a bare field with no value,
 * which the parser will interpret as an empty nested block.
 */
export function upsertCompoundFieldInBlock(
  cst: CSTInput,
  blockName: string,
  fieldName: string
): string {
  const rootNode = getRootNode(cst);
  const sourceText = rootNode.text || '';
  const lines = sourceText.split('\n');

  const blocks = findBlocks(rootNode, blockName);
  if (blocks.length === 0) return sourceText;

  const block = blocks[0];
  const fields = findFieldsInBlock(block, fieldName);
  if (fields.length > 0) return sourceText; // Already exists

  const blockStartLine = block.range.start.line;
  const newFieldLine = `  ${fieldName}:`;
  lines.splice(blockStartLine + 1, 0, newFieldLine);

  return lines.join('\n');
}

/**
 * Helper: Find all blocks with a given name
 */
function findBlocks(node: CSTNode, blockName: string): CSTNode[] {
  const blocks: CSTNode[] = [];

  function walk(n: CSTNode) {
    if (n.type === 'block') {
      // Check if this block has the right name
      const keyChild = n.children?.find(
        (c: CSTNode) => c.type === 'identifier' || c.fieldName === 'key'
      );
      if (keyChild && keyChild.text === blockName) {
        blocks.push(n);
      }
    }

    // Recurse into children
    if (n.children) {
      for (const child of n.children) {
        walk(child);
      }
    }
  }

  walk(node);
  return blocks;
}

/**
 * Helper: Find all fields with a given name in a block
 */
function findFieldsInBlock(blockNode: CSTNode, fieldName: string): CSTNode[] {
  const fields: CSTNode[] = [];

  if (!blockNode.children) return fields;

  for (const child of blockNode.children) {
    if (child.type === 'field') {
      const nameChild = child.children?.find(
        (c: CSTNode) => c.type === 'identifier' || c.fieldName === 'name'
      );
      if (nameChild && nameChild.text === fieldName) {
        fields.push(child);
      }
    }
  }

  return fields;
}

/**
 * Helper: Format a value for AgentScript
 */
function formatValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'True' : 'False';
  }
  return String(value);
}

/**
 * Helper: Create a new block with fields
 */
function createBlock(
  blockName: string,
  fields: Array<[string, string | number | boolean]>
): string {
  const lines = [`${blockName}:`];
  for (const [fieldName, value] of fields) {
    const formattedValue = formatValue(value);
    lines.push(`  ${fieldName}: ${formattedValue}`);
  }
  return lines.join('\n');
}

/**
 * Helper: Insert a block at the top of the script
 */
function insertBlockAtTop(lines: string[], blockText: string): string {
  if (lines.length === 0 || lines.every(l => l.trim() === '')) {
    return blockText;
  }
  return blockText + '\n\n' + lines.join('\n');
}

// ============================================================================
// Statement Mutation Utilities
// ============================================================================

/**
 * Position info for a CST node
 */
export interface NodePosition {
  startIndex: number;
  endIndex: number;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
}

/**
 * Insert a statement at a specific index within a parent block
 * @param source - The full source text
 * @param parentNode - The parent node containing statements
 * @param insertIndex - Index to insert at (0 = first, -1 = last)
 * @param statementText - The AgentScript statement text to insert
 * @returns Modified source text
 */
export function insertStatementAt(
  source: string,
  parentNode: NodePosition,
  insertIndex: number,
  statementText: string,
  existingStatements: NodePosition[] = []
): string {
  const lines = source.split('\n');

  // Determine the indent level from parent or existing statements
  let indent = '    '; // Default 4-space indent

  if (existingStatements.length > 0) {
    const firstStmt = existingStatements[0];
    const firstLine = lines[firstStmt.range.start.line];
    const match = firstLine.match(/^(\s*)/);
    if (match) indent = match[1];
  } else {
    // Use parent indent + 2 spaces
    const parentLine = lines[parentNode.range.start.line];
    const match = parentLine.match(/^(\s*)/);
    if (match) indent = match[1] + '  ';
  }

  // Determine insert line
  let insertLine: number;

  if (existingStatements.length === 0) {
    // Empty - insert after parent header
    insertLine = parentNode.range.start.line + 1;
  } else if (insertIndex < 0 || insertIndex >= existingStatements.length) {
    // Insert at end
    const lastStmt = existingStatements[existingStatements.length - 1];
    insertLine = lastStmt.range.end.line + 1;
  } else {
    // Insert before the statement at insertIndex
    const targetStmt = existingStatements[insertIndex];
    insertLine = targetStmt.range.start.line;
  }

  // Indent the statement text
  const indentedLines = statementText.split('\n').map((line, i) => {
    if (i === 0) return indent + line;
    // Additional lines get extra indent for nested content
    return indent + '  ' + line;
  });

  // Insert the lines
  lines.splice(insertLine, 0, ...indentedLines);

  return lines.join('\n');
}

/**
 * Move a statement from one position to another within the same parent
 * @param source - The full source text
 * @param statements - Array of statement positions
 * @param fromIndex - Index of statement to move
 * @param toIndex - Index to move to
 * @returns Modified source text
 */
export function moveStatement(
  source: string,
  statements: NodePosition[],
  fromIndex: number,
  toIndex: number
): string {
  if (fromIndex === toIndex) return source;
  if (fromIndex < 0 || fromIndex >= statements.length) return source;
  if (toIndex < 0 || toIndex >= statements.length) return source;

  const lines = source.split('\n');
  const movingStmt = statements[fromIndex];

  // Extract the lines to move
  const startLine = movingStmt.range.start.line;
  const endLine = movingStmt.range.end.line;
  const lineCount = endLine - startLine + 1;
  const movingLines = lines.slice(startLine, endLine + 1);

  // Remove from original position
  lines.splice(startLine, lineCount);

  // Calculate new insert position (accounting for removed lines)
  let insertLine: number;
  if (toIndex < fromIndex) {
    // Moving up - insert before target
    insertLine = statements[toIndex].range.start.line;
  } else {
    // Moving down - insert after target (adjusted for removal)
    const targetStmt = statements[toIndex];
    insertLine = targetStmt.range.end.line - lineCount + 1;
  }

  // Insert at new position
  lines.splice(insertLine, 0, ...movingLines);

  return lines.join('\n');
}

/**
 * Delete a statement
 * @param source - The full source text
 * @param statement - The statement position to delete
 * @returns Modified source text
 */
export function deleteStatement(
  source: string,
  statement: NodePosition
): string {
  const lines = source.split('\n');
  const startLine = statement.range.start.line;
  const endLine = statement.range.end.line;

  // Remove the statement lines
  lines.splice(startLine, endLine - startLine + 1);

  return lines.join('\n');
}

/**
 * Update template content within a field
 * @param source - The full source text
 * @param templateNode - The template_content node position
 * @param newContent - The new template content
 * @returns Modified source text
 */
export function updateTemplateContent(
  source: string,
  templateNode: NodePosition,
  newContent: string
): string {
  const lines = source.split('\n');
  const startLine = templateNode.range.start.line;
  const endLine = templateNode.range.end.line;

  // Get the indent from the first line of the template
  const firstLine = lines[startLine];
  const match = firstLine.match(/^(\s*)/);
  const indent = match ? match[1] : '    ';

  // Format the new content with proper indentation
  const newLines = newContent.split('\n').map(line => indent + line);

  // Replace the template content
  lines.splice(startLine, endLine - startLine + 1, ...newLines);

  return lines.join('\n');
}

/**
 * Replace a node's text in the source
 * @param source - The full source text
 * @param node - The node position to replace
 * @param newText - The new text
 * @returns Modified source text
 */
export function replaceNodeText(
  source: string,
  node: NodePosition,
  newText: string
): string {
  return (
    source.slice(0, node.startIndex) + newText + source.slice(node.endIndex)
  );
}

/**
 * Insert text after a node
 * @param source - The full source text
 * @param node - The node position
 * @param text - Text to insert after
 * @returns Modified source text
 */
export function insertAfterNode(
  source: string,
  node: NodePosition,
  text: string
): string {
  return source.slice(0, node.endIndex) + text + source.slice(node.endIndex);
}

/**
 * Insert text before a node
 * @param source - The full source text
 * @param node - The node position
 * @param text - Text to insert before
 * @returns Modified source text
 */
export function insertBeforeNode(
  source: string,
  node: NodePosition,
  text: string
): string {
  return (
    source.slice(0, node.startIndex) + text + source.slice(node.startIndex)
  );
}

// ============================================================================
// Statement Insertion Utility
// ============================================================================

/**
 * Insert a statement after a specific node within a procedure.
 * Uses the afterNode's position to find exact insertion point.
 *
 * @param source - The full source text
 * @param afterNode - The node to insert after (null = insert at start for empty procedure)
 * @param parentNode - The parent field node containing the procedure
 * @param templateText - The statement template text (without indentation)
 * @param existingStatements - Array of existing statements for indent detection and bounds
 * @returns Modified source text
 */
export function insertStatementAfterNode(
  source: string,
  afterNode: NodePosition | null,
  parentNode: NodePosition,
  templateText: string,
  existingStatements: NodePosition[] = []
): string {
  const lines = source.split('\n');

  // Detect proper indentation from existing statements
  let indent: string;

  if (existingStatements.length > 0) {
    // Match indent of existing statements
    const firstStmt = existingStatements[0];
    const firstLine = lines[firstStmt.range.start.line];
    const match = firstLine?.match(/^(\s*)/);
    indent = match?.[1] ?? '      ';
  } else {
    // For empty procedure: parent indent + 3 spaces (AgentScript convention)
    const parentLine = lines[parentNode.range.start.line];
    const match = parentLine?.match(/^(\s*)/);
    indent = (match?.[1] ?? '') + '   ';
  }

  // Build the indented content
  const templateLines = templateText.split('\n');
  const indentedContent = templateLines
    .map((line, i) => {
      if (i === 0) return indent + line;
      // Subsequent lines get extra indent for nested content
      return indent + '  ' + line;
    })
    .join('\n');

  // Calculate character offset for the end of the target line
  // We need to find the newline at the end of afterNode's last line
  let insertAt: number;

  if (afterNode) {
    const targetRow = afterNode.range.end.line;

    // Calculate character offset by counting through lines
    let charOffset = 0;
    for (let i = 0; i < targetRow; i++) {
      charOffset += lines[i].length + 1; // +1 for newline
    }
    // Add the length of the target line itself
    charOffset += lines[targetRow]?.length ?? 0;

    insertAt = charOffset;
  } else {
    // Empty procedure: insert after the parent's first line
    const targetRow = parentNode.range.start.line;
    let charOffset = 0;
    for (let i = 0; i < targetRow; i++) {
      charOffset += lines[i].length + 1;
    }
    charOffset += lines[targetRow]?.length ?? 0;

    insertAt = charOffset;
  }

  // Safety checks
  if (insertAt < 0) {
    console.error(
      '[insertStatementAfterNode] Negative insert position:',
      insertAt
    );
    return source;
  }

  if (insertAt > source.length) {
    console.error(
      '[insertStatementAfterNode] Insert position beyond source:',
      insertAt,
      'vs',
      source.length
    );
    insertAt = source.length;
  }

  // insertAt points to the character AFTER the last char of the target line
  // which should be the newline. We want to insert AFTER that newline.
  // So we include the newline in the first slice, then add our content + newline
  const insertAfterNewline = insertAt + 1; // Skip past the '\n'

  if (insertAfterNewline > source.length) {
    // Target line is the last line (no trailing newline)
    // Append with newline prefix
    return source + '\n' + indentedContent;
  }

  // Insert content after the newline, with its own trailing newline
  const newSource =
    source.slice(0, insertAfterNewline) +
    indentedContent +
    '\n' +
    source.slice(insertAfterNewline);

  return newSource;
}
