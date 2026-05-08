/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Schema,
  FieldType,
  SingularFieldType,
  SyntaxNode,
  EmitContext,
  ParseResult,
  Parsed,
  FieldMetadata,
  BlockCapability,
  InferFields,
  KeywordInfo,
  MaybeDiscriminant,
} from './types.js';
import type { Dialect } from './dialect.js';
import type { Diagnostic } from './diagnostics.js';
import type { Statement } from './statements.js';
import type { BuilderMethods } from './field-builder.js';
import type { BlockChild } from './children.js';
import type { BlockCore, NamedMap } from './named-map.js';
import type { TypedDeclarationBase } from './typed-declarations.js';

// ---------------------------------------------------------------------------
// Instance types
// ---------------------------------------------------------------------------

export type BlockInstance<T extends Schema> = BlockCore & InferFields<T>;

/**
 * Instance of a NamedBlock, including colinear value and body statements.
 * At runtime, ALL NamedBlockNode instances expose `value` and `statements`
 * as getter/setters backed by __children.
 */
export type NamedBlockInstance<T extends Schema> = BlockInstance<T> & {
  /** Colinear expression value (e.g., `@actions.X`). */
  value?: unknown;
  /** Body procedure statements (with/set/to clauses). */
  statements?: Statement[];
};

/** Instance type of a CollectionBlock — a NamedMap with typed entries over __children. */
export type CollectionBlockInstance<T extends Schema> = NamedMap<
  Parsed<InferFields<T> & BlockCore>
>;

// ---------------------------------------------------------------------------
// Class types (for parse result consumers)
// ---------------------------------------------------------------------------

export interface BlockClass<T extends Schema> {
  readonly kind: string;
  readonly schema: T;
  readonly isNamed: false;
  new (fields: InferFields<T>): BlockInstance<T>;
  parse(
    node: SyntaxNode,
    dialect: Dialect,
    extraElements?: SyntaxNode[]
  ): ParseResult<BlockInstance<T>>;
}

export interface NamedBlockClass<T extends Schema> {
  readonly kind: string;
  readonly schema: T;
  readonly isNamed: true;
  readonly allowAnonymous: boolean;
  readonly scopeAlias?: string;
  readonly colinearType?: SingularFieldType;
  readonly hasColinear: boolean;
  readonly hasBody: boolean;
  new (name: string, fields: InferFields<T>): NamedBlockInstance<T>;
  parse(
    node: SyntaxNode,
    name: string,
    dialect: Dialect
  ): ParseResult<NamedBlockInstance<T>>;
  /** Resolve the effective schema for a given instance name.
   *  For variant NamedBlocks, returns the merged variant schema.
   *  For non-variant blocks, always returns the base schema. */
  resolveSchemaForName(name: string): Record<string, FieldType>;
}

export interface TypedMapClass<T extends TypedDeclarationBase> {
  readonly kind: string;
  readonly isNamed: false;
  parse(node: SyntaxNode, dialect: Dialect): ParseResult<NamedMap<T>>;
}

// ---------------------------------------------------------------------------
// Factory options
// ---------------------------------------------------------------------------

export interface BlockFactoryOptions {
  symbol?: import('./types.js').SymbolMeta;
  /** Description set on __metadata at creation time, avoiding the TS7056-prone `.describe()` chain on exports. */
  description?: string;
  /** Semantic capabilities this block declares (e.g., 'invocationTarget', 'transitionTarget'). */
  capabilities?: readonly BlockCapability[];
  /** Wildcard prefixes that accept any field name matching a given prefix pattern. */
  wildcardPrefixes?: readonly import('./types.js').WildcardPrefix[];
  /** Field name whose string value selects the variant schema. Requires `variants`. */
  discriminant?: string;
  /** Variant schemas keyed by discriminant value. Requires `discriminant`. */
  variants?: Record<string, Schema>;
}

export interface NamedBlockOpts {
  colinear?: SingularFieldType;
  body?: SingularFieldType;
  symbol?: import('./types.js').SymbolMeta;
  scopeAlias?: string;
  /** Variant schemas keyed by instance name or discriminant value. Prefer the chained `.variant()` API. */
  variants?: Record<string, Schema>;
  /** Field name whose string value selects the variant schema. When set, variants are resolved by field value instead of instance name. */
  discriminant?: string;
  /** Description set on __metadata at creation time, avoiding the TS7056-prone `.describe()` chain on exports. */
  description?: string;
  /** When true, a nameless key (e.g. `start_agent:`) is parsed as an anonymous instance instead of a named-entry container. */
  allowAnonymous?: boolean;
  /** Semantic capabilities this block declares (e.g., 'invocationTarget', 'transitionTarget'). */
  capabilities?: readonly BlockCapability[];
}

