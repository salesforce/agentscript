/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the agentforce `live:` block — Agentforce Live layer configuration.
 */

import { describe, expect, test } from 'vitest';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
} from './test-utils.js';

const live = (...lines: string[]) =>
  ['live:', ...lines.map(l => `    ${l}`)].join('\n');

describe('live block', () => {
  test.each([
    { input: 'True', expected: true },
    { input: 'False', expected: false },
  ])('parses enabled: $input', ({ input, expected }) => {
    const result = parseWithDiagnostics(live(`enabled: ${input}`));
    expect(result.diagnostics).toHaveLength(0);
    expect(result.value.live?.enabled?.value).toBe(expected);
  });

  test('parses an empty live block', () => {
    const result = parseWithDiagnostics(live());
    expect(result.diagnostics).toHaveLength(0);
    expect(result.value.live).toBeDefined();
    expect(result.value.live?.enabled).toBeUndefined();
  });

  test.each([
    { input: '"yes"', message: 'Expected True or False, got string "yes"' },
    { input: '1', message: 'Expected True or False, got number 1' },
    { input: 'true', message: 'Expected True or False, got identifier "true"' },
    { input: 'None', message: 'Expected True or False, got None' },
  ])('reports type-mismatch for enabled: $input', ({ input, message }) => {
    const { diagnostics } = parseWithDiagnostics(live(`enabled: ${input}`));
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({ code: 'type-mismatch', message });
  });

  test.each([
    { name: 'alone', lines: ['foo: True'], enabled: undefined },
    {
      name: 'alongside enabled',
      lines: ['enabled: True', 'foo: 1'],
      enabled: true,
    },
  ])('reports unknown-field for extra field $name', ({ lines, enabled }) => {
    const result = parseWithDiagnostics(live(...lines));
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      code: 'unknown-field',
      message: 'Unknown field `foo` in live',
    });
    expect(result.value.live?.enabled?.value).toBe(enabled);
  });

  test('parses params as arbitrary key-value pairs', () => {
    const source = live(
      'enabled: True',
      'params:',
      '    provider: "openai"',
      '    model: "gpt-live"'
    );
    const result = parseWithDiagnostics(source);
    expect(result.diagnostics).toHaveLength(0);

    const params = result.value.live?.params as
      | Record<string, { __kind?: string; value?: string }>
      | undefined;
    expect(params?.provider).toMatchObject({
      __kind: 'StringLiteral',
      value: 'openai',
    });
    expect(params?.model).toMatchObject({
      __kind: 'StringLiteral',
      value: 'gpt-live',
    });
  });

  test('parses nested params written as an inline dict', () => {
    const source = live(
      'enabled: True',
      'params:',
      '    provider: "openai"',
      '    profile: {"locale": "en"}'
    );
    const result = parseWithDiagnostics(source);
    expect(result.diagnostics).toHaveLength(0);

    const params = result.value.live?.params as
      | Record<string, { __kind?: string }>
      | undefined;
    expect(params?.profile?.__kind).toBe('DictLiteral');
    expect(emitDocument(parseDocument(source))).toBe(source);
  });

  test.each([
    { name: 'enabled: True', source: live('enabled: True') },
    { name: 'enabled: False', source: live('enabled: False') },
    { name: 'empty block', source: live() },
    {
      name: 'params',
      source: live(
        'enabled: True',
        'params:',
        '    provider: "openai"',
        '    model: "gpt-live"'
      ),
    },
  ])('round-trips $name', ({ source }) => {
    expect(emitDocument(parseDocument(source))).toBe(source);
  });
});
