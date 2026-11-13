/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  NamedMap,
  ParameterDeclarationNode,
  ListLiteral,
  TypeDescriptorNode,
  SequenceNode,
} from '@agentscript/language';
import type { BlockCore, Expression } from '@agentscript/language';
import { SCHEMA_COMPONENT_TYPES } from '@agentscript/agentforce-dialect';
import type { CompilerContext } from '../compiler-context.js';
import type { ResponseFormat } from '../types.js';
import type { ParsedConnection } from '../parsed-types.js';
import { normalizeDeveloperName, parseUri, dedent } from '../utils.js';
import {
  extractStringValue,
  extractDescriptionValue,
  extractBooleanValue,
  extractNumberValue,
  getExpressionName,
  isListType,
  iterateNamedMap,
} from '../ast-helpers.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { compileExpression } from '../expressions/compile-expression.js';
import type { Range } from '@agentscript/types';

// ---------------------------------------------------------------------------
// JSON Schema output types
// ---------------------------------------------------------------------------

type JsonPrimitive = string | number | boolean;

interface JsonSchema {
  type?: string;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  description?: string;
  title?: string;
  enum?: JsonPrimitive[];
  const?: JsonPrimitive | JsonPrimitive[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  $schema?: string;
  /** Used by schema component parameters to denote list element type. */
  itemType?: string;
}

// ---------------------------------------------------------------------------

/**
 * Canonicalization of invocation target schemes
 */
const INVOCATION_TARGET_SCHEME_ALIASES: Record<string, string> = {
  prompt: 'generatePromptResponse',
};

/**
 * Compile response_formats from a connection block.
 */
export function compileResponseFormats(
  responseFormats: NamedMap<BlockCore> | undefined,
  ctx: CompilerContext
): ResponseFormat[] {
  if (!responseFormats) return [];

  const result: ResponseFormat[] = [];

  for (const [name, def] of iterateNamedMap(responseFormats)) {
    const formatDef = compileResponseFormat(name, def, ctx);
    if (formatDef) {
      result.push(formatDef);
    }
  }

  return result;
}

/**
 * Collect each connection's declared response format inputs into
 * `ctx.responseFormatInputs`.
 */
export function collectResponseFormatInputs(
  connections: NamedMap<ParsedConnection> | undefined,
  ctx: CompilerContext
): void {
  for (const [connectionName, def] of iterateNamedMap(connections)) {
    const formats = new Map<string, NamedMap<ParameterDeclarationNode>>();
    const responseFormats = def.response_formats as
      | NamedMap<BlockCore>
      | undefined;
    for (const [formatName, format] of iterateNamedMap(responseFormats)) {
      const inputs = format['inputs'];
      if (inputs instanceof NamedMap) {
        formats.set(formatName, inputs as NamedMap<ParameterDeclarationNode>);
      }
    }
    ctx.responseFormatInputs.set(connectionName, formats);
  }
}

function compileResponseFormat(
  name: string,
  def: BlockCore,
  ctx: CompilerContext
): ResponseFormat | undefined {
  // Description supports template interpolation as it is an instruction to the LLM
  const descriptionNode = def['description'];
  const description = descriptionNode
    ? dedent(compileTemplateValue(descriptionNode, ctx))
    : '';
  const label =
    extractStringValue(def['label']) ?? normalizeDeveloperName(name);

  // Parse and validate source (must be response_format://...)
  const sourceUri = extractStringValue(def['source']);
  let source: string | undefined;
  if (sourceUri) {
    const { scheme, path } = parseUri(sourceUri);
    if (scheme !== 'response_format') {
      ctx.error(
        `Response format source must use 'response_format://' scheme, got: '${sourceUri}'`,
        (def['__cst'] as { range?: Range } | undefined)?.range
      );
    }
    source = path || sourceUri;
  }

  // Parse target URI (e.g. "apex://MyApexClass")
  const targetUri = extractStringValue(def['target']) ?? undefined;
  let invocationTargetType: string | undefined;
  let invocationTargetName: string | undefined;

  if (targetUri) {
    const { scheme, path } = parseUri(targetUri);
    // Only emit a target type when the URI actually carried a scheme;
    // a schemeless target is malformed (the linter flags it)
    if (scheme) {
      invocationTargetType = INVOCATION_TARGET_SCHEME_ALIASES[scheme] ?? scheme;
    }
    invocationTargetName = path || targetUri;
  }

  // Compile structured input schema from TypedMap
  const inputsNode = def['inputs'] as
    | NamedMap<ParameterDeclarationNode>
    | undefined;
  const inputSchema = compileResponseFormatInputSchema(inputsNode, ctx);

  const formatDef: ResponseFormat = {
    developer_name: name,
    label,
    description,
    input_schema: inputSchema,
  };

  // Add optional fields only when they have values
  if (source !== undefined) {
    formatDef.source = source;
  }
  if (invocationTargetType !== undefined) {
    formatDef.invocation_target_type = invocationTargetType;
  }
  if (invocationTargetName !== undefined) {
    formatDef.invocation_target_name = invocationTargetName;
  }

  return formatDef;
}

// --- Structured input schema compilation ---

/** Map AgentScript type keywords to JSON Schema type strings. */
const TYPE_MAP: Record<string, string> = {
  string: 'string',
  number: 'number',
  integer: 'integer',
  boolean: 'boolean',
  object: 'object',
  null: 'null',
  // Types that map to string in JSON Schema
  currency: 'string',
  date: 'string',
  datetime: 'string',
  time: 'string',
  timestamp: 'string',
  id: 'string',
  long: 'integer',
};

/**
 * Response format input schema constraint mappings for individual values/items.
 * Maps AgentScript field names to JSON Schema property names.
 *
 * Constraint placement depends on the field type:
 * - For non-list types (string, number, etc.): applied directly to the property schema
 * - For list[primitive] (list[string], list[number], etc.): applied to items schema
 * - For list[object]: applied to property schema (semantically incorrect, but allowed)
 *
 * Note: Nested fields inside list[object] items correctly use these constraints.
 */
type NumericSchemaKey = keyof {
  [K in keyof JsonSchema as JsonSchema[K] extends number | undefined
    ? K
    : never]: true;
};

const FORMAT_INPUT_ITEM_CONSTRAINT_MAP: ReadonlyArray<
  readonly [string, NumericSchemaKey]
> = [
  ['min_length', 'minLength'], // string length constraint
  ['max_length', 'maxLength'], // string length constraint
  ['minimum', 'minimum'], // number/integer value constraint
  ['maximum', 'maximum'], // number/integer value constraint
] as const;

/**
 * Response format input schema constraint mappings for arrays/lists.
 * These constraints apply to array collections (not individual elements).
 *
 * Always placed at the top-level property schema (propSchema), not on items.
 * If used on non-array types, validators will ignore them (semantically incorrect but allowed).
 */
const FORMAT_INPUT_ARRAY_CONSTRAINT_MAP: ReadonlyArray<
  readonly [string, NumericSchemaKey]
> = [
  ['min_items', 'minItems'], // array size constraint
  ['max_items', 'maxItems'], // array size constraint
] as const;

/**
 * Compile a structured TypedMap of inputs into a JSON Schema string.
 */
function compileResponseFormatInputSchema(
  inputs: NamedMap<ParameterDeclarationNode> | undefined,
  ctx: CompilerContext
): string {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  let schemaComponentType: string | undefined;

  if (inputs) {
    for (const [name, decl] of iterateNamedMap(inputs)) {
      const result = compileInputProperty(decl, ctx);
      if (result) {
        properties[name] = result.schema;
        if (result.isRequired) required.push(name);
        if (result.schemaComponentType)
          schemaComponentType = result.schemaComponentType;
      }
    }
  }

  // A format of component type is typed as its component type
  // (e.g. 'messaging_component') for easier rehydration lookup in Core
  const schema: JsonSchema = {
    type: schemaComponentType ?? 'object',
    properties,
  };
  if (required.length > 0) schema.required = required;

  return JSON.stringify(schema);
}

/**
 * Compile a single input parameter declaration into a JSON Schema property.
 */
function compileInputProperty(
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
):
  | { schema: JsonSchema; isRequired: boolean; schemaComponentType?: string }
  | undefined {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr) return undefined;

