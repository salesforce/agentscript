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
  AstNodeBase,
  SymbolKind,
  emitKeyName,
  emitIndent,
  parseResult,
} from './types.js';
import type { Dialect, DiscriminantConfig } from './dialect.js';
import {
  createDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
  type Diagnostic,
} from './diagnostics.js';
import type { Statement } from './statements.js';
import { addBuilderMethods } from './field-builder.js';
import {
  ValueChild,
  StatementChild,
  emitChildren,
  initChildren,
  extractChildren,
} from './children.js';
import type { BlockChild } from './children.js';
import { BlockBase, BlockCore, NamedMap } from './named-map.js';
import type {
  NamedBlockInstance,
  NamedBlockFactory,
  NamedBlockOpts,
} from './factory-types.js';
import {
  normalizeSchema,
  validateSchemaFields,
  overrideFactoryBuilderMethods,
  stripDiscriminantIfMissing,
} from './factory-utils.js';

export function NamedBlock(
  kind: string
): NamedBlockFactory<Record<never, never>>;
export function NamedBlock<T extends Schema>(
  kind: string,
  inputSchema: T,
  opts?: NamedBlockOpts
): NamedBlockFactory<T>;
export function NamedBlock<T extends Schema>(
  kind: string,
  inputSchema?: T,
  opts?: NamedBlockOpts
): NamedBlockFactory<T> {
  const rawSchema = inputSchema ?? {};
  // SAFETY: normalizeSchema resolves FieldType[] to union FieldType; frozen result
  // is both Record<string, FieldType> and structurally compatible with T
  const schema = Object.freeze(normalizeSchema(rawSchema)) as Record<
    string,
    FieldType
  > &
    T;
  validateSchemaFields(schema);

  const colinear = opts?.colinear;
  const body = opts?.body;
  const symbol: SymbolMeta = opts?.symbol ?? { kind: SymbolKind.Class };
  const scopeLevel = opts?.scopeAlias;
  const rawVariants = opts?.variants;
  const variants: Record<string, Record<string, FieldType>> | undefined =
    rawVariants
      ? Object.fromEntries(
          Object.entries(rawVariants).map(([name, variantSchema]) => {
            const merged = Object.freeze({
              ...schema,
              ...normalizeSchema(variantSchema),
            });
            validateSchemaFields(merged);
            return [name, merged];
          })
        )
      : undefined;
  const validVariantNames = variants ? Object.keys(variants) : undefined;

  // -- Discriminant setup --
  const discriminantField = opts?.discriminant;
  let namedDiscriminantConfig: DiscriminantConfig | undefined;
  if (discriminantField) {
    if (!schema[discriminantField]) {
      throw new Error(
        `NamedBlock '${kind}': discriminant field '${discriminantField}' not found in base schema`
      );
    }
    if (variants && Object.keys(variants).length > 0) {
      namedDiscriminantConfig = {
        field: discriminantField,
        variants,
        validValues: validVariantNames!,
      };
    }
    // When discriminant is set but no variants yet (chained API: .discriminant().variant()),
    // namedDiscriminantConfig stays undefined and will be built when variants are added.
  }

  /**
   * Resolve the effective schema and optional discriminant config for a
   * given instance name.  Handles both name-based and discriminant-based
   * variant resolution so callers don't need to branch.
   */
  function resolveVariant(
    name: string,
    cstNode: SyntaxNode
  ): {
    effectiveSchema: Record<string, FieldType>;
    discriminantConfig: DiscriminantConfig | undefined;
    earlyDiagnostics: Diagnostic[];
  } {
    if (namedDiscriminantConfig) {
      // Discriminant-based: dialect will pre-scan body fields to resolve variant
      return {
        effectiveSchema: schema,
        discriminantConfig: namedDiscriminantConfig,
        earlyDiagnostics: [],
      };
    }
    if (!variants) {
      return {
        effectiveSchema: schema,
        discriminantConfig: undefined,
        earlyDiagnostics: [],
      };
    }
    const variantSchema = variants[name];
    if (variantSchema) {
      return {
        effectiveSchema: variantSchema,
        discriminantConfig: undefined,
        earlyDiagnostics: [],
      };
    }
    return {
      effectiveSchema: schema,
      discriminantConfig: undefined,
      earlyDiagnostics: [
        createDiagnostic(
          cstNode,
          `Unknown variant '${name}'. Valid variants: ${validVariantNames!.join(', ')}`,
          DiagnosticSeverity.Error,
          'unknown-variant'
        ),
      ],
    };
  }

  class NamedBlockNode extends BlockBase {
    __kind = kind;
    __symbol = symbol;
    __name?: string;
    __scope = scopeLevel;

    /** @internal Direct reference to the ValueChild, avoiding linear scan. Non-enumerable. */
    private _valueChild?: ValueChild;

    /** Colinear expression (e.g., `@actions.send_email`). Backed by __children. */
    get value(): unknown {
      return this._valueChild?.value;
    }

    set value(val: unknown) {
      if (this._valueChild) {
        this._valueChild.value = val;
      } else {
        const vc = new ValueChild(val);
        this._valueChild = vc;
        // Insert at the beginning (before field/statement children)
        this.__children.unshift(vc);
      }
    }

    /** Procedure statements (with/set/to clauses, body). Backed by __children. */
    get statements(): Statement[] | undefined {
      const stmts: Statement[] = [];
      for (const c of this.__children) {
        if (c instanceof StatementChild) {
          stmts.push(c.value);
        }
      }
      return stmts.length > 0 ? stmts : undefined;
    }

    set statements(stmts: Statement[] | undefined) {
      // Remove existing statement children.
      // SAFETY: only removes StatementChild entries — FieldChild accessors
      // remain valid because their entries survive the filter. See
      // defineFieldAccessors() invariant in children.ts.
      this.__children = this.__children.filter(c => c.__type !== 'statement');
      if (stmts) {
        for (const s of stmts) {
          this.__children.push(new StatementChild(s));
        }
      }
    }

    static readonly kind = kind;
    static readonly schema = schema;
    static readonly isNamed = true as const;
    static readonly allowAnonymous = opts?.allowAnonymous ?? false;
    static readonly scopeAlias = scopeLevel;
    static readonly colinearType = colinear;
    static readonly hasColinear = !!colinear;
    static readonly hasBody = !!body;
    static readonly capabilities = opts?.capabilities;

    constructor(
      name: string,
      fields: Record<string, unknown>,
      parseChildren?: BlockChild[]
    ) {
      super();
      // Hide _valueChild from enumeration (Object.entries / for...in)
      Object.defineProperty(this, '_valueChild', {
        value: undefined,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      this.__name = name;
      this.__children = initChildren(this, parseChildren, fields, schema);
    }

    private static fromParsedFields(
      name: string,
      fields: Record<string, unknown>,
      cstNode: SyntaxNode,
      diagnostics: Diagnostic[],
      children?: BlockChild[],
      ownDiagnostics?: Diagnostic[]
    ): ParseResult<NamedBlockInstance<T>> {
      const instance = new NamedBlockNode(name, fields, children);
      const parsed = withCst(instance, cstNode);
      // Only attach own-level diagnostics to the node. Child diagnostics
      // are already on child nodes and will be found by collectDiagnostics.
      parsed.__diagnostics = ownDiagnostics ?? diagnostics;
      return parseResult(parsed as Parsed<NamedBlockInstance<T>>, diagnostics);
    }

    static parse(
      node: SyntaxNode,
      name: string,
      dialect: Dialect,
      adoptedSiblings?: SyntaxNode[]
    ): ParseResult<NamedBlockInstance<T>> {
      if (colinear || body) {
        return NamedBlockNode.parseColinear(
          node,
          name,
          dialect,
          adoptedSiblings
        );
      }
      return NamedBlockNode.parseMapping(node, name, dialect, adoptedSiblings);
    }

    private static parseMapping(
      node: SyntaxNode,
      name: string,
      dialect: Dialect,
      adoptedSiblings?: SyntaxNode[]
    ): ParseResult<NamedBlockInstance<T>> {
      const { effectiveSchema, discriminantConfig, earlyDiagnostics } =
        resolveVariant(name, node);

      if (earlyDiagnostics.length > 0) {
        return NamedBlockNode.fromParsedFields(
          name,
          {},
          node,
          earlyDiagnostics
        );
      }

      const result = dialect.parseMapping(
        node,
        effectiveSchema,
        adoptedSiblings,
        discriminantConfig ? { discriminant: discriminantConfig } : undefined
      );
      const ownDiags = result.value.__diagnostics;
      const { fields, children } = extractChildren(result.value);
      return NamedBlockNode.fromParsedFields(
        name,
        fields,
        node,
        result.diagnostics,
        children,
        ownDiags
      );
    }

    private static parseColinear(
      node: SyntaxNode,
      name: string,
      dialect: Dialect,
      adoptedSiblings?: SyntaxNode[]
    ): ParseResult<NamedBlockInstance<T>> {
      const { effectiveSchema, discriminantConfig, earlyDiagnostics } =
        resolveVariant(name, node);

      if (earlyDiagnostics.length > 0) {
        return NamedBlockNode.fromParsedFields(
          name,
          {},
          node,
          earlyDiagnostics
        );
      }

      // Navigate to the mapping_element parent to find sibling nodes
      const parentNode = node.parent;
      const colinearNode =
        parentNode?.childForFieldName('colinear_value') ??
        parentNode?.childForFieldName('expression');
      const bodyNode =
        parentNode?.childForFieldName('block_value') ??
        parentNode?.childForFieldName('procedure');

      const dc = new DiagnosticCollector();
      let colinearValue: unknown;
      if (colinear && colinearNode) {
        const exprNode =
          colinearNode.childForFieldName('expression') ?? colinearNode;
        const colinearResult = colinear.parse(exprNode, dialect);
        colinearValue = colinearResult.value;
        dc.merge(colinearResult);
      }

      let statements: Statement[] | undefined;
      let mappingFields: Record<string, unknown> = {};
      let bodyChildren: BlockChild[] | undefined;
      let bodyOwnDiags: Diagnostic[] = [];

      const discOpt = discriminantConfig
        ? { discriminant: discriminantConfig }
        : undefined;

      if (bodyNode) {
        const content = dialect.parseBlockContent(
          bodyNode,
          effectiveSchema,
          discOpt
        );
        const extracted = extractChildren(content.fields);
        mappingFields = extracted.fields;
        bodyChildren = extracted.children;
        if (content.statements.length > 0) statements = content.statements;
        dc.mergeAll(content.diagnostics);
        // content.fields is the parseMappingElements value with own diagnostics
        bodyOwnDiags = (content.fields.__diagnostics as Diagnostic[]) ?? [];
      } else if (adoptedSiblings && adoptedSiblings.length > 0) {
        // Tree-sitter error recovery broke nesting — re-parent orphaned
        // siblings that were detected by indentation in parseMappingElements.
        const adoptedResult = dialect.parseMappingElements(
          adoptedSiblings,
          effectiveSchema,
          node,
          discriminantConfig
        );
        const extracted = extractChildren(adoptedResult.value);
        mappingFields = extracted.fields;
        bodyChildren = extracted.children;
        dc.merge(adoptedResult);
        bodyOwnDiags =
          (adoptedResult.value.__diagnostics as Diagnostic[]) ?? [];
        const adoptedStatements = dialect.parseStatementNodes(adoptedSiblings);
        if (adoptedStatements.length > 0) {
          statements = [...(statements ?? []), ...adoptedStatements];
        }
      }

      // Merge colinear with/to clauses + parentNode ERROR recovery.
      // When bodyNode was already parsed, the with/to statements from
      // the body are already included via parseBlockContent. Only add
      // colinear with_to_statement_list statements that aren't already
      // in the body (deduplicate by CST node identity).
      const extraNodes: SyntaxNode[] = [
        ...(colinearNode?.childForFieldName('with_to_statement_list')
          ?.namedChildren ?? []),
        ...(parentNode?.children
          .filter(c => c.type === 'ERROR')
          .flatMap(c => c.namedChildren) ?? []),
      ];
      if (extraNodes.length > 0) {
        // Collect CST node positions already parsed from body to avoid duplication
        const posKey = (n: SyntaxNode) =>
          `${n.startRow}:${n.startCol}-${n.endRow}:${n.endCol}`;
        const bodyPositions = new Set(
          (statements ?? [])
            .filter(s => s.__cst?.node)
            .map(s => posKey(s.__cst!.node))
        );
        const extraStatements = dialect
          .parseStatementNodes(extraNodes)
          .filter(s => {
            if (!s.__cst?.node) return true;
            return !bodyPositions.has(posKey(s.__cst.node));
          });
        if (extraStatements.length > 0) {
          statements = [...(statements ?? []), ...extraStatements];
        }
      }

      const instance = new NamedBlockNode(name, mappingFields, bodyChildren);
      if (colinearValue !== undefined) instance.value = colinearValue;
      if (statements) instance.statements = statements;

      const parsed = withCst(instance, node);
      // Only own-level diagnostics on this node; child diagnostics
      // are on child nodes and found by collectDiagnostics.
      parsed.__diagnostics = bodyOwnDiags;
      return parseResult(parsed as Parsed<NamedBlockInstance<T>>, dc.all);
    }

    __emit(ctx: EmitContext): string {
      if (colinear && this.value != null) {
        return this.emitColinear(ctx);
      }
      return this.emitAsEntry(ctx);
    }

    /** Emit as a top-level entry with schema key prefix (e.g., `topic main:`). */
    emitWithKey(schemaKey: string, ctx: EmitContext): string {
      const indent = emitIndent(ctx);
      const header = `${indent}${schemaKey} ${emitKeyName(this.__name!)}:`;
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = emitChildren(this.__children, childCtx);
      return body ? `${header}\n${body}` : header;
    }

    /** Emit as a nested entry with just the name (e.g., `fetch_data:` inside `actions:`). */
    private emitAsEntry(ctx: EmitContext): string {
      const indent = emitIndent(ctx);
      const header = `${indent}${emitKeyName(this.__name!)}:`;
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = emitChildren(this.__children, childCtx);
      return body ? `${header}\n${body}` : header;
    }

    static emit(value: NamedBlockInstance<T>, ctx: EmitContext): string {
      return value.__emit(ctx);
    }

    static emitField(
      key: string,
      value: NamedMap<BlockCore>,
      ctx: EmitContext
    ) {
      if (!value.__children || value.__children.length === 0) {
        // Preserve empty blocks that were in the original source
        if (value.__cst) {
          return `${emitIndent(ctx)}${key}:`;
        }
        return '';
      }
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = emitChildren(value.__children, childCtx);
      if (!body) return '';
      return `${indent}${key}:\n${body}`;
    }

    private emitColinear(ctx: EmitContext): string {
      const indent = emitIndent(ctx);
      let out = `${indent}${emitKeyName(this.__name!)}: ${colinear!.emit(this.value, ctx)}`;

      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const bodyParts: string[] = [];

      for (const child of this.__children) {
        if (child.__type === 'value') {
          // Already emitted inline above
          continue;
        }
        if (child instanceof StatementChild) {
          const stmt = child.value;
          if (stmt.__kind === 'ToClause') {
            // Preserve multi-line layout if the original source had
            // the `to` clause on a separate continuation line.
            const val = this.value;
            const colinearRow =
              val instanceof AstNodeBase
                ? val.__cst?.node?.endPosition?.row
                : undefined;
            const toRow = stmt.__cst?.node?.startPosition?.row;
            if (colinearRow != null && toRow != null && toRow > colinearRow) {
              bodyParts.push(stmt.__emit(childCtx));
            } else {
              out += ' ' + stmt.__emit({ indent: 0 });
            }
          } else {
            bodyParts.push(stmt.__emit(childCtx));
          }
          continue;
        }
        // FieldChild, ErrorBlock, etc.
        const emitted = child.__emit(childCtx);
        if (emitted) bodyParts.push(emitted);
      }

      if (bodyParts.length > 0) {
        out += '\n' + bodyParts.join('\n');
      }

      return out;
    }
  }

  // SAFETY: NamedBlock is not a FieldType (it's an entry type for CollectionBlock),
  // but addBuilderMethods only needs the structural shape to add .describe()/.required()/etc.
  const base = addBuilderMethods(NamedBlockNode as unknown as FieldType);
  const dp = (key: string, value: unknown) =>
    Object.defineProperty(base, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  if (opts?.description) {
    dp('__metadata', { description: opts.description });
  }
  dp(
    'resolveSchemaForName',
    (name: string): Record<string, FieldType> => variants?.[name] ?? schema
  );
  if (variants) {
    dp('__variantNames', Object.keys(variants));
  }
  dp(
    'extend',
    (additionalFields: Schema, overrideOpts?: Partial<NamedBlockOpts>) => {
      const mergedOpts = overrideOpts ? { ...opts, ...overrideOpts } : opts;
      return NamedBlock(kind, { ...schema, ...additionalFields }, mergedOpts);
    }
  );
  dp('omit', (...keys: string[]) => {
    const remaining: Record<string, FieldType> = { ...schema };
    for (const k of keys) delete remaining[k];
    return NamedBlock(
      kind,
      remaining,
      stripDiscriminantIfMissing(remaining, opts)
    );
  });
  dp('pick', (keys: string[]) => {
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
    return NamedBlock(kind, picked, stripDiscriminantIfMissing(picked, opts));
  });
  dp('variant', (name: string, variantSchema: Schema) => {
    const currentVariants = opts?.variants ?? {};
    const newVariants = { ...currentVariants, [name]: variantSchema };
    // SAFETY: inputSchema defaults to {} which satisfies T extends Schema
    return NamedBlock(kind, (inputSchema ?? {}) as T, {
      ...opts,
      variants: newVariants,
    });
  });
  dp('discriminant', (fieldName: string) => {
    return NamedBlock(kind, (inputSchema ?? {}) as T, {
      ...opts,
      discriminant: fieldName,
    });
  });
  dp('discriminantField', discriminantField);
  dp(
    'resolveSchemaForDiscriminant',
    (value: string): Record<string, FieldType> => variants?.[value] ?? schema
  );
  dp('__clone', () => NamedBlock(kind, { ...schema }, opts));
  // Must run AFTER factory methods are set (see Block() comment).
  overrideFactoryBuilderMethods(base);
  // SAFETY: base is structurally NamedBlockFactory<T> after Object.defineProperty population
  return base as unknown as NamedBlockFactory<T>;
}
