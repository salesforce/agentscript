/**
 * Shared hover resolution for AgentScript schema fields and keywords.
 *
 * Provides the core logic for resolving schema paths to metadata and
 * formatting hover markdown. Used by both the LSP and Monaco hover
 * providers — each keeps only client-specific tree navigation and
 * output wrapping.
 */

import type { FieldMetadata, KeywordInfo } from '../types.js';

/**
 * Interface for navigating the schema tree during hover resolution.
 * FieldType structurally satisfies this interface so no cast is needed
 * when passing a dialect schema to {@link resolveSchemaField}.
 */
export interface SchemaFieldInfo {
  isNamed?: boolean;
  __isCollection?: boolean;
  schema?: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>;
  __metadata?: FieldMetadata;
  __isTypedMap?: boolean;
  propertiesSchema?: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>;
  __modifiers?: readonly KeywordInfo[];
  __primitiveTypes?: readonly KeywordInfo[];
}

/**
 * Result of resolving a schema path to a field.
 */
export interface ResolvedSchemaField {
  field: SchemaFieldInfo;
  resolvedPath: string[];
  lastKey: string;
}

/**
 * Resolve a schema path to a field and its metadata.
 *
 * Handles three structural cases:
 * - Named/Collection (isNamed or __isCollection): skip instance name
 * - TypedMap (__isTypedMap): skip entry name, use propertiesSchema
 * - Regular Block/Field: direct schema key lookup
 */
export function resolveSchemaField(
  path: string[],
  schema: Record<string, SchemaFieldInfo | SchemaFieldInfo[]>
): ResolvedSchemaField | null {
  let current: Record<string, SchemaFieldInfo | SchemaFieldInfo[]> = schema;
  const resolvedPath: string[] = [];
  let lastField: SchemaFieldInfo | null = null;
  let lastKey = '';

  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    const raw = current[key];
    // Schema allows FieldType[] for variant unions; pick the first entry.
    const field: SchemaFieldInfo | undefined = Array.isArray(raw)
      ? raw[0]
      : raw;

    if (!field) break;

    lastField = field;
    lastKey = key;
    resolvedPath.push(key);

    // Named blocks and collections both skip the instance name (next path segment)
    if ((field.isNamed || field.__isCollection) && i + 1 < path.length) {
      i++;
      resolvedPath.push(path[i]);
    }

    // TypedMap: skip the entry name, use propertiesSchema for nested fields
    if (field.__isTypedMap && i + 1 < path.length) {
      i++;
      resolvedPath.push(path[i]);
      const propsSchema = field.propertiesSchema;
      if (propsSchema && i + 1 < path.length) {
        current = propsSchema;
        continue;
      }
      // No more path segments — hovering over entry name itself
      continue;
    }

    // Descend into the field's schema if available
    if (field.schema) {
      current = field.schema;
    } else {
      break;
    }
  }

  if (!lastField) return null;
  return { field: lastField, resolvedPath, lastKey };
}

/**
 * Build a markdown string summarizing the constraint metadata on a field.
 * Returns undefined if no constraints are present.
 */