  const props = decl.properties;

  // When type is declared via `type: list` block, decl.type is a bare
  // Identifier('list') rather than SubscriptExpression. Resolve the element
  // type from the TypeDescriptor's `value:` property.
  let isList = isListType(decl.type);
  let jsonType: string;

  if (typeStr === 'list' && !isList) {
    isList = true;
    const valueDesc = getValueDescriptor(getTypeDescriptor(props));
    const elementType = valueDesc?.typeName?.name ?? 'string';
    jsonType = TYPE_MAP[elementType] ?? 'string';
  } else {
    jsonType = TYPE_MAP[typeStr] ?? 'string';
  }

  // input schema of a component is compiled into a bastardized version of json schema
  // because there's no perfect mapping of component types to json schema types
  // (Core will rehydrate it into the correct consumable format)
  const schemaUri = extractStringValue(props?.['schema']);
  if (schemaUri) {
    const { scheme, path } = parseUri(schemaUri);
    if (SCHEMA_COMPONENT_TYPES.includes(scheme) && path) {
      const parameters = compileSchemaComponentParameters(props, ctx);

      const schema: JsonSchema = {
        type: 'object',
        $schema: schemaUri,
      };

      // Parameterized components (e.g. dynamic messaging components) additionally carry a
      // `properties` map; parameterless (e.g. static messaging components) ones simply omit it.
      if (parameters) schema.properties = parameters;

      return { schema, isRequired: true, schemaComponentType: scheme };
    }
  }

