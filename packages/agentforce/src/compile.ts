/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Compile pipeline — parse + lint + compile in one call.
 */

import { parseAndLint, dedupeDiagnostics } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import type { ParsedAgentforce } from '@agentscript/agentforce-dialect';
import {
  compile,
  agentDslAuthoringSchema,
  snakeKeysToCamel,
} from '@agentscript/compiler';
import type { CompileResult } from '@agentscript/compiler';
import type { AgentDSLAuthoring } from '@agentscript/compiler';
import { getParser } from './parser.js';
import { Document } from './document.js';

/**
 * Result of `compileSource()`.
 */
export interface AgentforceCompileResult {
  /** The compiled AgentJSON output (plain values) */
  output: AgentDSLAuthoring;
  /** Source range data for serializer */
  ranges: CompileResult['ranges'];
  /** Combined parse + compile diagnostics */
  diagnostics: Diagnostic[];
  /** The parsed Document (for mutation, emit, etc.) */
  document: Document;
}

/**
 * Options for `compileSource()`.
 */
export interface CompileSourceOptions {
  /**
   * Emit output keys in camelCase instead of the default snake_case. Only
   * keys declared by the AgentJSON schema are renamed; user-controlled keys
   * inside open-dict fields (e.g. variable names in `bound_inputs`,
   * locale codes in `filler_sentences`) pass through unchanged. Source
   * range mappings are remapped to the new keys.
   */
  camelCase?: boolean;
}

/**
 * Parse, lint, and compile an AgentScript source string to AgentJSON.
 *
 * @param source - The AgentScript source text.
 * @param options - Compile options (e.g. `camelCase` for camelCase output keys).
 * @returns The compiled output, diagnostics, and parsed document.
 */
export function compileSource(
  source: string,
  options: CompileSourceOptions = {}
): AgentforceCompileResult {
  const parser = getParser();

  const tree = parser.parse(source);
  const parseResult = parseAndLint(tree.rootNode, agentforceDialect);

  const document = Document.create(
    parseResult.ast as ParsedAgentforce,
    parseResult.diagnostics,
    parseResult.store,
    parser
  );

  const compileResult: CompileResult = compile(
    parseResult.ast as ParsedAgentforce
  );

  // Parse, lint, and compile all run over the same source, so one problem can
  // be reported by more than one step. Collapse repeats (keeping the highest
  // severity, then the earliest step) before surfacing them. The parse+lint
  // diagnostics come first so they win ties over the later compile step.
  const diagnostics = dedupeDiagnostics([
    ...parseResult.diagnostics,
    ...compileResult.diagnostics,
  ]);

  // Sort diagnostics by severity (Error=1 first), then line, then column
  diagnostics.sort(
    (a, b) =>
      a.severity - b.severity ||
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character
  );

  let output = compileResult.output;
  let ranges = compileResult.ranges;
  if (options.camelCase) {
    const converted = snakeKeysToCamel(output, ranges, agentDslAuthoringSchema);
    output = converted.value as AgentDSLAuthoring;
    ranges = converted.ranges;
  }

  return {
    output,
    ranges,
    diagnostics,
    document,
  };
}
