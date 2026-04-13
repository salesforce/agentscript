/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Parser Worker
 *
 * Runs parser-javascript parsing in an isolated Web Worker.
 * This keeps parsing off the main thread for better editor responsiveness.
 */

import { parse, parseAndHighlight } from '@agentscript/parser';
import type { SyntaxNode } from '@agentscript/parser';

// Message types for communication with main thread
export interface WorkerRequest {
  id: string;
  type: 'init' | 'parse' | 'highlight' | 'getErrors';
  payload?: {
    code?: string;
  };
}

export interface SerializedNode {
  type: string;
  text: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  startIndex: number;
  endIndex: number;
  isError: boolean;
  isMissing: boolean;
  hasError: boolean;
  isNamed: boolean;
  children: SerializedNode[];
  fieldName?: string;
}

export interface HighlightCapture {
  name: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface ParseError {
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  message: string;
  source: string;
  /** Additional diagnostic data for tooling */
  data?: {
    /** What construct was being parsed (parent node type) */
    context?: string;
    /** What was found instead */
    found?: string;
  };
}

export interface WorkerResponse {
  id: string;
  type: 'init' | 'parse' | 'highlight' | 'getErrors';
  success: boolean;
  error?: string;
  payload?: {
    rootNode?: SerializedNode;
    captures?: HighlightCapture[];
    errors?: ParseError[];
  };
}

/**
 * Serialize a SyntaxNode to a transferable object
 */
function serializeNode(node: SyntaxNode): SerializedNode {
  const children: SerializedNode[] = [];

  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child) {
      const serialized = serializeNode(child);
      const fieldName = node.fieldNameForChild?.(i);
      if (fieldName) {
        serialized.fieldName = fieldName;
      }
      children.push(serialized);
    }
  }

  return {
    type: node.type,
    text: node.text,
    range: {
      start: {
        line: node.startRow,
        character: node.startCol,
      },
      end: { line: node.endRow, character: node.endCol },
    },
    startIndex: node.startOffset ?? 0,
    endIndex: node.endOffset ?? 0,
    isError: !!node.isError,
    isMissing: !!node.isMissing,
    hasError: !!node.hasError,
    isNamed: !!node.isNamed,
    children,
  };
}

/**
 * Truncate text for error messages
 */
function truncateText(text: string, maxLen = 50): string {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= maxLen) return firstLine;
  return firstLine.slice(0, maxLen) + '...';
}

/**
 * Get the range for an error node.
 */
function getErrorRange(node: SyntaxNode): ParseError['range'] {
  return {
    start: {
      line: node.startRow,
      character: node.startCol,
    },
    end: {
      line: node.endRow,
      character: node.endCol,
    },
  };
}

/**
 * Check if a node has any ERROR/MISSING descendants
 */
function hasErrorDescendants(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.isError || child.isMissing) return true;
    if (child.hasError && hasErrorDescendants(child)) return true;
  }
  return false;
}

/**
 * Try to narrow an ERROR node's range by excluding valid compound children.
 */
function narrowErrorRange(
  node: SyntaxNode
): { range: ParseError['range']; text: string } | null {
  let lastValid: SyntaxNode | null = null;
  for (const child of node.children) {
    if (
      child.isNamed &&
      !child.isError &&
      !child.isMissing &&
      child.namedChildren.length > 0 &&
      child.children.length > child.namedChildren.length
    ) {
      lastValid = child;
    }
  }

  if (
    !lastValid ||
    lastValid.endOffset == null ||
    node.endOffset == null ||
    node.startOffset == null ||
    lastValid.endOffset >= node.endOffset
  ) {
    return null;
  }

  const narrowedText = node.text.slice(lastValid.endOffset - node.startOffset);
  if (!narrowedText.trim()) {
    return null;
  }

  return {
    range: {
      start: {
        line: lastValid.endRow,
        character: lastValid.endCol,
      },
      end: {
        line: node.endRow,
        character: node.endCol,
      },
    },
    text: narrowedText.trim(),
  };
}

/**
 * Find all errors in the tree.
 * Only reports the DEEPEST error nodes - if an ERROR has child errors,
 * we recurse into those instead of reporting the parent.
 * Skips top-level ERROR nodes (depth <= 0).
 */
