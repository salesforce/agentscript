/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Internal utilities for keeping `__children` arrays in sync with AST mutations.
 *
 * Provides low-level helpers that operate on any `BlockChild[]` array,
 * block-level sync (`syncBlockChildren` / `syncBlockField`), and
 * higher-level wrappers for document-root (`AstRoot`) mutations.
 *
 * Both `emit-component.ts` and `mutate-component.ts` import from this module,
 * keeping the dependency graph a clean DAG.
 */

import type {
  AstRoot,
  FieldType,
  BlockCore,
  EmitContext,
} from '@agentscript/language';
import type { BlockChild } from '@agentscript/language';
import {
  FieldChild,
  NamedMap,
  isNamedMap,
  isEmittable,
  defineFieldAccessors,
} from '@agentscript/language';
import { isInternalKey, getBlockSchema, getBlockChildren } from './validate.js';

// ---------------------------------------------------------------------------
// Shared low-level helpers (operate on any BlockChild[] array)
// ---------------------------------------------------------------------------

/**
 * Upsert or remove a non-named FieldChild in a `__children` array.
 *
 * - `value === undefined` → removes the existing entry (if any).
 * - Existing entry found   → updates its `value`.
 * - No existing entry       → creates a new `FieldChild` and appends it.
 *
 * @returns The created or updated `FieldChild`, or `undefined` if removed / no fieldType.
 */
export function upsertFieldChild(
  children: BlockChild[],
  key: string,
  value: unknown,
  fieldType: FieldType | undefined
): FieldChild | undefined {
  const idx = children.findIndex(
    c => c.__type === 'field' && c.key === key && !c.entryName
  );

  if (value === undefined) {
    if (idx >= 0) children.splice(idx, 1);
    return undefined;
  }

  if (idx >= 0) {
    const existing = children[idx] as FieldChild;
    existing.value = value;
    return existing;
  }

  if (!fieldType) return undefined;
  const fc = new FieldChild(key, value, fieldType);
  children.push(fc);
  return fc;
}

/**
 * Add or update a named entry's FieldChild in a `__children` array.
 *
 * If a FieldChild with the same key and entryName already exists, updates its
 * value in place. Otherwise appends a new one.
 */
export function upsertNamedFieldChild(
  children: BlockChild[],
  key: string,
  name: string,
  value: unknown,
  fieldType: FieldType
): void {
  const idx = children.findIndex(
    c => c.__type === 'field' && c.key === key && c.entryName === name
  );
  if (idx >= 0) {
    (children[idx] as FieldChild).value = value;
  } else {
    children.push(new FieldChild(key, value, fieldType, name));
  }
}

/**
 * Remove a named entry's FieldChild from a `__children` array.
 */
export function removeNamedFieldChild(
  children: BlockChild[],
  key: string,
  name: string
): void {
  const idx = children.findIndex(
    c => c.__type === 'field' && c.key === key && c.entryName === name
  );
  if (idx >= 0) children.splice(idx, 1);
}

// ---------------------------------------------------------------------------
// Block-level sync (used by both emit-component and mutate-component)
// ---------------------------------------------------------------------------

/**
 * Fallback FieldType for non-schema fields.
 * Emits by delegating to `value.__emit()` for AST nodes, or `String(value)` for primitives.
 */
export const fallbackFieldType: FieldType = {
  __fieldKind: 'Primitive',
  parse: () => {
    throw new Error('fallbackFieldType does not support parsing');
  },
  emit: (value: unknown, ctx: EmitContext): string => {
    if (isEmittable(value)) {
      return (value as { __emit(ctx: EmitContext): string }).__emit(ctx);
    }
    return String(value ?? '');
  },
};

/**
 * Sync a single field on a block's __children.
 *
 * - If value is `undefined`, removes the FieldChild and deletes the accessor.
 * - If a FieldChild exists, updates its value.
 * - If no FieldChild exists, creates one and defines a getter/setter accessor.
 */
