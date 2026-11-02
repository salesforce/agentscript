/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Builds a recursive "shape index" of every response format's inputs, keyed by
 * connection then format name. The `render: ... with` binding-validation rules
 * check bindings against this index.
 *
 * For each input it captures the full shape, recursively:
 *   - nested object `fields:` and list element types, to any depth
 *   - `is_required`, and whether a default value is declared
 *   - value constraints: enum, minimum, maximum, min_length, max_length,
 *     min_items, max_items
 *
 * Fields are a closed set: what the script declares is the whole shape, and a
 * `schema:` URI never widens an object's fields. A schema-backed input (a
 * messaging component) is indexed like any other object — its nested `fields:`
 * are its bindable sub-keys. Each format also records `hasBindableInputs`, which drills
 * through such a wrapper so a component with no fields (nothing to bind) reports
 * false; the binding rules reject a `with` on any format with no inputs.
 *
 * It also exports two clusters consumed elsewhere: the shape-reader helpers and
 * traversal primitives used by the definition-side validator
 * (`connection-validation.ts`); and the shape model — the index, its
 * `RenderInputInfo`/`RenderInputConstraints` types, and the `signedNumberValue`
 * literal helper — that the binding-side rules (`render-with-bindings.ts`) check
 * `with` bindings against.
 */

import type {
  AstNodeLike,
  AstRoot,
  ConstraintMetadata,
  LintPass,
  NamedMap,
  PassStore,
} from '@agentscript/language';
import {
  storeKey,
  schemaContextKey,
  resolveNamespaceKeys,
  isAstNodeLike,
  isNamedMap,
} from '@agentscript/language';

// ---------------------------------------------------------------------------
// Shape-readers (shared with connection-validation.ts)
// ---------------------------------------------------------------------------

// The three shape-traversal primitives below are the single place that knows
// *where* nested shape lives on a block-form declaration. Every reader (this
// file's info-builders and the definition-side validator) goes through them, so
// the `type`/`fields`/`value` key names live in one place and can't drift.

/**
 * Reads the type-descriptor properties bag of a block-form input or nested
 * field.
 *
 * A `type:` block carries its `fields:`/`value:`/constraints under a nested
 * TypeDescriptor at `props.type`; short-form inputs (`title: string`) have none.
 */
export function typeDescriptorProps(
  props: AstNodeLike | undefined
): Record<string, unknown> | undefined {
  const td = (props as Record<string, unknown> | undefined)?.type as
    | { properties?: Record<string, unknown> }
    | undefined;
  return td?.properties;
}

/** Reads the `fields:` NamedMap from a type-descriptor properties bag, if declared. */
function fieldsOf(
  tdProps: Record<string, unknown> | undefined
): NamedMap<unknown> | undefined {
  const fields = tdProps?.['fields'];
  return isNamedMap(fields) ? (fields as NamedMap<unknown>) : undefined;
}

/** Reads the list element `value:` TypeDescriptor from a type-descriptor properties bag. */
function listValueDescriptor(
  tdProps: Record<string, unknown> | undefined
): AstNodeLike | undefined {
  const value = tdProps?.['value'];
  return isAstNodeLike(value) ? value : undefined;
}

/**
 * Resolve the `fields` NamedMap from input properties, checking:
 * 1. props.type.properties.fields (for type: object)
 * 2. props.type.properties.value.properties.fields (for type: list > value: object)
 */
export function resolveFieldsMap(
  props: AstNodeLike
): NamedMap<unknown> | undefined {
  const tdProps = typeDescriptorProps(props);

  const direct = fieldsOf(tdProps);
  if (direct) return direct;

  // list > value: object > fields
  const value = listValueDescriptor(tdProps);
  return value
    ? fieldsOf(value.properties as Record<string, unknown>)
    : undefined;
}

/**
 * Collect the nested parameter declarations of a response-format input,
 * declared under its `fields:` block, as `[key, declaration]` pairs.
 */
export function iterateFieldDeclarations(
  props: AstNodeLike
): Array<[string, AstNodeLike]> {
  const fields = resolveFieldsMap(props);
  if (!fields) return [];
  const declarations: Array<[string, AstNodeLike]> = [];
  for (const [key, decl] of fields) {
    if (!isAstNodeLike(decl)) continue;
    if (decl.__kind !== 'ParameterDeclaration') continue;
    declarations.push([key, decl]);
  }
  return declarations;
}