  // Compile nested sub-fields for object types (skip for primitives)
  const nestedResult =
    jsonType === 'object' ? compileNestedObjectFields(props, ctx) : undefined;

  // Build the property schema for the base type
  const propSchema: JsonSchema = {};

  if (isList) {
    // Array type: type[] → { "type": "array", "items": { "type": "..." } }
    propSchema.type = 'array';
    if (jsonType === 'object' && nestedResult) {
      // list[object] with sub-fields → items is a nested object schema
      const itemSchema: JsonSchema = {
        type: 'object',
        properties: nestedResult.properties,
      };
      if (nestedResult.required.length > 0)
        itemSchema.required = nestedResult.required;
      propSchema.items = itemSchema;
    } else {
      propSchema.items = { type: jsonType };
    }
  } else if (jsonType === 'object' && nestedResult) {
    // Object with sub-fields → nested object schema
    propSchema.type = 'object';
    propSchema.properties = nestedResult.properties;
    if (nestedResult.required.length > 0)
      propSchema.required = nestedResult.required;
  } else {
    propSchema.type = jsonType;
  }

  // Extract description - supports template interpolation
  const descriptionNode = props?.['description'];
  if (descriptionNode) {
    const description = dedent(compileTemplateValue(descriptionNode, ctx));
    if (description) propSchema.description = description;
  }

  // Extract label and map to JSON Schema's title
  const label = extractStringValue(props?.['label']);
  if (label) propSchema.title = label;

  // Constraints live under the type descriptor's properties when present;
  // for short-form declarations they don't exist.
  const typeDesc = getTypeDescriptor(props);
  const typeDescProps = typeDesc?.properties;

  // For list types, item-level constraints (enum, minLength, etc.) come from
  // the value descriptor's properties (type: list → value: string → constraints on string)
  const valueDescProps = getValueDescriptor(typeDesc)?.properties;

  // Determine where item/value constraints should be placed in output JSON Schema:
  // - For list[primitive]: constraints go on items schema (constraining each element)
  // - For everything else: constraints go on the property schema itself
  const isListOfPrimitive = isList && jsonType !== 'object';
  const itemLevelSchema: JsonSchema = isListOfPrimitive
    ? propSchema.items!
    : propSchema;

  // Extract const from default value (= "value" or @variables/@inputs syntax)
  if (decl.defaultValue) {
    const constVal = compileDefaultValueConst(decl.defaultValue, ctx);
    if (constVal !== undefined) propSchema.const = constVal;
  }

  // Source for item-level constraints: for list types use value descriptor,
  // otherwise use the type descriptor directly
  const itemConstraintSource = isList ? valueDescProps : typeDescProps;

