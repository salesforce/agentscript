/**
 * Semantic token generation for syntax highlighting.
 *
 * Thin wrapper around @agentscript/language's generateSemanticTokens.
 * Executes the CST-walk highlighter via the TypeScript parser,
 * then delegates token generation to the shared implementation.
 */

import { executeQuery } from './parser.js';
import {
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  mapCaptureToToken,
  generateSemanticTokens as generateTokensFromCaptures,
} from '@agentscript/language';
import type { SemanticToken } from '@agentscript/language';

export { TOKEN_TYPES, TOKEN_MODIFIERS, mapCaptureToToken };
export type { SemanticToken };

/**
 * Generate semantic tokens from source code.
 *
 * @param source - Source code to highlight
 * @returns Array of semantic tokens sorted by position
 */
export function generateSemanticTokens(source: string): SemanticToken[] {
  if (!source.trim()) return [];

  try {
    const captures = executeQuery(source);
    return generateTokensFromCaptures(source, captures);
  } catch (error) {
    console.error('[SemanticTokens] Error generating tokens:', error);
    return [];
  }
}
