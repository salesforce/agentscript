/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Client-side AgentScript parser
 *
 * Uses @agentscript/agentforce for parsing with full dialect support (pure TypeScript via parser-javascript).
 */

import { parse as agentforceParse, getParser } from '@agentscript/agentforce';
import type { ParsedAgentforce } from '@agentscript/agentforce';
import type { SyntaxNode } from '@agentscript/types';
import { agentScriptSchemaContext } from '@agentscript/agentscript-dialect';
import { agentforceSchemaContext } from '@agentscript/agentforce-dialect';
import type { PassStore, SchemaContext } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import type { SerializedNode } from '../store/source';

// ---------------------------------------------------------------------------
// Dialect registry
// ---------------------------------------------------------------------------
interface DialectEntry {
  schemaContext: SchemaContext;
}

const dialectRegistry: Record<string, DialectEntry> = {
  agentscript: {
    schemaContext: agentScriptSchemaContext,
  },
  agentforce: {
    schemaContext: agentforceSchemaContext,
  },
};

function getDialectEntry(dialectId: string): DialectEntry {
  return dialectRegistry[dialectId] ?? dialectRegistry.agentscript;
}

/** Get the SchemaContext for a given dialect ID. */
export function getSchemaContext(dialectId: string): SchemaContext {
  return getDialectEntry(dialectId).schemaContext;
}

/** Get the root schema for a given dialect ID. */
export function getDialectSchema(
  dialectId: string
): Record<string, import('@agentscript/language').FieldType> {
  return getDialectEntry(dialectId).schemaContext.info.schema;
}

// Export typed AST type for consumers
export type AgentScriptAST = ParsedAgentforce;

// Re-export Diagnostic type
export type { Diagnostic } from '@agentscript/types';

/**
 * Serialize a SyntaxNode to a plain object for the UI
 */
function serializeNode(
  node: SyntaxNode,
  maxTextLength: number = 100,
  maxDepth: number = Infinity,
  currentDepth: number = 0
): SerializedNode {
  const serialized: SerializedNode = {
    type: node.type,
    isNamed: node.isNamed ?? true,
    range: {
      start: {
        line: node.startRow,
        character: node.startCol,
      },
      end: { line: node.endRow, character: node.endCol },
    },
    hasError: node.hasError ?? false,
    isMissing: node.isMissing ?? false,
  };

  // Include text for leaf nodes or small nodes
  if (
    !node.children ||
    node.children.length === 0 ||
    node.text.length <= maxTextLength
  ) {
    serialized.text = node.text;
  }

  // Recursively serialize children if not at max depth
  if (node.children && node.children.length > 0 && currentDepth < maxDepth) {
    serialized.children = [];
    for (const child of node.children) {
      const childNode = serializeNode(
        child,
        maxTextLength,
        maxDepth,
        currentDepth + 1
      );
      serialized.children.push(childNode);
    }
  }

  return serialized;
}

/**
 * Initialize the agentforce parser.
 * No-op — the parser initializes lazily. Kept for call-site compatibility.
 */
export async function initParser(): Promise<void> {
  // Parser initializes lazily on first use — nothing to do here.
}

/**
 * Parse AgentScript source code using agentforce.
 *
 * @param source - The source code to parse
 * @param dialectId - The dialect to use ('agentscript' or 'agentforce')
 *
 * This function automatically initializes the parser if needed.
 */
export async function parseAgentScript(
  source: string,
  _dialectId: string = 'agentforce'
): Promise<{
  tree: SerializedNode | null;
  ast: AgentScriptAST | null;
  diagnostics: Diagnostic[];
  store: PassStore | null;
}> {
  // Ensure parser is initialized
  await initParser();

  try {
    // Get the raw parser to access CST
    const parser = getParser();
    const tree = parser.parse(source);
    const rootNode = tree.rootNode;

    // Serialize the CST for the UI
    const serializedTree = serializeNode(rootNode);

    // Parse + lint (compilation is handled by the LSP worker)
    const doc = agentforceParse(source);

    return {
      tree: serializedTree,
      ast: doc.ast as AgentScriptAST,
      diagnostics: doc.diagnostics,
      store: null,
    };
  } catch (error) {
    console.error('[Parser] Parse failed:', error);
    return {
      tree: null,
      ast: null,
      diagnostics: [
        {
          severity: 1,
          message: `Parse failed: ${error instanceof Error ? error.message : String(error)}`,
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      ],
      store: null,
    };
  }
}

/**
 * Reset parser - no-op for agentforce (managed internally).
 */
export function resetParser(): void {
  // Parser state is managed internally by agentforce
}

/**
 * Check if parser is disabled - always returns false.
 */
export function isParserDisabled(): boolean {
  return false;
}
