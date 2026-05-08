/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  FieldType,
  SyntaxNode,
  EmitContext,
  Schema,
  ConstraintMetadata,
  FieldMetadata,
  ParseResult,
  BlockCapability,
  CstMeta,
  Range,
} from './types.js';
import { emitIndent } from './types.js';
import { isEmittable } from './children.js';
import type { Dialect } from './dialect.js';
import { createDiagnostic, DiagnosticSeverity } from './diagnostics.js';
import type { Diagnostic } from './diagnostics.js';
import type { Statement } from './statements.js';
import { IfStatement, RunStatement } from './statements.js';

export type { ConstraintMetadata, FieldMetadata } from './types.js';

/** Which constraint families a FieldType supports. */
export type ConstraintCategory = 'number' | 'string' | 'generic' | 'sequence';

/**
 * Infer the field-output type `F` from a FieldType.
 * This is the counterpart to Zod's `z.infer<T>` — recovers the concrete
 * output type from an erased `FieldType<any, any>`.
 *
 * Extracts `F` (field-level output), not `V` (parse-level value).
 * For primitives F = V; for NamedBlock F = NamedMap<Parsed<...>>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InferFieldValue<T> = T extends FieldType<any, infer F> ? F : any;

/**
 * FieldBuilder enhanced with the correct builder + constraint methods.
 * Every chainable method returns another ConstrainedBuilder with the same
 * constraint categories, parsed value type V, AND field output type F,
 * preserving type-safety through the entire chain.
 */
export type ConstrainedBuilder<
  S extends readonly ConstraintCategory[] = readonly [],
  V = unknown,
  F = V,
> = FieldBuilder<V, F> & BuilderMethods<S, V, F> & ResolveConstraints<S, V, F>;

/** Maps constraint categories to their method interfaces via conditional types. */
export type ResolveConstraints<
  S extends readonly ConstraintCategory[],
  V = unknown,
  F = V,
> = ('number' extends S[number] ? NumberConstraintMethods<S, V, F> : unknown) &
  ('string' extends S[number] ? StringConstraintMethods<S, V, F> : unknown) &
  ('generic' extends S[number] ? GenericConstraintMethods<S, V, F> : unknown) &
  ('sequence' extends S[number] ? SequenceConstraintMethods<S, V, F> : unknown);

export interface BuilderMethods<
  S extends readonly ConstraintCategory[] = readonly [],
  V = unknown,
  F = V,
> {
  describe(description: string): ConstrainedBuilder<S, V, F>;
  example(example: string): ConstrainedBuilder<S, V, F>;
  minVersion(version: string): ConstrainedBuilder<S, V, F>;
  deprecated(
    message?: string,
    opts?: { since?: string; removeIn?: string; replacement?: string }
  ): ConstrainedBuilder<S, V, F>;
  experimental(): ConstrainedBuilder<S, V, F>;
  required(): ConstrainedBuilder<S, V, F>;
  accepts(kinds: string[]): ConstrainedBuilder<S, V, F>;
  pick(keys: string[]): ConstrainedBuilder<S, V, F>;
  omitArrow(): ConstrainedBuilder<S, V, F>;
  disallowTemplates(suggestion?: string): ConstrainedBuilder<S, V, F>;
  allowedNamespaces(namespaces: string[]): ConstrainedBuilder<S, V, F>;
  resolvedType(type: BlockCapability): ConstrainedBuilder<S, V, F>;
  crossBlockReferenceable(): ConstrainedBuilder<S, V, F>;
  hidden(): ConstrainedBuilder<S, V, F>;
  // Structural methods — delegate to base type's extend/omit/etc. when present.
  // Throws at runtime for types that don't support them (e.g., primitives).
  extend(
    additionalFields: Schema,
    overrideOptions?: Record<string, unknown>
  ): ConstrainedBuilder<S, V, F>;
  omit(...keys: string[]): ConstrainedBuilder<S, V, F>;
  withProperties(newPropertiesBlock: FieldType): ConstrainedBuilder<S, V, F>;
  extendProperties(additionalFields: Schema): ConstrainedBuilder<S, V, F>;
  clone(): ConstrainedBuilder<S, V, F>;
}

