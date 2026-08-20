/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Names of the built-in functions recognized by the AgentScript runtime.
 *
 * This lives in the foundation `@agentscript/types` package so it can be shared
 * without a layering inversion:
 * - `@agentscript/language` builds its full function catalog (arity +
 *   validators) keyed off these names.
 * - `@agentscript/parser-javascript` uses them to tag `@function.builtin`
 *   highlight captures.
 *
 * Keep the tree-sitter `#any-of?` list in
 * `packages/parser-tree-sitter/queries/highlights.scm` in sync by hand
 * (tree-sitter queries can't import TypeScript).
 */
export const BUILTIN_FUNCTION_NAMES = [
  'len',
  'max',
  'min',
  'json_path',
  'lower',
  'upper',
  'to_json',
  'from_json',
] as const;

/** A built-in function name. */
export type BuiltinFunctionName = (typeof BUILTIN_FUNCTION_NAMES)[number];

/** Set form for O(1) membership checks. */
export const BUILTIN_FUNCTION_NAME_SET: ReadonlySet<string> = new Set(
  BUILTIN_FUNCTION_NAMES
);
