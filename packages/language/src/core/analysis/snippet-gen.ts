/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Auto-generates LSP snippet text from FieldType schema definitions.
 *
 * Walks the schema tree to produce snippet templates with tab stops ($1, ${1:placeholder}, $0).
 * Only generates snippets for compound fields (Block, Collection, TypedMap) —
 * leaf primitives return undefined.
 */
import type { FieldType, KeywordInfo, Schema } from '../types.js';
import { keywordNames } from '../types.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SnippetOptions {
  /** Spaces per indent level. Default 4. */
  tabSize?: number;
}

/**
 * Generate an LSP snippet string for a field completion.
 *
 * Returns `undefined` when a snippet adds no value (leaf primitives, sequences).
 */
export function generateFieldSnippet(
  fieldName: string,
  fieldType: FieldType,
  opts?: SnippetOptions
): string | undefined {
  const ft = resolveFieldType(fieldType);

  // Only generate snippets for compound types
  if (isSequence(ft)) return undefined;
  if (isPrimitive(ft) && !isTypedMap(ft)) return undefined;

  const tabSize = opts?.tabSize ?? 4;
  const counter = { value: 1 };

  if (isTypedMap(ft)) {
    return snippetForTypedMap(fieldName, ft, 0, counter, tabSize);
  }

  if (isCollection(ft)) {
    return snippetForCollection(fieldName, ft, 0, counter, tabSize);
  }

  if (ft.schema) {
    return snippetForBlock(fieldName, ft, 0, counter, 0, false, tabSize);
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Core snippet builders
// ---------------------------------------------------------------------------

/** Counter object passed by reference so tab stops auto-increment. */
interface Counter {
  value: number;
}

function snippetForBlock(
  name: string,
  ft: FieldType,
  indent: number,
  counter: Counter,
  depth: number,
  namedEntryMode: boolean,
  tabSize: number
): string {
  const pad = ' '.repeat(indent * tabSize);
  const lines: string[] = [`${pad}${name}:`];

  if (!ft.schema) {
    // No children — just the header with a tab stop
    lines[0] = `${pad}${name}: \${${counter.value++}}`;
    return lines.join('\n') + '$0';
  }

  const childLines = generateChildLines(
    ft.schema,
    indent + 1,
    counter,
    depth + 1,
    namedEntryMode,
    tabSize
  );

  if (childLines.length === 0) {
    // No children passed the heuristic — add a cursor placeholder
    const childPad = ' '.repeat((indent + 1) * tabSize);
    lines.push(`${childPad}\${${counter.value++}}`);
  } else {
    lines.push(...childLines);
  }

  return depth === 0 ? lines.join('\n') + '$0' : lines.join('\n');
}

function snippetForCollection(
  name: string,
  ft: FieldType,
  indent: number,
  counter: Counter,
  tabSize: number
): string {
  const basePad = generatePad(indent, tabSize);
  const entryBlock = getEntryBlock(ft);

  if (!entryBlock?.schema || Object.keys(entryBlock.schema).length === 0) {
    // Schema for entry block is not provided or empty. No collection content is provided
    if (ft.__isNamedCollection) {
      // Named collection, field name and collection name inlined
      return (
        [
          `${basePad}${name} \${${counter.value++}:Name}:`,
          `${generatePad(indent + 1, tabSize)}\${${counter.value++}}`,
        ].join('\n') + '$0'
      );
    }

    // Regular CollectionBlock - Field name in first line and collection name indented in second line
    return (
      [
        `${basePad}${name}:`,
        `${generatePad(indent + 1, tabSize)}\${${counter.value++}:Name}:`,
        `${generatePad(indent + 2, tabSize)}\${${counter.value++}}`,
      ].join('\n') + '$0'
    );
  }

  // Schema is provided — include name tab stop, then only required children
  let lines: string[];
  if (ft.__isNamedCollection) {
    // Named collection, field name and collection name inlined
    lines = [`${basePad}${name} \${${counter.value++}:Name}:`];
  } else {
    // Regular CollectionBlock - Field name in first line and collection name indented in second line
    lines = [
      `${basePad}${name}:`,
      `${generatePad(indent + 1, tabSize)}\${${counter.value++}:Name}:`,
    ];
    indent += 1; // Required to indent children inside collection block
  }

  const childLines = generateChildLines(
    entryBlock.schema,
    indent + 1,
    counter,
    1,
    true, // namedEntryMode — only required fields
    tabSize
  );

  if (childLines.length === 0) {
    lines.push(`${generatePad(indent + 1, tabSize)}\${${counter.value++}}`);
  } else {
    lines.push(...childLines);
  }

  return lines.join('\n') + '$0';
}

function snippetForTypedMap(
  name: string,
  ft: FieldType,
  indent: number,
  counter: Counter,
  tabSize: number
): string {
  const pad = ' '.repeat(indent * tabSize);
  const childPad = ' '.repeat((indent + 1) * tabSize);
  const propPad = ' '.repeat((indent + 2) * tabSize);

  const lines: string[] = [`${pad}${name}:`];

  // Build the entry line: name: modifier type
  const entryParts: string[] = [];

  // Entry name
  entryParts.push(`\${${counter.value++}:name}:`);

  // Modifier choice (mutable, linked, etc.)
  const modifiers = keywordNames(getTypedMapModifiers(ft));
  if (modifiers.length > 0) {
    entryParts.push(`\${${counter.value++}|${modifiers.join(',')}|}`);
  }

  // Type choice
  const primitiveTypes = keywordNames(getTypedMapPrimitiveTypes(ft));
  if (primitiveTypes.length > 0) {
    // Limit to first 8 types to keep the choice manageable
    const types = primitiveTypes.slice(0, 8);
    entryParts.push(`\${${counter.value++}|${types.join(',')}|}`);
  }

  lines.push(`${childPad}${entryParts.join(' ')}`);

  // Properties from propertiesSchema (e.g., description, label)
  const propsSchema = getTypedMapPropertiesSchema(ft);
  if (propsSchema) {
    for (const [fieldName, childFt] of Object.entries(propsSchema)) {
      const resolved = resolveFieldType(childFt);
      if (fieldName.startsWith('__')) continue;
      // Only include description by default for TypedMap entries
      if (fieldName === 'description' || resolved.__metadata?.required) {
        lines.push(
          `${propPad}${fieldName}: ${primitiveSnippetValue(resolved, counter)}`
        );
      }
    }
  }

  return lines.join('\n') + '$0';
}

// ---------------------------------------------------------------------------
// Child field generation
// ---------------------------------------------------------------------------

function generateChildLines(
  schema: Schema,
  indent: number,
  counter: Counter,
  depth: number,
  namedEntryMode: boolean,
  tabSize: number
): string[] {
  const lines: string[] = [];

  for (const [fieldName, rawFt] of Object.entries(schema)) {
    if (fieldName.startsWith('__')) continue;
    const ft = resolveFieldType(rawFt);

    if (!shouldIncludeField(ft, depth, namedEntryMode)) continue;

    if (isSequence(ft) || isCollection(ft) || isTypedMap(ft)) {
      // Skip complex nested types in child expansion
      continue;
    }

    if (ft.schema) {
      // Nested block — recurse
      lines.push(
        snippetForBlock(
          fieldName,
          ft,
          indent,
          counter,
          depth,
          namedEntryMode,
          tabSize
        )
      );
    } else if (isPrimitive(ft)) {
      lines.push(primitiveSnippetLine(fieldName, ft, indent, counter, tabSize));
    }
  }

  return lines;
}

function shouldIncludeField(
  ft: FieldType,
  depth: number,
  namedEntryMode: boolean
): boolean {
  const required = ft.__metadata?.required === true;

  // Required fields are always included (up to depth 2)
  if (required && depth <= 2) return true;

  // In named entry mode (Collection entries), only include required fields
  if (namedEntryMode) return false;

  // Depth 1: include primitives and blocks with required children
  if (depth === 1) {
    if (isPrimitive(ft)) return true;
    if (ft.schema && hasRequiredChild(ft)) return true;
    return false;
  }

  // Depth 2+: only required (handled above)
  return false;
}

function hasRequiredChild(ft: FieldType): boolean {
  if (!ft.schema) return false;
  for (const childFt of Object.values(ft.schema)) {
    const resolved = resolveFieldType(childFt);
    if (resolved.__metadata?.required) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Primitive snippet helpers
// ---------------------------------------------------------------------------

function primitiveSnippetLine(
  name: string,
  ft: FieldType,
  indent: number,
  counter: Counter,
  tabSize: number
): string {
  const pad = ' '.repeat(indent * tabSize);

  if (isProcedureValue(ft)) {
    const childPad = ' '.repeat((indent + 1) * tabSize);
    const placeholder = placeholderFromMeta(ft) ?? 'instructions';
    if (ft.__metadata?.omitArrow) {
      return `${pad}${name}:\n${childPad}\${${counter.value++}:${escapeSnippetText(placeholder)}}`;
    }
    return `${pad}${name}: ->\n${childPad}\${${counter.value++}:${escapeSnippetText(placeholder)}}`;
  }

  return `${pad}${name}: ${primitiveSnippetValue(ft, counter)}`;
}

function primitiveSnippetValue(ft: FieldType, counter: Counter): string {
  if (isEnumValue(ft)) {
    const placeholder = placeholderFromEnum(ft) ?? 'value';
    return `"\${${counter.value++}|${placeholder}|}"`;
  }

  if (isStringValue(ft)) {
    const placeholder = placeholderFromMeta(ft) ?? 'value';
    return `"\${${counter.value++}:${escapeSnippetText(placeholder)}}"`;
  }

  if (isBooleanValue(ft)) {
    return `\${${counter.value++}:True}`;
  }

  if (isNumberValue(ft)) {
    return `\${${counter.value++}:0}`;
  }

  // Fallback for unknown primitives
  const placeholder = placeholderFromMeta(ft) ?? 'value';
  return `\${${counter.value++}:${escapeSnippetText(placeholder)}}`;
}

// ---------------------------------------------------------------------------
// FieldType detection helpers
// ---------------------------------------------------------------------------

function resolveFieldType(ft: FieldType | FieldType[]): FieldType {
  return Array.isArray(ft) ? ft[0] : ft;
}

function isPrimitive(ft: FieldType): boolean {
  return ft.__fieldKind === 'Primitive';
}

function isSequence(ft: FieldType): boolean {
  return ft.__fieldKind === 'Sequence';
}

function isStringValue(ft: FieldType): boolean {
  return (
    isPrimitive(ft) &&
    Array.isArray(ft.__accepts) &&
    ft.__accepts.includes('StringLiteral')
  );
}

function isEnumValue(ft: FieldType): boolean {
  return (
    isPrimitive(ft) &&
    Array.isArray(ft.__accepts) &&
    ft.__accepts.includes('StringLiteral') &&
    Array.isArray(ft.__metadata?.constraints?.enum)
  );
}

function isBooleanValue(ft: FieldType): boolean {
  return (
    isPrimitive(ft) &&
    Array.isArray(ft.__accepts) &&
    ft.__accepts.includes('BooleanLiteral')
  );
}

function isNumberValue(ft: FieldType): boolean {
  return (
    isPrimitive(ft) &&
    Array.isArray(ft.__accepts) &&
    ft.__accepts.includes('NumberLiteral')
  );
}

function isProcedureValue(ft: FieldType): boolean {
  return isPrimitive(ft) && !ft.__accepts?.length;
}

function isTypedMap(ft: FieldType): boolean {
  return ft.__isTypedMap === true;
}

function isCollection(ft: FieldType): boolean {
  return ft.__isCollection === true;
}

function getEntryBlock(ft: FieldType): FieldType | undefined {
  const rec = ft as unknown as Record<string, unknown>;
  if ('entryBlock' in rec && rec.entryBlock != null) {
    const eb = rec.entryBlock;
    // entryBlock can be a class (function) or object — both have .schema
    if (typeof eb === 'function' || typeof eb === 'object') {
      return eb as FieldType;
    }
  }
  return undefined;
}

function getTypedMapModifiers(ft: FieldType): readonly KeywordInfo[] {
  return ft.__modifiers ?? [];
}

function getTypedMapPrimitiveTypes(ft: FieldType): readonly KeywordInfo[] {
  return ft.__primitiveTypes ?? [];
}

function getTypedMapPropertiesSchema(ft: FieldType): Schema | undefined {
  return ft.propertiesSchema ?? undefined;
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

/** Escape special LSP snippet characters and quotes in placeholder text. */
export function escapeSnippetText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/}/g, '\\}')
    .replace(/"/g, "'");
}

/** Escape special characters inside an LSP snippet choice value (`${N|...|}`). */
function escapeChoiceValue(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\$/g, '\\$')
    .replace(/}/g, '\\}')
    .replace(/\|/g, '\\|')
    .replace(/,/g, '\\,');
}

/** Extract a short placeholder string from field metadata description. */
function placeholderFromMeta(ft: FieldType): string | undefined {
  const example = ft.__metadata?.example;
  if (example) {
    return example;
  }

  const desc = ft.__metadata?.description;
  if (!desc) return undefined;

  // Take first sentence, truncate to ~50 chars
  const firstSentence = desc.split(/\.\s/)[0];
  if (firstSentence.length <= 50) return firstSentence.replace(/\.$/, '');
  return firstSentence.slice(0, 47) + '...';
}

/** Generate padding based on indent and tab size. */
function generatePad(indent: number, tabSize: number) {
  return ' '.repeat(indent * tabSize);
}

/** Build a comma-separated choice string from enum constraint values. */
function placeholderFromEnum(ft: FieldType): string | undefined {
  const enumValues = ft.__metadata?.constraints?.enum;
  if (!Array.isArray(enumValues)) return undefined;
  return enumValues.map(v => escapeChoiceValue(String(v))).join(',');
}