export interface NumberConstraintMethods<
  S extends readonly ConstraintCategory[] = readonly [],
  V = unknown,
  F = V,
> {
  min(value: number): ConstrainedBuilder<S, V, F>;
  max(value: number): ConstrainedBuilder<S, V, F>;
  exclusiveMin(value: number): ConstrainedBuilder<S, V, F>;
  exclusiveMax(value: number): ConstrainedBuilder<S, V, F>;
  multipleOf(value: number): ConstrainedBuilder<S, V, F>;
}

export interface StringConstraintMethods<
  S extends readonly ConstraintCategory[] = readonly [],
  V = unknown,
  F = V,
> {
  minLength(value: number): ConstrainedBuilder<S, V, F>;
  maxLength(value: number): ConstrainedBuilder<S, V, F>;
  pattern(regex: string | RegExp): ConstrainedBuilder<S, V, F>;
}

export interface GenericConstraintMethods<
  S extends readonly ConstraintCategory[] = readonly [],
  V = unknown,
  F = V,
> {
  enum(
    values: ReadonlyArray<string | number | boolean>
  ): ConstrainedBuilder<S, V, F>;
  const(value: string | number | boolean): ConstrainedBuilder<S, V, F>;
}

export interface SequenceConstraintMethods<
  S extends readonly ConstraintCategory[] = readonly [],
  V = unknown,
  F = V,
> {
  minItems(value: number): ConstrainedBuilder<S, V, F>;
  maxItems(value: number): ConstrainedBuilder<S, V, F>;
}

// ============================================================================
// Input validation helpers
// ============================================================================

