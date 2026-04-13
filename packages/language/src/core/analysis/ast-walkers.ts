/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Diagnostic } from '../diagnostics.js';
import type { AstNodeLike } from '../types.js';
import { isNamedMap, isAstNodeLike } from '../types.js';
import { isBlockChild } from '../children.js';
import { isExpressionKind } from '../expressions.js';
import { updateScopeContext } from './scope.js';
import type { ScopeContext } from './scope.js';

/**
 * Recurse into an AST node's children using the correct iteration strategy.
 *
 * For blocks/sequences, `__children` is the single source of truth —
 * all data (fields, values, statements, map entries, sequence items)
 * lives there. No fallback `Object.entries` loop is needed.
 *
 * For expressions/statements (no `__children`), falls back to
 * `Object.entries`, skipping `__`-prefixed metadata keys.
 */
export function recurseAstChildren(
  value: unknown,
  recurse: (key: string, child: unknown, parent: unknown) => void
): void {
  if (isNamedMap(value)) {
    for (const [k, v] of value) {
      recurse(k, v, value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      recurse('', item, value);
    }
    return;
  }

  if (!isAstNodeLike(value)) return;

  // __children is the single source of truth for blocks and sequences.
  const children = value.__children;
  if (Array.isArray(children)) {
    const yieldedKeys = new Set<string>();
    for (const item of children) {
      if (!isBlockChild(item)) continue;
      const child = item;
      switch (child.__type) {
        case 'field':
          if (child.entryName) {
            // Named entry: yield the NamedMap from the parent block once per key.
            // Consumers (scope, references, lint) expect NamedMap as an intermediate
            // node, not individual entries.
            if (!yieldedKeys.has(child.key)) {
              yieldedKeys.add(child.key);
              const map = value[child.key];
              if (map !== undefined) recurse(child.key, map, value);
            }
          } else {
            recurse(child.key, child.value, value);
          }
          break;
        case 'map_entry':
          recurse(child.name, child.value, value);
          break;
        case 'sequence_item':
          recurse('', child.value, value);
          break;
        case 'value':
          recurse('value', child.value, value);
          break;
        case 'statement':
          recurse('', child.value, value);
          break;
        case 'untyped':
          // UntypedBlock: walk into its __children for downstream analysis
          recurse(child.key, child, value);
          break;
        case 'error':
          // ErrorBlock has no AST children to walk — skip
          break;
        default: {
          const _exhaustive: never = child;
          void _exhaustive;
        }
      }
    }
    return;
  }

  // Fallback for expressions, statements, etc. (no __children)
  for (const [k, val] of Object.entries(value)) {
    if (k.startsWith('__')) continue;
    recurse(k, val, value);
  }
}

/**
 * Enumerate the child expressions of a compound expression node.
 * Used by both the lint engine and reference resolution.
 */
export function forEachExpressionChild(
  obj: AstNodeLike,
  callback: (child: unknown, key: string, parent: AstNodeLike) => void
): void {
  const kind = obj.__kind;

  switch (kind) {
    case 'MemberExpression':
      callback(obj.object, 'object', obj);
      break;
    case 'SubscriptExpression':
      callback(obj.object, 'object', obj);
      callback(obj.index, 'index', obj);
      break;
    case 'BinaryExpression':
    case 'ComparisonExpression':
      callback(obj.left, 'left', obj);
      callback(obj.right, 'right', obj);
      break;
    case 'UnaryExpression':
      callback(obj.operand, 'operand', obj);
      break;
    case 'ListLiteral': {
      const elements = obj.elements;
      if (Array.isArray(elements)) {
        for (const el of elements) {
          callback(el, '', obj);
        }
      }
      break;
    }
    case 'DictLiteral': {
      const entries = obj.entries;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          if (isAstNodeLike(entry)) {
            callback(entry.key, 'key', entry);
            callback(entry.value, 'value', entry);
          }
        }
      }
      break;
    }
    case 'TernaryExpression':
      callback(obj.consequence, 'consequence', obj);
      callback(obj.condition, 'condition', obj);
      callback(obj.alternative, 'alternative', obj);
      break;
    case 'CallExpression':
      callback(obj.func, 'func', obj);
      if (Array.isArray(obj.args)) {
        for (const arg of obj.args as unknown[]) {
          callback(arg, '', obj);
        }
      }
      break;
    case 'TemplateExpression': {
      const parts = obj.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (isAstNodeLike(part) && part.__kind === 'TemplateInterpolation') {
            callback(part.expression, 'expression', part);
          }
        }
      }
      break;
    }
  }
}

/**
 * Shared dispatch logic for AST children traversal.
 *
 * Composes scope-update, expression-check, and recurse into a single
 * pattern used by walkAstExpressions and LintEngine.walkNode.
 */
export function dispatchAstChildren(
  value: unknown,
  ctx: ScopeContext,
  onExpression: ((obj: AstNodeLike, ctx: ScopeContext) => void) | null,
  recurse: (
    child: unknown,
    ctx: ScopeContext,
    key: string,
    parent: unknown
  ) => void
): ScopeContext {
  // Arrays are not AstNodeLike but may contain AST children (e.g. statements).
  // Recurse through their items using the caller's context.
  if (Array.isArray(value)) {
    for (const item of value) {
      recurse(item, ctx, '', value);
    }
    return ctx;
  }

  if (!isAstNodeLike(value)) return ctx;

  const newCtx = updateScopeContext(value, ctx);

  if (value.__kind && isExpressionKind(value.__kind)) {
    onExpression?.(value, newCtx);
    forEachExpressionChild(value, (child, childKey, childParent) => {
      recurse(child, newCtx, childKey, childParent);
    });
  } else {
    recurseAstChildren(value, (k, v, p) => {
      recurse(v, newCtx, k, p);
    });
  }

  return newCtx;
}

/** Walk the entire AST visiting every expression node with scope context. */
export function walkAstExpressions(
  value: unknown,
  callback: (expr: AstNodeLike, ctx: ScopeContext) => void,
  ctx: ScopeContext = {},
  visited: Set<unknown> = new Set()
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  dispatchAstChildren(value, ctx, callback, (child, newCtx) => {
    walkAstExpressions(child, callback, newCtx, visited);
  });
}

/** Walk the AST collecting all __diagnostics into a flat array. */
export function collectDiagnostics(value: unknown): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  collectDiagnosticsInner(value, diagnostics, new Set());
  return diagnostics;
}

function collectDiagnosticsInner(
  value: unknown,
  diagnostics: Diagnostic[],
  visited: Set<unknown>
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (isAstNodeLike(value)) {
    const nodeDiags = value.__diagnostics;
    if (Array.isArray(nodeDiags)) {
      for (const diag of nodeDiags) {
        diagnostics.push(diag);
      }
    }
  }

  recurseAstChildren(value, (_key, child) => {
    collectDiagnosticsInner(child, diagnostics, visited);
  });
}