/**
 * Resolve the base type of a parameter declaration. For `list[X]` this is the
 * element type `X`; for a bare type it is the type name itself.
 */
export function getBaseTypeName(decl: AstNodeLike): string | undefined {
  const type = decl.type as AstNodeLike | undefined;
  if (!type) return undefined;
  if (type.__kind === 'Identifier') return type.name as string;
  if (type.__kind === 'SubscriptExpression') {
    const index = type.index as AstNodeLike | undefined;
    if (index?.__kind === 'Identifier') return index.name as string;
    const object = type.object as AstNodeLike | undefined;
    if (object?.__kind === 'Identifier') return object.name as string;
  }
  return undefined;
}

/**
 * True when a declaration's type can carry a `fields:` block: i.e. object and
 * list of objects.
 */
export function declAcceptsFields(
  decl: AstNodeLike,
  props: AstNodeLike | undefined
): boolean {
  const base = getBaseTypeName(decl);
  if (base === 'object') return true;
  if (base !== 'list') return false;

  const value = listValueDescriptor(typeDescriptorProps(props));
  if (!value) return false;
  // `value:` is a TypeDescriptor, not a ParameterDeclaration — its type keyword
  // lives on `.typeName`. (`getBaseTypeName` reads `.type`, so it won't work here.)
  const typeName = value.typeName as AstNodeLike | undefined;
  if (typeName?.__kind === 'Identifier') {
    return (typeName.name as string) === 'object';
  }
  return false;
}

// ---------------------------------------------------------------------------
// Recursive input-signature model
// ---------------------------------------------------------------------------

/**
 * Constraints whose value is a single number literal (numeric bounds, string
 * lengths, and list-item counts alike), as authored (snake_case) → model field.
 * `enum` is excluded — its value is a Sequence, not a number, so it reads
 * separately (see {@link readConstraints}).
 */
const NUMBER_VALUED_CONSTRAINT_KEYS = [
  ['minimum', 'minimum'],
  ['maximum', 'maximum'],
  ['min_length', 'minLength'],
  ['max_length', 'maxLength'],
  ['min_items', 'minItems'],
  ['max_items', 'maxItems'],
] as const satisfies ReadonlyArray<
  readonly [string, Exclude<keyof ConstraintMetadata, 'enum'>]
>;

/**
 * Static value constraints declared on an input (or nested field). Derived from
 * the canonical {@link ConstraintMetadata}: `enum` plus every field named in
 * {@link NUMBER_VALUED_CONSTRAINT_KEYS}, so the set of constraint fields is
 * declared once (in the reader table) and can never drift from the model.
 */
export type RenderInputConstraints = Pick<
  ConstraintMetadata,
  'enum' | (typeof NUMBER_VALUED_CONSTRAINT_KEYS)[number][1]
>;

/**
 * Fully-resolved shape of a single response-format input — recursive so nested
 * object `fields:` and list element types are reachable at any depth.
 */
export interface RenderInputInfo {
  /** Normalized structural kind. */
  kind: 'scalar' | 'object' | 'list';
  /**
   * The type keyword used for family/type-compatibility checks. For `scalar`
   * this is the declared primitive (e.g. `string`, `integer`); for `object`
   * it is `object`; for `list` it is `list`.
   */
  typeName: string;
  /**
   * Value of `is_required`, if explicitly declared. `undefined` means
   * unspecified (defaults to required). `false` marks the input optional.
   */
  isRequired?: boolean;
  /** Whether a default value (`= ...`) is declared. */
  hasDefault: boolean;
  /**
   * For `object`: the declared fields (`name → info`), or `undefined` when no
   * `fields:` block is declared (or it's empty).
   *
   * Fields are a closed set: `undefined`/empty means the object accepts no
   * sub-inputs, so any inline key is unknown. A `schema:` URI does not widen
   * this — binding validation goes only by what the script declares.
   */
  fields?: Map<string, RenderInputInfo>;
  /** For `list`: the element's own shape, when declared. */
  element?: RenderInputInfo;
  /** Declared value constraints at this level, if any. */
  constraints?: RenderInputConstraints;
}

/** Resolved binding-relevant view of a single response format. */
export interface ResponseFormatInfo {
  /**
   * Declared top-level inputs, `name → info`. A closed set: empty means the
   * format takes no inputs, so any `with` binding names an unknown input.
   */
  inputs: Map<string, RenderInputInfo>;
  /**
   * Whether the format exposes any input to bind.
   */
  hasBindableInputs: boolean;
}

