/**
 * Shared public API surface for @agentscript/parser.
 *
 * Both index.ts (parser-javascript) and index.tree-sitter.ts import this to
 * avoid duplicating the delegation logic. The backend is passed in
 * at module init time and is immutable thereafter.
 */

import type { SyntaxNode } from '@agentscript/types';
import type { HighlightCapture, Parser, ParserBackend } from './types.js';

/**
 * Create the public API functions bound to a specific backend.
 */
export function createApi(backend: ParserBackend) {
  function parse(source: string): { rootNode: SyntaxNode } {
    return backend.parse(source);
  }

  function parseAndHighlight(source: string): HighlightCapture[] {
    return backend.parseAndHighlight(source);
  }

  function getParser(): Parser {
    return { parse: (source: string) => backend.parse(source) };
  }

  function executeQuery(
    source: string,
    querySource?: string
  ): HighlightCapture[] {
    if (querySource && backend.executeQuery) {
      return backend.executeQuery(source, querySource);
    }
    return backend.parseAndHighlight(source);
  }

  return { parse, parseAndHighlight, getParser, executeQuery };
}
