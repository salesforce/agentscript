/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { evalExpr, type EvalScope } from '../expr/eval.js';

const TEMPLATE_PREFIX = 'template::';

/**
 * Render a compiled-IR template string. The compiler emits two shapes:
 *
 *   "template::plain text {{state.x}} more text"
 *   "plain text {{state.x}} more text"
 *
 * The `template::` prefix exists to disambiguate template values from raw
 * expressions in state-update payloads. We strip it here and expand every
 * `{{ ... }}` placeholder by evaluating it against the scope.
 */
export function renderTemplate(src: string, scope: EvalScope): string {
  const body = src.startsWith(TEMPLATE_PREFIX)
    ? src.slice(TEMPLATE_PREFIX.length)
    : src;
  let out = '';
  let i = 0;
  const n = body.length;
  while (i < n) {
    const open = body.indexOf('{{', i);
    if (open === -1) {
      out += body.slice(i);
      break;
    }
    out += body.slice(i, open);
    const close = body.indexOf('}}', open + 2);
    if (close === -1) {
      // unterminated — treat remainder as literal
      out += body.slice(open);
      break;
    }
    const expr = body.slice(open + 2, close).trim();
    try {
      const v = evalExpr(expr, scope);
      out += formatValue(v);
    } catch {
      out += body.slice(open, close + 2);
    }
    i = close + 2;
  }
  return out;
}

export function isTemplate(src: unknown): boolean {
  return typeof src === 'string' && src.startsWith(TEMPLATE_PREFIX);
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
