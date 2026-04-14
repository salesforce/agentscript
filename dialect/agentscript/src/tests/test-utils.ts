/**
 * Test utilities for parsing and round-trip testing.
 */

import { parse } from '@agentscript/parser';
import {
  Dialect,
  createSchemaContext,
  emitDocument as emitDocumentGeneric,
  isNamedMap,
} from '@agentscript/language';
import type {
  SchemaContext,
  Schema,
  InferFields,
  Parsed,
  ParseResult,
  Expression,
  AstRoot,
} from '@agentscript/language';
import { AgentScriptSchema, AgentScriptSchemaInfo } from '../schema.js';
import type { ParsedDocument } from '../index.js';

/** Pre-computed schema context for tests. */
export const testSchemaCtx: SchemaContext = createSchemaContext(
  AgentScriptSchemaInfo
);

/**
 * Parse a complete AgentScript source string into AST.
 */
export function parseDocument(source: string): ParsedDocument {
  const { rootNode } = parse(source);

  const dialect = new Dialect();
  const result = dialect.parse(rootNode, AgentScriptSchema);
  return result.value;
}

/**
 * Parse a source string using a custom schema.
 */
export function parseWithSchema<T extends Schema>(
  source: string,
  schema: T
): Parsed<InferFields<T>> {
  const { rootNode } = parse(source);

  const mappingNode =
    rootNode.namedChildren.find(n => n.type === 'mapping') ?? rootNode;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, schema);

  return result.value as Parsed<InferFields<T>>;
}

/**
 * Parse a source string using a custom schema, returning both value and diagnostics.
 * Passes the root node to dialect.parse(), matching the LSP pipeline flow.
 */
export function parseWithDiagnostics<T extends Schema>(
  source: string,
  schema: T
): ParseResult<InferFields<T>> {
  const { rootNode } = parse(source);
  const dialect = new Dialect();
  return dialect.parse(rootNode, schema) as ParseResult<InferFields<T>>;
}

/**
 * Parse an expression from source.
 */
export function parseExpression(source: string): Expression {
  // Wrap in a minimal structure to get a valid parse
  const wrappedSource = `test: ${source}`;
  const { rootNode } = parse(wrappedSource);

  // Find the value node
  const mappingNode = rootNode.namedChildren.find(n => n.type === 'mapping');
  if (!mappingNode) throw new Error('No mapping node found');

  const elementNode = mappingNode.namedChildren[0];
  if (!elementNode) throw new Error('No mapping element found');

  const valueNode =
    elementNode.childForFieldName('colinear_value') ??
    elementNode.childForFieldName('block_value');
  if (!valueNode) throw new Error('No value node found');

  const dialect = new Dialect();
  return dialect.parseExpression(valueNode);
}

/**
 * Emit a parsed document back to source.
 * Delegates to the generic `emitDocument` from `@agentscript/language`.
 */
export function emitDocument(
  parsed: Parsed<InferFields<typeof AgentScriptSchema>>
): string {
  return emitDocumentGeneric(parsed, AgentScriptSchema);
}

/**
 * Strip CST metadata from an object for comparison.
 * Creates a deep copy without __cst, __diagnostics, __comments.
 */
export function stripMeta<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(stripMeta) as T;
  }

  if (isNamedMap(obj)) {
    const result = new Map();
    for (const [k, v] of obj) {
      result.set(k, stripMeta(v));
    }
    return result as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    // Skip metadata fields
    if (
      key === '__cst' ||
      key === '__diagnostics' ||
      key === '__comments' ||
      key === '__paramCstNode' ||
      key === '__children'
    ) {
      continue;
    }
    result[key] = stripMeta(value);
  }

  return result as T;
}

/**
 * Compare two AST objects for structural equality, ignoring metadata.
 */
export function astEqual<T>(a: T, b: T): boolean {
  return JSON.stringify(stripMeta(a)) === JSON.stringify(stripMeta(b));
}

/**
 * Cast a Parsed node to AstRoot for passing to LintEngine.run().
 *
 * Parsed<InferFields<T>> has the same runtime shape as AstRoot (both carry
 * __cst, __diagnostics, and schema-defined fields) but differs at the type
 * level because AstRoot extends AstNodeLike's index signature. This helper
 * centralises the single unavoidable cast so tests stay clean.
 */
export function toAstRoot<T>(parsed: Parsed<T>): AstRoot {
  return parsed as unknown as AstRoot;
}

/**
 * Parse source and return the CST s-expression string.
 */
export function parseCst(source: string): string {
  const { rootNode } = parse(source);
  return rootNode.toSExp?.() ?? rootNode.type;
}