  // Extract enum values from ExpressionSequence
  const enumNode = itemConstraintSource?.['enum'];
  if (enumNode instanceof SequenceNode) {
    const enumValues = extractEnumValues(enumNode);
    if (enumValues.length > 0) itemLevelSchema.enum = enumValues;
  }

  // Extract item/value constraints: minLength, maxLength, minimum, maximum
  for (const [srcKey, jsonKey] of FORMAT_INPUT_ITEM_CONSTRAINT_MAP) {
    const val = extractNumberValue(itemConstraintSource?.[srcKey]);
    if (val !== undefined) itemLevelSchema[jsonKey] = val;
  }

  // Extract array constraints: minItems, maxItems (from the list type descriptor)
  for (const [srcKey, jsonKey] of FORMAT_INPUT_ARRAY_CONSTRAINT_MAP) {
    const val = extractNumberValue(typeDescProps?.[srcKey]);
    if (val !== undefined) propSchema[jsonKey] = val;
  }

  // Extract is_required (defaults to True when not specified)
  const isRequired = extractBooleanValue(props?.['is_required']) ?? true;

  return { schema: propSchema, isRequired };
}

/**
 * Compile the parameters of a component with parameters
 * (e.g. a Dynamic Messaging Component, or a Lightning Web Component).
 *
 * A component (`schema: "messaging_component://..."` or
 * `"lightning_web_component://..."`) may declare component parameters under its
 * `fields:` block, e.g.:
 *
 *   penguin_pet_intake_form: object
 *       schema: "messaging_component://FormMessage__PetIntakeForm"
 *       fields:
 *           selectedTimestamp: datetime = "2026-06-08 15:30:00"
 *               description: "..."
 *           linkedAccounts: list[id] = @variables.Users
 *
 * Each parameter is emitted with its raw AgentScript type (not the JSON Schema
 * mapping): list types use `type: "list"` + `itemType`, and `const` carries the
 * parameter value (variable refs → `{{state.X}}`, literals verbatim). A
 * parameter without a default (allowed for lightning web components) has no `const`.
 */
function compileSchemaComponentParameters(
  props: BlockCore | undefined,
  ctx: CompilerContext
): Record<string, JsonSchema> | undefined {
  const properties: Record<string, JsonSchema> = {};
  let hasParameters = false;

  // Fields are under the type descriptor
  const typeDescProps = getTypeDescriptor(props)?.properties;
  const fields = typeDescProps?.['fields'] as
    | NamedMap<ParameterDeclarationNode>
    | undefined;

  for (const [key, decl] of iterateNamedMap(fields)) {
    const paramSchema = compileSchemaComponentParameter(decl, ctx);
    if (paramSchema) {
      properties[key] = paramSchema;
      hasParameters = true;
    }
  }

  return hasParameters ? properties : undefined;
}

/**
 * Compile a single component parameter declaration
 */
function compileSchemaComponentParameter(
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
): JsonSchema | undefined {
  const typeName = getExpressionName(decl.type);
  if (!typeName) return undefined;

  const paramSchema: JsonSchema = isListType(decl.type)
    ? { type: 'list', itemType: typeName }
    : { type: typeName };

  // Description of a component param does not support template
  const rawDescription = extractDescriptionValue(
    decl.properties?.['description']
  );
  if (rawDescription) paramSchema.description = rawDescription;

  // const from default value (literals verbatim, variable refs → "{{state.X}}")
  if (decl.defaultValue) {
    const constVal = compileDefaultValueConst(decl.defaultValue, ctx);
    if (constVal !== undefined) paramSchema.const = constVal;
  }

  return paramSchema;
}

/**
 * Extract a primitive literal (`number`, `boolean`, or `string`) from an
 * expression, or `undefined` if it is not a primitive literal.
 */
function extractPrimitiveLiteral(expr: Expression): JsonPrimitive | undefined {
  const numVal = extractNumberValue(expr);
  if (numVal !== undefined) return numVal;
  const boolVal = extractBooleanValue(expr);
  if (boolVal !== undefined) return boolVal;
  if (expr.__kind === 'StringLiteral') return extractStringValue(expr);
  return undefined;
}

