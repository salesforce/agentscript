/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Schema Introspection Utilities
 *
 * Inspects FieldType and FieldMetadata to provide information
 * the visual Builder needs to render schema-driven UI controls.
 */

import {
  isNamedMap,
  NamedMap,
  type FieldType,
  type FieldMetadata,
  type ConstraintMetadata,
} from '@agentscript/language';
import type { PropertyFieldDef } from '~/components/builder/TypedMapEditor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchemaFieldInfo {
  name: string;
  fieldKind: 'Block' | 'TypedMap' | 'Collection' | 'Primitive' | 'Sequence';
  metadata: FieldMetadata;
  constraints: ConstraintMetadata;
  schema?: Record<string, FieldType>;
  isNamed: boolean;
  accepts?: string[];
  description?: string;
  /** Original FieldType reference for TypedMap property introspection. */
  fieldType: FieldType;
}

export type FieldControl =
  | 'text-input'
  | 'textarea'
  | 'number-input'
  | 'toggle'
  | 'dropdown'
  | 'reference-input'
  | 'procedure-editor'
  | 'block-editor'
  | 'named-block-list'
  | 'typed-map-editor'
  | 'sequence-editor';

// ---------------------------------------------------------------------------
// Field info extraction
// ---------------------------------------------------------------------------

export function getFieldInfo(
  name: string,
  fieldType: FieldType
): SchemaFieldInfo {
  const metadata: FieldMetadata =
    (fieldType as unknown as { __metadata?: FieldMetadata }).__metadata ?? {};
  return {
    name,
    fieldKind: fieldType.__fieldKind,
    metadata,
    constraints: metadata.constraints ?? {},
    schema: fieldType.schema as Record<string, FieldType> | undefined,
    isNamed: fieldType.isNamed ?? false,
    accepts: fieldType.__accepts,
    description: metadata.description,
    fieldType,
  };
}

/** Get all fields for a schema, sorted with required first. */
export function getSchemaFields(
  schema: Record<string, FieldType>
): SchemaFieldInfo[] {
  return Object.entries(schema)
    .map(([name, ft]) => getFieldInfo(name, ft))
    .sort((a, b) => {
      if (a.metadata.required && !b.metadata.required) return -1;
      if (!a.metadata.required && b.metadata.required) return 1;
      return 0;
    });
}

/** Which top-level blocks can still be added to the document? */
export function getAvailableBlocks(
  rootSchema: Record<string, FieldType>,
  existingKeys: Set<string>
): Array<{ key: string; fieldInfo: SchemaFieldInfo; canAddMultiple: boolean }> {
  return Object.entries(rootSchema)
    .map(([key, ft]) => ({
      key,
      fieldInfo: getFieldInfo(key, ft),
      canAddMultiple: ft.isNamed === true,
    }))
    .filter(entry => {
      // Singular blocks that already exist can't be added again
      if (!entry.canAddMultiple && existingKeys.has(entry.key)) return false;
      return true;
    });
}

// ---------------------------------------------------------------------------
// Field control resolution
// ---------------------------------------------------------------------------

/**
 * Determine the best UI control for a field based on its fieldKind,
 * accepted expression kinds, and constraint metadata.
 */
export function resolveFieldControl(info: SchemaFieldInfo): FieldControl {
  // Enum constraint always takes precedence
  if (info.constraints.enum && info.constraints.enum.length > 0)
    return 'dropdown';

  // Compound types
  if (info.fieldKind === 'Block') return 'block-editor';
  if (info.fieldKind === 'Collection') return 'named-block-list';
  if (info.fieldKind === 'TypedMap') return 'typed-map-editor';
  if (info.fieldKind === 'Sequence') return 'sequence-editor';

  // Primitive types — inspect accepts
  const accepts = info.accepts ?? [];

  if (accepts.length === 0) {
    // ProcedureValue has no __accepts — detect via omitArrow presence or
    // simply treat accepts-less primitives as procedure editors
    return 'procedure-editor';
  }

  // Check for boolean-only
  if (accepts.length === 1 && accepts[0] === 'BooleanLiteral') {
    return 'toggle';
  }

  // Check for number-only
  if (accepts.length === 1 && accepts[0] === 'NumberLiteral') {
    return 'number-input';
  }

  // Check for template support (multiline)
  if (accepts.includes('TemplateExpression')) {
    return 'textarea';
  }

  // Check for reference types
  if (
    accepts.includes('MemberExpression') &&
    !accepts.includes('StringLiteral')
  ) {
    return 'reference-input';
  }

  // Default to text input
  return 'text-input';
}

