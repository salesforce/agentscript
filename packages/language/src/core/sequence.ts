/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  SyntaxNode,
  SingularFieldType,
  EmitContext,
  ParseResult,
  Schema,
  InferFields,
} from './types.js';
import { withCst, AstNodeBase, emitIndent, parseResult } from './types.js';
import type { Dialect } from './dialect.js';
import type { Expression } from './expressions.js';
import type { BlockCore } from './named-map.js';
import type { BlockFactory } from './factory-types.js';
import type { BlockChild } from './children.js';
import {
  extractChildren,
  SequenceItemChild,
  emitChildren,
} from './children.js';
import {
  createDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
} from './diagnostics.js';
import { addBuilderMethods } from './field-builder.js';

/**
 * AST node representing a sequence (dash-prefixed list).
 * Items are stored in `__children` as `SequenceItemChild` entries.
 */
export class SequenceNode extends AstNodeBase {
  readonly __kind = 'Sequence';
  __children: BlockChild[] = [];

  get items(): (BlockCore | Expression)[] {
    const result: (BlockCore | Expression)[] = [];
    for (const c of this.__children) {
      if (c instanceof SequenceItemChild) {
        // SAFETY: SequenceNode only stores BlockCore | Expression values in SequenceItemChild
        result.push(c.value as BlockCore | Expression);
      }
    }
    return result;
  }

  set items(newItems: (BlockCore | Expression)[]) {
    this.__children = newItems.map(item => new SequenceItemChild(item));
  }

  constructor(items?: (BlockCore | Expression)[]) {
    super();
    if (items) {
      this.__children = items.map(item => new SequenceItemChild(item));
    }
  }

  __emit(ctx: EmitContext): string {
    return emitChildren(this.__children, ctx);
  }
}

/** Collect all mapping_element CST nodes from a sequence_element. */
function collectMappingElements(child: SyntaxNode): SyntaxNode[] {
  const elements: SyntaxNode[] = [];

  // Form B: colinear_mapping_element
  const colinearME = child.childForFieldName('colinear_mapping_element');
  if (colinearME) elements.push(colinearME);

  // Block value mapping entries (present in both Form B and Form C)
  const blockValue = child.childForFieldName('block_value');
  if (blockValue) {
    for (const bvChild of blockValue.namedChildren) {
      if (bvChild.type === 'mapping_element') elements.push(bvChild);
    }
  }

  return elements;
}

function hasMappingContent(child: SyntaxNode): boolean {
  return !!(
    child.childForFieldName('colinear_mapping_element') ||
    child.childForFieldName('block_value')
  );
}

/**
 * Internal factory that builds a FieldType for sequences.
 * When `blockType` is provided, mapping elements are parsed against its schema.
 * When omitted, mapping elements produce a diagnostic.
 */
function createSequenceFieldType<T extends Schema>(
  blockType?: BlockFactory<T>
) {
  const fieldType: SingularFieldType<SequenceNode> = {
    __fieldKind: 'Sequence',
    schema: blockType?.schema,

    parse(node: SyntaxNode, dialect: Dialect): ParseResult<SequenceNode> {
      const items: (BlockCore | Expression)[] = [];
      const dc = new DiagnosticCollector();

      for (const child of node.namedChildren) {
        if (child.type !== 'sequence_element') continue;

        // Must check mapping content before Form A because colinear_mapping_element
        // contains a colinear_value that parser would also match.
        if (hasMappingContent(child)) {
          if (blockType) {
            const allElements = collectMappingElements(child);
            const result = dialect.parseMappingElements(
              allElements,
              blockType.schema,
              child
            );
            const { fields, children } = extractChildren(result.value);
            const blockResult = blockType.fromParsedFields(
              // SAFETY: fields parsed against blockType.schema, structurally matches InferFields<T>
              fields as InferFields<T>,
              child,
              result.diagnostics,
              children
            );
            items.push(blockResult.value);
            dc.merge(result);
          } else {
            dc.add(
              createDiagnostic(
                child,
                'Mapping elements are not supported in expression-only sequences. Use simple values (e.g., - "value").',
                DiagnosticSeverity.Error,
                'invalid-sequence-element'
              )
            );
            const cv = child.childForFieldName('colinear_value');
            if (cv) {
              items.push(dialect.parseExpression(cv));
            }
          }
          continue;
        }

        // Form A: plain expression
        const colinearValue = child.childForFieldName('colinear_value');
        if (colinearValue) {
          items.push(dialect.parseExpression(colinearValue));
        }
      }

      return parseResult(withCst(new SequenceNode(items), node), dc.all);
    },

    emit(value: SequenceNode, ctx: EmitContext): string {
      return value.__emit(ctx);
    },

    emitField(key: string, value: SequenceNode, ctx: EmitContext): string {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      return `${indent}${key}:\n${value.__emit(childCtx)}`;
    },
  };

  return addBuilderMethods(fieldType, ['sequence']);
}

/**
 * Create a FieldType for sequences where mapping elements are parsed
 * against the given block type's schema. Expression elements are parsed as expressions.
 */
export function Sequence<T extends Schema>(blockType: BlockFactory<T>) {
  return createSequenceFieldType(blockType);
}

/**
 * Create a FieldType for expression-only sequences.
 * Mapping elements produce diagnostics.
 */
export function ExpressionSequence() {
  return createSequenceFieldType();
}
