/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  SyntaxNode,
  FieldType,
  SingularFieldType,
  EmitContext,
  ParseResult,
  CstMeta,
  Parsed,
} from './types.js';
import {
  withCst,
  toRange,
  AstNodeBase,
  emitIndent,
  parseResult,
  wrapWithComments,
} from './types.js';
import type { Dialect } from './dialect.js';
import type { Expression, ExpressionKind } from './expressions.js';
import {
  StringLiteral,
  TemplateExpression,
  MemberExpression,
  AtIdentifier,
  NumberLiteral,
  BooleanLiteral,
  KIND_LABELS,
  EXPRESSION_KINDS,
} from './expressions.js';
import type { Statement } from './statements.js';
import {
  type Diagnostic,
  createDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
  typeMismatchDiagnostic,
} from './diagnostics.js';
import { addBuilderMethods } from './field-builder.js';
import {
  ALLOWED_STRING_VALUE_KINDS,
  AllowedStringValueKind,
  STRING_VALUE_DEFAULT,
} from './primitives-constants.js';

/**
 * Ensure expression has __cst metadata. If already present (from parsing),
 * return as-is; otherwise attach it from the CST node.
 */
function withCstGuard(
  expr: Expression,
  node: SyntaxNode
): Expression & { __cst: CstMeta } {
  if (expr.__cst) {
    return expr as Expression & { __cst: CstMeta };
  }
  return withCst(expr, node);
}

/**
 * Parse expression and validate against accepted __kind values.
 * Handles the template CST special case (node.type === 'template').
 */
function validateExpression(
  node: SyntaxNode,
  dialect: Dialect,
  accepts: ExpressionKind[]
): { expr: Expression & { __cst: CstMeta }; diagnostics: Diagnostic[] } {
  if (node.type === 'template' && accepts.includes('TemplateExpression')) {
    return {
      expr: TemplateExpression.parse(node, n => dialect.parseExpression(n)),
      diagnostics: [],
    };
  }
  const expr = dialect.parseExpression(node);
  const acceptsSet: ReadonlySet<string> = new Set(accepts);
  if (!acceptsSet.has(expr.__kind)) {
    const expected = accepts.map(k => KIND_LABELS.get(k) ?? k).join(' or ');
    return {
      expr: withCstGuard(expr, node),
      diagnostics: [
        typeMismatchDiagnostic(
          toRange(node),
          `Expected ${expected}, got ${expr.__describe()}`,
          accepts.join(' | '),
          expr.__kind
        ),
      ],
    };
  }
  return { expr: withCstGuard(expr, node), diagnostics: [] };
}

/**
 * StringValue is a union type -- returns the actual expression node, not a wrapper.
 * Use __kind to discriminate: 'StringLiteral' for "quoted", 'TemplateExpression' for |template
 */
export type TStringValue = StringLiteral | TemplateExpression;
export type StringValue = TStringValue;

