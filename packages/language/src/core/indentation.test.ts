/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  increaseIndentPattern,
  decreaseIndentPattern,
  onEnterRules,
} from './indentation.js';

describe('increaseIndentPattern', () => {
  const re = new RegExp(increaseIndentPattern);

  const shouldMatch = [
    'agent:',
    '  actions:',
    'if x > 5:',
    'else:',
    'elif y < 3:',
    '  - ActionName:',
    'instructions: ->',
    '  reasoning: ->',
    'key: # trailing comment',
    'key: -> # trailing comment',
    '    nested_key:',
  ];

  const shouldNotMatch = [
    'agent_name: "HelloWorldBot"',
    '# comment:',
    '# comment with colon: value',
    '| template text',
    'plain value',
    '',
    '  ',
    'description: "has: colon inside"',
  ];

  for (const line of shouldMatch) {
    it(`should match: "${line}"`, () => {
      expect(re.test(line)).toBe(true);
    });
  }

  for (const line of shouldNotMatch) {
    it(`should NOT match: "${line}"`, () => {
      expect(re.test(line)).toBe(false);
    });
  }
});

describe('decreaseIndentPattern', () => {
  const re = new RegExp(decreaseIndentPattern);

  it('should not match normal lines', () => {
    expect(re.test('agent:')).toBe(false);
    expect(re.test('  field: value')).toBe(false);
    expect(re.test('')).toBe(false);
    expect(re.test('  ')).toBe(false);
  });
});

describe('onEnterRules', () => {
  it('has a rule for lines ending with colon', () => {
    const colonRule = onEnterRules.find(
      r => r.action === 'indent' && new RegExp(r.beforeText).test('agent:')
    );
    expect(colonRule).toBeDefined();
  });

  it('has a rule for lines ending with arrow', () => {
    const arrowRule = onEnterRules.find(
      r =>
        r.action === 'indent' &&
        new RegExp(r.beforeText).test('instructions: ->')
    );
    expect(arrowRule).toBeDefined();
  });

  describe('colon rule', () => {
    const rule = onEnterRules.find(r =>
      new RegExp(r.beforeText).test('agent:')
    )!;
    const re = new RegExp(rule.beforeText);

    it('matches mapping keys', () => {
      expect(re.test('agent:')).toBe(true);
      expect(re.test('  actions:')).toBe(true);
      expect(re.test('else:')).toBe(true);
      expect(re.test('if condition:')).toBe(true);
    });

    it('matches with trailing comment', () => {
      expect(re.test('agent: # comment')).toBe(true);
    });

    it('does not match inline values', () => {
      expect(re.test('name: "value"')).toBe(false);
      expect(re.test('count: 42')).toBe(false);
    });

    it('does not match comment-only lines', () => {
      expect(re.test('# comment:')).toBe(false);
    });
  });

  describe('arrow rule', () => {
    const rule = onEnterRules.find(r =>
      new RegExp(r.beforeText).test('instructions: ->')
    )!;
    const re = new RegExp(rule.beforeText);

    it('matches arrow syntax', () => {
      expect(re.test('instructions: ->')).toBe(true);
      expect(re.test('  reasoning: ->')).toBe(true);
    });

    it('matches with trailing comment', () => {
      expect(re.test('instructions: -> # comment')).toBe(true);
    });

    it('does not match comment-only lines', () => {
      expect(re.test('# ->')).toBe(false);
    });
  });
});
