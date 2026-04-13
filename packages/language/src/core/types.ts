/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Diagnostic } from './diagnostics.js';
import type { Dialect } from './dialect.js';
import type { BlockChild } from './children.js';
import type { NamedMap } from './named-map.js';

// Foundational types — canonical definitions live in @agentscript/types.
// Re-exported here so internal language modules can import from './types.js'.
export type {
  SyntaxNode,
  Position,
  Range,
  CstMeta,
  CommentAttachment,
  Comment,
} from '@agentscript/types';
export { toRange, comment } from '@agentscript/types';

import type {
  SyntaxNode,
  Range,
  CstMeta,
  CommentAttachment,
  Comment,
} from '@agentscript/types';
import { toRange } from '@agentscript/types';

/** Parse a CST comment node into a Comment object. */
export function parseCommentNode(
  node: SyntaxNode,
  attachment: CommentAttachment = 'leading'
): Comment {
  return {
    value: node.text.slice(1),
    attachment,
    range: toRange(node),
  };
}

export type AstNode<T> = T & {
  __cst?: CstMeta;
  __diagnostics: Diagnostic[];
  __comments?: Comment[];
};

export type Parsed<T> = AstNode<T> & { __cst: CstMeta };

/**
 * Base type for a parsed AST root node with metadata.
 * Extends AstNodeLike so internal analysis code can access schema-defined
 * fields via the index signature without casting.
 */
export interface AstRoot extends AstNodeLike {
  __cst: CstMeta;
  __diagnostics: Diagnostic[];
}

/** Access a dynamic field on a parsed AST node by schema key. */
export function astField(ast: AstNodeLike, key: string): unknown {
  return ast[key];
}

/**
 * Extract the string value of a discriminant field from a parsed AST entry.
 * Handles StringLiteral (.value) and Identifier (.name) expression types.
 */
export function extractDiscriminantValue(
  entry: AstNodeLike,
  fieldName: string
): string | undefined {
  const field = entry[fieldName];
  if (!field || typeof field !== 'object') return undefined;
  const expr = field as { value?: unknown; name?: unknown };
  if (typeof expr.value === 'string') return expr.value;
  if (typeof expr.name === 'string') return expr.name;
  return undefined;
}

export function withCst<T extends object>(ast: T, node: SyntaxNode): Parsed<T> {
  const existing = (ast as Partial<Parsed<T>>).__diagnostics;
  const result: T & { __cst: CstMeta; __diagnostics: Diagnostic[] } =
    Object.assign(ast, {
      __cst: {
        node,
        range: toRange(node),
      },
      __diagnostics: existing ?? ([] satisfies Diagnostic[]),
    });
  return result;
}

export function createNode<T extends object>(ast: T): AstNode<T> {
  const result: T & { __diagnostics: Diagnostic[] } = Object.assign(ast, {
    __diagnostics: [] satisfies Diagnostic[],
  });
  return result;
}

/** Provides common AST metadata fields shared by expression and statement classes. */
export abstract class AstNodeBase {
  __diagnostics: Diagnostic[] = [];
  __cst?: CstMeta;
  __comments?: Comment[];
}

// Handles bare identifiers and quoted strings as mapping keys.

export const BARE_ID_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Extract the text content of a key child node (either 'id' or 'string'). */
export function getKeyText(node: SyntaxNode): string {
  if (node.type === 'id') {
    return node.text;
  }
  if (node.type === 'string') {
    let value = '';
    for (const child of node.namedChildren) {
      if (child.type === 'string_content') {
        value += child.text;
      } else if (child.type === 'escape_sequence') {
        if (child.text === '\\"') value += '"';
        else if (child.text === "\\'") value += "'";
        else if (child.text === '\\\\') value += '\\';
        else if (child.text === '\\n') value += '\n';
        else if (child.text === '\\r') value += '\r';
        else if (child.text === '\\t') value += '\t';
        else if (child.text === '\\0') value += '\0';
      }
    }
    return value;
  }
  return node.text;
}

/** Quotes the key name if it contains non-identifier characters. */
export function emitKeyName(name: string): string {
  if (BARE_ID_PATTERN.test(name)) {
    return name;
  }
  return quoteKeyName(name);
}

/** Always quotes the key name (for keys that were originally quoted in source). */
export function quoteKeyName(name: string): string {
  const escaped = name
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    .replace(/\0/g, '\\0');
  return `"${escaped}"`;
}