export interface CollectionBlockOpts {
  /** Description set on __metadata at creation time. */
  description?: string;
}

export interface TypedMapOptions {
  /**
   * Valid modifiers for entries (e.g., `mutable`, `linked`).
   *
   * Each entry provides both the keyword name and a description shown on hover.
   *
   * @example Using the built-in modifiers:
   * ```ts
   * modifiers: VARIABLE_MODIFIERS
   * ```
   *
   * @example Extending with a custom modifier:
   * ```ts
   * modifiers: [
   *   ...VARIABLE_MODIFIERS,
   *   { keyword: 'readonly', description: 'Cannot be changed after initialization.' },
   * ]
   * ```
   *
   * @example Defining from scratch:
   * ```ts
   * modifiers: [
   *   { keyword: 'mutable', description: 'A variable that can change during the conversation.' },
   *   { keyword: 'linked', description: 'A variable sourced from an external system.' },
   * ]
   * ```
   */
  modifiers?: readonly import('./types.js').KeywordInfo[];
  /**
   * Valid primitive type names for entries.
   *
   * Each entry provides both the type name and a description shown on hover.
   * Undefined means any type is accepted.
   *
   * @example Using the built-in types:
   * ```ts
   * primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES
   * ```
   *
   * @example Extending with a dialect-specific type:
   * ```ts
   * primitiveTypes: [
   *   ...AGENTSCRIPT_PRIMITIVE_TYPES,
   *   { keyword: 'picklist', description: 'A predefined set of values from an external system.' },
   * ]
   * ```
   *
   * @example Defining a minimal set:
   * ```ts
   * primitiveTypes: [
   *   { keyword: 'string', description: 'A text value.' },
   *   { keyword: 'number', description: 'A numeric value.' },
   * ]
   * ```
   */
  primitiveTypes?: readonly import('./types.js').KeywordInfo[];
  symbol?: import('./types.js').SymbolMeta;
  /** Description set on __metadata at creation time, avoiding the TS7056-prone `.describe()` chain on exports. */
  description?: string;
  /** Regex pattern that map keys must match. */
  keyPattern?: string;
}

// ---------------------------------------------------------------------------
// Shared builder methods
// ---------------------------------------------------------------------------

/**
 * Metadata methods available on all factory types.
 *
 * Generic `Self` parameter ensures `.describe()` etc. return the original
 * factory type instead of `ConstrainedBuilder`, which avoids TS7056
 * serialization overflow on exported declarations.
 */
export interface FactoryBuilderMethods<Self> {
  describe(description: string): Self;
  example(example: string): Self;
  minVersion(version: string): Self;
  deprecated(
    message?: string,
    opts?: { since?: string; removeIn?: string; replacement?: string }
  ): Self;
  experimental(): Self;
  required(): Self;
  crossBlockReferenceable(): Self;
  singular(): Self;
  accepts(kinds: string[]): Self;
  omitArrow(): Self;
  withProperties(newPropertiesBlock: FieldType): Self;
  extendProperties(additionalFields: Schema): Self;
  /**
   * Create an independent copy of this factory with the same schema, options,
   * and metadata. Use this when the same block definition is assigned to
   * multiple schema keys that need different metadata (e.g., different
   * `.example()` values for `start_agent` and `topic`).
   */
  clone(): Self;
}

// ---------------------------------------------------------------------------
// Factory interfaces
// ---------------------------------------------------------------------------

/**
 * Full return type from Block().
 *
 * Using an `interface` (not a type alias) ensures TypeScript always references
 * this by name in `.d.ts` output, preventing TS7056 serialization overflow.
 *
 * The `__fieldOutput` phantom carries `InferFields<T> & BlockCore` — the
 * pre-computed type that appears on a parent block when this factory is used
 * as a schema field. This enables InferFields to read the phantom directly
 * instead of recursing (Zod-style eager resolution).
 */
