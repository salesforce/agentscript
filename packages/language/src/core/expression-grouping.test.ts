/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Grouping parentheses must survive parse -> emit, and expressions built
 * without source info must be parenthesized wherever precedence requires.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from './dialect.js';
import type { SyntaxNode } from './types.js';
import {
  BinaryExpression,
  CallExpression,
  ComparisonExpression,
  Identifier,
  MemberExpression,
  NumberLiteral,
  SpreadExpression,
  SubscriptExpression,
  TernaryExpression,
  UnaryExpression,
} from './expressions.js';
import type { Expression } from './expressions.js';

function findNode(node: SyntaxNode, type: string): SyntaxNode | undefined {
  if (node.type === type) return node;
  for (const child of node.namedChildren) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

function parseExpr(source: string): Expression {
  const { rootNode } = parse(`key: ${source}`);
  const element = findNode(rootNode, 'mapping_element');
  const valueNode =
    element?.childForFieldName('colinear_value') ??
    element?.childForFieldName('expression');
  if (!valueNode) throw new Error(`No value node for: ${source}`);
  return new Dialect().parseExpression(valueNode);
}

function emit(expr: Expression): string {
  return expr.__emit({ indent: 0 });
}

const num = (n: number) => new NumberLiteral(n);
const id = (name: string) => new Identifier(name);

describe('parse -> emit preserves grouping', () => {
  it.each([
    '(1 + 2) * (3 + 4)',
    '(True or False) and (False or False)',
    'not (True and False)',
    '@variables.a and not (@variables.b or @variables.c)',
    '-(1 + 2)',
    '(True or False) == False',
    'not (@variables.a == 1)',
    '1 - (2 - 3)',
    '(1 - 2) - 3',
    '(a and b) or c',
    '(a if b else c) if d else e',
    'a if (b if c else d) else e',
    'a if b else (c if d else e)',
    '(a + b).c',
    '(a or b)[0]',
    '(a or b)(x)',
    'f((a or b), (c + d))',
    '[(a or b), (1 + 2)]',
    '*(a or b)',
    '(a == b) == c',
    '(@variables.a or @variables.b) and @variables.c',
  ])('keeps %s unchanged', source => {
    expect(emit(parseExpr(source))).toBe(source);
  });

  it('drops redundant parentheses around atoms', () => {
    expect(emit(parseExpr('(a)'))).toBe('a');
  });

  it('collapses doubled parentheses to one pair', () => {
    expect(emit(parseExpr('((a + b)) * c'))).toBe('(a + b) * c');
  });

  it.each([
    '1 + 2 * 3',
    'a or b and c',
    'a and not b',
    'not a == 1',
    'a == 1 and b != 2',
    '1 - 2 - 3',
    'a if b else c',
    'a + -b',
    'a == not b',
    'a.b[0](c)',
  ])('adds no parentheses to %s', source => {
    expect(emit(parseExpr(source))).toBe(source);
  });

  it('is idempotent', () => {
    for (const source of [
      '(1 + 2) * (3 + 4)',
      'not (a and b) or (c)',
      '-(1 + 2) - (3 - 4)',
      '(a if b else c) if d else e',
    ]) {
      const once = emit(parseExpr(source));
      expect(emit(parseExpr(once))).toBe(once);
    }
  });
});

describe('programmatic expressions get parentheses from precedence', () => {
  it('wraps a lower-precedence left operand', () => {
    const expr = new BinaryExpression(
      new BinaryExpression(id('a'), '+', id('b')),
      '*',
      id('c')
    );
    expect(emit(expr)).toBe('(a + b) * c');
  });

  it('wraps equal precedence on the right of a left-associative operator', () => {
    const rightNested = new BinaryExpression(
      num(1),
      '-',
      new BinaryExpression(num(2), '-', num(3))
    );
    const leftNested = new BinaryExpression(
      new BinaryExpression(num(1), '-', num(2)),
      '-',
      num(3)
    );
    expect(emit(rightNested)).toBe('1 - (2 - 3)');
    expect(emit(leftNested)).toBe('1 - 2 - 3');
  });

  it('wraps lower-precedence operands of unary operators', () => {
    const notAnd = new UnaryExpression(
      'not',
      new BinaryExpression(id('a'), 'and', id('b'))
    );
    const negSum = new UnaryExpression(
      '-',
      new BinaryExpression(num(1), '+', num(2))
    );
    const notEq = new UnaryExpression(
      'not',
      new ComparisonExpression(id('a'), '==', num(1))
    );
    expect(emit(notAnd)).toBe('not (a and b)');
    expect(emit(negSum)).toBe('-(1 + 2)');
    // `not` binds looser than `==`, so no parentheses are needed.
    expect(emit(notEq)).toBe('not a == 1');
  });

  it('wraps looser operands of comparisons', () => {
    const orLeft = new ComparisonExpression(
      new BinaryExpression(id('a'), 'or', id('b')),
      '==',
      new UnaryExpression('not', id('c'))
    );
    const notLeft = new ComparisonExpression(
      new UnaryExpression('not', id('a')),
      '==',
      id('b')
    );
    expect(emit(orLeft)).toBe('(a or b) == not c');
    expect(emit(notLeft)).toBe('(not a) == b');
  });

  it('wraps ternaries nested as consequence, condition, or operand', () => {
    const t = () => new TernaryExpression(id('a'), id('b'), id('c'));
    expect(emit(new TernaryExpression(t(), id('d'), id('e')))).toBe(
      '(a if b else c) if d else e'
    );
    expect(emit(new TernaryExpression(id('d'), t(), id('e')))).toBe(
      'd if (a if b else c) else e'
    );
    expect(emit(new TernaryExpression(id('d'), id('e'), t()))).toBe(
      'd if e else a if b else c'
    );
    expect(emit(new BinaryExpression(t(), '+', num(1)))).toBe(
      '(a if b else c) + 1'
    );
  });

  it('wraps compound objects of member, subscript, call, and spread', () => {
    const sum = () => new BinaryExpression(id('a'), '+', id('b'));
    expect(emit(new MemberExpression(sum(), 'c'))).toBe('(a + b).c');
    expect(emit(new SubscriptExpression(sum(), num(0)))).toBe('(a + b)[0]');
    expect(emit(new CallExpression(sum(), [num(1)]))).toBe('(a + b)(1)');
    expect(emit(new SpreadExpression(sum()))).toBe('*(a + b)');
  });

  it('does not double-wrap expressions that carry source grouping', () => {
    const inner = new BinaryExpression(id('a'), '+', id('b'));
    inner.__parenthesized = true;
    expect(emit(new BinaryExpression(inner, '*', id('c')))).toBe('(a + b) * c');
  });
});

/** Structural rendering that ignores parenthesization flags. */
function shape(expr: Expression): string {
  if (expr instanceof BinaryExpression || expr instanceof ComparisonExpression)
    return `[${shape(expr.left)} ${expr.operator} ${shape(expr.right)}]`;
  if (expr instanceof UnaryExpression)
    return `[${expr.operator} ${shape(expr.operand)}]`;
  if (expr instanceof TernaryExpression)
    return `[${shape(expr.consequence)} if ${shape(expr.condition)} else ${shape(expr.alternative)}]`;
  if (expr instanceof MemberExpression)
    return `${shape(expr.object)}.${expr.property}`;
  if (expr instanceof CallExpression)
    return `${shape(expr.func)}(${expr.args.map(shape).join(',')})`;
  return emit(expr);
}

describe('prefix operators that would absorb a following operator', () => {
  const not = (e: Expression) => new UnaryExpression('not', e);
  const neg = (e: Expression) => new UnaryExpression('-', e);

  it.each<[string, () => Expression, string]>([
    [
      '(a * (not b)) + c',
      () =>
        new BinaryExpression(
          new BinaryExpression(id('a'), '*', not(id('b'))),
          '+',
          id('c')
        ),
      '(a * not b) + c',
    ],
    [
      '(a == (not b)) == c',
      () =>
        new ComparisonExpression(
          new ComparisonExpression(id('a'), '==', not(id('b'))),
          '==',
          id('c')
        ),
      '(a == not b) == c',
    ],
    [
      '(a + (not b)) == c',
      () =>
        new ComparisonExpression(
          new BinaryExpression(id('a'), '+', not(id('b'))),
          '==',
          id('c')
        ),
      '(a + not b) == c',
    ],
    [
      '(-(not b)) + c',
      () => new BinaryExpression(neg(not(id('b'))), '+', id('c')),
      '(-not b) + c',
    ],
    [
      'x is (not y)',
      () => new ComparisonExpression(id('x'), 'is', not(id('y'))),
      'x is (not y)',
    ],
  ])('groups %s', (_name, build, expected) => {
    const expr = build();
    const text = emit(expr);
    expect(text).toBe(expected);
    expect(shape(parseExpr(text))).toBe(shape(expr));
  });

  it.each<[string, () => Expression]>([
    [
      'a and not b or c',
      () =>
        new BinaryExpression(
          new BinaryExpression(id('a'), 'and', not(id('b'))),
          'or',
          id('c')
        ),
    ],
    ['a == not b', () => new ComparisonExpression(id('a'), '==', not(id('b')))],
    [
      'a * -b + c',
      () =>
        new BinaryExpression(
          new BinaryExpression(id('a'), '*', neg(id('b'))),
          '+',
          id('c')
        ),
    ],
  ])('leaves %s ungrouped', (source, build) => {
    const expr = build();
    expect(emit(expr)).toBe(source);
    expect(shape(parseExpr(source))).toBe(shape(expr));
  });
});

describe('emit -> parse round-trips randomly built expressions', () => {
  // Deterministic LCG so failures reproduce.
  let seed = 12345;
  const rnd = (n: number): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 1;
    return seed % n;
  };
  const pick = <T>(items: readonly T[]): T => items[rnd(items.length)];

  const binaryOps = ['+', '-', '*', '/', 'and', 'or'] as const;
  const comparisonOps = ['==', '!=', '<', 'is', 'is not'] as const;
  const unaryOps = ['not', '-', '+'] as const;

  let leaf = 0;
  function gen(depth: number): Expression {
    if (depth === 0 || rnd(5) === 0) return id(`v${leaf++ % 5}`);
    const sub = () => gen(depth - 1);
    switch (rnd(6)) {
      case 0:
      case 1:
        return new BinaryExpression(sub(), pick(binaryOps), sub());
      case 2:
        return new ComparisonExpression(sub(), pick(comparisonOps), sub());
      case 3:
        return new UnaryExpression(pick(unaryOps), sub());
      case 4:
        return new TernaryExpression(sub(), sub(), sub());
      default:
        return rnd(2)
          ? new MemberExpression(sub(), 'p')
          : new CallExpression(sub(), [sub()]);
    }
  }

  it('re-parses every emitted tree to the same shape', () => {
    const mismatches: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const expr = gen(4);
      const text = emit(expr);
      let actual: string;
      try {
        actual = shape(parseExpr(text));
      } catch (error) {
        actual = `threw: ${String(error)}`;
      }
      if (actual !== shape(expr)) {
        mismatches.push(`${text}\n  want ${shape(expr)}\n  got  ${actual}`);
      }
    }
    expect(mismatches.slice(0, 3)).toEqual([]);
  });
});
