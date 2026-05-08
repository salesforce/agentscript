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
  SymbolMeta,
} from './types.js';
import {
  SymbolKind,
  isKeyNode,
  emitKeyName,
  quoteKeyName,
  emitIndent,
  emitCommentList,
  keywordNames,
} from './types.js';
import type { Dialect } from './dialect.js';
import { Identifier } from './expressions.js';
import { addBuilderMethods } from './field-builder.js';
import { ErrorBlock, isEmittable } from './children.js';
import { NamedMap } from './named-map.js';
import { TypedDeclarationBase } from './typed-declarations.js';
import type { TypedMapFactory, TypedMapOptions } from './factory-types.js';
import { overrideFactoryBuilderMethods } from './factory-utils.js';
import { TypedMapParser } from './typed-map-parser.js';

// ---------------------------------------------------------------------------
// TypedMap factory function
// ---------------------------------------------------------------------------

export function TypedMap<T extends TypedDeclarationBase = TypedDeclarationBase>(
  kind: string,
  propertiesBlock: FieldType,
  options: TypedMapOptions = {}
): TypedMapFactory<T> {
  const modifiers = options.modifiers ?? [];
  const primitiveTypes = options.primitiveTypes ?? [];
  const hasModifier = modifiers.length > 0;
  const blockLabel = kind.replace(/Block$/, '').toLowerCase();
  const symbol: SymbolMeta = options.symbol ?? { kind: SymbolKind.Namespace };

  class TypedMapNode extends NamedMap<T> {
    static readonly __fieldKind = 'TypedMap' as const;
    static readonly kind = kind;
    static readonly isNamed = false as const;
    static readonly __isTypedMap = true as const;
    static readonly propertiesSchema = propertiesBlock.schema;
    static readonly __modifiers = modifiers;
    static readonly __primitiveTypes = primitiveTypes;
    static readonly propertiesBlock = propertiesBlock;

    constructor(entries?: Iterable<[string, T]>) {
      super(kind, { symbol, entries });
    }

    static emit(value: NamedMap<T>, ctx: EmitContext): string {
      return value.__emit(ctx);
    }

    static emitField(
      key: string,
      value: NamedMap<T>,
      ctx: EmitContext
    ): string {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = value.__emit(childCtx);
      return body ? `${indent}${key}:\n${body}` : `${indent}${key}:`;
    }

    static withProperties(newPropsBlock: FieldType) {
      return TypedMap(kind, newPropsBlock, options);
    }

    static extendProperties(additionalFields: Schema) {
      if (
        'extend' in propertiesBlock &&
        typeof propertiesBlock.extend === 'function'
      ) {
        return TypedMap(
          kind,
          propertiesBlock.extend(additionalFields),
          options
        );
      }
      throw new Error(
        `Properties block for '${kind}' does not support extend(). ` +
          'Use withProperties() instead.'
      );
    }

    static withKeyPattern(pattern: string) {
      return TypedMap(kind, propertiesBlock, {
        ...options,
        keyPattern: pattern,
      });
    }

    static parse(
      node: SyntaxNode,
      dialect: Dialect
    ): ParseResult<TypedMapNode> {
      const instance = new TypedMapNode();
      const parser = new TypedMapParser<T>(
        instance,
        blockLabel,
        hasModifier,
        modifiers,
        primitiveTypes,
        propertiesBlock,
        dialect,
        options
      );
      return parser.run(node) as ParseResult<TypedMapNode>;
    }

    __emit(ctx: EmitContext): string {
      const indent = emitIndent(ctx);
      const lines: string[] = [];
      const reservedEntryNames = new Set([
        ...keywordNames(primitiveTypes),
        ...keywordNames(modifiers),
        'list',
      ]);

      for (const [name, decl] of this.entries()) {
        if (!decl) continue;
        const allComments = decl.__comments ?? [];
        const leading = allComments.filter(c => c.attachment === 'leading');
        const inline = allComments.filter(c => c.attachment === 'inline');
        const trailing = allComments.filter(c => c.attachment === 'trailing');

        const leadingOutput = emitCommentList(leading, ctx);
        if (leadingOutput) {
          lines.push(leadingOutput);
        }

        // Preserve original quoting from source. If the key was written as
        // a quoted string (e.g. "date": object), emit it quoted. For
        // programmatically-created entries (no CST), quote reserved keywords
        // so re-parsing doesn't flag them as reserved-name errors.
        const keyChild = decl.__cst?.node
          ?.childForFieldName('key')
          ?.namedChildren.find(isKeyNode);
        const wasQuoted = keyChild
          ? keyChild.type === 'string'
          : reservedEntryNames.has(name);
        const emittedKey = wasQuoted ? quoteKeyName(name) : emitKeyName(name);
        let line = `${indent}${emittedKey}: `;

        if (
          hasModifier &&
          'modifier' in decl &&
          decl.modifier instanceof Identifier
        ) {
          line += `${decl.modifier.__emit(ctx)} `;
        }

        // Emit error prefix from ErrorBlock in declaration's __children
        for (const dc of decl.__children) {
          if (dc instanceof ErrorBlock) {
            line += `${dc.rawText} `;
            break;
          }
        }

        line += decl.type.__emit(ctx);

        if (decl.defaultValue) {
          line += ` = ${decl.defaultValue.__emit(ctx)}`;
        } else if (decl.__cst?.node?.text?.trimEnd().endsWith('=')) {
          // Preserve trailing `=` when CST had one but default value is missing.
          // Use endsWith (not includes) to avoid matching `= ""` or `= None`
          // where the `=` is mid-line with a parsed default value.
          line += ' =';
        }

        if (inline.length > 0) {
          const inlineText = inline
            .map(c => {
              if (c.value.trim().length === 0) return '#';
              const prefix = c.range ? '#' : '# ';
              return `${prefix}${c.value}`;
            })
            .join(' ');
          line += ` ${inlineText}`;
        }

        lines.push(line);

        const trailingOutput = emitCommentList(trailing, {
          ...ctx,
          indent: ctx.indent + 1,
        });
        if (trailingOutput) {
          lines.push(trailingOutput);
        }

        if (isEmittable(decl.properties)) {
          const propsOutput = decl.properties.__emit({
            ...ctx,
            indent: ctx.indent + 1,
          });
          if (propsOutput) {
            lines.push(propsOutput);
          }
        }
      }

      return lines.join('\n');
    }
  }

  const base = addBuilderMethods(TypedMapNode, undefined, { factory: true });
  if (options.description) {
    Object.defineProperty(base, '__metadata', {
      value: { description: options.description },
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  Object.defineProperty(base, '__clone', {
    value: () => TypedMap(kind, propertiesBlock, options),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  overrideFactoryBuilderMethods(base);
  // SAFETY: base is structurally TypedMapFactory<T> after method population
  return base as unknown as TypedMapFactory<T>;
}
