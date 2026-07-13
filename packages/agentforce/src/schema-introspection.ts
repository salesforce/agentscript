/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  FieldType,
  ConstraintMetadata,
  FieldMetadata,
} from '@agentscript/language';
import { isCollectionFieldType } from '@agentscript/language';
import { AgentforceSchema } from '@agentscript/agentforce-dialect';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface FieldDefinition {
  type: string;
  required: boolean;
  fieldKind: 'Block' | 'TypedMap' | 'Collection' | 'Primitive' | 'Sequence';
  description?: string;
  constraints?: ConstraintMetadata;
  deprecated?: { message?: string; replacement?: string };
  children?: Record<string, FieldDefinition>;
}

export type BlockSchemaDefinition = Record<string, FieldDefinition>;

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function deriveTypeName(ft: FieldType): string {
  if (ft.__fieldKind === 'Block') {
    return (ft as { kind?: string }).kind ?? 'Block';
  }
  if (ft.__fieldKind === 'Collection') {
    const entry = (ft as { entryBlock?: { kind?: string } }).entryBlock;
    return entry?.kind ? `Collection<${entry.kind}>` : 'Collection';
  }
  if (ft.__fieldKind === 'TypedMap') return 'TypedMap';
  if (ft.__fieldKind === 'Sequence') return 'Sequence';

  const accepts = ft.__accepts;
  if (!accepts || accepts.length === 0) return 'ProcedureValue';
  if (accepts.includes('StringLiteral')) return 'StringValue';
  if (accepts.length === 1) return accepts[0];
  return accepts.join(' | ');
}

function resolveNestedSchema(
  ft: FieldType
): Record<string, FieldType | FieldType[]> | undefined {
  if (ft.__fieldKind === 'Block') {
    return ft.schema as Record<string, FieldType | FieldType[]> | undefined;
  }
  if (isCollectionFieldType(ft)) {
    return ft.entryBlock.schema;
  }
  return undefined;
}

function toFieldDefinition(
  ft: FieldType,
  visited: Set<FieldType>
): FieldDefinition {
  const meta: FieldMetadata =
    (ft as unknown as { __metadata?: FieldMetadata }).__metadata ?? {};

  const def: FieldDefinition = {
    type: deriveTypeName(ft),
    required: meta.required ?? false,
    fieldKind: ft.__fieldKind,
  };

  if (meta.description) def.description = meta.description;
  if (meta.constraints && Object.keys(meta.constraints).length > 0) {
    def.constraints = meta.constraints;
  }
  if (meta.deprecated) def.deprecated = meta.deprecated;

  const nested = resolveNestedSchema(ft);
  if (nested && !visited.has(ft)) {
    visited.add(ft);
    def.children = Object.fromEntries(
      Object.entries(nested)
        .filter(
          (entry): entry is [string, FieldType] => !Array.isArray(entry[1])
        )
        .map(([k, v]) => [k, toFieldDefinition(v, visited)])
    );
  }

  return def;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the simplified field definitions for a block by its schema key.
 *
 * @example
 * ```typescript
 * const schema = getBlockFieldDefinitions('language');
 * // {
 * //   default_locale: { type: 'StringValue', required: false, ... },
 * //   additional_locales: { type: 'StringValue', required: false, ... },
 * //   ...
 * // }
 * ```
 */
export function getBlockFieldDefinitions(
  kind: string
): BlockSchemaDefinition | undefined {
  const ft = (AgentforceSchema as Record<string, FieldType>)[kind];
  if (!ft) return undefined;

  const schema = isCollectionFieldType(ft) ? ft.entryBlock.schema : ft.schema;
  if (!schema) return undefined;

  const visited = new Set<FieldType>();
  return Object.fromEntries(
    Object.entries(schema)
      .filter((entry): entry is [string, FieldType] => !Array.isArray(entry[1]))
      .map(([k, v]) => [k, toFieldDefinition(v, visited)])
  );
}

/**
 * Get simplified field definitions for all top-level schema entries.
 */
export function getSchemaDefinitions(): Record<string, FieldDefinition> {
  const visited = new Set<FieldType>();
  return Object.fromEntries(
    Object.entries(AgentforceSchema as Record<string, FieldType>).map(
      ([k, v]) => [k, toFieldDefinition(v, visited)]
    )
  );
}
