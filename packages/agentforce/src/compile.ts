/**
 * Compile pipeline — parse + lint + compile in one call.
 */

import { parseAndLint } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import type { ParsedAgentforce } from '@agentscript/agentforce-dialect';
import { compile } from '@agentscript/compiler';
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
 * Parse, lint, and compile an AgentScript source string to AgentJSON.
 *
 * @param source - The AgentScript source text.
 * @returns The compiled output, diagnostics, and parsed document.
 */
export function compileSource(source: string): AgentforceCompileResult {
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

  const diagnostics = [
    ...parseResult.diagnostics,
    ...compileResult.diagnostics,
  ];

  // Sort diagnostics by severity (Error=1 first), then line, then column
  diagnostics.sort(
    (a, b) =>
      a.severity - b.severity ||
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character
  );

  return {
    output: compileResult.output,
    ranges: compileResult.ranges,
    diagnostics,
    document,
  };
}
