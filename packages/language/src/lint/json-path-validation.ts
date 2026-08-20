/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { DiagnosticSeverity } from '../core/diagnostics.js';
import { StringLiteral } from '../core/expressions.js';
import type { Expression } from '../core/expressions.js';
import type { CatalogFinding } from './function-catalog.js';

/**
 * Validate a `json_path(obj, path, default?)` call. The arity (2–3 args) is
 * already enforced generically by the catalog before this runs. Only literal
 * selectors with source ranges can be checked statically.
 */
export function validateJsonPathCall(
  args: readonly Expression[]
): CatalogFinding[] {
  const selectorArg = args[1];
  if (!(selectorArg instanceof StringLiteral) || !selectorArg.__cst?.range) {
    return [];
  }

  if (checkJsonPathSelector(selectorArg.value)) {
    return [];
  }

  return [
    {
      range: selectorArg.__cst.range,
      message: `'${selectorArg.value}' is a structurally malformed JSONPath selector. Selectors must follow necessary structural rules such as a '$' root, balanced brackets and quotes, and non-empty bracket contents.`,
      severity: DiagnosticSeverity.Error,
      code: 'invalid-jsonpath',
    },
  ];
}

/**
 * Check only the necessary structure shared by JSONPath selector forms. This
 * deliberately leaves runtime syntax and semantics to the runtime.
 *
 * Rules:
 * 1. Non-empty, rooted at `$`, and followed only by `.` or `[` when non-root.
 * 2. Balanced brackets and escape-aware single/double quotes.
 * 3. No empty bracket pairs or trailing dot/recursive-dot.
 */
export function checkJsonPathSelector(selector: string): boolean {
  if (selector.length === 0 || selector[0] !== '$') {
    return false;
  }
  if (selector.length > 1 && selector[1] !== '.' && selector[1] !== '[') {
    return false;
  }

  let quote: '"' | "'" | null = null;
  const openingBrackets: number[] = [];

  for (let i = 1; i < selector.length; i++) {
    const ch = selector[i];
    if (quote) {
      if (ch === quote) {
        let precedingBackslashes = 0;
        for (let j = i - 1; j >= 0 && selector[j] === '\\'; j--) {
          precedingBackslashes++;
        }
        if (precedingBackslashes % 2 === 0) {
          quote = null;
        }
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[') {
      openingBrackets.push(i);
    } else if (ch === ']') {
      const openingBracket = openingBrackets.pop();
      if (openingBracket === undefined) {
        return false;
      }
      if (selector.slice(openingBracket + 1, i).trim().length === 0) {
        return false;
      }
    }
  }

  if (quote !== null || openingBrackets.length > 0) {
    return false;
  }

  if (/\.\.?$/.test(selector)) {
    return false;
  }

  return true;
}
