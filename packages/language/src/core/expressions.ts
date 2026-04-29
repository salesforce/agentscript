/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { EmitContext, SyntaxNode, Parsed, AstNode } from './types.js';
import { withCst, createNode } from './types.js';
import { createDiagnostic, DiagnosticSeverity } from './diagnostics.js';
import { interpretEscape, escapeStringValue } from './string-escapes.js';
import type { Expression } from './expression-base.js';
import { ExpressionBase } from './expression-base.js';
import {
  TemplateText,
  TemplateInterpolation,
  TemplateExpression,
  parseTemplateParts,
  TEMPLATE_PART_KINDS,
  isTemplatePartKind,
} from './template.js';
import type { TemplatePart, TemplatePartKind } from './template.js';

// Re-export expression/template primitives that historically lived in this
// file. Consumers should migrate to the canonical paths over time.
export type { Expression };
export { ExpressionBase };
export {
  TemplateText,
  TemplateInterpolation,
  TemplateExpression,
  parseTemplateParts,
  TEMPLATE_PART_KINDS,
  isTemplatePartKind,
};
export type { TemplatePart, TemplatePartKind };

export class StringLiteral extends ExpressionBase {
  static readonly kind = 'StringLiteral' as const;
  readonly __kind = StringLiteral.kind;

  constructor(public value: string) {
    super();
  }

  __describe(): string {
    return `string "${this.value}"`;
  }

  __emit(_ctx: EmitContext): string {
    // Prefer CST text for round-trip fidelity (preserves original escaping).
    // For unclosed strings (CST text doesn't end with a matching quote),
    // fall through to the clean emit path to prevent newline accumulation.
    const cstText = this.__cst?.node?.text;
    if (cstText) {
      const quote = cstText[0];
      if (
        (quote === '"' || quote === "'") &&
        cstText.length > 1 &&
        cstText.endsWith(quote)
      ) {
        return cstText;
      }
      // Unclosed string — fall through to clean emit
    }

    return `"${escapeStringValue(this.value)}"`;
  }

  static parse(node: SyntaxNode): Parsed<StringLiteral> {
    let value = '';
    for (const child of node.namedChildren) {
      if (child.type === 'string_content') {
        value += child.text;
      } else if (child.type === 'escape_sequence') {
        const interpreted = interpretEscape(child.text[1]!);
        if (interpreted !== undefined) {
          value += interpreted;
        }
      }
    }
    const parsed = withCst(new StringLiteral(value), node);
    // Flag raw newlines (source spans multiple lines), but not \n escape sequences
    const hasRawNewlines = node.startRow !== node.endRow;
    if (hasRawNewlines) {
      parsed.__diagnostics = [
        createDiagnostic(
          node,
          'String literals must not contain raw newlines. Use template syntax (| ...) for multi-line content.',
          DiagnosticSeverity.Error,
          'string-contains-newline'
        ),
      ];
    }
    return parsed;
  }
}

export class NumberLiteral extends ExpressionBase {
  static readonly kind = 'NumberLiteral' as const;
  readonly __kind = NumberLiteral.kind;

  constructor(public value: number) {
    super();
  }

  __describe(): string {
    return `number ${this.value}`;
  }

  __emit(_ctx: EmitContext): string {
    // Prefer CST text for round-trip fidelity (preserves "1.0" vs "1", etc.)
    if (this.__cst) {
      return this.__cst.node.text;
    }
    return String(this.value);
  }

  static parse(node: SyntaxNode): Parsed<NumberLiteral> {
    return withCst(new NumberLiteral(Number(node.text)), node);
  }
}

export class BooleanLiteral extends ExpressionBase {
  static readonly kind = 'BooleanLiteral' as const;
  readonly __kind = BooleanLiteral.kind;

  constructor(public value: boolean) {
    super();
  }

  __describe(): string {
    return this.value ? 'True' : 'False';
  }

  __emit(_ctx: EmitContext): string {
    return this.value ? 'True' : 'False';
  }

  static parse(node: SyntaxNode): Parsed<BooleanLiteral> {
    return withCst(new BooleanLiteral(node.text === 'True'), node);
  }
}

export class NoneLiteral extends ExpressionBase {
  static readonly kind = 'NoneLiteral' as const;
  readonly __kind = NoneLiteral.kind;

