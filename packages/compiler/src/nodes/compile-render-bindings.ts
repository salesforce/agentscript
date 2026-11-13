/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Expression,
  NamedMap,
  ParameterDeclarationNode,
  RenderStatement,
} from '@agentscript/language';
import {
  WithClause,
  DictLiteral,
  ListLiteral,
  NoneLiteral,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { InputBindingValue } from '../types.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { getDeclaredFields } from '../surfaces/compile-response-formats.js';
import {
  extractBooleanValue,
  extractStringOrIdentifierValue,
  getExpressionName,
  isListType,
  iterateNamedMap,
} from '../ast-helpers.js';

type DeclaredInputs = NamedMap<ParameterDeclarationNode>;

/**
 * Compile the `with <input> = <value>` clauses under a `render:` into a render
 * rule's `input_bindings`.
 *
 * Binding is all-or-nothing: once any input is bound, every declared input of
 * the render target is emitted. Unbound inputs compile to their default value.
 *
 * Returns undefined when nothing is bound.
 */
export function compileRenderInputBindings(
  renderStmt: RenderStatement,
  surface: string,
  formatName: string,
  ctx: CompilerContext
): Record<string, InputBindingValue> | undefined {
  // A clause without a param exists only after a parse error; it binds nothing.
  const withClauses = renderStmt.body.filter(
    (s): s is WithClause => s instanceof WithClause && !!s.param
  );
  if (withClauses.length === 0) return undefined;

  const inputs = ctx.responseFormatInputs.get(surface)?.get(formatName);
  const previousConnection = ctx.connectionName;
  // `@inputs.Y` in a value resolves against this connection.
  ctx.connectionName = surface;
  try {
    const bindings = compileDefaultValues(inputs, ctx);
    // Last value wins, matching the render-with-duplicate-input warning.
    for (const stmt of withClauses) {
      bindings[stmt.param] = compileRenderInputBinding(
        stmt.value,
        getDeclaredFields(inputs?.get(stmt.param)?.properties),
        ctx
      );
    }
    return bindings;
  } finally {
    ctx.connectionName = previousConnection;
  }
}

/**
 * Compile one render input binding:
 *   - an inline dict or list keeps its structure, and a dict fills the fields
 *     it leaves out with their default value;
 *   - a bare `None` compiles to `null`;
 *   - any other value compiles like an action's `with` value, to an expression
 *     string. `@inputs.Y` resolves against the render's connection.
 *
 * `fields` are the declared fields of the bound object, or list item.
 */
function compileRenderInputBinding(
  value: Expression,
  fields: DeclaredInputs | undefined,
  ctx: CompilerContext
): InputBindingValue {
  if (value instanceof DictLiteral) {
    const result = compileDefaultValues(fields, ctx);
    for (const entry of value.entries) {
      // A computed key is a parse error.
      const key = extractStringOrIdentifierValue(entry.key);
      if (key === undefined) continue;
      result[key] = compileRenderInputBinding(
        entry.value,
        getDeclaredFields(fields?.get(key)?.properties),
        ctx
      );
    }
    return result;
  }
  if (value instanceof ListLiteral) {
    return value.elements.map(el => compileRenderInputBinding(el, fields, ctx));
  }
  if (value instanceof NoneLiteral) return null;
  return compileExpression(value, ctx, {
    expressionContext: "'render' with-binding",
  });
}

/**
 * Compile each declared input, or object field, to its default value.
 */
function compileDefaultValues(
  declared: DeclaredInputs | undefined,
  ctx: CompilerContext
): Record<string, InputBindingValue> {
  // Null prototype: a `__proto__` key is a plain entry, not the prototype.
  const inputMap: Record<string, InputBindingValue> = Object.create(null);
  for (const [name, decl] of iterateNamedMap(declared)) {
    inputMap[name] = compileDefaultValue(decl, ctx);
  }
  return inputMap;
}

/**
 * Compile the default value of one declared input: its declared default, or for
 * an object its fields' default values. `null` if it has no default.
 *
 * An unbound list without a default is `null`: its element defaults describe
 * an element, not that one exists.
 */
function compileDefaultValue(
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
): InputBindingValue {
  const fields = getDeclaredFields(decl.properties);
  if (decl.defaultValue) {
    return compileRenderInputBinding(decl.defaultValue, fields, ctx);
  }
  const isList =
    isListType(decl.type) || getExpressionName(decl.type) === 'list';
  if (!fields || isList) return null;
  const fieldMap = compileDefaultValues(fields, ctx);
  const isRequired =
    extractBooleanValue(decl.properties?.['is_required']) ?? true;
  if (!isRequired && isAllNull(fieldMap)) return null;
  return fieldMap;
}

/** True when every value in a compiled binding is `null`, at any depth. */
function isAllNull(value: InputBindingValue): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every(isAllNull);
  if (typeof value === 'object') return Object.values(value).every(isAllNull);
  return false;
}
