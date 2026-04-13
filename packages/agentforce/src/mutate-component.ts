/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Component mutation utilities.
 *
 * `mutateComponent()` provides helpers for operations that can't be expressed as
 * simple property assignment: field removal, NamedMap add/remove.
 *
 * The lower-level `syncBlockChildren()` lives in `children-sync.ts` so that both
 * this module and `emit-component.ts` can import it without a circular dependency.
 */

import type { BlockCore, FieldType } from '@agentscript/language';
import {
  NamedMap,
  isNamedMap,
  isCollectionFieldType,
} from '@agentscript/language';
import type { MutationHelpers } from './types.js';
import {
  upsertFieldChild,
  syncBlockField,
  syncBlockChildren,
  fallbackFieldType,
} from './children-sync.js';
import {
  getBlockSchema,
  getBlockChildren,
  validateStrictSchema,
} from './validate.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { validateStrictSchema } from './validate.js';
export { syncBlockChildren } from './children-sync.js';

/** Throw if strict mode is enabled and the key is not in the schema. */
function assertSchemaField(
  key: string,
  schema: Record<string, FieldType> | undefined,
  kind: string | undefined,
  strict: boolean | undefined
): void {
  if (strict && !schema?.[key]) {
    throw new Error(
      `Strict mode: field "${key}" is not defined in the schema for ${kind ?? 'unknown'}`
    );
  }
}

/**
 * Strategy for syncing `__children` — differs between document-root and block.
 *
 * Document-root stores one `FieldChild` per named entry (consumed by `emitDocument`).
 * Blocks store one `FieldChild` per NamedMap container (delegates to `NamedMap.__emit()`).
 *
 * @internal
 */
export interface ChildrenSyncStrategy {
  /** Sync a singular field to __children (upsert or remove). */
  syncField(key: string, value: unknown): void;
  /** Sync __children after adding a named entry. */
  addNamedChild(key: string, name: string, value: BlockCore): void;
  /** Sync __children after removing a named entry. */
  removeNamedChild(key: string, name: string): void;
}

/** @internal */
export interface BuildHelpersOptions {
  /** When true, throws if a field key is not in the schema. */
  strict?: boolean;
  /** Block kind label for error messages (e.g. `block.__kind`). */
  kind?: string;
}

/**
 * Build `MutationHelpers` for any target with a `__children` array.
 *
 * Shared between `Document.mutate()` (document-root) and `mutateComponent()`
 * (individual blocks). The `sync` strategy handles the structural difference
 * in how `__children` are managed at each level.
 *
 * @internal
 */
export function buildMutationHelpers<T>(
  target: T,
  schema: Record<string, FieldType> | undefined,
  sync: ChildrenSyncStrategy,
  options?: BuildHelpersOptions
): MutationHelpers<T> {
  const { strict, kind } = options ?? {};
  // BlockCore has [key: string]: unknown, but generic T can't be indexed for writing
  const record = target as Record<string, unknown>;
  return {
    setField(key: string, value: unknown) {
      assertSchemaField(key, schema, kind, strict);
      record[key] = value;
      sync.syncField(key, value);
    },

    removeField(key: string) {
      record[key] = undefined;
      sync.syncField(key, undefined);
    },

    addEntry(key: string, name: string, value: BlockCore) {
      assertSchemaField(key, schema, kind, strict);
      let map = record[key];
      if (!isNamedMap(map)) {
        const ft = schema?.[key];
        // Intentionally broad: both named and nested collections back entries
        // with NamedMap, so the constructor lookup applies to either variant.
        if (ft && isCollectionFieldType(ft)) {
          map = new (ft as unknown as new () => NamedMap<BlockCore>)();
        } else {
          map = NamedMap.forCollection<BlockCore>(key);
        }
        record[key] = map;
      }
      (map as NamedMap<BlockCore>).set(name, value);
      sync.addNamedChild(key, name, value);
    },

    removeEntry(key: string, name: string) {
      const map = record[key];
      if (isNamedMap(map)) {
        map.delete(name);
      }
      sync.removeNamedChild(key, name);
    },
  };
}

/**
 * Mutate a standalone block component in-place with helpers for operations
 * that can't be expressed as simple property assignment.
 *
 * For simple field changes, you can assign directly — `emitComponent()` auto-syncs.
 * Use `mutateComponent()` when you need helpers for operations that can't be expressed
 * as simple property assignment:
 * - **Remove** fields (`helpers.removeField()`)
 * - **Add/remove named entries** (`helpers.addEntry()` / `helpers.removeEntry()`)
 *
 * @example
 * ```typescript
 * // Simple field changes — assign directly, emitComponent auto-syncs:
 * topic.description = new StringLiteral('Updated');
 * topic.source = new StringLiteral('billing_v2'); // new field
 * emitComponent(topic); // both changes are emitted
 *
 * // For removal or NamedMap ops, use mutateComponent:
 * mutateComponent(topic, (block, helpers) => {
 *   helpers.removeField('source');
 *   helpers.addEntry('actions', 'myAction', actionBlock);
 * });
 * ```
 *
 * @returns The same block instance, for chaining.
 */
export interface MutateComponentOptions {
  /** When true, throws if any field is not defined in the block's schema. */
  strict?: boolean;
}

export function mutateComponent<T extends BlockCore>(
  block: T,
  fn: (block: T, helpers: MutationHelpers<T>) => void,
  options?: MutateComponentOptions
): T {
  const schema = getBlockSchema(block);
  const sync: ChildrenSyncStrategy = {
    syncField: (key, value) => syncBlockField(block, key, value, schema),
    addNamedChild: key => {
      const fieldType = schema?.[key] ?? fallbackFieldType;
      upsertFieldChild(getBlockChildren(block), key, block[key], fieldType);
    },
    removeNamedChild: () => {
      // Block-level: NamedMap.delete() already removes the MapEntryChild.
      // The container-level FieldChild stays and delegates to the NamedMap on emission.
    },
  };

  const helpers = buildMutationHelpers(block, schema, sync, {
    strict: options?.strict,
    kind: block.__kind,
  });

  fn(block, helpers);

  // Sync any remaining direct assignments the callback may have made
  syncBlockChildren(block);

  // Validate once at the end, after all mutations and sync are complete
  if (options?.strict) {
    validateStrictSchema(block);
  }

  return block;
}
