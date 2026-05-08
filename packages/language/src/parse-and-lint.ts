/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Stateless parse-and-lint — one-shot pipeline: parse → lint → return results.
 * Unlike LanguageService (stateful), this is for CLI, CI, and testing.
 */

import type { AstRoot } from './core/types.js';
import type { Diagnostic } from './core/diagnostics.js';
import { Dialect } from './core/dialect.js';
import { LintEngine, PassStore } from './core/analysis/lint-engine.js';
import { createSchemaContext } from './core/analysis/scope.js';
import type { DialectConfig } from './dialect-config.js';
import type { SyntaxNode } from './core/types.js';

export function parseAndLint(
  node: SyntaxNode,
  dialect: DialectConfig,
  options?: { dialectParser?: Dialect; engine?: LintEngine }
): { ast: AstRoot; diagnostics: Diagnostic[]; store: PassStore } {
  const schemaCtx = createSchemaContext(dialect.schemaInfo);

  const source = dialect.source ?? `${dialect.name}-lint`;
  const parser = options?.dialectParser ?? new Dialect();
  // Parser-level diagnostics (ERROR/MISSING nodes) are now collected
  // inside Dialect.parse() with source 'parser' — no separate CST walk needed.
  const result = parser.parse(node, dialect.schemaInfo.schema);
  const ast = result.value as AstRoot;

  const engine =
    options?.engine ??
    new LintEngine({
      passes: dialect.createRules(),
      source,
    });

  const { diagnostics: lintDiagnostics, store } = engine.run(ast, schemaCtx);
  // lintDiagnostics includes collectDiagnostics(ast) which walks all
  // __diagnostics on AST nodes. Deduplicate against result.diagnostics
  // to avoid double-counting parse diagnostics that appear on both the
  // AST nodes and the ParseResult's flat diagnostics array.
  const seen = new Set<Diagnostic>(lintDiagnostics);
  const uniqueParseDiags = result.diagnostics.filter(d => !seen.has(d));
  return {
    ast,
    diagnostics: [...uniqueParseDiags, ...lintDiagnostics],
    store,
  };
}
