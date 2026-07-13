/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * TypeDescriptor — a FieldType that models the `type:` block on inputs,
 * separating type structure (parameters, constraints) from input metadata.
 *
 * Syntax:
 *   type: list
 *       value: object
 *           fields:
 *               name: string
 *
 *   type: object
 *       fields:
 *           name: string
 *
 *   type: string   (no nested block needed)
 *
 * Each type keyword accepts specific nested parameters:
 *   - list   → value: (element type, itself a TypeDescriptor), min_items, max_items
 *   - object → fields: (recursive TypedMap of inputs)
 *   - string → enum, min_length, max_length
 *   - number/integer → enum, minimum, maximum
 */
import type {
  SyntaxNode,
  EmitContext,
  ParseResult,
  FieldType,
  KeywordInfo,
  Schema,
} from './types.js';
import {
  AstNodeBase,
  emitIndent,
  keywordNames,
  parseResult,
  SymbolKind,
  withCst,
} from './types.js';
import type { Dialect } from './dialect.js';
import { Identifier } from './expressions.js';
import {
  createDiagnostic,
  DiagnosticCollector,
  DiagnosticSeverity,
} from './diagnostics.js';
import { FieldChild, emitChildren } from './children.js';
import { addBuilderMethods } from './field-builder.js';
import type { BlockCore } from './named-map.js';
import { findSuggestion } from '../lint/lint-utils.js';

// ---------------------------------------------------------------------------
// TypeDescriptor AST node
// ---------------------------------------------------------------------------

export class TypeDescriptorNode extends AstNodeBase {
  readonly __kind = 'TypeDescriptor' as const;
  readonly __symbol = { kind: SymbolKind.Object, noRecurse: true };
  __children: FieldChild[] = [];

  typeName: Identifier;
  properties?: BlockCore;

  constructor(typeName: Identifier) {
    super();
    this.typeName = typeName;
  }

  __emit(ctx: EmitContext): string {
    const parts: string[] = [];
    parts.push(this.typeName.__emit(ctx));

    if (this.__children.length > 0) {
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = emitChildren(this.__children, childCtx);
      if (body) {
        parts.push('\n' + body);
      }
    }

    return parts.join('');
  }
}

// ---------------------------------------------------------------------------
// TypeDescriptor options
// ---------------------------------------------------------------------------

export interface TypeDescriptorOptions {
  primitiveTypes: readonly KeywordInfo[];
  typeParameterSchemas: TypeParameterSchemaMap;
}

/**
 * Maps type keywords to schemas for their nested parameters.
 * - list → { value: TypeDescriptorField }
 * - object → { fields: TypedMapField }
 */
export type TypeParameterSchemaMap = Record<string, Schema>;

// ---------------------------------------------------------------------------
// TypeDescriptor FieldType factory
// ---------------------------------------------------------------------------

export function TypeDescriptor(options: TypeDescriptorOptions) {
  const { primitiveTypes, typeParameterSchemas } = options;
  const typeNames = keywordNames(primitiveTypes);

  const fieldType: FieldType<TypeDescriptorNode> = {
    __fieldKind: 'Block' as const,

    parse(node: SyntaxNode, dialect: Dialect): ParseResult<TypeDescriptorNode> {
      const dc = new DiagnosticCollector();

      // The dialect passes blockValue when both colinear and block exist.
      // If node is a mapping, the type keyword is on the parent's colinear_value.
      // If node is an expression, it IS the type keyword (no nested block).
      let typeKeywordNode: SyntaxNode | null = null;
      let bodyNode: SyntaxNode | null = null;

      if (node.type === 'mapping') {
        bodyNode = node;
        const parent = node.parent;
        if (parent) {
          typeKeywordNode =
            parent.childForFieldName('colinear_value') ??
            parent.childForFieldName('expression') ??
            null;
        }
      } else {
        // The node itself is the expression (e.g., bare `type: string`)
        typeKeywordNode = node;
      }

      let typeName = '';
      let typeIdent: Identifier;

      if (typeKeywordNode) {
        // The expression might be wrapped in an `expression` node
        const exprChild =
          typeKeywordNode.childForFieldName('expression') ?? typeKeywordNode;
        const identNode =
          exprChild.type === 'id'
            ? exprChild
            : exprChild.namedChildren?.find((c: SyntaxNode) => c.type === 'id');

        if (identNode) {
          typeName = identNode.text;
          typeIdent = withCst(new Identifier(typeName), identNode);
        } else {
          typeName = typeKeywordNode.text.trim();
          typeIdent = withCst(new Identifier(typeName), typeKeywordNode);
        }

        if (typeName && !typeNames.includes(typeName) && typeName !== 'list') {
          const suggestion = findSuggestion(typeName, [...typeNames, 'list']);
          const hint = suggestion
            ? `Did you mean '${suggestion}'?`
            : `Valid types: ${[...typeNames, 'list'].join(', ')}`;
          dc.add(
            createDiagnostic(
              identNode ?? typeKeywordNode,
              `Unknown type '${typeName}'. ${hint}`,
              DiagnosticSeverity.Error,
              'unknown-type',
              { found: typeName, expected: [...typeNames, 'list'] }
            )
          );
        }
      } else {
        typeIdent = new Identifier('');
        dc.add(
          createDiagnostic(
            node,
            `Missing type keyword after 'type:'`,
            DiagnosticSeverity.Error,
            'missing-type-keyword'
          )
        );
      }

      const descriptor = withCst(new TypeDescriptorNode(typeIdent), node);

      if (bodyNode && typeName) {
        const paramSchema = typeParameterSchemas[typeName];
        if (paramSchema && Object.keys(paramSchema).length > 0) {
          const result = dialect.parseMapping(bodyNode, paramSchema);
          if (result.value && typeof result.value === 'object') {
            descriptor.properties = result.value as BlockCore;
            for (const key of Object.keys(paramSchema)) {
              const val = (result.value as Record<string, unknown>)[key];
              if (val !== undefined) {
                const ft = paramSchema[key] as FieldType;
                descriptor.__children.push(new FieldChild(key, val, ft));
              }
            }
          }
          dc.merge(result);
        } else if (bodyNode.namedChildren.length > 0) {
          // Type doesn't accept parameters but user provided a body
          dc.add(
            createDiagnostic(
              bodyNode,
              `Type '${typeName}' does not accept type parameters.`,
              DiagnosticSeverity.Error,
              'unexpected-type-parameters'
            )
          );
        }
      }

      descriptor.__diagnostics = dc.all;
      return parseResult(descriptor, dc.all);
    },

    emit(value: TypeDescriptorNode, ctx: EmitContext): string {
      return value.__emit(ctx);
    },

    emitField(
      key: string,
      value: TypeDescriptorNode,
      ctx: EmitContext
    ): string {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const typeStr = value.typeName.__emit(ctx);

      let body = '';
      if (value.__children.length > 0) {
        const emitted = emitChildren(value.__children, childCtx);
        if (emitted) body = '\n' + emitted;
      }

      return `${indent}${key}: ${typeStr}${body}`;
    },
  };

  return addBuilderMethods(fieldType, undefined);
}
