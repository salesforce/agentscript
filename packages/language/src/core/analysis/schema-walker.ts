/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot, FieldType, AstNodeLike, Schema } from '../types.js';
import {
  astField,
  isNamedMap,
  isAstNodeLike,
  isCollectionFieldType,
  extractDiscriminantValue,
  hasDiscriminant,
} from '../types.js';
import { SequenceNode } from '../sequence.js';

export interface SchemaFieldVisitor {
  /** Called for each schema field within a block instance. `value` is undefined when the field is absent. */
  visitField?(
    value: unknown,
    fieldType: FieldType,
    fieldName: string,
    instance: AstNodeLike
  ): void;
}

/** Resolve a potentially array-wrapped schema entry to a single FieldType and its inner schema. */
function resolveSchemaEntry(rawFt: FieldType | FieldType[]): {
  fieldType: FieldType;
  innerSchema: Schema | undefined;
} {
  const fieldType = Array.isArray(rawFt) ? rawFt[0] : rawFt;
  return { fieldType, innerSchema: fieldType.schema };
}

function isSchema(value: unknown): value is Schema {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Check a block instance against its schema, calling visitField for every
 * field (present or absent), then recursing into nested structure.
 */
function checkInstance(
  instance: AstNodeLike,
  schema: Schema,
  visitor: SchemaFieldVisitor
): void {
  for (const [fieldName, rawFt] of Object.entries(schema)) {
    const { fieldType, innerSchema } = resolveSchemaEntry(rawFt);
    const value = instance[fieldName];

    visitor.visitField?.(value, fieldType, fieldName, instance);

    if (value !== undefined) {
      checkFieldValue(value, fieldType, innerSchema, visitor);
    }
  }
}

/** Recurse into a field value for nested Blocks, NamedBlocks (Maps), and Sequences. */
function checkFieldValue(
  value: unknown,
  fieldType: FieldType,
  innerSchema: Schema | undefined,
  visitor: SchemaFieldVisitor
): void {
  // TypedMap: iterate entries and visit their properties schema.
  // TypedMap entries are TypedDeclaration nodes where properties live in
  // `entry.properties` (a BlockCore sub-object), not directly on the entry.
  if (fieldType.__fieldKind === 'TypedMap' && isNamedMap(value)) {
    const typedMapProps =
      'propertiesSchema' in fieldType && isSchema(fieldType.propertiesSchema)
        ? fieldType.propertiesSchema
        : undefined;
    if (typedMapProps) {
      for (const [, entry] of value) {
        if (isAstNodeLike(entry)) {
          const props = entry.properties;
          if (isAstNodeLike(props)) {
            checkInstance(props, typedMapProps, visitor);
          }
        }
      }
    }
  }
  // Intentionally broad: both named and nested collections store entries in a
  // NamedMap that needs recursive lint traversal.
  if (isCollectionFieldType(fieldType)) {
    if (isNamedMap(value)) {
      const colinearType =
        'colinearType' in fieldType ? fieldType.colinearType : undefined;
      for (const [, entry] of value) {
        if (isAstNodeLike(entry)) {
          const entryBlock = fieldType.entryBlock;
          let entrySchema = innerSchema;
          if (hasDiscriminant(entryBlock)) {
            const discValue = extractDiscriminantValue(
              entry,
              entryBlock.discriminantField
            );
            if (discValue) {
              entrySchema = entryBlock.resolveSchemaForDiscriminant(discValue);
            }
          } else {
            const name =
              typeof entry.__name === 'string' ? entry.__name : undefined;
            if (name) {
              entrySchema = entryBlock.resolveSchemaForName(name);
            }
          }
          if (entrySchema) {
            checkInstance(entry, entrySchema, visitor);
          }
          if (colinearType && entry.value !== undefined) {
            visitor.visitField?.(
              entry.value,
              colinearType as FieldType,
              'value',
              entry
            );
          }
        }
      }
    }
  } else if (innerSchema) {
    // Block: value is a single block instance (NOT a Sequence — those are
    // handled below and would incorrectly match as plain objects).
    if (isAstNodeLike(value) && !(value instanceof SequenceNode)) {
      let blockSchema = innerSchema;
      // Resolve discriminant-based variant schema for Block types
      if (hasDiscriminant(fieldType)) {
        const discValue = extractDiscriminantValue(
          value,
          fieldType.discriminantField
        );
        if (discValue) {
          blockSchema = fieldType.resolveSchemaForDiscriminant(discValue);
        }
      }
      checkInstance(value, blockSchema, visitor);
    }
  }

  if (value instanceof SequenceNode) {
    const items = value.items;
    if (innerSchema) {
      for (const item of items) {
        if (isAstNodeLike(item) && '__symbol' in item) {
          checkInstance(item, innerSchema, visitor);
        }
      }
    }
  }
}

/**
 * Walk the AST against its root schema, calling the visitor for each field.
 *
 * All fields (root and nested) are visited regardless of presence, enabling
 * required-field checks at every level. Nested structure is only recursed
 * into when the value is present.
 */
export function walkSchema(
  root: AstRoot,
  rootSchema: Record<string, FieldType>,
  visitor: SchemaFieldVisitor
): void {
  for (const [key, rawFt] of Object.entries(rootSchema)) {
    const { fieldType, innerSchema } = resolveSchemaEntry(rawFt);
    const value = astField(root, key);

    // Visit all fields (even absent) for required-field checks
    visitor.visitField?.(value, fieldType, key, root);

    // Only recurse into present values for nested structure
    if (value !== undefined) {
      checkFieldValue(value, fieldType, innerSchema, visitor);
    }
  }
}