export function isKeyNode(node: SyntaxNode): boolean {
  return node.type === 'id' || node.type === 'string';
}

/** Extract the value-bearing child nodes from a mapping_element. */
export function getValueNodes(element: SyntaxNode): {
  blockValue: SyntaxNode | null;
  colinearValue: SyntaxNode | null;
  procedure: SyntaxNode | null;
} {
  return {
    blockValue: element.childForFieldName('block_value'),
    // expression is semantically a colinear value, just promoted due to inline rule
    colinearValue:
      element.childForFieldName('colinear_value') ??
      element.childForFieldName('expression'),
    procedure: element.childForFieldName('procedure'),
  };
}

export interface EmitContext {
  indent: number;
  /** Spaces per indent level (default 4). */
  tabSize?: number;
}

export function emitIndent(ctx: EmitContext): string {
  return ' '.repeat(ctx.indent * (ctx.tabSize ?? 4));
}

/** Structural type for any AST node that can carry comments. */
export interface CommentTarget {
  __cst?: CstMeta;
  __comments?: Comment[];
}

/** Filter comments by attachment position. */
export function leadingComments(
  node: CommentTarget | null | undefined
): Comment[] {
  return node?.__comments?.filter(c => c.attachment === 'leading') ?? [];
}

/** Filter comments by attachment position. */
export function trailingComments(
  node: CommentTarget | null | undefined
): Comment[] {
  return node?.__comments?.filter(c => c.attachment === 'trailing') ?? [];
}

/** Filter comments by attachment position. */
export function inlineComments(
  node: CommentTarget | null | undefined
): Comment[] {
  return node?.__comments?.filter(c => c.attachment === 'inline') ?? [];
}

function emitSingleComment(c: Comment, ctx: EmitContext): string {
  const indent = emitIndent(ctx);
  if (c.value.trim().length === 0) return `${indent}#`;
  // Parsed comments (have range) preserve original spacing via raw slice(1).
  // Programmatic comments (no range) get conventional `# ` prefix.
  const prefix = c.range ? '#' : '# ';
  return `${indent}${prefix}${c.value}`;
}

function formatInlineComment(c: Comment): string {
  if (c.value.trim().length === 0) return '#';
  const prefix = c.range ? '#' : '# ';
  return `${prefix}${c.value}`;
}

function appendInlineToFirstLine(body: string, inlineComment: string): string {
  const newlineIdx = body.indexOf('\n');
  if (newlineIdx === -1) return `${body} ${inlineComment}`;
  return `${body.slice(0, newlineIdx)} ${inlineComment}${body.slice(newlineIdx)}`;
}

export function emitCommentList(
  comments: Comment[] | undefined,
  ctx: EmitContext
): string {
  if (!comments || comments.length === 0) return '';
  return comments.map(c => emitSingleComment(c, ctx)).join('\n');
}

/**
 * Wrap emitted `body` text with leading, inline, and trailing comments from `node`.
 *
 * @param trailingIndentOffset - Extra indent **levels** added to `ctx.indent` for
 *   trailing comments only (not an absolute level or a space count). For example,
 *   passing `1` indents trailing comments one level deeper than the current context,
 *   which {@link FieldChild} uses so trailing comments sit inside the block body.
 */
export function wrapWithComments(
  body: string,
  node: CommentTarget | null | undefined,
  ctx: EmitContext,
  trailingIndentOffset?: number
): string {
  if (!node || !node.__comments?.length) return body;

  const leading = leadingComments(node);
  const inline = inlineComments(node);
  const trailing = trailingComments(node);

  const parts: string[] = [];

  // Leading: each on its own line above body
  const leadingText = emitCommentList(leading, ctx);
  if (leadingText) parts.push(leadingText);

  // Body + inline comments appended to first line
  if (body) {
    if (inline.length > 0) {
      const inlineText = inline.map(c => formatInlineComment(c)).join(' ');
      parts.push(appendInlineToFirstLine(body, inlineText));
    } else {
      parts.push(body);
    }
  }

  // Trailing: each on its own line below body
  if (trailing.length > 0) {
    const trailingCtx =
      trailingIndentOffset != null
        ? { ...ctx, indent: ctx.indent + trailingIndentOffset }
        : ctx;
    const trailingText = trailing
      .map(c => emitSingleComment(c, trailingCtx))
      .join('\n');
    if (trailingText) parts.push(trailingText);
  }

  return parts.join('\n');
}