  __describe(): string {
    return 'None';
  }

  __emit(_ctx: EmitContext): string {
    return 'None';
  }

  static parse(node: SyntaxNode): Parsed<NoneLiteral> {
    return withCst(new NoneLiteral(), node);
  }
}

export class Identifier extends ExpressionBase {
  static readonly kind = 'Identifier' as const;
  readonly __kind = Identifier.kind;

  constructor(public name: string) {
    super();
  }

  __describe(): string {
    return `identifier "${this.name}"`;
  }

  __emit(_ctx: EmitContext): string {
    return this.name;
  }

  static parse(node: SyntaxNode): Parsed<Identifier> {
    return withCst(new Identifier(node.text), node);
  }
}

/**
 * Placeholder expression for values that failed to parse.
 * Preserves the raw source text for faithful round-trip emission.
 */
export class ErrorValue extends ExpressionBase {
  static readonly kind = 'ErrorValue' as const;
  readonly __kind = ErrorValue.kind;

  constructor(public rawText: string) {
    super();
  }

  __describe(): string {
    return `error value: ${this.rawText}`;
  }

  __emit(_ctx: EmitContext): string {
    return this.rawText;
  }
}

export class AtIdentifier extends ExpressionBase {
  static readonly kind = 'AtIdentifier' as const;
  readonly __kind = AtIdentifier.kind;

  constructor(public name: string) {
    super();
  }

  __describe(): string {
    return `reference @${this.name}`;
  }

  __emit(_ctx: EmitContext): string {
    return `@${this.name}`;
  }

  static parse(node: SyntaxNode): Parsed<AtIdentifier> {
    const idNode = node.namedChildren.find(n => n.type === 'id');
    const name = idNode?.text ?? node.text.slice(1);
    return withCst(new AtIdentifier(name), node);
  }
}

export class MemberExpression extends ExpressionBase {
  static readonly kind = 'MemberExpression' as const;
  readonly __kind = MemberExpression.kind;

