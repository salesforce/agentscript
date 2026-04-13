/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Top-level `parse()` — one call to go from source string to a Document.
 *
 * Wraps: CST parsing → agentforce dialect parsing → linting.
 * Never throws — errors are returned as diagnostics on the Document.
 */

import { parseAndLint } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import type { ParsedAgentforce } from '@agentscript/agentforce-dialect';
import { getParser } from './parser.js';
import { Document } from './document.js';

/**
 * Parse an AgentScript source string into a Document.
 *
 * This function never throws. If parsing fails due to a runtime error,
 * it returns a Document with an empty AST and a diagnostic describing
 * the failure.
 *
 * @param source - The AgentScript source text.
 * @returns A Document with the parsed AST, diagnostics, and mutation API.
 *
 * @example
 * ```typescript
 * import { parse } from '@agentscript/agentforce';
 *
 * const doc = parse('system:\n  instructions: "Hello"');
 * console.log(doc.hasErrors);
 * console.log(doc.emit());
 * ```
 */
export function parse(source: string): Document {
  try {
    const parser = getParser();
    const tree = parser.parse(source);
    const result = parseAndLint(tree.rootNode, agentforceDialect);
    return Document.create(
      result.ast as ParsedAgentforce,
      result.diagnostics,
      result.store,
      parser
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const diagnostic: Diagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message: `Parse failed: ${message}`,
      severity: DiagnosticSeverity.Error,
      code: 'parse-error',
      source: 'agentscript',
    };
    return Document.empty([diagnostic]);
  }
}
