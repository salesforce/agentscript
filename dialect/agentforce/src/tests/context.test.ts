/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the agentforce `context:` block — external context providers
 * (Salesforce, Data Cloud) the agent can draw on during execution, alongside
 * the existing memory / user_profile / past_conversations config. The set of
 * providers is a fixed schema for now; BYO Context is future work.
 */

import { describe, expect, test } from 'vitest';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
} from './test-utils.js';

describe('context providers', () => {
  test('parses salesforce and data_cloud providers', () => {
    const doc = parseDocument(
      [
        'context:',
        '    salesforce:',
        '        auto_enabled: True',
        '    data_cloud:',
        '        auto_enabled: True',
      ].join('\n')
    );
    expect(doc.context?.salesforce?.auto_enabled?.value).toBe(true);
    expect(doc.context?.data_cloud?.auto_enabled?.value).toBe(true);
  });

  test('supports the enabled flag alongside auto_enabled', () => {
    const doc = parseDocument(
      ['context:', '    salesforce:', '        enabled: True'].join('\n')
    );
    expect(doc.context?.salesforce?.enabled?.value).toBe(true);
  });

  test('coexists with the existing memory config', () => {
    const result = parseWithDiagnostics(
      [
        'context:',
        '    memory:',
        '        enabled: True',
        '    salesforce:',
        '        auto_enabled: True',
      ].join('\n')
    );
    expect(result.diagnostics).toHaveLength(0);
    expect(result.value.context?.memory?.enabled?.value).toBe(true);
    expect(result.value.context?.salesforce?.auto_enabled?.value).toBe(true);
  });

  test('round-trips', () => {
    const source = [
      'context:',
      '    salesforce:',
      '        auto_enabled: True',
      '    data_cloud:',
      '        enabled: True',
    ].join('\n');
    const emitted = emitDocument(parseDocument(source));
    const doc = parseDocument(emitted);
    expect(doc.context?.salesforce?.auto_enabled?.value).toBe(true);
    expect(doc.context?.data_cloud?.enabled?.value).toBe(true);
  });
});