/**
 * LSP SymbolKind values. MUST NOT be changed -- LSP clients depend on these exact values.
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#symbolKind
 */
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface SymbolMeta {
  kind: SymbolKind;
  noRecurse?: boolean;
}

/**
 * Internal type for schema-driven tree walking (lint passes, scope analysis,
 * completions). The index signature allows dynamic access to schema-defined
 * fields whose names are only known at runtime.
 *
 * Contrast with {@link AstRoot} which is the consumer-facing strict type
 * without an index signature. Use {@link astField} for dynamic access on
 * AstRoot; use AstNodeLike's index signature for internal traversal code.
 */
export interface AstNodeLike {
  __kind?: string;
  __cst?: CstMeta;
  __diagnostics?: Diagnostic[];
  __children?: BlockChild[];
  __scope?: string;
  __name?: string;
  __symbol?: SymbolMeta;
  __comments?: Comment[];
  [key: string]: unknown;
}

/**
 * Narrow an unknown value to AstNodeLike after a typeof 'object' check.
 *
 * AstNodeLike's index signature (`[key: string]: unknown`) means any
 * non-null object is structurally compatible at runtime, but TypeScript
 * cannot infer this from `typeof v === 'object'` alone (the narrowed
 * `object` type lacks an index signature). This single guard replaces
 * scattered `as AstNodeLike` casts throughout the analysis/lint layer.
 */
export function isAstNodeLike(value: unknown): value is AstNodeLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Type guard: value is a non-null object carrying a `__cst` with a `range`. */
export function hasCstRange(
  value: unknown
): value is { __cst: { range: Range } } {
  if (value == null || typeof value !== 'object') return false;
  const cst = (value as Record<string, unknown>).__cst;
  return cst != null && typeof cst === 'object' && 'range' in (cst as object);
}

export interface ParseResult<T> {
  value: Parsed<T>;
  diagnostics: Diagnostic[];
}

export function parseResult<T>(
  value: Parsed<T>,
  diagnostics: Diagnostic[]
): ParseResult<T> {
  return { value, diagnostics };
}

export type Schema = Record<string, FieldType | FieldType[]>;

/** A wildcard prefix that matches field names starting with a given string. */
export interface WildcardPrefix {
  readonly prefix: string;
  readonly fieldType: FieldType;
}

const WILDCARD_KEY = '__wildcardPrefixes__';

/** Attach wildcard prefixes as a non-enumerable property on a schema object. */
export function attachWildcardPrefixes(
  schema: Record<string, FieldType>,
  prefixes: readonly WildcardPrefix[]
): void {
  Object.defineProperty(schema, WILDCARD_KEY, {
    value: prefixes,
    enumerable: false,
    writable: false,
    configurable: false,
  });
}

/** Read wildcard prefixes from a schema object (returns [] if none). */
export function getWildcardPrefixes(
  schema: Schema | Record<string, FieldType>
): readonly WildcardPrefix[] {
  return (
    ((schema as Record<string, unknown>)[WILDCARD_KEY] as
      | readonly WildcardPrefix[]
      | undefined) ?? []
  );
}

/** Resolve a field name against wildcard prefixes. Returns the matching FieldType or undefined. */
export function resolveWildcardField(
  schema: Schema | Record<string, FieldType>,
  fieldName: string
): FieldType | undefined {
  for (const { prefix, fieldType } of getWildcardPrefixes(schema)) {
    if (fieldName.startsWith(prefix) && fieldName.length > prefix.length) {
      return fieldType;
    }
  }
  return undefined;
}

/**
 * Schema keys whose field types are colinear-scannable (not Block, Collection, or TypedMap).
 * Discriminant fields must be colinear scalar values that prescanDiscriminantValue() can read.
 */
export type ColinearFieldKeys<T extends Schema> = {
  [K in keyof T & string]: T[K] extends {
    readonly __fieldKind: 'Block' | 'Collection' | 'TypedMap';
  }
    ? never
    : K;
}[keyof T & string];

/** Semantic capability that a block type declares (e.g., can be called as a tool, can be transitioned to). */
export type BlockCapability = 'invocationTarget' | 'transitionTarget';

