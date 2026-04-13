/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Schema,
  FieldType,
  SyntaxNode,
  EmitContext,
  ParseResult,
  Parsed,
  SymbolMeta,
} from './types.js';
import {
  withCst,
  SymbolKind,
  emitIndent,
  parseResult,
  attachWildcardPrefixes,
} from './types.js';
import type { Dialect, DiscriminantConfig } from './dialect.js';
import type { Diagnostic } from './diagnostics.js';
import { addBuilderMethods } from './field-builder.js';
import { emitChildren, initChildren, extractChildren } from './children.js';
import type { BlockChild } from './children.js';
import { BlockBase } from './named-map.js';
import type {
  BlockInstance,
  BlockFactory,
  BlockFactoryOptions,
} from './factory-types.js';
import {
  normalizeSchema,
  validateSchemaFields,
  overrideFactoryBuilderMethods,
  stripDiscriminantIfMissing,
} from './factory-utils.js';

export function Block(kind: string): BlockFactory<Record<never, never>>;
export function Block<T extends Schema>(
  kind: string,
  inputSchema: T,
  options?: BlockFactoryOptions
): BlockFactory<T>;
export function Block<T extends Schema>(
  kind: string,
  inputSchema?: T,
  options?: BlockFactoryOptions
): BlockFactory<T> {
  const rawSchema = inputSchema ?? {};
  // SAFETY: normalizeSchema resolves FieldType[] to union FieldType; frozen result
  // is both Record<string, FieldType> and structurally compatible with T
  const normalizedSchema = normalizeSchema(rawSchema);
  if (options?.wildcardPrefixes?.length) {
    attachWildcardPrefixes(normalizedSchema, options.wildcardPrefixes);
  }
  const schema = Object.freeze(normalizedSchema) as Record<string, FieldType> &
    T;
  validateSchemaFields(schema);

  // -- Discriminant setup --
  const discriminantField = options?.discriminant;
  const rawVariantsBlock = options?.variants;
  let discriminantConfig: DiscriminantConfig | undefined;
  let blockVariants: Record<string, Record<string, FieldType>> | undefined;

  if (discriminantField) {
    if (!schema[discriminantField]) {
      throw new Error(
        `Block '${kind}': discriminant field '${discriminantField}' not found in base schema`
      );
    }
    if (rawVariantsBlock && Object.keys(rawVariantsBlock).length > 0) {
      blockVariants = Object.fromEntries(
        Object.entries(rawVariantsBlock).map(([name, variantSchema]) => {
          const merged = Object.freeze({
            ...schema,
            ...normalizeSchema(variantSchema),
          });
          validateSchemaFields(merged);
          return [name, merged];
        })
      );
      discriminantConfig = {
        field: discriminantField,
        variants: blockVariants,
        validValues: Object.keys(blockVariants),
      };
    }
    // When discriminant is set but no variants yet (chained API: .discriminant().variant()),
    // discriminantConfig stays undefined and will be built when variants are added.
  }

  const symbol: SymbolMeta = options?.symbol ?? { kind: SymbolKind.Object };

  class BlockNode extends BlockBase {
    static readonly __fieldKind = 'Block' as const;
    __kind = kind;
    __symbol = symbol;

    static readonly kind = kind;
    static readonly schema = schema;
    static readonly isNamed = false as const;
    static readonly capabilities = options?.capabilities;

    constructor(fields: Record<string, unknown>, parseChildren?: BlockChild[]) {
      super();
      this.__children = initChildren(this, parseChildren, fields, schema);
    }

    static fromParsedFields(
      fields: Record<string, unknown>,
      cstNode: SyntaxNode,
      diagnostics: Diagnostic[],
      children?: BlockChild[],
      ownDiagnostics?: Diagnostic[]
    ): ParseResult<BlockInstance<T>> {
      const instance = new BlockNode(fields, children);
      const parsed = withCst(instance, cstNode);
      // Only attach own-level diagnostics to the node. Child diagnostics
      // are already on child nodes and will be found by collectDiagnostics.
      parsed.__diagnostics = ownDiagnostics ?? diagnostics;
      return parseResult(parsed as Parsed<BlockInstance<T>>, diagnostics);
    }

    static parse(
      node: SyntaxNode,
      dialect: Dialect,
      extraElements?: SyntaxNode[]
    ): ParseResult<BlockInstance<T>> {
      const result = dialect.parseMapping(node, schema, extraElements, {
        discriminant: discriminantConfig,
      });
      // result.value.__diagnostics has only own-level diagnostics
      // (set by parseMappingElements), while result.diagnostics has all.
      const ownDiags = result.value.__diagnostics;
      const { fields, children } = extractChildren(result.value);
      return BlockNode.fromParsedFields(
        fields,
        node,
        result.diagnostics,
        children,
        ownDiags
      );
    }

    static emit(value: BlockInstance<T>, ctx: EmitContext): string {
      return value.__emit(ctx);
    }

    static emitField(key: string, value: BlockInstance<T>, ctx: EmitContext) {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = value.__emit(childCtx);
      return body ? `${indent}${key}:\n${body}` : `${indent}${key}:`;
    }

    __emit(ctx: EmitContext): string {
      return emitChildren(this.__children, ctx);
    }
  }

  const base = addBuilderMethods(BlockNode);
  if (options?.description) {
    Object.defineProperty(base, '__metadata', {
      value: { description: options.description },
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  Object.defineProperty(base, 'extend', {
    value: (
      additionalFields: Schema,
      overrideOptions?: Partial<BlockFactoryOptions>
    ) => {
      const mergedOpts = overrideOptions
        ? { ...options, ...overrideOptions }
        : options;
      return Block(kind, { ...schema, ...additionalFields }, mergedOpts);
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(base, 'omit', {
    value: (...keys: string[]) => {
      const remaining: Record<string, FieldType> = { ...schema };
      for (const k of keys) delete remaining[k];
      return Block(
        kind,
        remaining,
        stripDiscriminantIfMissing(remaining, options)
      );
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(base, 'pick', {
    value: (keys: string[]) => {
      const picked: Record<string, FieldType> = {};
      const nested = new Map<string, string[]>();
      for (const key of keys) {
        const dotIdx = key.indexOf('.');
        if (dotIdx === -1) {
          if (key in schema) picked[key] = schema[key];
        } else {
          const first = key.slice(0, dotIdx);
          const rest = key.slice(dotIdx + 1);
          if (!nested.has(first)) nested.set(first, []);
          nested.get(first)!.push(rest);
        }
      }
      for (const [first, restKeys] of nested) {
        const field = schema[first];
        if (field && 'pick' in field && typeof field.pick === 'function') {
          picked[first] = field.pick(restKeys);
        }
      }
      return Block(kind, picked, stripDiscriminantIfMissing(picked, options));
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(base, '__clone', {
    value: () => Block(kind, { ...schema }, options),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  // -- Discriminant API --
  const dp = (key: string, value: unknown) =>
    Object.defineProperty(base, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  dp('discriminantField', discriminantField);
  dp(
    'resolveSchemaForDiscriminant',
    (value: string): Record<string, FieldType> =>
      blockVariants?.[value] ?? schema
  );
  dp('discriminant', (fieldName: string) => {
    return Block(kind, (inputSchema ?? {}) as T, {
      ...options,
      discriminant: fieldName,
    });
  });
  dp('variant', (name: string, variantSchema: Schema) => {
    const currentVariants = options?.variants ?? {};
    const newVariants = { ...currentVariants, [name]: variantSchema };
    return Block(kind, (inputSchema ?? {}) as T, {
      ...options,
      variants: newVariants,
    });
  });

  // Must run AFTER factory methods (extend/omit/pick) are set, so the
  // override captures the factory's own implementations, not the
  // addBuilderMethods placeholders.
  overrideFactoryBuilderMethods(base);
  // SAFETY: base is structurally BlockFactory<T> after method population
  return base as unknown as BlockFactory<T>;
}
