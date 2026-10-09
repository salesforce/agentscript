/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ExprNode } from './ast.js';
import { parseExpr } from './parser.js';

export interface EvalScope {
  /** Read a variable by its top-level name (e.g. "state", "result", "action"). */
  resolve(name: string): unknown;
}

const cache = new Map<string, ExprNode>();

function compileExpr(src: string): ExprNode {
  let node = cache.get(src);
  if (!node) {
    node = parseExpr(src);
    cache.set(src, node);
  }
  return node;
}

export function evalExpr(src: string, scope: EvalScope): unknown {
  return evalNode(compileExpr(src), scope);
}

function evalNode(node: ExprNode, scope: EvalScope): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value;
    case 'ref': {
      const [head, ...rest] = node.path;
      let v = scope.resolve(head);
      for (const key of rest) {
        if (v == null) return undefined;
        v = (v as Record<string, unknown>)[key];
      }
      return v;
    }
    case 'unary': {
      const a = evalNode(node.arg, scope);
      if (node.op === 'not') return !truthy(a);
      if (node.op === '-') return -(a as number);
      return undefined;
    }
    case 'binary':
      return evalBinary(node.op, node.left, node.right, scope);
    case 'call':
      // Reserved for future builtins; unused in v1.
      return undefined;
  }
}

function evalBinary(
  op: string,
  lN: ExprNode,
  rN: ExprNode,
  s: EvalScope
): unknown {
  // Short-circuit logical ops
  if (op === 'and') {
    const l = evalNode(lN, s);
    if (!truthy(l)) return l;
    return evalNode(rN, s);
  }
  if (op === 'or') {
    const l = evalNode(lN, s);
    if (truthy(l)) return l;
    return evalNode(rN, s);
  }
  const l = evalNode(lN, s);
  const r = evalNode(rN, s);
  switch (op) {
    case '==':
      return eq(l, r);
    case '!=':
      return !eq(l, r);
    case '<':
      return (l as number) < (r as number);
    case '<=':
      return (l as number) <= (r as number);
    case '>':
      return (l as number) > (r as number);
    case '>=':
      return (l as number) >= (r as number);
    case 'is':
      return l === r;
    case 'is not':
      return l !== r;
    case 'in':
      return Array.isArray(r)
        ? r.includes(l)
        : typeof r === 'string' && typeof l === 'string'
          ? r.includes(l)
          : false;
    case '+':
      if (typeof l === 'string' || typeof r === 'string')
        return String(l) + String(r);
      return (l as number) + (r as number);
    case '-':
      return (l as number) - (r as number);
    case '*':
      return (l as number) * (r as number);
    case '/':
      return (l as number) / (r as number);
    case '%':
      return (l as number) % (r as number);
  }
  return undefined;
}

function truthy(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function eq(a: unknown, b: unknown): boolean {
  // Loosely compare numbers/strings; strict for the rest. Avoids surprises
  // when the IR mixes numeric literals with numeric state vars.
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return a === b;
}