/** Value-level validation constraints, modeled after JSON Schema. */
export interface ConstraintMetadata {
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: ReadonlyArray<string | number | boolean>;
  const?: string | number | boolean;
  minItems?: number;
  maxItems?: number;
  /** Restrict ReferenceValue to only allow these @namespaces. */
  allowedNamespaces?: ReadonlyArray<string>;
  /** The resolved expression must reference a namespace with this capability (e.g. 'invocationTarget'). */
  resolvedType?: BlockCapability;
}

/**
 * Metadata that describes any named language concept — fields, keywords, types.
 * This is the base for both schema field metadata and keyword documentation.
 */
export interface DocumentationMetadata {
  description?: string;
  example?: string;
  minVersion?: string;
  deprecated?: {
    message?: string;
    since?: string;
    removeIn?: string;
    replacement?: string;
  };
  experimental?: boolean;
}

/** Full metadata for a schema field — extends DocumentationMetadata with field-specific behavior. */
export interface FieldMetadata extends DocumentationMetadata {
  required?: boolean;
  /** When true, collection fields must contain at most one entry. */
  singular?: boolean;
  constraints?: ConstraintMetadata;
  /** When true, ProcedureValue fields emit without the arrow (->) syntax. */
  omitArrow?: boolean;
  /** When true, ProcedureValue fields disallow Template statements. */
  disallowTemplates?: boolean;
  /**
   * When true, this scoped namespace supports cross-block @namespace.member
   * references via colinear resolution. For example, marking `outputs` as
   * crossBlockReferenceable means `@outputs.result` inside a reasoning action
   * resolves against the outputs of the action referenced by the sibling
   * colinear value (e.g., `@actions.fetch_data`).
   */
  crossBlockReferenceable?: boolean;
  /** When true, the field is valid in the schema but not shown in code completions. */
  hidden?: boolean;
}

/**
 * Describes a keyword in the language (e.g., a modifier like `mutable` or a type like `string`).
 *
 * @example
 * ```ts
 * { keyword: 'mutable', description: 'A variable that can change during the conversation.' }
 * ```
 */
export interface KeywordInfo {
  keyword: string;
  description?: string;
  metadata?: DocumentationMetadata;
}

/** Extract just the keyword name strings from a KeywordInfo array. */
export function keywordNames(keywords: readonly KeywordInfo[]): string[] {
  return keywords.map(k => k.keyword);
}

// SAFETY: Default is `any` because emit(value: V) is contravariant in V,
// so FieldType<X> is not assignable to FieldType<unknown>. The `any` default
// enables Schema to erase V while preserving assignability. This `any` is
// confined to the FieldType boundary and does not leak into parsed AST types
// (InferFieldType recovers the concrete V).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface FieldTypeBase<V = any, F = V> {
  readonly __fieldKind:
    | 'Block'
    | 'TypedMap'
    | 'Collection'
    | 'Primitive'
    | 'Sequence';
  /**
   * Phantom field carrying the type that appears on a parent block when this
   * field type is used in a schema. For primitives F = V. For NamedBlock
   * F = NamedMap<Parsed<...>>. Pre-computed at each factory call site
   * so InferFields never recurses — Zod-style eager resolution.
   */
  readonly __fieldOutput?: F;
  __accepts?: string[];
  __metadata?: FieldMetadata;
  emit: (value: V, ctx: EmitContext) => string;
  emitField?: (key: string, value: V, ctx: EmitContext) => string;
  schema?: Schema;
  scopeAlias?: string;
  /** Semantic capabilities declared by this block type (e.g., 'invocationTarget', 'transitionTarget'). */
  readonly capabilities?: readonly BlockCapability[];

  // Optional properties populated by specialized factories (Collection, TypedMap).
  // Declared here so FieldType structurally satisfies SchemaFieldInfo.
  readonly __isCollection?: boolean;
  readonly __isTypedMap?: boolean;
  propertiesSchema?: Schema;
  __modifiers?: readonly KeywordInfo[];
  __primitiveTypes?: readonly KeywordInfo[];

  // Discriminant API — populated via defineProperty on Block/NamedBlock factories.
  /** The discriminant field name, if using field-based discrimination. */
  readonly discriminantField?: string;
  /** Resolve variant schema by discriminant field value. */
  resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
}

