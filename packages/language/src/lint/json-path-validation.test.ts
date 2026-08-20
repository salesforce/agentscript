/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import type { CstMeta, Range } from '../core/types.js';
import { DiagnosticSeverity } from '../core/diagnostics.js';
import { Identifier, StringLiteral } from '../core/expressions.js';
import {
  checkJsonPathSelector,
  validateJsonPathCall,
} from './json-path-validation.js';

const range: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 10 },
};

function literalWithRange(value: string): StringLiteral {
  const literal = new StringLiteral(value);
  literal.__cst = { range } as unknown as CstMeta;
  return literal;
}

describe('checkJsonPathSelector', () => {
  it.each([
    '$',
    '$.items[0].name',
    '$["a]b"]',
    String.raw`$["a\"b"]`,
    String.raw`$['a\'b']`,
    String.raw`$["a\\"]`,
    '$.*',
    '$[0:10:2]',
    '$[?(@.price < 10)]',
    '$..book[*]',
    '$[?(unfamiliar(@.value))]',
  ])('accepts structurally valid selector %s', selector => {
    expect(checkJsonPathSelector(selector)).toBe(true);
  });

  it.each([
    '',
    'items[0]',
    '$foo',
    '$$',
    '$.items[',
    '$.items]',
    '$[]',
    '$[ \t ]',
    '$.items.',
    '$.items..',
    '$["unterminated]',
    String.raw`$["escaped\"]`,
  ])('rejects structurally malformed selector %s', selector => {
    expect(checkJsonPathSelector(selector)).toBe(false);
  });
});

describe('validateJsonPathCall', () => {
  it('returns one error for a malformed literal selector', () => {
    const findings = validateJsonPathCall([
      new Identifier('value'),
      literalWithRange('$foo'),
    ]);

    expect(findings).toEqual([
      expect.objectContaining({
        range,
        severity: DiagnosticSeverity.Error,
        code: 'invalid-jsonpath',
      }),
    ]);
    expect(findings[0]?.message).toContain('structurally malformed');
  });

  it('returns no finding for a valid literal selector', () => {
    expect(
      validateJsonPathCall([
        new Identifier('value'),
        literalWithRange('$.items[0].name'),
      ])
    ).toEqual([]);
  });

  it('returns no finding for a dynamic selector', () => {
    expect(
      validateJsonPathCall([
        new Identifier('value'),
        new Identifier('selector'),
      ])
    ).toEqual([]);
  });
});
