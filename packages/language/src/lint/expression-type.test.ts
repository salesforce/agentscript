/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { inferExpressionType, inferredTypeLabel } from './expression-type.js';

describe('inferExpressionType', () => {
  it('returns "boolean" for BooleanLiteral', () => {
    expect(inferExpressionType({ __kind: 'BooleanLiteral' })).toBe('boolean');
  });

  it('returns "boolean" for ComparisonExpression', () => {
    expect(inferExpressionType({ __kind: 'ComparisonExpression' })).toBe(
      'boolean'
    );
  });

  it('returns "boolean" for and/or BinaryExpression', () => {
    expect(
      inferExpressionType({ __kind: 'BinaryExpression', operator: 'and' })
    ).toBe('boolean');
    expect(
      inferExpressionType({ __kind: 'BinaryExpression', operator: 'or' })
    ).toBe('boolean');
  });

  it('returns "number" for arithmetic BinaryExpression', () => {
    expect(
      inferExpressionType({ __kind: 'BinaryExpression', operator: '+' })
    ).toBe('number');
  });

  it('returns "boolean" for not UnaryExpression', () => {
    expect(
      inferExpressionType({ __kind: 'UnaryExpression', operator: 'not' })
    ).toBe('boolean');
  });

  it('returns "number" for arithmetic UnaryExpression', () => {
    expect(
      inferExpressionType({ __kind: 'UnaryExpression', operator: '-' })
    ).toBe('number');
  });

  it('returns "string" for StringLiteral and TemplateExpression', () => {
    expect(inferExpressionType({ __kind: 'StringLiteral' })).toBe('string');
    expect(inferExpressionType({ __kind: 'TemplateExpression' })).toBe(
      'string'
    );
  });

  it('returns "number" for NumberLiteral', () => {
    expect(inferExpressionType({ __kind: 'NumberLiteral' })).toBe('number');
  });

  it('returns null for None, list/dict literals, calls, ternaries', () => {
    expect(inferExpressionType({ __kind: 'NoneLiteral' })).toBeNull();
    expect(inferExpressionType({ __kind: 'ListLiteral' })).toBeNull();
    expect(inferExpressionType({ __kind: 'DictLiteral' })).toBeNull();
    expect(inferExpressionType({ __kind: 'CallExpression' })).toBeNull();
    expect(inferExpressionType({ __kind: 'TernaryExpression' })).toBeNull();
  });

  it('returns null for non-object input', () => {
    expect(inferExpressionType(null)).toBeNull();
    expect(inferExpressionType(undefined)).toBeNull();
    expect(inferExpressionType('string')).toBeNull();
    expect(inferExpressionType(42)).toBeNull();
  });

  it('returns null for member expression without resolver', () => {
    expect(inferExpressionType({ __kind: 'MemberExpression' })).toBeNull();
    expect(inferExpressionType({ __kind: 'AtIdentifier' })).toBeNull();
  });
});

describe('inferredTypeLabel', () => {
  it('returns "a string" for "string"', () => {
    expect(inferredTypeLabel('string')).toBe('a string');
  });

  it('returns "a number" for "number"', () => {
    expect(inferredTypeLabel('number')).toBe('a number');
  });

  it('returns "a boolean" for "boolean"', () => {
    // inferExpressionType can return 'boolean' (e.g. via variable resolver),
    // so inferredTypeLabel must format it consistently with the other primitives.
    expect(inferredTypeLabel('boolean')).toBe('a boolean');
  });

  it('quotes unknown dialect types verbatim', () => {
    expect(inferredTypeLabel('list[string]')).toBe("'list[string]'");
    expect(inferredTypeLabel('CustomType')).toBe("'CustomType'");
  });
});
