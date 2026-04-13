/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { EmitContext, FieldType, Parsed, InferFields } from './types.js';
import {
  emitIndent,
  isNamedMap,
  isNamedCollectionFieldType,
  wrapWithComments,
} from './types.js';
import type { BlockChild } from './children.js';
import { emitChildren, isNamedBlockValue } from './children.js';

function isBlockChildArray(value: unknown): value is BlockChild[] {
  return Array.isArray(value);
}

/**
 * Emit a parsed document back to source text.
 *
 * Prefers `__children` for CST-order output (preserves original source order).
 * Falls back to schema-based emission for manually constructed objects that
 * lack `__children` (e.g., objects not created through Block/NamedBlock constructors).
 *
 * Top-level entries are separated by blank lines (`\n\n`), while fields within
 * a block use single newlines (`\n`) — see `BlockNode.__emit`.
 */
export function emitDocument<S extends Record<string, FieldType>>(
  parsed: Parsed<InferFields<S>>,
  schema: S,
  options?: { tabSize?: number }
): string;
export function emitDocument(
  parsed: Record<string, unknown>,
  schema: Record<string, FieldType>,
  options?: { tabSize?: number }
): string;
export function emitDocument(
  parsed: Record<string, unknown>,
  schema: Record<string, FieldType>,
  options?: { tabSize?: number }
): string {
  const ctx: EmitContext = { indent: 0, tabSize: options?.tabSize };
  const rawChildren = parsed.__children;
  if (isBlockChildArray(rawChildren) && rawChildren.length > 0) {
    const emitted = emitChildren(rawChildren, ctx, '\n\n');
    return wrapWithComments(emitted, parsed, ctx);
  }
  // Fallback: emit from schema for objects without __children
  // (e.g., manually constructed without Block/NamedBlock constructors)
  const emitted = emitFromSchema(parsed, schema, ctx);
  return wrapWithComments(emitted, parsed, ctx);
}

/**
 * Schema-based emission fallback for objects without `__children`.
 * Iterates schema fields in definition order rather than CST order.
 */
function emitFromSchema(
  parsed: Record<string, unknown>,
  schema: Record<string, FieldType>,
  ctx: EmitContext
): string {
  const parts: string[] = [];
  for (const [key, fieldType] of Object.entries(schema)) {
    const value = parsed[key];
    if (value === undefined) continue;

    if (isNamedMap(value) && isNamedCollectionFieldType(fieldType)) {
      // Top-level named entries (NamedCollectionBlock):
      // emit each entry with its schema key (e.g., "subagent main:")
      for (const [, entry] of value) {
        if (isNamedBlockValue(entry)) {
          parts.push(wrapWithComments(entry.emitWithKey(key, ctx), entry, ctx));
        }
      }
    } else if (fieldType.emitField) {
      const s = fieldType.emitField(key, value, ctx);
      if (s) parts.push(wrapWithComments(s, value, ctx));
    } else if (fieldType.emit) {
      const indent = emitIndent(ctx);
      parts.push(
        wrapWithComments(
          `${indent}${key}: ${fieldType.emit(value, ctx)}`,
          value,
          ctx
        )
      );
    }
  }
  return parts.join('\n\n');
}