/** Structural shape of a type that supports discriminant-based polymorphic schema resolution. */
export interface DiscriminantProvider {
  readonly discriminantField: string;
  resolveSchemaForDiscriminant(value: string): Record<string, FieldType>;
}

/** Narrows to a type that has both discriminantField and resolveSchemaForDiscriminant. */
export function hasDiscriminant(value: {
  discriminantField?: string | null;
  resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
}): value is DiscriminantProvider {
  return !!value.discriminantField && !!value.resolveSchemaForDiscriminant;
}

/** All field types: parse(node, dialect). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface SingularFieldType<V = any, F = V> extends FieldTypeBase<V, F> {
  isNamed?: false;
  parse: (
    node: SyntaxNode,
    dialect: Dialect,
    extraElements?: SyntaxNode[]
  ) => ParseResult<V>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FieldType<V = any, F = V> = SingularFieldType<V, F>;

type ResolveFieldType<T> = T extends FieldType[] ? FieldType : T & FieldType;

/**
 * Extract the field-level output type from a FieldType.
 *
 * Prefers `__fieldOutput` (pre-computed phantom set by factory call sites)
 * over `V` (the parse-level value type). This is the Zod-style trick:
 * each Block/NamedBlock/TypedMap factory eagerly resolves its output type
 * at definition time, so InferFields never recurses into nested schemas.
 *
 * For variant CollectionBlocks wrapping variant NamedBlocks, `__variants`
 * takes priority to produce a typed NamedMap with variant-aware `get()`.
 */
type FieldOutput<T> = T extends {
  __variants: infer V extends Record<string, Schema>;
}
  ? [keyof V] extends [never]
    ? T extends FieldTypeBase<infer _V, infer F>
      ? F
      : never
    : NamedMap<Parsed<VariantBlockInstance<V[keyof V]>>>
  : T extends FieldTypeBase<infer _V, infer F>
    ? F
    : never;

/**
 * Map a schema to its parsed field types. Each field's output type is
 * extracted via {@link FieldOutput} — a single conditional that reads the
 * pre-computed `__fieldOutput` phantom. No recursion, no deep conditionals.
 */
export type InferFields<T extends Schema> = {
  [K in keyof T]?: FieldOutput<ResolveFieldType<T[K]>>;
};
/** @internal */
export type VariantBlockInstance<S extends Schema> = {
  __kind: string;
  __diagnostics: Diagnostic[];
} & InferFields<S>;

/**
 * Extract the parse value type from a FieldType or NamedBlock entry type.
 * Works with both FieldType (parse returns ParseResult<V>) and NamedBlockFactory
 * (parse returns ParseResult<V> with a 3-arg signature).
 *
 * For variant NamedBlockFactories, produces a union of base instance types
 * intersected with each variant's inferred fields. The `isNamed: true`
 * guard ensures this only applies to entry-level NamedBlockFactory, not
 * CollectionBlockFactory (which carries __variants for FieldOutput only).
 */
export type InferFieldType<T> = T extends {
  __variants: infer V extends Record<string, Schema>;
  parse: (...args: never[]) => ParseResult<infer Base>;
  isNamed: true;
}
  ? [keyof V] extends [never]
    ? Base
    : VariantFieldType<Base, V>
  : T extends {
        parse: (...args: never[]) => ParseResult<infer V>;
      }
    ? V
    : never;

/** @internal Distributes Base over each variant schema to produce a union. */
type VariantFieldType<Base, V extends Record<string, Schema>> = {
  [K in keyof V]: Base & InferFields<V[K]>;
}[keyof V];

/**
 * For collection factories, extract the entry block's parsed type.
 * Falls back to `InferFieldType<T>` for non-collection types.
 */
export type InferEntryType<T> = T extends {
  entryBlock: infer E;
}
  ? InferFieldType<E>
  : InferFieldType<T>;

/**
 * Brand symbol for NamedMap instances.
 * Using `Symbol.for` ensures cross-realm compatibility (same symbol
 * regardless of where NamedMap was instantiated).
 */
export const NAMED_MAP_BRAND: unique symbol = Symbol.for(
  'agentscript.NamedMap'
);

/**
 * Runtime type guard for NamedMap instances.
 * Uses a Symbol brand set in the NamedMap constructor — reliable and
 * immune to false positives from objects that happen to have similar
 * properties (e.g., a block with a `get` field).
 */
