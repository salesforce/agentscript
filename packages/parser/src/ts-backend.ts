/**
 * TypeScript parser backend — delegates to @agentscript/parser-javascript.
 */

import {
  parse as tsParserParse,
  parseAndHighlight as tsParseAndHighlight,
} from '@agentscript/parser-javascript';
import type { ParserBackend } from './types.js';

/**
 * Create a parser-javascript backend.
 *
 * This is the default backend — pure TypeScript, works everywhere,
 * no native bindings or WASM required. Synchronous, no init needed.
 */
export function createTsBackend(): ParserBackend {
  return {
    parse: tsParserParse,
    parseAndHighlight: tsParseAndHighlight,
  };
}
