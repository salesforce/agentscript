/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Test utilities for parsing Agentforce documents.
 */

import { parse } from '@agentscript/parser';
import {
  Dialect,
  createSchemaContext,
  emitDocument as emitDocumentGeneric,
} from '@agentscript/language';
import type { SchemaContext } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { AgentforceSchema, AgentforceSchemaInfo } from '../schema.js';
import type { ParsedAgentforce } from '../index.js';

/** Pre-computed schema context for tests. */
export const testSchemaCtx: SchemaContext =
  createSchemaContext(AgentforceSchemaInfo);

/**
 * Parse a complete Agentforce source string into AST.
 */
export function parseDocument(source: string): ParsedAgentforce {
  const { rootNode: root } = parse(source);

  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, AgentforceSchema);

  return result.value;
}

/**
 * Parse a complete Agentforce source string, returning value + all diagnostics.
 */
export function parseWithDiagnostics(source: string): {
  value: ReturnType<typeof parseDocument>;
  diagnostics: Diagnostic[];
} {
  const { rootNode: root } = parse(source);

  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, AgentforceSchema);

  return {
    value: result.value,
    diagnostics: result.diagnostics,
  };
}

/**
 * Emit a parsed Agentforce document back to source.
 */
export function emitDocument(parsed: ReturnType<typeof parseDocument>): string {
  return emitDocumentGeneric(parsed, AgentforceSchema);
}
