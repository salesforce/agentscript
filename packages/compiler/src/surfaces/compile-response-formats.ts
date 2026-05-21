import { NamedMap, type ParameterDeclarationNode } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { ResponseFormat, FormatTool } from '../types.js';
import { normalizeDeveloperName, parseUri } from '../utils.js';
import {
  extractStringValue,
  extractDescriptionValue,
  extractBooleanValue,
  extractNumberValue,
  getExpressionName,
  isListType,
  iterateNamedMap,
} from '../ast-helpers.js';
import type { Range } from '@agentscript/types';

// Re-export types for convenience
export type { ResponseFormat };

/**
 * Compile response_formats from a connection block.
 */
export function compileResponseFormats(
  responseFormats: NamedMap<Record<string, unknown>> | undefined,
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

function compileResponseFormat(
  name: string,
  def: Record<string, unknown>,
  ctx: CompilerContext
): ResponseFormat | undefined {
  const description = extractDescriptionValue(def['description']) ?? '';
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
    invocationTargetType = scheme || 'externalService';
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
  if (inputSchema !== undefined) {
    formatDef.input_schema = inputSchema;
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
const FORMAT_INPUT_ITEM_CONSTRAINT_MAP: ReadonlyArray<
  readonly [string, string]
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
  readonly [string, string]
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
): string | undefined {
  if (!inputs || inputs.size === 0) return undefined;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [name, decl] of iterateNamedMap(inputs)) {
    const result = compileInputProperty(decl, ctx);
    if (result) {
      properties[name] = result.schema;
      if (result.isRequired) required.push(name);
    }
  }

  const schema: Record<string, unknown> = {
    type: 'object',
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
): { schema: Record<string, unknown>; isRequired: boolean } | undefined {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr) return undefined;

  const isList = isListType(decl.type);
  const jsonType = TYPE_MAP[typeStr] ?? 'string';
  const props = decl.properties as Record<string, unknown> | undefined;

  // messaging_component:// schema → raw format instead of JSON schema
  const schemaUri = extractStringValue(props?.['schema']);
  if (schemaUri) {
    const { scheme, path } = parseUri(schemaUri);
    if (scheme === 'messaging_component' && path) {
      const isRequired = extractBooleanValue(props?.['is_required']) ?? false;
      return {
        schema: {
          isMessagingComponent: true,
          messagingDefinitionNameOrId: path,
        },
        isRequired,
      };
    }
  }

  // Compile nested sub-fields for object types (skip for primitives)
  const nestedResult =
    jsonType === 'object' ? compileNestedObjectFields(props, ctx) : undefined;

  // Build the property schema for the base type
  const propSchema: Record<string, unknown> = {};

  if (isList) {
    // Array type: type[] → { "type": "array", "items": { "type": "..." } }
    propSchema.type = 'array';
    if (jsonType === 'object' && nestedResult) {
      // list[object] with sub-fields → items is a nested object schema
      const itemSchema: Record<string, unknown> = {
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

  // Extract description
  const description = extractDescriptionValue(props?.['description']);
  if (description) propSchema.description = description;

  // Extract label and map to JSON Schema's title
  const label = extractStringValue(props?.['label']);
  if (label) propSchema.title = label;

  // Determine where item/value constraints (enum, minLength, minimum, maximum) should be placed:
  // - For list[primitive]: constraints go on items schema (constraining each element)
  // - For everything else: constraints go on the property schema itself
  const isListOfPrimitive = isList && jsonType !== 'object';
  const itemLevelSchema = isListOfPrimitive
    ? (propSchema.items as Record<string, unknown>)
    : propSchema;

  // Extract const from default value (= "value" syntax)
  // Always placed on propSchema (the field itself, or array for list types)
  if (decl.defaultValue) {
    const constVal = extractStringValue(decl.defaultValue);
    if (constVal !== undefined) {
      propSchema.const = constVal;
    } else {
      const numVal = extractNumberValue(decl.defaultValue);
      if (numVal !== undefined) propSchema.const = numVal;
    }
  }

  // Extract enum values from ExpressionSequence
  // Placed on itemLevelSchema (items for list[primitive], propSchema otherwise)
  const enumNode = props?.['enum'];
  if (enumNode && typeof enumNode === 'object') {
    const enumValues = extractEnumValues(enumNode);
    if (enumValues.length > 0) itemLevelSchema.enum = enumValues;
  }

  // Extract item/value constraints: minLength, maxLength, minimum, maximum
  // Placed on itemLevelSchema (items for list[primitive], propSchema otherwise)
  for (const [srcKey, jsonKey] of FORMAT_INPUT_ITEM_CONSTRAINT_MAP) {
    const val = extractNumberValue(props?.[srcKey]);
    if (val !== undefined) itemLevelSchema[jsonKey] = val;
  }

  // Extract array constraints: minItems, maxItems
  // Always placed on propSchema (semantically only valid for array types)
  for (const [srcKey, jsonKey] of FORMAT_INPUT_ARRAY_CONSTRAINT_MAP) {
    const val = extractNumberValue(props?.[srcKey]);
    if (val !== undefined) propSchema[jsonKey] = val;
  }

  // Extract is_required
  const isRequired = extractBooleanValue(props?.['is_required']) ?? false;

  return { schema: propSchema, isRequired };
}

/**
 * Compile nested sub-fields from a properties block's __children.
 *
 * __children contains both property assignments and subfield declarations:
 * - Property assignments (e.g., `label: "text"`): value is StringLiteral, BooleanValue, etc.
 * - Subfield declarations (e.g., `title: string`): value is ParameterDeclarationNode
 *
 * We filter to only process ParameterDeclarationNodes (subfield declarations).
 */
function compileNestedObjectFields(
  props: Record<string, unknown> | undefined,
  ctx: CompilerContext
): { properties: Record<string, unknown>; required: string[] } | undefined {
  if (!props) return undefined;

  const children = (props as Record<string, unknown>).__children as
    | Array<{ __type: string; key: string; value: unknown }>
    | undefined;
  if (!Array.isArray(children)) return undefined;

  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  let hasFields = false;

  for (const child of children) {
    if (child.__type !== 'field') continue;

    const decl = child.value as ParameterDeclarationNode | undefined;
    if (!decl || typeof decl !== 'object') continue;
    // Filter to only subfield declarations (not property assignments)
    if (decl.__kind !== 'ParameterDeclaration') continue;

    hasFields = true;

    const result = compileInputProperty(decl, ctx);
    if (result) {
      properties[child.key] = result.schema;
      if (result.isRequired) required.push(child.key);
    }
  }

  return hasFields ? { properties, required } : undefined;
}

/**
 * Extract enum values from an ExpressionSequence node.
 * Supports string, number, and boolean values.
 */
function extractEnumValues(node: unknown): (string | number | boolean)[] {
  if (!node || typeof node !== 'object') return [];

  const seqNode = node as Record<string, unknown>;
  const items = (seqNode.items ?? seqNode.__children ?? []) as unknown[];
  const result: (string | number | boolean)[] = [];

  for (const item of items) {
    const itemObj = item as Record<string, unknown>;
    const value = itemObj._value ?? item;

    const str = extractStringValue(value);
    if (str !== undefined) {
      result.push(str);
      continue;
    }

    const num = extractNumberValue(value);
    if (num !== undefined) {
      result.push(num);
      continue;
    }

    const bool = extractBooleanValue(value);
    if (bool !== undefined) {
      result.push(bool);
    }
  }

  return result;
}

/**
 * Compile available_formats from a reasoning block.
 * Returns FormatTool[] (with type='format') for JSON output.
 */
export function compileAvailableFormats(
  availableFormats: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): FormatTool[] {
  if (!availableFormats) return [];

  const result: FormatTool[] = [];

  for (const [name, def] of iterateNamedMap(availableFormats)) {
    const tool = compileAvailableFormat(name, def, ctx);
    if (tool) {
      result.push(tool);
    }
  }

  return result;
}

function compileAvailableFormat(
  name: string,
  def: Record<string, unknown>,
  ctx: CompilerContext
): FormatTool | undefined {
  // Colinear value is accessible via .value (NamedBlock getter)
  const colinear = def['value'] as Record<string, unknown> | undefined;

  // Extract the reference name from the expression
  const target = extractFormatReference(colinear);
  if (!target) {
    return undefined;
  }

  // Map reasoning.response_actions name to response_formats definition target for @response_actions references
  ctx.responseFormatReferenceMap.set(name, target);

  const description = normalizeDeveloperName(name);

  const tool: FormatTool = {
    type: 'format',
    target,
    name,
    description,
  };

  return tool;
}

/**
 * Extract the format reference from a colinear expression.
 * Handles @response_formats.format_name -> "format_name"
 */
function extractFormatReference(
  expr: Record<string, unknown> | undefined
): string | undefined {
  if (!expr) return undefined;

  const kind = expr['__kind'] as string | undefined;

  if (kind === 'MemberExpression') {
    // @response_formats.format_name
    // Property can be a string directly or an Identifier node
    const property = expr['property'];
    if (typeof property === 'string') {
      return property;
    }
    if (typeof property === 'object' && property !== null) {
      const propObj = property as Record<string, unknown>;
      if (propObj['__kind'] === 'Identifier') {
        return propObj['name'] as string;
      }
    }
  }

  return undefined;
}