function findErrors(
  node: SyntaxNode,
  errors: ParseError[],
  depth: number = 0
): void {
  if (node.isError || node.isMissing) {
    // Check if this ERROR has deeper ERROR children - if so, recurse instead
    if (node.isError && hasErrorDescendants(node)) {
      for (const child of node.children) {
        findErrors(child, errors, depth + 1);
      }
      return;
    }

    // This is a leaf error (no deeper errors) - report it
    if (depth > 0) {
      const data: ParseError['data'] = {};

      // Get parent context
      let contextNode = node.parent;
      while (contextNode && contextNode.isError) {
        contextNode = contextNode.parent;
      }
      if (contextNode) {
        data.context = contextNode.type;
      }

      // Try to narrow the range
      const narrowed = node.isError ? narrowErrorRange(node) : null;

      if (narrowed) {
        data.found = truncateText(narrowed.text, 20);
        errors.push({
          range: narrowed.range,
          message: `Syntax error: unexpected \`${truncateText(narrowed.text)}\``,
          source: 'Parser',
          data: Object.keys(data).length > 0 ? data : undefined,
        });
      } else {
        if (!node.isMissing) {
          data.found = truncateText(node.text, 20);
        }

        errors.push({
          range: getErrorRange(node),
          message: node.isMissing
            ? `Missing ${node.type}`
            : `Syntax error: unexpected \`${truncateText(node.text)}\``,
          source: 'Parser',
          data: Object.keys(data).length > 0 ? data : undefined,
        });
      }
    }
    return;
  }

  // Not an error node - recurse into children with errors
  for (const child of node.children) {
    if (child.hasError) {
      findErrors(child, errors, depth + 1);
    }
  }
}

/**
 * Parse code and return serialized tree
 */
function parseCode(code: string): { rootNode: SerializedNode } {
  const result = parse(code);
  return { rootNode: serializeNode(result.rootNode) };
}

/**
 * Parse code and return highlight captures
 */
function getHighlights(code: string): { captures: HighlightCapture[] } {
  const rawCaptures = parseAndHighlight(code);
  const captures: HighlightCapture[] = rawCaptures.map(capture => ({
    name: capture.name,
    startRow: capture.startRow,
    startCol: capture.startCol,
    endRow: capture.endRow,
    endCol: capture.endCol,
  }));
  return { captures };
}

/**
 * Parse code and return errors
 */
function getParseErrors(code: string): { errors: ParseError[] } {
  const result = parse(code);
  const errors: ParseError[] = [];
  if (result.rootNode.hasError) {
    findErrors(result.rootNode, errors);
  }
  return { errors };
}

/**
 * Handle incoming messages from main thread
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, type, payload } = event.data;

  let response: WorkerResponse;

  try {
    switch (type) {
      case 'init': {
        // No-op: parser-javascript needs no async initialization
        response = {
          id,
          type,
          success: true,
        };
        break;
      }

      case 'parse': {
        if (!payload?.code) {
          throw new Error('No code provided for parsing');
        }
        const result = parseCode(payload.code);
        response = {
          id,
          type,
          success: true,
          payload: { rootNode: result.rootNode },
        };
        break;
      }

      case 'highlight': {
        if (!payload?.code) {
          throw new Error('No code provided for highlighting');
        }
        const result = getHighlights(payload.code);
        response = {
          id,
          type,
          success: true,
          payload: { captures: result.captures },
        };
        break;
      }

      case 'getErrors': {
        if (!payload?.code) {
          throw new Error('No code provided for error detection');
        }
        const result = getParseErrors(payload.code);
        response = {
          id,
          type,
          success: true,
          payload: { errors: result.errors },
        };
        break;
      }

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[Worker] Error handling ${type}:`, errorMessage);

    response = {
      id,
      type,
      success: false,
      error: errorMessage,
    };
  }

  self.postMessage(response);
};

// Global error handler
self.onerror = event => {
  try {
    self.postMessage({
      id: 'crash',
      type: 'parse',
      success: false,
      error: `Worker crash: ${event instanceof ErrorEvent ? event.message : String(event)}`,
    });
  } catch {
    // Worker might be too broken to post message
  }
};

self.onunhandledrejection = () => {
  // Silently handle unhandled rejections
};

// Signal that worker is ready
self.postMessage({ type: 'ready' });
