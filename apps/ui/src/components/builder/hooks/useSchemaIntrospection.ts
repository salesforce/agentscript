/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useMemo } from 'react';
import type { FieldType } from '@agentscript/language';
import {
  getSchemaFields,
  getAvailableBlocks,
  type SchemaFieldInfo,
} from '~/lib/schema-introspection';

/**
 * Hook returning the fields for a given schema, sorted with required first.
 */
export function useSchemaFields(
  schema: Record<string, FieldType> | undefined
): SchemaFieldInfo[] {
  return useMemo(() => (schema ? getSchemaFields(schema) : []), [schema]);
}

/**
 * Hook returning which blocks can still be added to the document.
 */
export function useAvailableBlocks(
  rootSchema: Record<string, FieldType>,
  existingKeys: Set<string>
) {
  return useMemo(
    () => getAvailableBlocks(rootSchema, existingKeys),
    [rootSchema, existingKeys]
  );
}
