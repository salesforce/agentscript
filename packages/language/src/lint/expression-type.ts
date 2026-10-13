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
 * or null when it can't (lists, dicts, None, data-dependent calls, ternaries,
 * and unresolved references all return null — callers should treat them as
 * "skip type check"). Built-in calls with a fixed return type (e.g.
 * lower/upper → string) resolve to that type.
 *
 * For `@variables.X` references, callers may supply a {@link VariableTypeResolver}
 * to look up dialect-specific variable types (e.g. 'list[string]'). Resolved
 * types are returned verbatim, except case-insensitive 'boolean' is normalized
 * to lowercase so callers can compare with `=== 'boolean'`.
 */
import { KIND_LABELS, decomposeAtMemberChain } from '../core/expressions.js';
import type { ExpressionKind } from '../core/expressions.js';
import { extractVariableRef } from './lint-utils.js';

/** Resolve `@variables.X` to a dialect-specific type string. */
export type VariableTypeResolver = (varName: string) => string | null;

/**
 * Built-in calls whose return type is fixed regardless of arguments. Others
 * (from_json, json_path, min, max) depend on runtime data and stay un-inferable.
 */
const BUILTIN_RETURN_TYPES: Record<string, string> = {
  lower: 'string',
  upper: 'string',
  concat: 'string',
  to_json: 'string',
  len: 'number',
};

/**
 * Resolve a global-scope member reference (e.g. `@system_variables.last_reply.interrupted`)
 * to its declared primitive type, or null when the namespace/path is not a
 * typed global-scope member.
 */
export type GlobalMemberTypeResolver = (
  namespace: string,
  path: readonly string[]
) => string | null;

/**
 * Infer the AgentScript type of an expression when statically determinable.
 *
 * Returns:
 * - 'boolean' for BooleanLiteral, ComparisonExpression, and `and`/`or`/`not`
 * - 'string' for StringLiteral, TemplateExpression, and `+` with a string operand
 *   (concatenation)
 * - 'number' for NumberLiteral, unary +/-, and arithmetic BinaryExpression
 *   (`-`/`*`/`/`, or any `+` without a string operand — `+` defaults to
 *   arithmetic since it is never boolean)
 * - For `@variables.X`: the resolver's return value (e.g. 'list[string]'),
 *   with 'boolean' normalized to lowercase
 * - For a built-in call with a fixed return type: that type (e.g. 'string' for
 *   lower/upper/concat/to_json, 'number' for len)
 * - null otherwise (None, list/dict literals, data-dependent calls, ternaries,
 *   unresolved references) — callers should skip type checks on null
 */
export function inferExpressionType(
  expr: unknown,
  resolveVariable?: VariableTypeResolver,
  resolveGlobalMember?: GlobalMemberTypeResolver
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
      // `+` is overloaded: string concatenation when either operand is a known
      // string, otherwise numeric addition. When neither operand resolves we
      // assume arithmetic — `+` is never boolean, so defaulting to number keeps
      // it flagged where a boolean is expected (e.g. `available when @x + 1`).
      if (op === '+') {
        const left = inferExpressionType(
          obj.left,
          resolveVariable,
          resolveGlobalMember
        );
        const right = inferExpressionType(
          obj.right,
          resolveVariable,
          resolveGlobalMember
        );
        if (left === 'string' || right === 'string') return 'string';
        return 'number';
      }

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

    // Built-in calls with a fixed return type (e.g. lower/upper → string).
    case 'CallExpression': {
      const func = (obj as { func?: { __kind?: string; name?: string } }).func;
      if (func?.__kind === 'Identifier' && func.name) {
        return BUILTIN_RETURN_TYPES[func.name] ?? null;
      }
      return null;
    }

    // A keyword argument has its value's type.
    case 'KeywordArgument':
      return inferExpressionType(
        (obj as { value: unknown }).value,
        resolveVariable,
        resolveGlobalMember
      );

    case 'MemberExpression':
    case 'AtIdentifier': {
      if (resolveVariable) {
        const varName = extractVariableRef(expr);
        if (varName) {
          const t = resolveVariable(varName);
          if (t) return t.toLowerCase() === 'boolean' ? 'boolean' : t;
        }
      }
      if (resolveGlobalMember) {
        const chain = decomposeAtMemberChain(expr);
        if (chain) {
          const t = resolveGlobalMember(chain.namespace, chain.path);
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