/**
 * Index of response-format shapes: `connection → formatName → ResponseFormatInfo`.
 * Populated per document by {@link responseFormatShapeAnalyzer}. Empty when the
 * active schema has no `connection` namespace (e.g. pure agentscript).
 */
export type ResponseFormatShapeIndex = Map<
  string,
  Map<string, ResponseFormatInfo>
>;

export const responseFormatShapeIndexKey = storeKey<ResponseFormatShapeIndex>(
  'response-format-shape-index'
);

/**
 * Index of each connection's declared `inputs:` shapes: `connection →
 * inputName → info`. Populated alongside {@link ResponseFormatShapeIndex} by
 * {@link responseFormatShapeAnalyzer}. Every connection gets an entry (an empty
 * map when it declares no `inputs:`), so a lookup distinguishes "connection has
 * no such input" from "connection does not exist".
 *
 * The render-with binding rules read this to type-check and resolve
 * `@inputs.Y` / `@connection.X.inputs.Y` binding values.
 */
export type ConnectionInputsIndex = Map<string, Map<string, RenderInputInfo>>;

export const connectionInputsIndexKey = storeKey<ConnectionInputsIndex>(
  'connection-inputs-index'
);

/** Read an Identifier node's `name`, or undefined. */
function identifierName(node: unknown): string | undefined {
  if (!isAstNodeLike(node)) return undefined;
  if (node.__kind !== 'Identifier') return undefined;
  const name = node.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/**
 * Read a numeric constraint bound (`NumberValue.value`), or undefined.
 *
 * Intentionally NOT `signedNumberValue`: a negative bound like `minimum: -5` is
 * rejected upstream by the `NumberValue` primitive (which only accepts a
 * `NumberLiteral`, not the `UnaryExpression` a signed literal parses to), so a
 * negative never reaches this reader — swapping in `signedNumberValue` here
 * would be a silent no-op. Do not "unify" the two helpers; fix the primitive.
 */
function numberFieldValue(node: unknown): number | undefined {
  if (!isAstNodeLike(node)) return undefined;
  if (node.__kind !== 'NumberValue') return undefined;
  return typeof node.value === 'number' ? node.value : undefined;
}

/**
 * Fold a signed numeric literal into its value. `-5` parses as a
 * `UnaryExpression` over a `NumberLiteral`, not a `NumberLiteral`, so a bare
 * `node.value` read misses negatives. Returns undefined for anything else.
 */
export function signedNumberValue(node: unknown): number | undefined {
  if (!isAstNodeLike(node)) return undefined;
  if (node.__kind === 'NumberLiteral' || node.__kind === 'NumberValue') {
    return typeof node.value === 'number' ? node.value : undefined;
  }
  if (node.__kind === 'UnaryExpression') {
    const operand = node.operand as AstNodeLike | undefined;
    const base = signedNumberValue(operand);
    if (base === undefined) return undefined;
    if (node.operator === '-') return -base; // negate
    if (node.operator === '+') return base; // unary plus is a no-op
  }
  return undefined;
}

/** Extract a primitive literal value from an enum element expression. */
function literalValue(node: unknown): string | number | boolean | undefined {
  if (!isAstNodeLike(node)) return undefined;
  const kind = node.__kind;
  // Signed numbers (`-5`) are UnaryExpressions — fold them before the direct read.
  if (kind === 'UnaryExpression') return signedNumberValue(node);
  if (
    (kind === 'StringLiteral' ||
      kind === 'NumberLiteral' ||
      kind === 'BooleanLiteral' ||
      kind === 'NumberValue' ||
      kind === 'BooleanValue') &&
    (typeof node.value === 'string' ||
      typeof node.value === 'number' ||
      typeof node.value === 'boolean')
  ) {
    return node.value;
  }
  return undefined;
}

/** Collect the literal values declared in an `enum:` Sequence node. */
function extractEnumValues(
  seq: unknown
): Array<string | number | boolean> | undefined {
  if (!isAstNodeLike(seq) || seq.__kind !== 'Sequence') return undefined;
  // `SequenceNode.items` exposes the element expressions.
  const items = (seq as { items?: unknown[] }).items;
  if (!Array.isArray(items)) return undefined;
  const values: Array<string | number | boolean> = [];
  for (const item of items) {
    const v = literalValue(item);
    if (v !== undefined) values.push(v);
  }
  return values.length > 0 ? values : undefined;
}

/**
 * Read the constraint keywords (`enum` plus {@link NUMBER_VALUED_CONSTRAINT_KEYS})
 * from a TypeDescriptor's `properties` bag. Returns undefined when none are
 * present.
 */
function readConstraints(
  tdProps: Record<string, unknown> | undefined
): RenderInputConstraints | undefined {
  if (!tdProps) return undefined;
  const c: RenderInputConstraints = {};
  let any = false;

  const enumValues = extractEnumValues(tdProps['enum']);
  if (enumValues) {
    c.enum = enumValues;
    any = true;
  }
  for (const [authored, field] of NUMBER_VALUED_CONSTRAINT_KEYS) {
    const n = numberFieldValue(tdProps[authored]);
    if (n !== undefined) {
      c[field] = n;
      any = true;
    }
  }

  return any ? c : undefined;
}

/**
 * Build a fields map from a `fields:` NamedMap.
 *
 * Returns undefined when the block is absent or empty; binding validation
 * treats that as a closed object with no sub-inputs.
 */
function buildFieldsMap(
  fields: unknown
): Map<string, RenderInputInfo> | undefined {
  if (!isNamedMap(fields)) return undefined;
  const map = new Map<string, RenderInputInfo>();
  for (const [name, decl] of fields as NamedMap<unknown>) {
    if (!isAstNodeLike(decl)) continue;
    if (decl.__kind !== 'ParameterDeclaration') continue;
    const info = infoFromParamDecl(decl);
    if (info) map.set(name, info);
  }
  return map.size > 0 ? map : undefined;
}

/**
 * Build a {@link RenderInputInfo} from a list element's `value:` TypeDescriptor.
 * TypeDescriptors carry no `is_required`/default of their own — those belong to
 * the enclosing declaration — so `hasDefault` is false and `isRequired` is left
 * unset.
 */
function infoFromTypeDescriptor(td: AstNodeLike): RenderInputInfo | undefined {
  const kw = identifierName(td.typeName);
  if (!kw) return undefined;
  const tdProps = td.properties as Record<string, unknown> | undefined;
  const constraints = readConstraints(tdProps);

  if (kw === 'object') {
    return {
      kind: 'object',
      typeName: 'object',
      hasDefault: false,
      fields: buildFieldsMap(fieldsOf(tdProps)),
      constraints,
    };
  }
  if (kw === 'list') {
    const valueTd = listValueDescriptor(tdProps);
    return {
      kind: 'list',
      typeName: 'list',
      hasDefault: false,
      element: valueTd ? infoFromTypeDescriptor(valueTd) : undefined,
      constraints,
    };
  }
  return {
    kind: 'scalar',
    typeName: kw,
    hasDefault: false,
    constraints,
  };
}

/**
 * Build a {@link RenderInputInfo} from a response-format input's
 * `ParameterDeclaration`.
 */
function infoFromParamDecl(decl: AstNodeLike): RenderInputInfo | undefined {
  const type = decl.type as AstNodeLike | undefined;
  if (!type) return undefined;

  const props = decl.properties as AstNodeLike | undefined;
  const isRequiredNode = props?.is_required;
  const isRequired =
    isAstNodeLike(isRequiredNode) &&
    isRequiredNode.__kind === 'BooleanValue' &&
    typeof isRequiredNode.value === 'boolean'
      ? isRequiredNode.value
      : undefined;
  const hasDefault = decl.defaultValue != null;
  const hasSchema = !!props && props.schema != null;

  const tdProps = typeDescriptorProps(props);
  const constraints = readConstraints(tdProps);

  const base = {
    isRequired,
    hasDefault,
    constraints,
  };

  // Short-form `list[X]`: `decl.type` is a SubscriptExpression whose index is
  // the element type keyword. Short-form cannot declare object `fields:`.
  if (type.__kind === 'SubscriptExpression') {
    const elementKw = identifierName(type.index) ?? identifierName(type.object);
    const element: RenderInputInfo | undefined = elementKw
      ? elementKw === 'object'
        ? {
            kind: 'object',
            typeName: 'object',
            hasDefault: false,
          }
        : {
            kind: 'scalar',
            typeName: elementKw,
            hasDefault: false,
          }
      : undefined;
    return { kind: 'list', typeName: 'list', ...base, element };
  }

  const kw = identifierName(type);
  if (!kw) {
    // Input declared via `schema:` with no type keyword: index it as an object
    // with no declared fields (a closed empty shape — any inline sub-key is
    // unknown).
    if (hasSchema) return { kind: 'object', typeName: 'object', ...base };
    return undefined;
  }

  if (kw === 'object') {
    return {
      kind: 'object',
      typeName: 'object',
      ...base,
      fields: buildFieldsMap(fieldsOf(tdProps)),
    };
  }

  if (kw === 'list') {
    // Long-form `type: list` + `value:` — element is a nested TypeDescriptor.
    const valueTd = listValueDescriptor(tdProps);
    return {
      kind: 'list',
      typeName: 'list',
      ...base,
      element: valueTd ? infoFromTypeDescriptor(valueTd) : undefined,
    };
  }

  return { kind: 'scalar', typeName: kw, ...base };
}

/**
 * Analyzer that walks every connection's `response_formats:` sub-map and builds
 * the recursive {@link ResponseFormatShapeIndex}. Mirrors the traversal of the
 * base `connectionFormatsAnalyzer`, but resolves full input shape instead of
 * just names.
 */
class ResponseFormatShapeAnalyzer implements LintPass {
  readonly id = responseFormatShapeIndexKey;
  readonly description =
    'Indexes each response_format’s recursive input shape for render-with binding validation';

  finalize(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const index: ResponseFormatShapeIndex = new Map();
    const inputsIndex: ConnectionInputsIndex = new Map();
    const rootObj = root as AstNodeLike;
    const connectionKeys = resolveNamespaceKeys('connection', ctx);

    for (const key of connectionKeys) {
      const connections = rootObj[key];
      if (!isNamedMap(connections)) continue;

      for (const [connName, block] of connections as NamedMap<unknown>) {
        if (!isAstNodeLike(block)) continue;

        // Index the connection's own `inputs:` (empty map when none declared),
        // so `@inputs.Y` / `@connection.X.inputs.Y` bindings resolve. Top-level
        // inputs share the ParameterDeclaration shape of format inputs.
        inputsIndex.set(
          connName,
          buildFieldsMap(block.inputs) ?? new Map<string, RenderInputInfo>()
        );

        const formats = block.response_formats;
        if (!isNamedMap(formats)) continue;

        const formatMap = new Map<string, ResponseFormatInfo>();
        for (const [formatName, formatBlock] of formats as NamedMap<unknown>) {
          if (!isAstNodeLike(formatBlock)) continue;
          formatMap.set(formatName, this.buildFormatInfo(formatBlock));
        }
        index.set(connName, formatMap);
      }
    }

    store.set(responseFormatShapeIndexKey, index);
    store.set(connectionInputsIndexKey, inputsIndex);
  }

  private buildFormatInfo(format: AstNodeLike): ResponseFormatInfo {
    // Top-level inputs share the ParameterDeclaration shape of nested `fields:`.
    const inputs =
      buildFieldsMap(format.inputs) ?? new Map<string, RenderInputInfo>();

    return {
      inputs,
      hasBindableInputs: formatHasBindableInputs(format.inputs),
    };
  }
}

/**
 * Whether a format exposes any input to bind.
 *
 * Normally that's just "declares at least one input". The exception is a
 * messaging component, which declares its real inputs as the nested `fields:`
 * of a single `schema:`-backed wrapper input — so we drill one level and report
 * whether that wrapper has any fields. A component that declares none exposes
 * nothing to bind.
 */
function formatHasBindableInputs(rawInputs: unknown): boolean {
  if (!isNamedMap(rawInputs) || rawInputs.size === 0) return false;
  if (rawInputs.size !== 1) return true;

  let sole: unknown;
  for (const [, value] of rawInputs as NamedMap<unknown>) {
    sole = value;
    break;
  }
  if (!isAstNodeLike(sole)) return true;

  const props = sole.properties;
  // Not a schema-backed wrapper — a single ordinary input is an input.
  if (!isAstNodeLike(props) || props.schema == null) return true;

  // Messaging component: its bindable inputs are the wrapper's nested fields.
  const fields = resolveFieldsMap(props);
  return fields !== undefined && fields.size > 0;
}

/** Build the response-format shape analyzer. */
export function responseFormatShapeAnalyzer(): LintPass {
  return new ResponseFormatShapeAnalyzer();
}