export interface BlockFactory<T extends Schema>
  extends FactoryBuilderMethods<BlockFactory<T>>, MaybeDiscriminant {
  // FieldType members (inlined to avoid union-type extension)
  readonly __fieldKind: 'Block';
  /** Phantom: pre-computed field output type for InferFields. */
  readonly __fieldOutput?: InferFields<T> & BlockCore;
  __accepts?: string[];
  __metadata?: FieldMetadata;
  emit(value: BlockInstance<T>, ctx: EmitContext): string;
  emitField?(key: string, value: BlockInstance<T>, ctx: EmitContext): string;
  scopeAlias?: string;
  /** Semantic capabilities declared by this block type. */
  readonly capabilities?: readonly BlockCapability[];
  // Factory-specific
  readonly kind: string;
  readonly schema: T;
  readonly isNamed: false;
  new (fields: InferFields<T>): BlockInstance<T>;
  parse(
    node: SyntaxNode,
    dialect: Dialect,
    extraElements?: SyntaxNode[]
  ): ParseResult<BlockInstance<T>>;
  /** @internal Used by Sequence to construct from pre-parsed fields. */
  fromParsedFields(
    fields: InferFields<T>,
    cstNode: SyntaxNode,
    diagnostics: Diagnostic[],
    children?: BlockChild[]
  ): ParseResult<BlockInstance<T>>;
  // Structural methods — generics preserve schema types through chains
  extend<U extends Schema>(
    additionalFields: U,
    overrideOptions?: Partial<BlockFactoryOptions>
  ): BlockFactory<Omit<T, keyof U> & U>;
  omit<K extends string>(...keys: K[]): BlockFactory<Omit<T, K>>;
  pick<K extends string & keyof T>(keys: K[]): BlockFactory<Pick<T, K>>;
  /** Set the discriminant field for field-based variant resolution. */
  discriminant(fieldName: string): BlockFactory<T>;
  /** Add a variant schema keyed by discriminant value. */
  variant(name: string, variantSchema: Schema): BlockFactory<T>;
}

/**
 * Full return type from NamedBlock().
 *
 * NamedBlock is NOT a FieldType — it cannot be used directly as a schema field.
 * Instead, wrap it with CollectionBlock() to use in schemas.
 * NamedBlock defines the entry type (individual named items inside a collection).
 */
export interface NamedBlockFactory<
  T extends Schema,
  V extends Record<string, Schema> = Record<never, never>,
>
  extends FactoryBuilderMethods<NamedBlockFactory<T, V>>, MaybeDiscriminant {
  /** Phantom: variant schemas keyed by variant name. Empty `{}` when no variants. */
  readonly __variants: V;
  __metadata?: FieldMetadata;
  emit(value: BlockInstance<T>, ctx: EmitContext): string;
  emitField?(key: string, value: unknown, ctx: EmitContext): string;
  scopeAlias?: string;
  /** Semantic capabilities declared by this block type. */
  readonly capabilities?: readonly BlockCapability[];
  parse(
    node: SyntaxNode,
    name: string,
    dialect: Dialect
  ): ParseResult<NamedBlockInstance<T>>;
  // Factory-specific
  readonly kind: string;
  readonly schema: T;
  readonly isNamed: true;
  readonly allowAnonymous: boolean;
  readonly colinearType?: SingularFieldType;
  readonly hasColinear: boolean;
  readonly hasBody: boolean;
  new (name: string, fields: InferFields<T>): NamedBlockInstance<T>;
  resolveSchemaForName(name: string): Record<string, FieldType>;
  // Structural methods — generics preserve schema types through chains
  extend<U extends Schema>(
    additionalFields: U,
    overrideOpts?: Partial<NamedBlockOpts>
  ): NamedBlockFactory<Omit<T, keyof U> & U>;
  omit<K extends string>(...keys: K[]): NamedBlockFactory<Omit<T, K>>;
  pick<K extends string & keyof T>(keys: K[]): NamedBlockFactory<Pick<T, K>>;
  variant<N extends string, S extends Schema>(
    name: N,
    variantSchema: S
  ): NamedBlockFactory<T, V & Record<N, S>>;
  /** Set the discriminant field for field-based variant resolution. */
  discriminant(fieldName: string): NamedBlockFactory<T, V>;
}

/**
 * Full return type from CollectionBlock().
 *
 * A CollectionBlock is a SingularFieldType — the collection IS the field value.
 * Its `__fieldOutput` phantom carries `NamedMap<Parsed<...>>` so that
 * InferFields produces the same Map-like type as NamedBlock did.
 */
export interface CollectionBlockFactory<
  T extends Schema,
  V extends Record<string, Schema> = Record<never, never>,