// ---------------------------------------------------------------------------
// TypedMap property field extraction
// ---------------------------------------------------------------------------

/**
 * Extract PropertyFieldDef[] from a TypedMap FieldType's propertiesSchema.
 * Returns an empty array if the FieldType is not a TypedMap or has no properties.
 */
export function getTypedMapPropertyFields(
  fieldType: FieldType
): PropertyFieldDef[] {
  const ft = fieldType as unknown as {
    __isTypedMap?: boolean;
    propertiesSchema?: Record<string, FieldType>;
  };
  if (!ft.__isTypedMap || !ft.propertiesSchema) return [];

  const fields: PropertyFieldDef[] = [];
  for (const [name, propFt] of Object.entries(ft.propertiesSchema)) {
    const accepts = propFt.__accepts ?? [];
    const isBool = accepts.length === 1 && accepts[0] === 'BooleanLiteral';

    fields.push({
      name,
      label: formatFieldName(name),
      type: isBool ? 'boolean' : 'string',
    });
  }
  return fields;
}

/** Format a field name for display (snake_case → Title Case). */
export function formatFieldName(name: string): string {
  return name
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Get a human-readable description for a block type. */
export function getBlockDescription(fieldInfo: SchemaFieldInfo): string {
  return fieldInfo.description ?? fieldInfo.metadata.description ?? '';
}

// ---------------------------------------------------------------------------
// Variable options (shared between Monaco completions & builder comboboxes)
// ---------------------------------------------------------------------------

export interface VariableOption {
  /** Variable name (e.g. "order_id") */
  name: string;
  /** Display value for comboboxes (e.g. "@variables.order_id") */
  value: string;
  /** Primitive type name (e.g. "string", "number") */
  type: string;
  /** Description from variable properties, if any */
  description?: string;
}

/**
 * Extract variable options from the AST's variables Map.
 *
 * This mirrors the logic in `collectMapCandidates` from
 * `@agentscript/language` completions, but returns a simpler
 * shape suitable for builder comboboxes.
 */
export function getVariableOptions(
  variables: NamedMap<Record<string, unknown>> | undefined
): VariableOption[] {
  if (!variables || !isNamedMap(variables)) return [];

  const options: VariableOption[] = [];
  for (const [name, entry] of variables) {
    if (!entry || typeof entry !== 'object') continue;

    const typeNode = entry.type as { name?: string } | undefined;
    const typeName = typeNode?.name ?? '';

    const propsNode = entry.properties as
      | { description?: { value?: string } }
      | undefined;
    const description =
      typeof propsNode?.description?.value === 'string'
        ? propsNode.description.value
        : undefined;

    options.push({
      name,
      value: `@variables.${name}`,
      type: typeName,
      description,
    });
  }
  return options;
}

// ---------------------------------------------------------------------------
// Topic options (for transition "to" clause comboboxes)
// ---------------------------------------------------------------------------

export interface TopicOption {
  /** Topic name (e.g. "escalation") */
  name: string;
  /** Full reference (e.g. "@topic.escalation") */
  value: string;
  /** Scope namespace (e.g. "topic", "start_agent") */
  scope: string;
  /** Description from the topic block, if any */
  description?: string;
}

/**
 * Extract topic options from the AST, excluding the current topic.
 * Scans `topic`, `start_agent`, and `subagent` namespace keys for block entries.
 */
export function getTopicOptions(
  ast: Record<string, unknown> | undefined,
  excludeTopic?: string
): TopicOption[] {
  if (!ast) return [];

  const options: TopicOption[] = [];
  const scopes = ['topic', 'start_agent', 'subagent'] as const;

  for (const scope of scopes) {
    const ns = ast[scope];
    if (!ns || typeof ns !== 'object') continue;

    // Could be a NamedMap or a plain object
    const entries: Array<[string, unknown]> = isNamedMap(ns)
      ? [...ns.entries()]
      : Object.entries(ns as Record<string, unknown>);

    for (const [name, entry] of entries) {
      if (!entry || typeof entry !== 'object' || name.startsWith('__'))
        continue;
      const block = entry as Record<string, unknown>;
      if (
        block.__kind !== 'TopicBlock' &&
        block.__kind !== 'StartAgentBlock' &&
        block.__kind !== 'SubagentBlock'
      )
        continue;
      if (name === excludeTopic) continue;

      const descNode = block.description as { value?: string } | undefined;
      const description =
        typeof descNode?.value === 'string' ? descNode.value : undefined;

      options.push({
        name,
        value: `@${scope}.${name}`,
        scope,
        description,
      });
    }
  }

  return options;
}
