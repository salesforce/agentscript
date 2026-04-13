/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

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
