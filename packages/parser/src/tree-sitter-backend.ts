/**
 * Native tree-sitter parser backend.
 *
 * Dynamically imports tree-sitter and @agentscript/parser-tree-sitter at runtime.
 * Used in Node.js environments where native bindings are available.
 */

import type { SyntaxNode } from '@agentscript/types';
import { adaptNode, type RawTreeSitterNode } from './adapter.js';
import type { HighlightCapture, ParserBackend } from './types.js';

interface TreeSitterParser {
  parse(input: string): { rootNode: RawTreeSitterNode };
  setLanguage(language: unknown): void;
}

interface TreeSitterLanguage {
  language: unknown;
  HIGHLIGHTS_QUERY?: string;
}

interface TreeSitterQuery {
  captures(
    node: RawTreeSitterNode
  ): Array<{ name: string; node: RawTreeSitterNode }>;
}

/**
 * Create a native tree-sitter backend.
 *
 * Dynamically requires tree-sitter and @agentscript/parser-tree-sitter (optional
 * peer dependencies). Throws if they are not installed.
 */
export function createNativeBackend(): ParserBackend {
  let TreeSitter: {
    new (): TreeSitterParser;
    Query: new (lang: unknown, source: string) => TreeSitterQuery;
  };

  let AgentScript: TreeSitterLanguage;

  try {
    // Dynamic require — tree-sitter is an optional peer dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    TreeSitter = require('tree-sitter') as typeof TreeSitter;
    AgentScript =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@agentscript/parser-tree-sitter') as typeof AgentScript;
  } catch {
    throw new Error(
      'Native tree-sitter backend requires "tree-sitter" and "@agentscript/parser-tree-sitter" packages. ' +
        'Install them with: pnpm add tree-sitter @agentscript/parser-tree-sitter'
    );
  }

  const parser = new TreeSitter();
  parser.setLanguage(AgentScript.language ?? AgentScript);

  function parse(source: string): { rootNode: SyntaxNode } {
    const tree = parser.parse(source);
    return { rootNode: adaptNode(tree.rootNode) };
  }

  function parseAndHighlight(source: string): HighlightCapture[] {
    const tree = parser.parse(source);

    if (!AgentScript.HIGHLIGHTS_QUERY) {
      throw new Error(
        'Tree-sitter highlights query not found. ' +
          'The @agentscript/parser-tree-sitter package may not export HIGHLIGHTS_QUERY.'
      );
    }

    const query = new TreeSitter.Query(
      AgentScript.language ?? AgentScript,
      AgentScript.HIGHLIGHTS_QUERY
    );

    const captures = query.captures(tree.rootNode);
    return captures.map(
      (c: { name: string; node: RawTreeSitterNode }): HighlightCapture => ({
        name: c.name,
        text: c.node.text,
        startRow: c.node.startPosition.row,
        startCol: c.node.startPosition.column,
        endRow: c.node.endPosition.row,
        endCol: c.node.endPosition.column,
      })
    );
  }

  function executeQuery(
    source: string,
    querySource: string
  ): HighlightCapture[] {
    const tree = parser.parse(source);

    const query = new TreeSitter.Query(
      AgentScript.language ?? AgentScript,
      querySource
    );

    const captures = query.captures(tree.rootNode);
    return captures.map(
      (c: { name: string; node: RawTreeSitterNode }): HighlightCapture => ({
        name: c.name,
        text: c.node.text,
        startRow: c.node.startPosition.row,
        startCol: c.node.startPosition.column,
        endRow: c.node.endPosition.row,
        endCol: c.node.endPosition.column,
      })
    );
  }

  return { parse, parseAndHighlight, executeQuery };
}
