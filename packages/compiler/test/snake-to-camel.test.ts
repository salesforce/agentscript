/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import * as z from 'zod';
import type { Range } from '@agentscript/types';
import { byoClientConfig } from '../src/generated/agent-dsl.js';
import { snakeKeysToCamel } from '../src/snake-to-camel.js';

const PROTOTYPE_KEYS = [
  'constructor',
  'toString',
  'hasOwnProperty',
  '__proto__',
];
const RANGE: Range = {
  start: { line: 2, character: 4 },
  end: { line: 2, character: 20 },
};
const CLIENT_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 24 },
};
const FIELD_RANGE: Range = {
  start: { line: 3, character: 8 },
  end: { line: 3, character: 28 },
};

describe('snakeKeysToCamel', () => {
  describe.each(PROTOTYPE_KEYS)('record key %s', key => {
    test.each([
      ['object', { customer_name: 'Ada' }],
      ['array', [{ customer_name: 'Ada' }]],
      ['scalar', 'Ada'],
    ])('preserves generated-schema record data (%s)', (_kind, recordValue) => {
      // Computed keys create an own __proto__ data property.
      const configuration = { [key]: recordValue };
      const input = { client_ref: 'my_client', configuration };
      const before = JSON.stringify(input);
      const ranges = new WeakMap<object, Map<string, Range>>([
        [input, new Map([['client_ref', CLIENT_RANGE]])],
        [configuration, new Map([[key, RANGE]])],
      ]);

      const result = snakeKeysToCamel(input, ranges, byoClientConfig);
      const output = result.value as {
        clientRef: string;
        configuration: Record<string, unknown>;
      };

      expect(output).toEqual({ clientRef: 'my_client', configuration });
      expect(Object.hasOwn(output.configuration, key)).toBe(true);
      expect(
        Object.getOwnPropertyDescriptor(output.configuration, key)
      ).toEqual({
        value: recordValue,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      expect(Object.getPrototypeOf(output.configuration)).toBe(
        Object.prototype
      );
      expect(JSON.parse(JSON.stringify(output.configuration))).toEqual(
        configuration
      );
      expect(JSON.stringify(input)).toBe(before);
      expect(Object.getPrototypeOf(configuration)).toBe(Object.prototype);
      expect(output).not.toBe(input);
      expect(output.configuration).not.toBe(configuration);
      expect(result.ranges.get(output)).toEqual(
        new Map([['clientRef', CLIENT_RANGE]])
      );
      expect(result.ranges.get(output.configuration)).toEqual(
        new Map([[key, RANGE]])
      );
      expect(ranges.get(input)).toEqual(
        new Map([['client_ref', CLIENT_RANGE]])
      );
      expect(ranges.get(configuration)).toEqual(new Map([[key, RANGE]]));
    });

    test('converts schema-declared fields within record values', () => {
      const schema = z.record(
        z.string(),
        z.array(z.object({ customer_name: z.string() }))
      );
      const item = { customer_name: 'Ada' };
      const input = { [key]: [item] };
      const ranges = new WeakMap<object, Map<string, Range>>([
        [item, new Map([['customer_name', FIELD_RANGE]])],
      ]);
      const result = snakeKeysToCamel(input, ranges, schema);
      const output = result.value as Record<
        string,
        Array<{ customerName: string }>
      >;

      expect(output).toEqual({ [key]: [{ customerName: 'Ada' }] });
      expect(Object.hasOwn(output, key)).toBe(true);
      expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
      expect(result.ranges.get(output[key][0])).toEqual(
        new Map([['customerName', FIELD_RANGE]])
      );
    });

    test('recognizes schema-declared prototype names', () => {
      const schema = z.object({
        [key]: z.object({ customer_name: z.string() }),
      });
      const item = { customer_name: 'Ada' };
      const input = { [key]: item };
      const ranges = new WeakMap<object, Map<string, Range>>([
        [input, new Map([[key, RANGE]])],
        [item, new Map([['customer_name', FIELD_RANGE]])],
      ]);
      const result = snakeKeysToCamel(input, ranges, schema);
      const output = result.value as Record<string, { customerName: string }>;
      // Declared __proto__ follows the same snake_case rule as other fields.
      const outKey = key === '__proto__' ? '_Proto__' : key;

      expect(output).toEqual({ [outKey]: { customerName: 'Ada' } });
      expect(Object.hasOwn(output, outKey)).toBe(true);
      expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
      expect(result.ranges.get(output)).toEqual(new Map([[outKey, RANGE]]));
      expect(result.ranges.get(output[outKey])).toEqual(
        new Map([['customerName', FIELD_RANGE]])
      );
      expect(input[key]).toEqual({ customer_name: 'Ada' });
    });
  });

  test('preserves an undeclared own __proto__ key and its subtree', () => {
    const input = JSON.parse('{"__proto__":{"customer_name":"Ada"}}');
    const ranges = new WeakMap<object, Map<string, Range>>([
      [input, new Map([['__proto__', RANGE]])],
    ]);
    const result = snakeKeysToCamel(input, ranges, z.object({}));
    const output = result.value as Record<string, unknown>;

    expect(Object.hasOwn(output, '__proto__')).toBe(true);
    expect(output['__proto__']).toBe(input['__proto__']);
    expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(input)).toBe(Object.prototype);
    expect(JSON.stringify(output)).toBe(JSON.stringify(input));
    expect(result.ranges.get(output)).toEqual(new Map([['__proto__', RANGE]]));
  });
});