export function isNamedMap(value: unknown): value is NamedMap<unknown> {
  if (value == null || typeof value !== 'object') return false;
  return (
    Object.prototype.hasOwnProperty.call(value, NAMED_MAP_BRAND) &&
    Reflect.get(value, NAMED_MAP_BRAND) === true
  );
}

/** Discriminator: all FieldTypes are singular (parse with node, dialect). */
export function isSingularFieldType(_ft: FieldType): _ft is SingularFieldType {
  return true;
}

/**
 * Shape of a NamedBlock entry factory as seen by CollectionBlock at runtime.
 * NamedBlock is NOT a FieldType — it's the entry type inside a CollectionBlock.
 */
export interface NamedBlockEntryType {
  readonly isNamed: true;
  readonly allowAnonymous: boolean;
  readonly kind: string;
  readonly schema: Record<string, FieldType>;
  parse: (
    node: SyntaxNode,
    name: string,
    dialect: Dialect,
    adoptedSiblings?: SyntaxNode[]
  ) => ParseResult<unknown>;
  resolveSchemaForName(name: string): Record<string, FieldType>;
  /** The discriminant field name, if using field-based discrimination. */
  readonly discriminantField?: string;
  /** Resolve variant schema by discriminant field value. */
  resolveSchemaForDiscriminant?(value: string): Record<string, FieldType>;
}

/** Structural interface for CollectionBlock field types detected at runtime. */
export interface CollectionFieldType extends SingularFieldType {
  readonly __isCollection: true;
  readonly entryBlock: NamedBlockEntryType;
  readonly kind: string;
}

/** Discriminator: field type is a CollectionBlock (holds typed variadic named children). */
export function isCollectionFieldType(
  ft: FieldType
): ft is CollectionFieldType {
  return ft.__isCollection === true;
}

/**
 * Structural interface for NamedCollectionBlock field types detected at runtime.
 * A NamedCollectionBlock is a CollectionBlock whose entries are declared as
 * sibling keys (e.g., `subagent Foo:`, `subagent Bar:`) rather than nested
 * children under a single container key.
 */
export interface NamedCollectionFieldType extends CollectionFieldType {
  readonly __isNamedCollection: true;
}

/** Discriminator: field type is a NamedCollectionBlock (sibling-keyed named entries). */
export function isNamedCollectionFieldType(
  ft: FieldType
): ft is NamedCollectionFieldType {
  return '__isNamedCollection' in ft && ft.__isNamedCollection === true;
}

/**
 * Build a reverse lookup from block `__kind` (e.g. "ConfigBlock") to schema
 * key (e.g. "config"). Computed once at schema definition time.
 */
export function buildKindToSchemaKey(
  schema: Record<string, FieldType>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const [schemaKey, fieldType] of Object.entries(schema)) {
    if ('kind' in fieldType && typeof fieldType.kind === 'string') {
      map.set(fieldType.kind, schemaKey);
    }
    // For CollectionBlock (named or nested), also register the entry block's kind.
    // Both variants have an entryBlock whose kind must be discoverable via reverse
    // lookup.  Later schema keys overwrite earlier ones, so canonical keys
    // (e.g. "topic") win over aliases (e.g. "start_agent").
    if (isCollectionFieldType(fieldType)) {
      const entryKind = (fieldType.entryBlock as { kind?: string }).kind;
      if (entryKind) {
        map.set(entryKind, schemaKey);
      }
    }
  }
  return map;
}

/**
 * Schema metadata for core modules (scope, completions, lint).
 * Keeps core/ decoupled from any specific schema definition.
 */
export interface SchemaInfo {
  readonly schema: Record<string, FieldType>;
  readonly aliases: Record<string, string>;
  /** Global scopes: namespaces with known members, always resolvable (e.g., @utils, @system_variables). */
  readonly globalScopes?: Readonly<Record<string, ReadonlySet<string>>>;
  /**
   * Extra schema keys to include when resolving a namespace.
   * E.g., `{ topic: ['start_agent'] }` makes `@topic.X` also search `start_agent` entries.
   * Unlike aliases, this doesn't affect completions — it only affects reference resolution.
   */
  readonly extraNamespaceKeys?: Readonly<Record<string, readonly string[]>>;
}