  constructor(
    public object: Expression,
    public property: string
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return `${this.object.__emit(ctx)}.${this.property}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<MemberExpression> {
    const children = node.namedChildren;
    const objectNode = children[0];
    const propertyNode = children.find(n => n.type === 'id');

    const object = parseExpr(objectNode);
    const property = propertyNode?.text ?? '';

    return withCst(new MemberExpression(object, property), node);
  }
}

export class SubscriptExpression extends ExpressionBase {
  static readonly kind = 'SubscriptExpression' as const;
  readonly __kind = SubscriptExpression.kind;

  constructor(
    public object: Expression,
    public index: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return `${this.object.__emit(ctx)}[${this.index.__emit(ctx)}]`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<SubscriptExpression> {
    const children = node.namedChildren;
    const object = parseExpr(children[0]);
    const index = parseExpr(children[1]);

    return withCst(new SubscriptExpression(object, index), node);
  }
}

export type BinaryOperator = '+' | '-' | '*' | '/' | 'and' | 'or';

export class BinaryExpression extends ExpressionBase {
  static readonly kind = 'BinaryExpression' as const;
  readonly __kind = BinaryExpression.kind;

  constructor(
    public left: Expression,
    public operator: BinaryOperator,
    public right: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return `${this.left.__emit(ctx)} ${this.operator} ${this.right.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<BinaryExpression> {
    const children = node.namedChildren;
    const left = parseExpr(children[0]);
    const right = parseExpr(children[1]);

    const operators: BinaryOperator[] = ['+', '-', '*', '/', 'and', 'or'];
    let operator: BinaryOperator = '+';
    for (const child of node.children) {
      if (child.isNamed) continue;
      const matched = operators.find(op => op === child.text);
      if (matched) {
        operator = matched;
        break;
      }
    }

    return withCst(new BinaryExpression(left, operator, right), node);
  }
}

export type UnaryOperator = 'not' | '+' | '-';

export class UnaryExpression extends ExpressionBase {
  static readonly kind = 'UnaryExpression' as const;
  readonly __kind = UnaryExpression.kind;

  constructor(
    public operator: UnaryOperator,
    public operand: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    if (this.operator === 'not') {
      return `not ${this.operand.__emit(ctx)}`;
    }
    return `${this.operator}${this.operand.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<UnaryExpression> {
    const children = node.namedChildren;
    const operand = parseExpr(children[0]);

    let operator: UnaryOperator = 'not';
    if (node.text.startsWith('not ')) operator = 'not';
    else if (node.text.startsWith('-')) operator = '-';
    else if (node.text.startsWith('+')) operator = '+';

    return withCst(new UnaryExpression(operator, operand), node);
  }
}

export type ComparisonOperator =
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'is'
  | 'is not';

export class ComparisonExpression extends ExpressionBase {
  static readonly kind = 'ComparisonExpression' as const;
  readonly __kind = ComparisonExpression.kind;

  constructor(
    public left: Expression,
    public operator: ComparisonOperator,
    public right: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return `${this.left.__emit(ctx)} ${this.operator} ${this.right.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<ComparisonExpression> {
    // Filter out ERROR nodes from named children to get left/right operands
    const operands = node.namedChildren.filter(c => !c.isError);
    const left = parseExpr(operands[0]);
    const right = operands.length > 1 ? parseExpr(operands[1]) : left;

    // Detect operator from the non-expression children between left and right.
    // Anonymous children are operator tokens (e.g. `==`, or `is` + `not`).
    // ERROR children contain invalid operators (e.g. bare `=`) that we
    // preserve for round-trip fidelity.
    const opParts: string[] = [];
    for (const child of node.children) {
      // Skip the left and right expression operands
      if (child === operands[0] || child === operands[1]) continue;
      if (child.isError) {
        // ERROR nodes wrap invalid tokens — collect their text
        opParts.push(child.text.trim());
      } else if (!child.isNamed) {
        opParts.push(child.text.trim());
      }
    }
    const opText = opParts.filter(p => p.length > 0).join(' ');
    const operator: ComparisonOperator = (opText || '==') as ComparisonOperator;

    return withCst(new ComparisonExpression(left, operator, right), node);
  }
}

export class ListLiteral extends ExpressionBase {
  static readonly kind = 'ListLiteral' as const;
  readonly __kind = ListLiteral.kind;

  constructor(public elements: Expression[]) {
    super();
  }

  __describe(): string {
    return `list ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    const items = this.elements.map(e => e.__emit(ctx)).join(', ');
    return `[${items}]`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<ListLiteral> {
    const elements: Expression[] = [];
    for (const child of node.namedChildren) {
      elements.push(parseExpr(child));
    }
    return withCst(new ListLiteral(elements), node);
  }
}

export class DictLiteral extends ExpressionBase {
  static readonly kind = 'DictLiteral' as const;
  readonly __kind = DictLiteral.kind;

  constructor(
    public entries: Array<AstNode<{ key: Expression; value: Expression }>>
  ) {
    super();
  }

  __describe(): string {
    return `dictionary ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    const items = this.entries
      .map(e => `${e.key.__emit(ctx)}: ${e.value.__emit(ctx)}`)
      .join(', ');
    return `{${items}}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<DictLiteral> {
    const entries: DictLiteral['entries'] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'dictionary_pair') {
        const rawKeyNode = child.childForFieldName('key');
        // Tree-sitter wraps dict keys in a `key` node (e.g., `(key (string))`).
        // Unwrap it so we parse the actual literal/identifier inside.
        const keyNode =
          rawKeyNode?.type === 'key' && rawKeyNode.namedChildren.length > 0
            ? rawKeyNode.namedChildren[0]
            : rawKeyNode;
        const valueNode = child.childForFieldName('value');
        if (keyNode && valueNode) {
          entries.push(
            withCst(
              { key: parseExpr(keyNode), value: parseExpr(valueNode) },
              child
            )
          );
        }
      }
    }
    return withCst(new DictLiteral(entries), node);
  }
}

/**
 * A function call expression, e.g. len(x)
 */
export class CallExpression extends ExpressionBase {
  static readonly kind = 'CallExpression' as const;
  readonly __kind = CallExpression.kind;

  constructor(
    public func: Expression,
    public args: Expression[]
  ) {
    super();
  }

  __describe(): string {
    return `call ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    const argsStr = this.args.map(a => a.__emit(ctx)).join(', ');
    return `${this.func.__emit(ctx)}(${argsStr})`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<CallExpression> {
    const funcNode = node.childForFieldName('function');
    const func = funcNode ? parseExpr(funcNode) : new Identifier('');
    const args: Expression[] = [];
    // Collect all 'argument' field children
    for (const child of node.childrenForFieldName('argument')) {
      args.push(parseExpr(child));
    }
    return withCst(new CallExpression(func, args), node);
  }
}

/**
 * Python-style ternary: consequence if condition else alternative
 */
export class TernaryExpression extends ExpressionBase {
  static readonly kind = 'TernaryExpression' as const;
  readonly __kind = TernaryExpression.kind;

  constructor(
    public consequence: Expression,
    public condition: Expression,
    public alternative: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return `${this.consequence.__emit(ctx)} if ${this.condition.__emit(ctx)} else ${this.alternative.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<TernaryExpression> {
    const consequenceNode = node.childForFieldName('consequence');
    const conditionNode = node.childForFieldName('condition');
    const alternativeNode = node.childForFieldName('alternative');

    const consequence = consequenceNode
      ? parseExpr(consequenceNode)
      : new Identifier('');
    const condition = conditionNode
      ? parseExpr(conditionNode)
      : new Identifier('');
    const alternative = alternativeNode
      ? parseExpr(alternativeNode)
      : new Identifier('');

    return withCst(
      new TernaryExpression(consequence, condition, alternative),
      node
    );
  }
}

export class Ellipsis extends ExpressionBase {
  static readonly kind = 'Ellipsis' as const;
  readonly __kind = Ellipsis.kind;

  __describe(): string {
    return 'ellipsis (...)';
  }

  __emit(_ctx: EmitContext): string {
    return '...';
  }

  static parse(node: SyntaxNode): Parsed<Ellipsis> {
    return withCst(new Ellipsis(), node);
  }
}

/**
 * A spread/unpack expression, e.g. *items or *@variables.artifacts
 * Python-style iterable unpacking in function calls and list literals.
 */
export class SpreadExpression extends ExpressionBase {
  static readonly kind = 'SpreadExpression' as const;
  readonly __kind = SpreadExpression.kind;

  constructor(public expression: Expression) {
    super();
  }

  __describe(): string {
    return `spread *${this.expression.__describe()}`;
  }

  __emit(ctx: EmitContext): string {
    return `*${this.expression.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<SpreadExpression> {
    const exprNode = node.childForFieldName('expression');
    if (exprNode) {
      return withCst(new SpreadExpression(parseExpr(exprNode)), node);
    }
    const inner = withCst(new ErrorValue(''), node);
    inner.__diagnostics.push(
      createDiagnostic(
        node,
        'Spread operator `*` requires an expression to unpack',
        DiagnosticSeverity.Error,
        'spread-missing-expression'
      )
    );
    return withCst(new SpreadExpression(inner), node);
  }
}

export function createExpression<T extends Expression>(expr: T): AstNode<T> {
  return createNode(expr);
}

export function isMemberExpression(expr: unknown): expr is MemberExpression {
  return expr instanceof MemberExpression;
}

export function isAtIdentifier(expr: unknown): expr is AtIdentifier {
  return expr instanceof AtIdentifier;
}

export interface AtMemberDecomposition {
  namespace: string;
  property: string;
}

/**
 * Decompose a `namespace.property` member expression into its parts.
 * Matches `@namespace.property` (AtIdentifier) unconditionally.
 * Also matches bare `namespace.property` (Identifier) when the name
 * appears in the optional {@link knownNamespaces} set.
 */
export function decomposeMemberExpression(
  expr: unknown,
  knownNamespaces?: ReadonlySet<string>
): AtMemberDecomposition | null {
  if (!isMemberExpression(expr)) return null;
  if (!expr.property) return null;
  if (isAtIdentifier(expr.object)) {
    return { namespace: expr.object.name, property: expr.property };
  }
  if (
    knownNamespaces &&
    expr.object instanceof Identifier &&
    knownNamespaces.has(expr.object.name)
  ) {
    return { namespace: expr.object.name, property: expr.property };
  }
  return null;
}

/**
 * Decompose an `@namespace.property` expression into its parts.
 * Returns null if the expression is not a MemberExpression with an AtIdentifier object.
 */
export function decomposeAtMemberExpression(
  expr: unknown
): AtMemberDecomposition | null {
  return decomposeMemberExpression(expr);
}

/**
 * All expression classes -- single source of truth for kinds.
 * ExpressionKind and EXPRESSION_KINDS are derived automatically; user-facing
 * labels are declared separately in {@link KIND_LABELS} below.
 */
const ALL_EXPRESSION_CLASSES = [
  StringLiteral,
  TemplateExpression,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  TernaryExpression,
  CallExpression,
  ListLiteral,
  DictLiteral,
  Ellipsis,
  SpreadExpression,
] as const;

export type ExpressionKind = (typeof ALL_EXPRESSION_CLASSES)[number]['kind'];

export const EXPRESSION_KINDS: ReadonlySet<ExpressionKind> = new Set(
  ALL_EXPRESSION_CLASSES.map(C => C.kind)
);

/**
 * User-facing labels for each expression kind. Consumed by primitives.ts
 * when formatting type-mismatch errors (e.g., "Expected a number, got ...").
 */
export const KIND_LABELS: ReadonlyMap<ExpressionKind, string> = new Map([
  [StringLiteral.kind, 'a string'],
  [TemplateExpression.kind, 'a template'],
  [NumberLiteral.kind, 'a number'],
  [BooleanLiteral.kind, 'True or False'],
  [NoneLiteral.kind, 'None'],
  [Identifier.kind, 'an identifier'],
  [AtIdentifier.kind, 'a reference (e.g., @Foo)'],
  [MemberExpression.kind, 'a reference (e.g., @Foo.Bar)'],
  [SubscriptExpression.kind, 'a subscript expression'],
  [BinaryExpression.kind, 'a binary expression'],
  [UnaryExpression.kind, 'a unary expression'],
  [ComparisonExpression.kind, 'a comparison'],
  [TernaryExpression.kind, 'a ternary expression'],
  [CallExpression.kind, 'a function call'],
  [ListLiteral.kind, 'a list'],
  [DictLiteral.kind, 'a dictionary'],
  [Ellipsis.kind, 'an ellipsis (...)'],
  [SpreadExpression.kind, 'a spread expression'],
]);

const EXPRESSION_KIND_STRINGS: ReadonlySet<string> = EXPRESSION_KINDS;
export function isExpressionKind(kind: string): kind is ExpressionKind {
  return EXPRESSION_KIND_STRINGS.has(kind);
}

type ParseExprFn = (node: SyntaxNode) => Expression;

type ExpressionParser =
  | ((node: SyntaxNode) => Expression)
  | ((node: SyntaxNode, parseExpr: ParseExprFn) => Expression);

/**
 * Expression parser dispatch table.
 * Maps CST node types to their parser functions.
 */
export const expressionParsers = {
  string: (node: SyntaxNode) => StringLiteral.parse(node),
  template: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    TemplateExpression.parse(node, parseExpr),
  number: (node: SyntaxNode) => NumberLiteral.parse(node),
  True: (node: SyntaxNode) => BooleanLiteral.parse(node),
  False: (node: SyntaxNode) => BooleanLiteral.parse(node),
  None: (node: SyntaxNode) => NoneLiteral.parse(node),
  ellipsis: (node: SyntaxNode) => Ellipsis.parse(node),

  id: (node: SyntaxNode) => Identifier.parse(node),
  at_id: (node: SyntaxNode) => AtIdentifier.parse(node),

  member_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    MemberExpression.parse(node, parseExpr),
  subscript_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    SubscriptExpression.parse(node, parseExpr),
  binary_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    BinaryExpression.parse(node, parseExpr),
  unary_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    UnaryExpression.parse(node, parseExpr),
  comparison_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    ComparisonExpression.parse(node, parseExpr),
  ternary_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    TernaryExpression.parse(node, parseExpr),
  call_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    CallExpression.parse(node, parseExpr),
  list: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    ListLiteral.parse(node, parseExpr),
  dictionary: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    DictLiteral.parse(node, parseExpr),
  spread_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    SpreadExpression.parse(node, parseExpr),
} satisfies Record<string, ExpressionParser>;
