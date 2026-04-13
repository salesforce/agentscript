/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * `emitComponent()` — emit a standalone block, statement, or expression to source text.
 *
 * Accepts anything returned by `parseComponent()` (a block instance, `Statement[]`,
 * a single `Statement`, or an `Expression`) and emits it back to AgentScript source.
 *
 * For block kinds, emits the full block including its header:
 * - Named blocks: `topic billing:\n    description: "Billing"`
 * - Singular blocks: `config:\n    description: "My agent"`
 *
 * This function is Agentforce-dialect specific. It uses the AgentforceSchema
 * to resolve block `__kind` values back to schema keys for header emission.
 *
 * @example
 * ```typescript
 * const topic = parseComponent('topic billing:\n  description: "Billing"', 'topic', parser);
 * emitComponent(topic);  // 'topic billing:\n    description: "Billing"'
 *
 * const stmts = parseComponent('run MyAction()', 'statement', parser);
 * emitComponent(stmts);  // 'run MyAction()'
 *
 * const expr = parseComponent('"hello " + name', 'expression', parser);
 * emitComponent(expr);   // '"hello " + name'
 * ```
 *
 * `emitComponent()` automatically calls `syncBlockChildren()` for block inputs,
 * so directly assigned fields are always emitted correctly without a manual sync step.
 */

import type {
  EmitContext,
  Statement,
  Expression,
  BlockCore,
} from '@agentscript/language';
import {
  emitIndent,
  isEmittable,
  isNamedBlockValue,
  isSingularBlock,
} from '@agentscript/language';
import { AgentforceKindToSchemaKey } from '@agentscript/agentforce-dialect';
import { validateStrictSchema } from './validate.js';
import { syncBlockChildren } from './children-sync.js';

const kindToSchemaKey = AgentforceKindToSchemaKey;

export interface EmitComponentOptions {
  tabSize?: number;
  /** When true, throws if any field is not defined in the block's schema. */
  strict?: boolean;
}

/**
 * Emit a parsed component back to AgentScript source text.
 *
 * Handles all `parseComponent()` return types:
 * - Block instances (topic, config, etc.) — emitted with their full header
 * - `Statement[]` arrays
 * - Single `Statement` or `Expression` values
 *
 * When `strict: true`, throws if the block contains non-schema fields.
 */
export function emitComponent(
  component: BlockCore | Statement[] | Statement | Expression | undefined,
  options?: EmitComponentOptions
): string {
  if (component == null) return '';

  // Auto-sync block children so callers don't need to remember a pre-step.
  if (
    !Array.isArray(component) &&
    '__kind' in component &&
    '__children' in component
  ) {
    if (options?.strict) {
      validateStrictSchema(component as BlockCore);
    }
    syncBlockChildren(component as BlockCore);
  }

  const ctx: EmitContext = { indent: 0, tabSize: options?.tabSize };

  // Statement array — emit each and join with newlines
  if (Array.isArray(component)) {
    return component
      .filter(isEmittable)
      .map(s => s.__emit(ctx))
      .join('\n');
  }

  // Named block — emit with schema key header (e.g., "topic billing:\n  ...")
  // If the kind is not in the map (e.g. ActionBlock — a collection entry, not a
  // top-level schema key), fall back to __emit() which emits as just "Name:\n..."
  if (isNamedBlockValue(component)) {
    const schemaKey = kindToSchemaKey.get(component.__kind);
    if (schemaKey) {
      return component.emitWithKey(schemaKey, ctx);
    }
    return component.__emit(ctx);
  }

  // Singular block — emit with key header (e.g., "config:\n  ...")
  if (isSingularBlock(component)) {
    const schemaKey = kindToSchemaKey.get(component.__kind) ?? component.__kind;
    const indent = emitIndent(ctx);
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    return `${indent}${schemaKey}:\n${component.__emit(childCtx)}`;
  }

  // Single emittable value (statement or expression)
  if (isEmittable(component)) {
    return component.__emit(ctx);
  }

  return '';
}