/**
 * Compile an input/parameter default value (`= <expr>`) into a JSON Schema
 * `const`.
 * - Numeric, boolean, and string literals are emitted as raw JSON values.
 * - A list literal of primitive literals (e.g. `= [1, 2, 3]`) becomes a JSON
 *   array. Lists containing non-primitives (e.g. `= [@variables.A]`) are
 *   rejected at lint time, so here they simply yield no const.
 * - `@variables.X` (and other expressions) compile via the expression compiler,
 *   wrapped as a template (e.g. `@variables.defaultDate` → `"{{state.defaultDate}}"`).
 */
function compileDefaultValueConst(
  defaultValue: Expression,
  ctx: CompilerContext
): JsonPrimitive | JsonPrimitive[] | undefined {
  const primitive = extractPrimitiveLiteral(defaultValue);
  if (primitive !== undefined) return primitive;

  // List literal of primitives → JSON array. Bail if any element is not a
  // primitive literal (lint flags these; don't emit a half-compiled const).
  if (defaultValue instanceof ListLiteral) {
    const values: JsonPrimitive[] = [];
    for (const element of defaultValue.elements) {
      const value = extractPrimitiveLiteral(element);
      if (value === undefined) return undefined;
      values.push(value);
    }
    return values;
  }

  // Everything else: Variables/Inputs (e.g. @variables.X, @inputs.Y) → compiled expression,
  // wrapped as a template so the runtime interpolates it (e.g. {{state.X}}).
  const compiled = compileExpression(defaultValue, ctx);
  if (!compiled) return undefined;
  return `{{${compiled}}}`;
}

/**
 * Extract the TypeDescriptorNode from a declaration's properties block.
 * The `type` field on a ParameterDeclarationNode's properties is always a
 * TypeDescriptorNode when present (set by the dialect's TypeDescriptor parser).
 */
function getTypeDescriptor(
  props: BlockCore | undefined
): TypeDescriptorNode | undefined {
  const typeDesc = props?.['type'];
  return typeDesc instanceof TypeDescriptorNode ? typeDesc : undefined;
}

/**
 * Extract the nested value TypeDescriptorNode from a list type descriptor.
 * For `type: list`, the value field (e.g. `value: string`) is itself a
 * TypeDescriptorNode with its own properties (constraints, etc.).
 */
function getValueDescriptor(
  typeDesc: TypeDescriptorNode | undefined
): TypeDescriptorNode | undefined {
  const valueDesc = typeDesc?.properties?.['value'];
  return valueDesc instanceof TypeDescriptorNode ? valueDesc : undefined;
}

/**
 * Return the nested `fields:` declared under an input's type descriptor:
 * - type: object → .fields
 * - type: list → .value.properties.fields
 *
 * Returns undefined for scalar inputs and short-form declarations.
 */
export function getDeclaredFields(
  props: BlockCore | undefined
): NamedMap<ParameterDeclarationNode> | undefined {
  const typeDesc = getTypeDescriptor(props);
  const typeDescProps = typeDesc?.properties;
  if (!typeDescProps) return undefined;

  // Direct object type: type: object → fields in typeDescProps
  const direct = typeDescProps['fields'] as
    | NamedMap<ParameterDeclarationNode>
    | undefined;
  if (direct) return direct;

  // List of objects: type: list → value.properties.fields
  return getValueDescriptor(typeDesc)?.properties?.['fields'] as
    | NamedMap<ParameterDeclarationNode>
    | undefined;
}

/**
 * Compile the nested object fields of an input's type descriptor.
 */
function compileNestedObjectFields(
  props: BlockCore | undefined,
  ctx: CompilerContext
): { properties: Record<string, JsonSchema>; required: string[] } | undefined {
  const fieldsSource = getDeclaredFields(props);

  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  let hasFields = false;

  for (const [key, decl] of iterateNamedMap(fieldsSource)) {
    hasFields = true;

    const result = compileInputProperty(decl, ctx);
    if (result) {
      properties[key] = result.schema;
      if (result.isRequired) required.push(key);
    }
  }

  return hasFields ? { properties, required } : undefined;
}

function extractEnumValues(node: SequenceNode): JsonPrimitive[] {
  const result: JsonPrimitive[] = [];
  for (const item of node.items) {
    const val = extractPrimitiveLiteral(item as Expression);
    if (val !== undefined) result.push(val);
  }
  return result;
}
