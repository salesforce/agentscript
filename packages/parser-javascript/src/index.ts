/**
 * @agentscript/parser-javascript — Hand-written TypeScript parser for AgentScript.
 *
 * Error-tolerant: NEWLINE and DEDENT are unconditional recovery points.
 */

export { CSTNode } from './cst-node.js';
export type { SyntaxNode } from '@agentscript/types';
export { TokenKind } from './token.js';
export type { Token, Position } from './token.js';
export type { TokenStream, NodeBuilder, ParserContext } from './parser.js';
export { highlight } from './highlighter.js';
export type { HighlightCapture } from './highlighter.js';

import { Parser } from './parser.js';
import { highlight } from './highlighter.js';
import type { CSTNode } from './cst-node.js';
import type { HighlightCapture } from './highlighter.js';

/**
 * Parse AgentScript source code and return a CST.
 * The returned rootNode implements the SyntaxNode interface
 * used by all consumers (dialect, LSP, monaco, agentforce).
 */
export function parse(source: string): { rootNode: CSTNode } {
  const parser = new Parser(source);
  return { rootNode: parser.parse() };
}

/**
 * Parse and highlight source code in one call.
 * Returns captures compatible with the QueryCapture format
 * used by LSP semantic tokens.
 */
export function parseAndHighlight(source: string): HighlightCapture[] {
  const { rootNode } = parse(source);
  return highlight(rootNode);
}
