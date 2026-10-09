/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExprNode, BinOp } from './ast.js';
import { tokenize, type Token } from './lexer.js';

/**
 * Pratt parser for the expression subset emitted by @agentscript/compiler:
 *   literals: number, string, True/False/None (and lowercase variants)
 *   refs:     foo, foo.bar.baz (no array indexing in v1)
 *   unary:    not, -
 *   binary:   or, and, ==, !=, <, <=, >, >=, is, is not, +, -, *, /, %
 *   grouping: ( expr )
 */
export function parseExpr(input: string): ExprNode {
  const tokens = tokenize(input);
  const p = new Parser(tokens);
  const expr = p.parseOr();
  if (p.peek().kind !== 'eof') {
    throw new Error(
      `Unexpected trailing token "${p.peek().value}" at ${p.peek().pos}`
    );
  }
  return expr;
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[]) {}

  peek(): Token {
    return this.tokens[this.i];
  }
  private next(): Token {
    return this.tokens[this.i++];
  }
  private eat(kind: string, value?: string): Token {
    const t = this.peek();
    if (t.kind !== kind || (value !== undefined && t.value !== value)) {
      throw new Error(
        `Expected ${value ?? kind} at ${t.pos}, got "${t.value}"`
      );
    }
    return this.next();
  }

  parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek().kind === 'op' && this.peek().value === 'or') {
      this.next();
      const right = this.parseAnd();
      left = { kind: 'binary', op: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.peek().kind === 'op' && this.peek().value === 'and') {
      this.next();
      const right = this.parseNot();
      left = { kind: 'binary', op: 'and', left, right };
    }
    return left;
  }

  private parseNot(): ExprNode {
    if (this.peek().kind === 'op' && this.peek().value === 'not') {
      this.next();
      return { kind: 'unary', op: 'not', arg: this.parseNot() };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    let left = this.parseAddSub();
    while (this.peek().kind === 'op' && isComparisonOp(this.peek().value)) {
      let op = this.next().value as string;
      // handle "is not"
      if (
        op === 'is' &&
        this.peek().kind === 'op' &&
        this.peek().value === 'not'
      ) {
        this.next();
        op = 'is not';
      }
      const right = this.parseAddSub();
      left = { kind: 'binary', op: op as BinOp, left, right };
    }
    return left;
  }

  private parseAddSub(): ExprNode {
    let left = this.parseMulDiv();
    while (
      this.peek().kind === 'op' &&
      (this.peek().value === '+' || this.peek().value === '-')
    ) {
      const op = this.next().value as BinOp;
      const right = this.parseMulDiv();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseMulDiv(): ExprNode {
    let left = this.parseUnary();
    while (this.peek().kind === 'op' && '*/%'.includes(this.peek().value)) {
      const op = this.next().value as BinOp;
      const right = this.parseUnary();
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  private parseUnary(): ExprNode {
    if (this.peek().kind === 'op' && this.peek().value === '-') {
      this.next();
      return { kind: 'unary', op: '-', arg: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): ExprNode {
    const t = this.peek();
    if (t.kind === 'number') {
      this.next();
      return { kind: 'literal', value: Number(t.value) };
    }
    if (t.kind === 'string') {
      this.next();
      return { kind: 'literal', value: t.value };
    }
    if (t.kind === 'lparen') {
      this.next();
      const e = this.parseOr();
      this.eat('rparen');
      return e;
    }
    if (t.kind === 'op') {
      if (t.value === 'True' || t.value === 'true') {
        this.next();
        return { kind: 'literal', value: true };
      }
      if (t.value === 'False' || t.value === 'false') {
        this.next();
        return { kind: 'literal', value: false };
      }
      if (t.value === 'None' || t.value === 'null') {
        this.next();
        return { kind: 'literal', value: null };
      }
    }
    if (t.kind === 'ident') {
      this.next();
      const path = [t.value];
      while (this.peek().kind === 'dot') {
        this.next();
        const next = this.eat('ident');
        path.push(next.value);
      }
      return { kind: 'ref', path };
    }
    throw new Error(`Unexpected token "${t.value}" at ${t.pos}`);
  }
}

function isComparisonOp(v: string): boolean {
  return (
    v === '==' ||
    v === '!=' ||
    v === '<' ||
    v === '<=' ||
    v === '>' ||
    v === '>=' ||
    v === 'is' ||
    v === 'in'
  );
}
