/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { unwrapPrimitiveLiteral } from './expressions.js';

describe('unwrapPrimitiveLiteral hydration contract', () => {
  it.each([
    ['boolean false', false],
    ['boolean true', true],
    ['empty string', ''],
    ['non-empty string', 'sessionID'],
    ['number zero', 0],
    ['non-zero number', 42],
  ])('preserves native %s', (_name, value) => {
    expect(unwrapPrimitiveLiteral(value)).toBe(value);
  });

  it.each([
    ['boolean false', { __kind: 'BooleanLiteral', value: false }, false],
    ['boolean true', { __kind: 'BooleanLiteral', value: true }, true],
    ['empty string', { __kind: 'StringLiteral', value: '' }, ''],
    [
      'non-empty string',
      { __kind: 'StringLiteral', value: 'sessionID' },
      'sessionID',
    ],
    ['number zero', { __kind: 'NumberLiteral', value: 0 }, 0],
    ['non-zero number', { __kind: 'NumberLiteral', value: 42 }, 42],
  ])('unwraps serialized %s', (_name, literal, expected) => {
    expect(unwrapPrimitiveLiteral(literal)).toBe(expected);
  });

  it.each([
    { __kind: 'BooleanLiteral', value: 'false' },
    { __kind: 'StringLiteral', value: 42 },
    { __kind: 'NumberLiteral', value: true },
    { __kind: 'UnknownLiteral', value: false },
    null,
    undefined,
  ])('rejects invalid or unsupported input %#', input => {
    expect(unwrapPrimitiveLiteral(input)).toBeUndefined();
  });
});