function assertFiniteNumber(value: number, method: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${method}() requires a finite number, got ${value}`);
  }
}

function assertNonNegativeInteger(value: number, method: string): void {
  assertFiniteNumber(value, method);
  if (value < 0 || !Number.isInteger(value)) {
    throw new Error(
      `${method}() requires a non-negative integer, got ${value}`
    );
  }
}

function assertPositiveNumber(value: number, method: string): void {
  assertFiniteNumber(value, method);
  if (value <= 0) {
    throw new Error(`${method}() requires a positive number, got ${value}`);
  }
}

// ============================================================================
// FieldBuilder class
// ============================================================================

/**
 * Pure data holder and FieldType proxy. All chainable builder methods
 * (describe, required, min, etc.) are added dynamically by addBuilderMethods().
 * FieldBuilder itself has NO builder methods — only delegation to the base type.
 *
 * Generic `V` carries the parsed value type, `F` carries the field-output type.
 * Both are erased at runtime — purely compile-time markers for type inference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class FieldBuilder<V = any, F = V> {
  readonly __fieldKind: FieldType['__fieldKind'];
  /** Phantom — carries the field-output type through builder chains. */
  declare readonly __fieldOutput?: F;
  readonly __metadata: FieldMetadata = {};
  readonly __constraintCategories?: readonly ConstraintCategory[];
  readonly emitField?: FieldType<V>['emitField'];
  // `declare` tells TS about the property without emitting code; the
  // constructor's for-loop copies the real value from baseType at runtime.
  declare readonly isNamed?: false;

  constructor(
    private baseType: FieldType,
    initialMetadata?: FieldMetadata,
    constraintCategories?: readonly ConstraintCategory[]
  ) {
    this.__fieldKind = baseType.__fieldKind;
    this.emitField = baseType.emitField;
    if (initialMetadata) {
      Object.assign(this.__metadata, initialMetadata);
    }
    if (constraintCategories) {
      this.__constraintCategories = constraintCategories;
    }
    // Forward all base type properties so FieldBuilder is a transparent wrapper.
    // Ensures properties like __isTypedMap, propertiesSchema, kind, etc.
    // are accessible for schema resolution and hover info.
    for (const [key, val] of Object.entries(baseType)) {
      if (!(key in this)) {
        Object.defineProperty(this, key, {
          value: val,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
    }
  }

  // FieldType delegation — return types carry V for InferFieldType inference
  parse(
    node: SyntaxNode,
    dialect: Dialect,
    extraElements?: SyntaxNode[]
  ): ParseResult<V> {
    // SAFETY: base type's parse returns ParseResult<any> (V defaults to any), assignable to ParseResult<V>
    return this.baseType.parse(node, dialect, extraElements) as ParseResult<V>;
  }
  emit(value: V, ctx: EmitContext) {
    return this.baseType.emit(value, ctx);
  }
  get schema(): Schema | undefined {
    return this.baseType.schema;
  }
}

// ============================================================================
// addBuilderMethods — the only public way to add builder/constraint methods
// ============================================================================

/**
 * Add builder methods (.describe(), .deprecated(), etc.) and optionally
 * constraint methods (.min(), .maxLength(), etc.) to a FieldType.
 *
 * Constraint methods are gated by the `constraints` parameter:
 * - `['number', 'generic']` adds .min(), .max(), .enum(), .const(), etc.
 * - `['string', 'generic']` adds .minLength(), .pattern(), .enum(), etc.
 * - `['sequence']` adds .minItems(), .maxItems()
 * - `[]` or omitted adds no constraint methods
 *
 * Every method returns an immutable enhanced builder.
 * Uses a single `populateMethods` function as the source of truth for all
 * method definitions — both static entry points and chained instance methods.
 */
/**
 * Options for {@link addBuilderMethods}. When `factory: true`, the pure
 * metadata builders (`describe`, `example`, `required`, …) and the
 * structural methods (`extend`, `omit`, `pick`, …) are skipped because the
 * caller will install factory-specific versions via
 * {@link import('./factory-utils.js').overrideFactoryBuilderMethods}. The
 * constraint methods (`min`, `enum`, etc.) and factory-neutral builders
 * (`hidden`, `omitArrow`, `disallowTemplates`, `accepts`,
 * `allowedNamespaces`, `resolvedType`) are always installed.
 */
export interface AddBuilderOptions {
  factory?: boolean;
}

export function addBuilderMethods<
  T extends FieldType,
  const S extends readonly ConstraintCategory[] = readonly [],
>(
  fieldType: T,
  constraints?: S,
  opts?: AddBuilderOptions
): T &
  BuilderMethods<S, InferFieldValue<T>, InferFieldValue<T>> &
  ResolveConstraints<S, InferFieldValue<T>, InferFieldValue<T>> {
  type V = InferFieldValue<T>;
  type F = V;
  const cats: readonly ConstraintCategory[] = constraints ?? [];
  const skipFactoryOverridden = opts?.factory === true;

  /**
   * Assign all builder + constraint methods to `target`. Called once for the
   * static entry points on `fieldType`, and once per `enhance()` call for
   * chained instance methods. This eliminates duplication — every method
   * name-to-metadata mapping is defined in exactly one place.
   */
  function populateMethods(
    target: Record<string, unknown>,
    meta: FieldMetadata,
    base: FieldType
  ): void {
    const withMeta = (
      updates: Partial<FieldMetadata>
    ): ConstrainedBuilder<S, V, F> => enhance({ ...meta, ...updates }, base);
    const withConstraint = (
      updates: Partial<ConstraintMetadata>
    ): ConstrainedBuilder<S, V, F> =>
      enhance(
        { ...meta, constraints: { ...meta.constraints, ...updates } },
        base
      );

    // --- Base builder methods ---
    // Pure-metadata setters (describe/example/required/minVersion/deprecated/
    // experimental) are skipped when the caller is a factory that will
    // reinstall them via overrideFactoryBuilderMethods. `hidden` has no
    // factory override and is always installed.
    if (!skipFactoryOverridden) {
      target.describe = (desc: string) => withMeta({ description: desc });
      target.example = (ex: string) => withMeta({ example: ex });
      target.minVersion = (v: string) => withMeta({ minVersion: v });
      target.deprecated = (
        msg?: string,
        opts?: { since?: string; removeIn?: string; replacement?: string }
      ) => withMeta({ deprecated: { message: msg, ...opts } });
      target.experimental = () => withMeta({ experimental: true });
      target.required = () => withMeta({ required: true });
    }
    target.hidden = () => withMeta({ hidden: true });
    target.omitArrow = () => {
      // Object.create preserves non-enumerable static methods (parse, emit)
      // via prototype chain. Spread ({...base}) would lose them.
      const noArrowBase: FieldType = Object.create(base);
      noArrowBase.emitField = (
        key: string,
        value: unknown,
        ctx: EmitContext
      ) => {
        const indent = emitIndent(ctx);
        const childCtx = { ...ctx, indent: ctx.indent + 1 };
        if (isEmittable(value)) {
          return `${indent}${key}:\n${value.__emit(childCtx)}`;
        }
        return `${indent}${key}:\n`;
      };
      return enhance({ ...meta, omitArrow: true }, noArrowBase);
    };
    target.disallowTemplates = (suggestion?: string) => {
      const noTemplateBase: FieldType = Object.create(base);
      const originalParse = base.parse.bind(base);

      const errorMessage =
        'Template statements (|) are not allowed in this procedure block.' +
        (suggestion ? ` ${suggestion}` : '');

      function collectTemplateDiagnostics(
        statements: Statement[],
        diagnostics: Diagnostic[],
        fallbackRange: Range | SyntaxNode
      ): void {
        for (const stmt of statements) {
          if (stmt.__kind === 'Template') {
            const range = stmt.__cst?.range ?? fallbackRange;
            diagnostics.push(
              createDiagnostic(
                range,
                errorMessage,
                DiagnosticSeverity.Error,
                'template-in-deterministic-procedure'
              )
            );
          }
          if (stmt instanceof IfStatement) {
            collectTemplateDiagnostics(stmt.body, diagnostics, fallbackRange);
            if (stmt.orelse.length > 0) {
              collectTemplateDiagnostics(
                stmt.orelse,
                diagnostics,
                fallbackRange
              );
            }
          }
          if (stmt instanceof RunStatement) {
            collectTemplateDiagnostics(stmt.body, diagnostics, fallbackRange);
          }
        }
      }

      noTemplateBase.parse = function (
        node: SyntaxNode,
        dialect: Dialect,
        extraElements?: SyntaxNode[]
      ): ParseResult<V> {
        const result = originalParse(node, dialect, extraElements);
        const diagnostics = [...result.diagnostics];

        if (result.value && 'statements' in result.value) {
          const procedureNode = result.value as {
            statements: Statement[];
            __cst?: CstMeta;
          };

          const fallbackRange = procedureNode.__cst?.range ?? node;
          collectTemplateDiagnostics(
            procedureNode.statements,
            diagnostics,
            fallbackRange
          );

          return { value: result.value, diagnostics };
        }

        return result;
      };

      return enhance({ ...meta, disallowTemplates: true }, noTemplateBase);
    };
    target.accepts = (kinds: string[]) => {
      // Object.create: see comment on omitArrow above.
      const clone = Object.create(base);
      clone.__accepts = [...kinds];
      return enhance(meta, clone);
    };
    target.allowedNamespaces = (namespaces: string[]) =>
      withConstraint({ allowedNamespaces: namespaces });
    target.resolvedType = (type: BlockCapability) =>
      withConstraint({ resolvedType: type });
    if (!skipFactoryOverridden) {
      target.crossBlockReferenceable = () =>
        withMeta({ crossBlockReferenceable: true });
      target.pick = (keys: string[]) => {
        if ('pick' in base && typeof base.pick === 'function') {
          return enhance(meta, base.pick(keys));
        }
        throw new Error('Base type does not support pick()');
      };

      // --- Structural method propagation ---
      // Always add extend/omit/withProperties/extendProperties. When the base
      // type supports them, the calls are delegated and wrapped with enhance()
      // to preserve metadata + constraints. Otherwise they throw.
      // Use direct property access (not Object.entries) so that non-enumerable
      // static methods on class-based factories (e.g. TypedMapNode) are found.
      const baseAny = base as unknown as Record<string, unknown>;
      for (const method of [
        'extend',
        'omit',
        'withProperties',
        'extendProperties',
        'withKeyPattern',
      ] as const) {
        const orig = baseAny[method];
        if (typeof orig === 'function') {
          target[method] = (...args: unknown[]) => {
            // SAFETY: structural methods (extend, omit, etc.) return FieldType at runtime
            const applied = orig.apply(base, args) as FieldType;
            return enhance(meta, applied);
          };
        } else {
          target[method] = () => {
            throw new Error(`Base type does not support ${method}()`);
          };
        }
      }

      // clone — for FieldBuilder, just re-enhance with a copy of metadata
      target.clone = () => enhance({ ...meta }, base);
    }

    // --- Constraint methods (conditional on categories, with validation) ---
    if (cats.includes('number')) {
      target.min = (v: number) => {
        assertFiniteNumber(v, 'min');
        return withConstraint({ minimum: v });
      };
      target.max = (v: number) => {
        assertFiniteNumber(v, 'max');
        return withConstraint({ maximum: v });
      };
      target.exclusiveMin = (v: number) => {
        assertFiniteNumber(v, 'exclusiveMin');
        return withConstraint({ exclusiveMinimum: v });
      };
      target.exclusiveMax = (v: number) => {
        assertFiniteNumber(v, 'exclusiveMax');
        return withConstraint({ exclusiveMaximum: v });
      };
      target.multipleOf = (v: number) => {
        assertPositiveNumber(v, 'multipleOf');
        return withConstraint({ multipleOf: v });
      };
    }
    if (cats.includes('string')) {
      target.minLength = (v: number) => {
        assertNonNegativeInteger(v, 'minLength');
        return withConstraint({ minLength: v });
      };
      target.maxLength = (v: number) => {
        assertNonNegativeInteger(v, 'maxLength');
        return withConstraint({ maxLength: v });
      };
      target.pattern = (regex: string | RegExp) =>
        withConstraint({
          pattern: regex instanceof RegExp ? regex.source : regex,
        });
    }
    if (cats.includes('generic')) {
      target.enum = (values: ReadonlyArray<string | number | boolean>) =>
        withConstraint({ enum: values });
      target.const = (value: string | number | boolean) =>
        withConstraint({ const: value });
    }
    if (cats.includes('sequence')) {
      target.minItems = (v: number) => {
        assertNonNegativeInteger(v, 'minItems');
        return withConstraint({ minItems: v });
      };
      target.maxItems = (v: number) => {
        assertNonNegativeInteger(v, 'maxItems');
        return withConstraint({ maxItems: v });
      };
    }
  }

  /**
   * Create an immutable enhanced FieldBuilder. Every method creates a fresh
   * builder via this same function, so chaining never mutates.
   */
  function enhance(
    meta: FieldMetadata,
    base: FieldType = fieldType
  ): ConstrainedBuilder<S, V, F> {
    const builder = new FieldBuilder<V, F>(
      base,
      meta,
      cats.length > 0 ? cats : undefined
    );
    // SAFETY: populateMethods dynamically adds builder/constraint methods onto builder
    populateMethods(builder as unknown as Record<string, unknown>, meta, base);
    // SAFETY: after populateMethods, builder has all required builder + constraint methods
    return builder as ConstrainedBuilder<S, V, F>;
  }

  // SAFETY: populateMethods dynamically adds builder/constraint methods onto fieldType
  populateMethods(
    fieldType as unknown as Record<string, unknown>,
    {},
    fieldType
  );
  // SAFETY: after populateMethods, fieldType has all required builder + constraint methods
  return fieldType as T & BuilderMethods<S, V, F> & ResolveConstraints<S, V, F>;
}