export function syncBlockField(
  block: BlockCore,
  key: string,
  value: unknown,
  schema: Record<string, FieldType> | undefined
): void {
  const children = getBlockChildren(block);
  const fc = upsertFieldChild(
    children,
    key,
    value,
    schema?.[key] ?? fallbackFieldType
  );

  if (value === undefined) {
    // Property removed — clean up the accessor
    delete block[key];
    return;
  }

  if (fc && !Object.getOwnPropertyDescriptor(block, key)?.get) {
    // New field: define getter/setter accessor closing over the FieldChild directly.
    // Reuses the same strategy as the language package's defineFieldAccessors (O(1)).
    defineFieldAccessors(block, [fc]);
  }
}

/**
 * Return the set of all field keys that should be considered for sync.
 * Includes all enumerable own keys (excluding __-prefixed internals)
 * plus all schema keys (which may not yet be own properties).
 */
function collectFieldKeys(
  record: Record<string, unknown>,
  schema: Record<string, FieldType> | undefined
): Set<string> {
  const keys = new Set<string>();
  for (const key of Object.keys(record)) {
    if (!isInternalKey(key)) keys.add(key);
  }
  if (schema) {
    for (const key of Object.keys(schema)) {
      keys.add(key);
    }
  }
  return keys;
}

/**
 * Sync a block's enumerable properties to its `__children` array.
 *
 * Scans the block for properties that don't have a corresponding `FieldChild`
 * in `__children` and creates one (plus a getter/setter accessor). This ensures
 * that directly assigned fields are emitted correctly.
 *
 * Called automatically by `emitComponent()` and `mutateComponent()`.
 * Can also be called explicitly if needed.
 *
 * Note: This function only syncs — it does not validate. Callers that need
 * strict schema validation should call `validateStrictSchema()` separately.
 */
export function syncBlockChildren(block: BlockCore): void {
  const schema = getBlockSchema(block);
  const record = block;

  for (const key of collectFieldKeys(record, schema)) {
    const value = record[key];
    if (value === undefined || isNamedMap(value)) continue;
    syncBlockField(block, key, value, schema);
  }
}

// ---------------------------------------------------------------------------
// Document-root helpers (operate on AstRoot)
// ---------------------------------------------------------------------------

function getChildren(ast: AstRoot): BlockChild[] {
  // AstRoot extends AstNodeLike which declares __children as optional;
  // at runtime the parser always populates it on document roots.
  return ast.__children ?? [];
}

/**
 * Update or add a FieldChild for a singular (non-named) root block.
 *
 * If a FieldChild with the same key already exists, updates its value.
 * If the value is undefined, removes the FieldChild.
 * If no FieldChild exists, creates one and appends it.
 */
export function syncSingularField(
  ast: AstRoot,
  key: string,
  value: unknown,
  schema: Record<string, FieldType>
): void {
  upsertFieldChild(getChildren(ast), key, value, schema[key]);
}

/**
 * Add a named entry's FieldChild to the document's __children array.
 *
 * This is needed because NamedMap.set() only updates the NamedMap's own
 * __children — it doesn't touch the document-level __children which
 * emitDocument() reads.
 */
export function addNamedEntryChild(
  ast: AstRoot,
  key: string,
  name: string,
  value: BlockCore,
  schema: Record<string, FieldType>
): void {
  const fieldType = schema[key];
  if (fieldType) {
    upsertNamedFieldChild(getChildren(ast), key, name, value, fieldType);
  }
}

/**
 * Remove a named entry's FieldChild from the document's __children array.
 */
export function removeNamedEntryChild(
  ast: AstRoot,
  key: string,
  name: string
): void {
  removeNamedFieldChild(getChildren(ast), key, name);
}

/**
 * Ensure a NamedMap exists for the given key on the AST root.
 * Creates one if it doesn't exist.
 */
export function ensureNamedMap(ast: AstRoot, key: string): NamedMap<BlockCore> {
  let map = ast[key] as NamedMap<BlockCore> | undefined;
  if (!map) {
    map = NamedMap.forCollection<BlockCore>(key);
    ast[key] = map;
  }
  return map;
}
