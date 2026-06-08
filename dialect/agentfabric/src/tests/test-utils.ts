/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/** Test utilities for parsing AgentFabric dialect sources. */
import { parse } from '@agentscript/parser';
import {
  Dialect,
  createSchemaContext,
  parseAndLint,
} from '@agentscript/language';
import type {
  SchemaContext,
  Schema,
  InferFields,
  Parsed,
  ParseResult,
} from '@agentscript/language';
import { AgentFabricSchema, AgentFabricSchemaInfo } from '../schema.js';
import { agentfabricDialect } from '../index.js';
import type { ParsedDocument } from '../index.js';

export const testSchemaCtx: SchemaContext = createSchemaContext(
  AgentFabricSchemaInfo
);

/**
 * Parse a complete AgentFabric source string into AST.
 */
export function parseDocument(source: string): ParsedDocument {
  const root = parse(source).rootNode;
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, AgentFabricSchema);
  return result.value;
}

/**
 * Parse a source string using a custom schema.
 */
export function parseWithSchema<T extends Schema>(
  source: string,
  schema: T
): Parsed<InferFields<T>> {
  const root = parse(source).rootNode;
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, schema);
  return result.value as Parsed<InferFields<T>>;
}

/**
 * Parse and return both value and diagnostics.
 */
export function parseWithDiagnostics<T extends Schema>(
  source: string,
  schema: T
): ParseResult<InferFields<T>> {
  const tree = parse(source);
  const dialect = new Dialect();
  return dialect.parse(tree.rootNode, schema) as ParseResult<InferFields<T>>;
}

/**
 * Cast a parsed document to Record<string, unknown> for compile().
 *
 * The compiler uses dynamic field access internally, so it accepts
 * Record<string, unknown>. Parsed<InferFields<T>> has the same runtime
 * shape but a narrower type-level signature. This centralises the cast.
 */
export function toRecord<T>(parsed: Parsed<T>): Record<string, unknown> {
  return parsed as unknown as Record<string, unknown>;
}

/**
 * Parse and lint a source string using the AgentFabric dialect.
 */
export function parseAndLintSource(source: string) {
  const tree = parse(source);
  return parseAndLint(tree.rootNode, agentfabricDialect);
}