export function formatConstraints(metadata: FieldMetadata): string | undefined {
  const c = metadata.constraints;
  if (!c) return undefined;

  const parts: string[] = [];

  // Range constraints (number)
  if (c.minimum !== undefined && c.maximum !== undefined) {
    parts.push(`${c.minimum} \u2264 value \u2264 ${c.maximum}`);
  } else if (c.minimum !== undefined) {
    parts.push(`\u2265 ${c.minimum}`);
  } else if (c.maximum !== undefined) {
    parts.push(`\u2264 ${c.maximum}`);
  }

  if (c.exclusiveMinimum !== undefined) parts.push(`> ${c.exclusiveMinimum}`);
  if (c.exclusiveMaximum !== undefined) parts.push(`< ${c.exclusiveMaximum}`);
  if (c.multipleOf !== undefined) parts.push(`multiple of ${c.multipleOf}`);

  // Length constraints (string)
  if (c.minLength !== undefined && c.maxLength !== undefined) {
    parts.push(`length ${c.minLength}\u2013${c.maxLength}`);
  } else if (c.minLength !== undefined) {
    parts.push(`min length ${c.minLength}`);
  } else if (c.maxLength !== undefined) {
    parts.push(`max length ${c.maxLength}`);
  }

  if (c.pattern !== undefined) parts.push(`pattern \`/${c.pattern}/\``);

  // Items constraints (sequence)
  if (c.minItems !== undefined && c.maxItems !== undefined) {
    parts.push(`${c.minItems}\u2013${c.maxItems} items`);
  } else if (c.minItems !== undefined) {
    parts.push(`min ${c.minItems} item(s)`);
  } else if (c.maxItems !== undefined) {
    parts.push(`max ${c.maxItems} item(s)`);
  }

  // Enum / const
  if (c.enum !== undefined) {
    const vals = c.enum.map(v => JSON.stringify(v)).join(', ');
    parts.push(`one of: ${vals}`);
  }
  if (c.const !== undefined) {
    parts.push(`must be ${JSON.stringify(c.const)}`);
  }

  return parts.length > 0 ? parts.join(' \u00b7 ') : undefined;
}

/**
 * Format a full hover markdown string for a schema field.
 * Includes path, description, deprecation, version, modifiers, types, and constraints.
 */
export function formatSchemaHoverMarkdown(
  path: string[],
  metadata: FieldMetadata,
  modifiers?: readonly KeywordInfo[],
  primitiveTypes?: readonly KeywordInfo[]
): string {
  const parts: string[] = [];
  parts.push(`**${path.join('.')}**`);

  if (metadata.description) {
    parts.push(`\n\n${metadata.description}`);
  }

  if (metadata.deprecated) {
    const msg = metadata.deprecated.message || 'This field is deprecated.';
    parts.push(`\n\n**Deprecated:** ${msg}`);
  }

  if (metadata.minVersion) {
    parts.push(`\n\n_Added in v${metadata.minVersion}_`);
  }

  if (metadata.experimental) {
    parts.push(`\n\n_Experimental_`);
  }

  if (modifiers && modifiers.length > 0) {
    parts.push(
      `\n\n**Modifiers:** \`${modifiers.map(m => m.keyword).join('` | `')}\``
    );
  }

  if (primitiveTypes && primitiveTypes.length > 0) {
    parts.push(
      `\n\n**Types:** \`${primitiveTypes.map(t => t.keyword).join('` | `')}\``
    );
  }

  const constraints = formatConstraints(metadata);
  if (constraints) {
    parts.push(`\n\n**Constraints:** ${constraints}`);
  }

  return parts.join('');
}

/**
 * Format hover markdown for a keyword (modifier or primitive type).
 *
 * @param keyword - The keyword text (e.g., "mutable", "string")
 * @param kind - Whether this is a 'modifier' or 'type'
 * @param info - The KeywordInfo for the keyword, if found
 * @returns Markdown string for the hover tooltip
 */
export function formatKeywordHoverMarkdown(
  keyword: string,
  kind: 'modifier' | 'type',
  info: KeywordInfo | undefined
): string {
  const label = kind === 'modifier' ? 'Modifier' : 'Type';
  const parts: string[] = [];

  parts.push(`**${keyword}** — _${label}_`);

  if (info?.description) {
    parts.push(`\n\n${info.description}`);
  }

  if (info?.metadata) {
    const m = info.metadata;
    if (m.deprecated) {
      const msg = m.deprecated.message || 'This keyword is deprecated.';
      parts.push(`\n\n**Deprecated:** ${msg}`);
    }
    if (m.minVersion) {
      parts.push(`\n\n_Added in v${m.minVersion}_`);
    }
    if (m.experimental) {
      parts.push(`\n\n_Experimental_`);
    }
  }

  return parts.join('');
}

/**
 * Find a keyword in a KeywordInfo array by name.
 */
export function findKeywordInfo(
  keyword: string,
  keywords: readonly KeywordInfo[]
): KeywordInfo | undefined {
  return keywords.find(k => k.keyword === keyword);
}
