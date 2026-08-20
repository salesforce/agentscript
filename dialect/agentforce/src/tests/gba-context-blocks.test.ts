/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for GBA-only enforcement of context.salesforce and context.data_cloud.
 *
 * These sub-fields are defined in the Agentforce schema (not the base AgentScript
 * schema), so the validation tests live here where AgentforceSchema is available.
 * context.memory is not GBA-only and must remain unrestricted.
 */

import { describe, expect, test } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function gbaErrors(source: string) {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics } = engine.run(ast, testSchemaCtx);
  return diagnostics.filter(
    d => typeof d.code === 'string' && d.code.startsWith('gba-only-')
  );
}

const GBA_CONFIG = `config:
    agent_type: "GoalBasedAgent"`;

const SERVICE_CONFIG = `config:
    agent_type: "AgentforceServiceAgent"`;

describe('gba-only context provider blocks', () => {
  test('errors on context.salesforce for non-GBA agent', () => {
    const source = [
      SERVICE_CONFIG,
      'context:',
      '    salesforce:',
      '        enabled: True',
    ].join('\n');

    const errs = gbaErrors(source);
    expect(errs.some(d => d.code === 'gba-only-context-salesforce')).toBe(true);
  });

  test('errors on context.data_cloud for non-GBA agent', () => {
    const source = [
      SERVICE_CONFIG,
      'context:',
      '    data_cloud:',
      '        enabled: True',
    ].join('\n');

    const errs = gbaErrors(source);
    expect(errs.some(d => d.code === 'gba-only-context-data_cloud')).toBe(true);
  });

  test('no gba-only error for context.memory on non-GBA agent', () => {
    const source = [
      SERVICE_CONFIG,
      'context:',
      '    memory:',
      '        enabled: True',
    ].join('\n');

    expect(gbaErrors(source)).toHaveLength(0);
  });

  test('no gba-only errors for context.salesforce on GBA agent', () => {
    const source = [
      GBA_CONFIG,
      'context:',
      '    salesforce:',
      '        enabled: True',
      '    data_cloud:',
      '        enabled: True',
    ].join('\n');

    expect(gbaErrors(source)).toHaveLength(0);
  });
});