> extends FactoryBuilderMethods<CollectionBlockFactory<T, V>> {
  readonly __fieldKind: 'Collection';
  /** Phantom: pre-computed field output type for InferFields. */
  readonly __fieldOutput?: NamedMap<Parsed<InferFields<T> & BlockCore>>;
  /** Phantom: variant schemas propagated from entryBlock for FieldOutput. */
  readonly __variants: V;
  __accepts?: string[];
  __metadata?: FieldMetadata;
  emit(value: CollectionBlockInstance<T>, ctx: EmitContext): string;
  emitField?(
    key: string,
    value: CollectionBlockInstance<T>,
    ctx: EmitContext
  ): string;
  schema?: T;
  scopeAlias?: string;
  /**
   * Whether the collection block itself is a NamedBlock (requires a name on
   * its own declaration line).  This is always `false` — the *container* is
   * not named.  Individual *entries* inside the collection may be named
   * (NamedBlockFactory), but that is tracked on `entryBlock`, not here.
   *
   * Note: `NamedCollectionBlockFactory` inherits this `false` value, which
   * can look contradictory.  "Named" in that type name refers to the
   * declaration pattern (sibling keys like `subagent Foo:`) — not to this
   * flag, which answers "is the collection node itself a NamedBlock?".
   */
  isNamed: false;
  readonly __isCollection: true;
  readonly kind: string;
  readonly entryBlock: NamedBlockFactory<T, V>;
  new (): CollectionBlockInstance<T>;
  parse(
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<CollectionBlockInstance<T>>;
}

/**
 * Full return type from NamedCollectionBlock().
 * Extends CollectionBlockFactory with a `__isNamedCollection` discriminator.
 *
 * Uses Omit to strip FactoryBuilderMethods from CollectionBlockFactory so we
 * can re-bind them to return NamedCollectionBlockFactory (preserving chaining).
 */
export interface NamedCollectionBlockFactory<
  T extends Schema,
  V extends Record<string, Schema> = Record<never, never>,
>
  extends
    Omit<CollectionBlockFactory<T, V>, keyof FactoryBuilderMethods<unknown>>,
    FactoryBuilderMethods<NamedCollectionBlockFactory<T, V>> {
  readonly __isNamedCollection: true;
}

/**
 * Full return type from TypedMap().
 *
 * The `__fieldOutput` phantom carries `NamedMap<T>` — the pre-computed
 * type for when this TypedMap is used as a field in a parent schema.
 */
export interface TypedMapFactory<
  T extends TypedDeclarationBase = TypedDeclarationBase,
> extends FactoryBuilderMethods<TypedMapFactory<T>> {
  // FieldType members (inlined to avoid union-type extension)
  readonly __fieldKind: 'TypedMap';
  /** Phantom: pre-computed field output type for InferFields. */
  readonly __fieldOutput?: NamedMap<T>;
  __accepts?: string[];
  __metadata?: FieldMetadata;
  emit(value: NamedMap<T>, ctx: EmitContext): string;
  emitField?(key: string, value: NamedMap<T>, ctx: EmitContext): string;
  scopeAlias?: string;
  /** Semantic capabilities declared by this block type. */
  readonly capabilities?: readonly BlockCapability[];
  isNamed: false;
  // TypedMapClass members
  readonly kind: string;
  new (entries?: Iterable<[string, T]>): NamedMap<T>;
  parse(node: SyntaxNode, dialect: Dialect): ParseResult<NamedMap<T>>;
  // TypedMap-specific
  readonly __isTypedMap: true;
  readonly propertiesSchema?: Schema;
  readonly __modifiers: readonly KeywordInfo[];
  readonly __primitiveTypes: readonly KeywordInfo[];
  withProperties(newPropertiesBlock: FieldType): TypedMapFactory<T>;
  extendProperties<U extends Schema>(additionalFields: U): TypedMapFactory<T>;
  withKeyPattern(pattern: string): TypedMapFactory<T>;
  readonly propertiesBlock: FieldType & BuilderMethods;
}

// ---------------------------------------------------------------------------
// Compile-time guards: factory interfaces must remain structurally compatible
// with FieldType. If FieldType gains new required members, these will produce
// type errors until the factory interfaces are updated — preventing silent drift.
// ---------------------------------------------------------------------------
type _AssertExtends<Sub, Super> = Sub extends Super ? true : never;
type _BlockCheck = _AssertExtends<BlockFactory<Schema>, SingularFieldType>;
type _TypedMapCheck = _AssertExtends<TypedMapFactory, SingularFieldType>;
type _CollectionCheck = _AssertExtends<
  CollectionBlockFactory<Schema>,
  SingularFieldType
>;
// Export to suppress noUnusedLocals; not re-exported from package index.
export type { _BlockCheck, _TypedMapCheck, _CollectionCheck };
