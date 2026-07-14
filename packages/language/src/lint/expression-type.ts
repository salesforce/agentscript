/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lightweight expression type inference shared across lint passes.
 *
 * Returns an AgentScript type string when one can be statically determined,
 * or null when it can't (lists, dicts, None, function calls, ternaries, and
 * unresolved references all return null — callers should treat them as
 * "skip type check").
 *
 * For `@variables.X` references, callers may supply a {@link VariableTypeResolver}
 * to look up dialect-specific variable types (e.g. 'list[string]'). Resolved
 * types are returned verbatim, except case-insensitive 'boolean' is normalized
 * to lowercase so callers can compare with `=== 'boolean'`.
 */
import { KIND_LABELS } from '../core/expressions.js';
import type { ExpressionKind } from '../core/expressions.js';
import { extractVariableRef } from './lint-utils.js';

/** Resolve `@variables.X` to a dialect-specific type string. */
export type VariableTypeResolver = (varName: string) => string | null;

/**
 * Infer the AgentScript type of an expression when statically determinable.
 *
 * Returns:
 * - 'boolean' for BooleanLiteral, ComparisonExpression, and `and`/`or`/`not`
 * - 'string' for StringLiteral, TemplateExpression
 * - 'number' for NumberLiteral, arithmetic BinaryExpression, unary +/-
 * - For `@variables.X`: the resolver's return value (e.g. 'list[string]'),
 *   with 'boolean' normalized to lowercase
 * - null otherwise (None, list/dict literals, function calls, ternaries,
 *   unresolved references) — callers should skip type checks on null
 */
export function inferExpressionType(
  expr: unknown,
  resolveVariable?: VariableTypeResolver
): string | null {
  if (!expr || typeof expr !== 'object') return null;
  const obj = expr as Record<string, unknown>;

  switch (obj.__kind) {
    case 'BooleanLiteral':
    case 'ComparisonExpression':
      return 'boolean';

    case 'BinaryExpression': {
      const op = obj.operator as string | undefined;
      if (op === 'and' || op === 'or') return 'boolean';
      return 'number';
    }

    case 'UnaryExpression': {
      const op = obj.operator as string | undefined;
      if (op === 'not') return 'boolean';
      return 'number';
    }

    case 'StringLiteral':
    case 'TemplateExpression':
      return 'string';
    case 'NumberLiteral':
      return 'number';

    case 'MemberExpression':
    case 'AtIdentifier': {
      if (resolveVariable) {
        const varName = extractVariableRef(expr);
        if (varName) {
          const t = resolveVariable(varName);
          if (t) return t.toLowerCase() === 'boolean' ? 'boolean' : t;
        }
      }
      return null;
    }

    default:
      return null;
  }
}

/** Maps inferred primitive types to the corresponding KIND_LABELS entry. */
const PRIMITIVE_TYPE_KINDS: Record<string, ExpressionKind> = {
  string: 'StringLiteral',
  number: 'NumberLiteral',
};

/**
 * Human-readable label for an inferred type, e.g. 'a string', 'a number'.
 *
 * For primitive types, reuses the phrasing from {@link KIND_LABELS} in
 * core/expressions.ts to avoid drift. For dialect-specific types from a
 * variable resolver (e.g. 'list[string]'), quotes the type verbatim.
 */
export function inferredTypeLabel(type: string): string {
  const kind = PRIMITIVE_TYPE_KINDS[type];
  if (kind) return KIND_LABELS.get(kind) ?? `'${type}'`;
  if (type === 'boolean') return 'a boolean';
  return `'${type}'`;
}
