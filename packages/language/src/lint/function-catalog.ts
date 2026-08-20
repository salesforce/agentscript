/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { BUILTIN_FUNCTION_NAMES } from '@agentscript/types';
import type { Range } from '../core/types.js';
import type { DiagnosticSeverity } from '../core/diagnostics.js';
import type { Expression } from '../core/expressions.js';
import { validateJsonPathCall } from './json-path-validation.js';

/**
 * A single lint finding produced by a function's argument validator. Kept
 * decoupled from the `Diagnostic` type so validators stay pure and easy to
 * unit-test; {@link expression-validation}'s pass converts each finding into a
 * real diagnostic via `lintDiagnostic` + `attachDiagnostic`.
 */
export interface CatalogFinding {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  code: string;
  suggestion?: string;
}

/**
 * Machine-readable description of a built-in function. This is the single
 * source of truth that drives function-name recognition, arity checking, and
 * per-function argument validation. Adding a new function is one entry here.
 */
export interface FunctionDefinition {
  /** The function name as written in source (e.g. `len`, `json_path`). */
  readonly name: string;
  /** Minimum number of arguments the function accepts. */
  readonly minArgs: number;
  /** Maximum number of arguments, or `null` for variadic (unbounded). */
  readonly maxArgs: number | null;
  /** Optional argument validators run after the arity check passes. */
  readonly validators?: ReadonlyArray<
    (args: readonly Expression[]) => CatalogFinding[]
  >;
}

/** A read-only catalog keyed by function name. */
export type FunctionCatalog = ReadonlyMap<string, FunctionDefinition>;

/**
 * Built-in functions recognized by the AgentScript runtime, with arity and
 * per-function validation. The arity bounds are intentionally permissive so
 * only genuinely malformed calls error:
 * - `len`  — exactly 1 argument.
 * - `max`/`min` — at least 1 argument (variadic).
 * - `json_path(obj, path, default?)` — 2 or 3 arguments, with selector checks.
 * - `lower`/`upper`/`to_json`/`from_json` — exactly 1 argument.
 *
 * The function *names* are the single source of truth in
 * `@agentscript/types` ({@link BUILTIN_FUNCTION_NAMES}), shared with the
 * pure-TS highlighter; the arity/validator metadata lives here.
 */
export const BUILTIN_CATALOG: FunctionCatalog = new Map<
  string,
  FunctionDefinition
>([
  ['len', { name: 'len', minArgs: 1, maxArgs: 1 }],
  ['max', { name: 'max', minArgs: 1, maxArgs: null }],
  ['min', { name: 'min', minArgs: 1, maxArgs: null }],
  [
    'json_path',
    {
      name: 'json_path',
      minArgs: 2,
      maxArgs: 3,
      validators: [validateJsonPathCall],
    },
  ],
  ['lower', { name: 'lower', minArgs: 1, maxArgs: 1 }],
  ['upper', { name: 'upper', minArgs: 1, maxArgs: 1 }],
  ['to_json', { name: 'to_json', minArgs: 1, maxArgs: 1 }],
  ['from_json', { name: 'from_json', minArgs: 1, maxArgs: 1 }],
]);

// Fail fast at module load if the catalog and BUILTIN_FUNCTION_NAMES drift —
// otherwise a name in only one gets highlighted but flagged unknown, or vice versa.
(() => {
  const catalogNames = new Set(BUILTIN_CATALOG.keys());
  const sharedNames = new Set<string>(BUILTIN_FUNCTION_NAMES);

  const missingFromCatalog = [...sharedNames].filter(
    name => !catalogNames.has(name)
  );
  const missingFromShared = [...catalogNames].filter(
    name => !sharedNames.has(name)
  );

  if (missingFromCatalog.length > 0 || missingFromShared.length > 0) {
    const details: string[] = [];
    if (missingFromCatalog.length > 0) {
      details.push(
        `missing from BUILTIN_CATALOG: ${missingFromCatalog.join(', ')}`
      );
    }
    if (missingFromShared.length > 0) {
      details.push(
        `missing from BUILTIN_FUNCTION_NAMES: ${missingFromShared.join(', ')}`
      );
    }
    throw new Error(
      `Built-in function catalog is out of sync with @agentscript/types ` +
        `BUILTIN_FUNCTION_NAMES (${details.join('; ')}). Add the function to ` +
        `both so highlighting and linting agree.`
    );
  }
})();

/**
 * Build a name-only catalog from a plain set of function names. Entries carry
 * no arity bounds (`minArgs: 0, maxArgs: null`) and no validators, preserving
 * the historical behavior of dialects (e.g. agentfabric) that supply a bare
 * `Set<string>` of allowed function names.
 */
export function catalogFromNames(names: ReadonlySet<string>): FunctionCatalog {
  const entries = new Map<string, FunctionDefinition>();
  for (const name of names) {
    entries.set(name, { name, minArgs: 0, maxArgs: null });
  }
  return entries;
}
