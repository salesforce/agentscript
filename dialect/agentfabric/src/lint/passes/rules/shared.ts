/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  attachDiagnostic,
  BinaryExpression,
  BooleanLiteral,
  CallExpression,
  ComparisonExpression,
  decomposeAtMemberExpression,
  TernaryExpression,
  UnaryExpression,
} from '@agentscript/language';
import { normalizeId } from '../../utils.js';

const AGENTFABRIC_LINT_SOURCE = 'agentfabric-lint';
const ERROR_SEVERITY = 1;

interface ExpressionLike {
  __kind?: string;
  operator?: string;
}

interface StatementLike {
  __kind?: string;
  clauses?: unknown;
}

interface ProcedureLike {
  statements?: unknown;
}

interface CstLike {
  range?: unknown;
}

export interface AstLike {
  __diagnostics?: unknown;
  __cst?: CstLike;
}

export function attachError(
  node: AstLike,
  message: string,
  code: string
): void {
  if (!Array.isArray(node.__diagnostics)) return;
  const range =
    node.__cst && node.__cst.range
      ? node.__cst.range
      : {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        };
  attachDiagnostic(node as never, {
    range: range as never,
    message,
    severity: ERROR_SEVERITY,
    code,
    source: AGENTFABRIC_LINT_SOURCE,
  });
}

export function asStatements(value: unknown): StatementLike[] {
  if (value == null || typeof value !== 'object') return [];
  const proc = value as ProcedureLike;
  if (!Array.isArray(proc.statements)) return [];
  return proc.statements.filter(
    (stmt): stmt is StatementLike => stmt != null && typeof stmt === 'object'
  );
}

export function collectStatementKinds(procedure: unknown): string[] {
  return asStatements(procedure)
    .map(stmt => stmt.__kind)
    .filter((kind): kind is string => typeof kind === 'string');
}

export function hasSingleFixedTransition(procedure: unknown): boolean {
  const statements = asStatements(procedure);
  if (statements.length !== 1) return false;
  const stmt = statements[0];
  if (stmt.__kind !== 'TransitionStatement') return false;
  if (!Array.isArray(stmt.clauses) || stmt.clauses.length !== 1) return false;
  const clause = stmt.clauses[0] as StatementLike | undefined;
  return clause?.__kind === 'ToClause';
}

export function extractStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value == null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.value === 'string') return record.value;
  if (typeof record.text === 'string') return record.text;
  return undefined;
}

export function isNonEmptyString(value: unknown): boolean {
  const s = extractStringValue(value);
  return s !== undefined && s.trim().length > 0;
}

export function extractWhenString(value: unknown): string | undefined {
  const direct = extractStringValue(value);
  if (direct !== undefined && direct.trim().length > 0) return direct;
  if (value && typeof value === 'object') return '__expr__';
  return undefined;
}

export function schemaFieldKeys(entry: Record<string, unknown>): string[] {
  return Object.keys(entry).filter(k => !k.startsWith('__'));
}

export function hasOwnNonNull(
  obj: Record<string, unknown>,
  key: string
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(obj, key) &&
    obj[key] !== undefined &&
    obj[key] !== null
  );
}

const SWITCH_TARGET_NAMESPACES = new Set([
  'orchestrator',
  'subagent',
  'generator',
  'executor',
  'router',
  'echo',
]);

export function extractSwitchTarget(value: unknown): string | undefined {
  const candidates: unknown[] = [value];
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec.value !== undefined) candidates.push(rec.value);
  }
  for (const candidate of candidates) {
    const ref = decomposeAtMemberExpression(candidate);
    if (ref && SWITCH_TARGET_NAMESPACES.has(ref.namespace)) {
      return normalizeId(ref.property);
    }
    const s = extractStringValue(candidate);
    if (!s) continue;
    const m = s.match(/^@(\w+)\.([\w-]+)$/);
    if (!m) continue;
    if (!SWITCH_TARGET_NAMESPACES.has(m[1])) continue;
    return normalizeId(m[2]);
  }
  return undefined;
}

export function asObjectList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is Record<string, unknown> => v != null && typeof v === 'object'
    );
  }
  if (value && typeof value === 'object' && Symbol.iterator in value) {
    const out: Record<string, unknown>[] = [];
    for (const item of value as Iterable<unknown>) {
      const candidate =
        Array.isArray(item) && item.length === 2 ? item[1] : item;
      if (candidate && typeof candidate === 'object') {
        out.push(candidate as Record<string, unknown>);
      }
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (Array.isArray(rec.items)) {
      return rec.items.filter(
        (v): v is Record<string, unknown> => v != null && typeof v === 'object'
      );
    }
  }
  return [];
}

export function configHasDefaultLlm(root: Record<string, unknown>): boolean {
  const config = root.config;
  if (config == null || typeof config !== 'object') return false;
  return hasOwnNonNull(config as Record<string, unknown>, 'default_llm');
}

export function isBooleanLikeExpression(
  value: unknown
): value is
  | ComparisonExpression
  | BooleanLiteral
  | CallExpression
  | TernaryExpression
  | BinaryExpression
  | UnaryExpression {
  if (value == null || typeof value !== 'object') return false;
  const expr = value as ExpressionLike;
  const kind = expr.__kind;
  if (typeof kind !== 'string') return false;

  switch (kind) {
    case ComparisonExpression.kind:
    case BooleanLiteral.kind:
    case CallExpression.kind:
    case TernaryExpression.kind:
      return true;
    case BinaryExpression.kind:
      return expr.operator === 'and' || expr.operator === 'or';
    case UnaryExpression.kind:
      return expr.operator === 'not';
    default:
      return false;
  }
}
