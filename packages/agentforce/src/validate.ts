/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Block validation utilities — pure read-only checks on block structure.
 *
 * Shared helpers for inspecting block metadata (schema, children, internal keys)
 * and strict-mode validation. These are intentionally kept separate from mutation
 * logic so that both emit and mutate modules can depend on them without coupling.
 */

import type { BlockCore, FieldType, BlockChild } from '@agentscript/language';
import { isNamedMap } from '@agentscript/language';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Keys that are internal block metadata and should never be synced. */
export function isInternalKey(key: string): boolean {
  return key.startsWith('__');
}

/**
 * Extract the effective schema from a block instance's constructor.
 *
 * For variant NamedBlocks (e.g., `ModalityBlock` with variant `voice`),
 * the base `schema` is empty — fields live in the variant schema.
 * This resolves the variant schema via `resolveSchemaForName` when
 * the instance has a `__name` (variant key).
 */
export function getBlockSchema(
  block: BlockCore
): Record<string, FieldType> | undefined {
  const ctor = block.constructor as {
    schema?: Record<string, FieldType>;
    resolveSchemaForName?: (name: string) => Record<string, FieldType>;
  };
  // Variant blocks: resolve merged schema using the instance's variant name
  const name = (block as { __name?: string }).__name;
  if (name && ctor.resolveSchemaForName) {
    return ctor.resolveSchemaForName(name);
  }
  return ctor.schema;
}

/** Get the __children array from a block, initializing it if absent. */
export function getBlockChildren(block: BlockCore): BlockChild[] {
  if (!block.__children) {
    (block as { __children: BlockChild[] }).__children = [];
  }
  return block.__children as BlockChild[];
}

// ---------------------------------------------------------------------------
// Strict schema validation
// ---------------------------------------------------------------------------

/**
 * Validate that all fields on a block are defined in its schema.
 * Throws if any non-schema field is found.
 */
export function validateStrictSchema(block: BlockCore): void {
  const schema = getBlockSchema(block);
  const record = block;

  for (const key of Object.keys(record)) {
    if (isInternalKey(key)) continue;
    const value = record[key];
    if (value === undefined || isNamedMap(value)) continue;
    if (!schema?.[key]) {
      throw new Error(
        `Strict mode: field "${key}" is not defined in the schema for ${block.__kind}`
      );
    }
  }

  const children = getBlockChildren(block);
  for (const child of children) {
    if (child.__type === 'field' && !child.entryName) {
      const key = child.key;
      if (!schema?.[key]) {
        throw new Error(
          `Strict mode: field "${key}" is not defined in the schema for ${block.__kind}`
        );
      }
    }
  }
}
