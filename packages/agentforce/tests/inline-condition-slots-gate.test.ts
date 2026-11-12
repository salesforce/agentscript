/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSource, INLINE_CONDITION_SLOTS_GATE } from '../src/index.js';

// The compiler's 4b fixture: its expected output is compiled with
// `inlineConditionSlots: true`.
const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../compiler/test/fixtures'
);
const SOURCE = readFileSync(
  join(FIXTURES, 'scripts/inline_condition_slots_basic.agent'),
  'utf8'
);

function expected(keyCase: 'snake' | 'camel'): unknown {
  return JSON.parse(
    readFileSync(
      join(FIXTURES, `expected/inline_condition_slots_basic.${keyCase}.json`),
      'utf8'
    )
  );
}

function compiled(gates?: Record<string, boolean>, camelCase = false) {
  const result = compileSource(SOURCE, { gates, camelCase });
  return {
    output: JSON.parse(JSON.stringify(result.output)) as unknown,
    inlineConditionSlots: result.inlineConditionSlots,
  };
}

const OPEN = { [INLINE_CONDITION_SLOTS_GATE]: true };

describe('INLINE_CONDITION_SLOTS_GATE', () => {
  test('inlines condition slots when the gate is open', () => {
    expect(compiled(OPEN)).toEqual({
      output: expected('snake'),
      inlineConditionSlots: true,
    });
    expect(compiled(OPEN, true)).toEqual({
      output: expected('camel'),
      inlineConditionSlots: true,
    });
  });

  test('keeps condition slots when the gate is closed or absent', () => {
    const closed = compiled({ [INLINE_CONDITION_SLOTS_GATE]: false });
    expect(closed.inlineConditionSlots).toBe(false);
    expect(closed.output).not.toEqual(expected('snake'));
    expect(compiled()).toEqual(closed);
    expect(compiled({ 'com.example.other': true })).toEqual(closed);
  });
});
