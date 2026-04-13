/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Range,
  SyntaxNode,
  Parsed,
  AstNodeLike,
  ParseResult,
} from './types.js';
import { toRange, hasCstRange } from './types.js';
import { formatSuggestionHint } from '../lint/lint-utils.js';

// Diagnostic types — canonical definitions live in @agentscript/types.
// Re-exported here so internal language modules can import from './diagnostics.js'.
export { DiagnosticSeverity, DiagnosticTag } from '@agentscript/types';
export type { Diagnostic } from '@agentscript/types';

import { DiagnosticSeverity, DiagnosticTag } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';

export function createDiagnostic(
  rangeOrNode: Range | Parsed<object> | SyntaxNode,
  message: string,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  code?: string,
  data?: Diagnostic['data']
): Diagnostic {
  let range: Range;

  if (hasCstRange(rangeOrNode)) {
    range = rangeOrNode.__cst.range;
  } else if ('startPosition' in rangeOrNode) {
    range = toRange(rangeOrNode);
  } else if ('start' in rangeOrNode && 'end' in rangeOrNode) {
    range = rangeOrNode;
  } else {
    throw new Error(
      'createDiagnostic: expected Range, SyntaxNode, or Parsed node with __cst'
    );
  }

  return {
    range,
    message,
    severity,
    code,
    source: 'agentscript-schema',
    ...(data ? { data } : {}),
  };
}

export function undefinedReferenceDiagnostic(
  range: Range,
  message: string,
  referenceName: string,
  suggestion?: string,
  expected?: string[]
): Diagnostic {
  const fullMessage = formatSuggestionHint(message, suggestion);
  return {
    range,
    message: fullMessage,
    severity: DiagnosticSeverity.Error,
    code: 'undefined-reference',
    source: 'agentscript-lint',
    data: {
      referenceName,
      ...(suggestion ? { suggestion } : {}),
      ...(expected && expected.length > 0 ? { expected } : {}),
    },
  };
}

/**
 * Push a diagnostic onto an AST node's __diagnostics array.
 *
 * Throws if the node lacks __diagnostics, indicating a programming error
 * (not a valid AST node). All AST nodes initialize __diagnostics via
 * AstNodeBase, createNode(), or withCst().
 */
export function attachDiagnostic(
  node: AstNodeLike,
  diagnostic: Diagnostic
): void {
  const arr = node.__diagnostics;
  if (Array.isArray(arr)) {
    arr.push(diagnostic);
    return;
  }
  throw new Error(
    `attachDiagnostic: target node lacks __diagnostics array ` +
      `(kind: ${node.__kind ?? 'unknown'}). ` +
      `Ensure the node was created via withCst(), createNode(), or extends AstNodeBase.`
  );
}

/**
 * Create a diagnostic for a parser-level ERROR or MISSING CST node.
 * Source is always 'parser' — no exceptions.
 */
export function createParserDiagnostic(
  rangeOrNode: Range | SyntaxNode,
  message: string,
  code: 'syntax-error' | 'missing-token'
): Diagnostic {
  const range: Range =
    'startPosition' in rangeOrNode ? toRange(rangeOrNode) : rangeOrNode;
  return {
    range,
    message,
    severity: DiagnosticSeverity.Error,
    code,
    source: 'parser',
  };
}

export function typeMismatchDiagnostic(
  range: Range,
  message: string,
  expectedType: string,
  actualType: string,
  source: string = 'agentscript-schema'
): Diagnostic {
  return {
    range,
    message,
    severity: DiagnosticSeverity.Error,
    code: 'type-mismatch',
    source,
    data: { expectedType, actualType },
  };
}

export class DeprecatedFieldDiagnostic implements Diagnostic {
  severity = DiagnosticSeverity.Warning;
  code = 'deprecated-field';
  source = 'agentscript';
  tags = [DiagnosticTag.Deprecated];
  data?: { replacement?: string; [key: string]: unknown };

  constructor(
    public range: Range,
    public message: string,
    replacement?: string
  ) {
    if (replacement) {
      this.data = { replacement };
    }
  }
}

/**
 * Tracks diagnostics at two levels: own (generated at this parse level) and
 * all (own + child). Eliminates the error-prone dual-push pattern where every
 * diagnostic creation site had to remember to push to both arrays.
 *
 * - `add(diag)` — diagnostic generated at THIS level → pushed to both
 * - `merge(result)` — child parse result → only pushed to `all`
 * - `own` → attach to node's `__diagnostics` (no child duplication)
 * - `all` → return in `parseResult()` (complete picture for caller)
 */
export class DiagnosticCollector {
  readonly all: Diagnostic[] = [];
  readonly own: Diagnostic[] = [];

  /** Record a diagnostic generated at this parse level. */
  add(diag: Diagnostic): void {
    this.all.push(diag);
    this.own.push(diag);
  }

  /** Incorporate diagnostics from a child parse result. */
  merge(result: ParseResult<unknown>): void {
    this.all.push(...result.diagnostics);
  }

  /** Incorporate an array of child diagnostics. */
  mergeAll(diags: Diagnostic[]): void {
    this.all.push(...diags);
  }
}