const _stringValueFieldType: FieldType<TStringValue> = {
  __fieldKind: 'Primitive' as const,
  __accepts: [...STRING_VALUE_DEFAULT],
  parse(
    this: FieldType<TStringValue>,
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<TStringValue> {
    const acceptsArr = this.__accepts ?? STRING_VALUE_DEFAULT;
    const allowedSet: ReadonlySet<string> = ALLOWED_STRING_VALUE_KINDS;
    const accepted = acceptsArr.filter(
      (el: string): el is AllowedStringValueKind => allowedSet.has(el)
    );
    const { expr, diagnostics } = validateExpression(node, dialect, accepted);
    if (diagnostics.length > 0) {
      return parseResult(withCst(new StringLiteral(''), node), diagnostics);
    }
    // SAFETY: validateExpression confirmed expr.__kind is StringLiteral | TemplateExpression
    return parseResult(expr as Parsed<TStringValue>, []);
  },
  emit: (value: TStringValue, ctx: EmitContext): string => value.__emit(ctx),
};

export const StringValue = addBuilderMethods(_stringValueFieldType, [
  'string',
  'generic',
]);

class NumberValueNode extends AstNodeBase {
  static readonly __fieldKind = 'Primitive' as const;
  static __accepts = ['NumberLiteral'];
  readonly __kind = 'NumberValue';

  constructor(public value: number) {
    super();
  }

  __emit(_ctx: EmitContext): string {
    return String(this.value);
  }

  static parse(
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<NumberValueNode> {
    const { expr, diagnostics } = validateExpression(node, dialect, [
      'NumberLiteral',
    ]);
    if (diagnostics.length > 0) {
      return parseResult(withCst(new NumberValueNode(0), node), diagnostics);
    }
    const numValue = expr instanceof NumberLiteral ? expr.value : 0;
    return parseResult(withCst(new NumberValueNode(numValue), node), []);
  }

  static emit(value: NumberValueNode, ctx: EmitContext): string {
    return value.__emit(ctx);
  }
}

export type NumberValue = NumberValueNode;
export const NumberValue = addBuilderMethods(NumberValueNode, [
  'number',
  'generic',
]);

class BooleanValueNode extends AstNodeBase {
  static readonly __fieldKind = 'Primitive' as const;
  static __accepts = ['BooleanLiteral'];
  readonly __kind = 'BooleanValue';

  constructor(public value: boolean) {
    super();
  }

  __emit(_ctx: EmitContext): string {
    return this.value ? 'True' : 'False';
  }

  static parse(
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<BooleanValueNode> {
    const { expr, diagnostics } = validateExpression(node, dialect, [
      'BooleanLiteral',
    ]);
    if (diagnostics.length > 0) {
      // Accept string "TRUE"/"FALSE" as boolean values
      if (expr instanceof StringLiteral) {
        const upper = expr.value.toUpperCase();
        if (upper === 'TRUE' || upper === 'FALSE') {
          return parseResult(
            withCst(new BooleanValueNode(upper === 'TRUE'), node),
            []
          );
        }
      }
      return parseResult(
        withCst(new BooleanValueNode(false), node),
        diagnostics
      );
    }
    const boolValue = expr instanceof BooleanLiteral ? expr.value : false;
    return parseResult(withCst(new BooleanValueNode(boolValue), node), []);
  }

  static emit(value: BooleanValueNode, ctx: EmitContext): string {
    return value.__emit(ctx);
  }
}

export type BooleanValue = BooleanValueNode;
export const BooleanValue = addBuilderMethods(BooleanValueNode, ['generic']);

/**
 * Procedure AST node -- a list of statements (templates, conditionals, runs, etc.).
 *
 * Grammar context: a procedure can arrive via three mapping_element paths:
 * 1. Arrow form: `key: -> \n  stmts` (procedure field)
 * 2. Block form: `key:\n  stmts` (block_value field)
 * 3. Colinear: `key: |template` (colinear_value, single template wrapped)
 *
 * emitField emits the arrow form (->) for procedures with statements,
 * or the inline pipe form (|) for single-template procedures.
 */
class ProcedureValueNode extends AstNodeBase {
  static readonly __fieldKind = 'Primitive' as const;
  readonly __kind = 'ProcedureValue';

  constructor(public statements: Statement[]) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return this.statements
      .map(statement => wrapWithComments(statement.__emit(ctx), statement, ctx))
      .join('\n');
  }

  static parse(
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<ProcedureValueNode> {
    const validTypes = new Set(['procedure', 'mapping', 'template']);
    const dc = new DiagnosticCollector();
    if (!validTypes.has(node.type)) {
      dc.add(
        createDiagnostic(
          node,
          `Expected procedure (->) or template (|) syntax, got '${node.text}'`,
          DiagnosticSeverity.Error,
          'invalid-procedure-value'
        )
      );
    }
    const statements = dialect.parseProcedure(node);
    return parseResult(
      withCst(new ProcedureValueNode(statements), node),
      dc.all
    );
  }

  static emit(value: ProcedureValueNode, ctx: EmitContext): string {
    return value.__emit(ctx);
  }

  static emitField(key: string, value: ProcedureValueNode, ctx: EmitContext) {
    const indent = emitIndent(ctx);
    // Single template — choose syntax based on how it was originally written:
    if (
      value.statements.length === 1 &&
      value.statements[0].__kind === 'Template'
    ) {
      const cstType = value.__cst?.node?.type;

      if (cstType === 'template') {
        // Colinear bare pipe: "key: | content"
        const raw = value.statements[0].__emit({ ...ctx, indent: 0 });
        const lines = raw.split('\n');
        const childIndent = emitIndent({ ...ctx, indent: ctx.indent + 1 });
        const reindented = lines
          .map((line, i) => {
            if (i === 0) return line;
            if (line.trim().length === 0) return '';
            return `${childIndent}${line}`;
          })
          .join('\n');
        return `${indent}${key}: ${reindented}`;
      }

      if (cstType === 'mapping') {
        // Block-level pipe: "key:\n    | content"
        const childCtx = { ...ctx, indent: ctx.indent + 1 };
        return `${indent}${key}:\n${value.statements[0].__emit(childCtx)}`;
      }
    }
    // Multiple statements or non-template → emit arrow form
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    const body = value.__emit(childCtx);
    if (!body) return `${indent}${key}: ->`;
    return `${indent}${key}: ->\n${body}`;
  }
}

export type ProcedureValue = ProcedureValueNode;
export const ProcedureValue = addBuilderMethods(ProcedureValueNode);

export const ExpressionValue = addBuilderMethods({
  __fieldKind: 'Primitive' as const,
  parse: (node: SyntaxNode, dialect: Dialect): ParseResult<Expression> => {
    const expr = dialect.parseExpression(node);
    const parsed = expr.__cst
      ? (expr as Expression & { __cst: CstMeta })
      : withCst(expr, node);
    return parseResult(parsed, []);
  },
  emit: (value: Expression, ctx: EmitContext): string => {
    if (value == null) return '';
    return value.__emit(ctx);
  },
} satisfies FieldType);

export type ReferenceValue = MemberExpression;

export const ReferenceValue = addBuilderMethods({
  __fieldKind: 'Primitive' as const,
  __accepts: ['MemberExpression'],
  parse: (
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<MemberExpression> => {
    const { expr, diagnostics } = validateExpression(node, dialect, [
      'MemberExpression',
    ]);
    if (diagnostics.length > 0) {
      return parseResult(
        withCst(new MemberExpression(new AtIdentifier(''), ''), node),
        diagnostics
      );
    }
    if (expr instanceof MemberExpression && expr.__cst) {
      return parseResult(expr as MemberExpression & { __cst: CstMeta }, []);
    }
    return parseResult(
      withCst(new MemberExpression(new AtIdentifier(''), ''), node),
      []
    );
  },
  emit: (value: MemberExpression, ctx: EmitContext): string =>
    value.__emit(ctx),
} satisfies FieldType);

/**
 * Creates a FieldType that accepts any of the given types.
 * Disambiguation is based on __kind after a single parseExpression() call.
 * Templates are handled at the CST level (node.type === 'template').
 */
export function union(...types: FieldType[]): SingularFieldType<Expression> {
  const expressionKindSet: ReadonlySet<string> = EXPRESSION_KINDS;
  const allAccepts = [...new Set(types.flatMap(t => t.__accepts ?? []))];
  const accepts = allAccepts.filter((k): k is ExpressionKind =>
    expressionKindSet.has(k)
  );
  return {
    __fieldKind: 'Primitive',
    __accepts: accepts,
    parse: (node: SyntaxNode, dialect: Dialect): ParseResult<Expression> => {
      const { expr, diagnostics } = validateExpression(node, dialect, accepts);
      return parseResult(expr, diagnostics);
    },
    emit: (value: Expression, ctx: EmitContext): string => value.__emit(ctx),
  };
}
