/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { compileSource } from '../src/index.js';

const SOURCE = `config:
    agent_name: "TestBot"
    default_agent_user: "test@test.com"
`;

describe('compileSource camelCase option', () => {
  test('defaults to snake_case keys', () => {
    const { output } = compileSource(SOURCE);
    expect(output).toHaveProperty('schema_version');
    expect(output).toHaveProperty('global_configuration');
    expect(output.global_configuration).toHaveProperty('developer_name');
  });

  test('emits camelCase keys when camelCase: true', () => {
    const { output } = compileSource(SOURCE, { camelCase: true });
    const camel = output as unknown as Record<string, unknown>;
    expect(camel).toHaveProperty('schemaVersion');
    expect(camel).toHaveProperty('globalConfiguration');
    expect(camel).not.toHaveProperty('schema_version');
    const gc = camel.globalConfiguration as Record<string, unknown>;
    expect(gc).toHaveProperty('developerName');
    expect(gc).not.toHaveProperty('developer_name');
  });

  test('preserves user-controlled keys inside record-typed fields', () => {
    // additional_parameters is z.record(z.string(), z.unknown()) — its keys
    // come from compiler-emitted user data and must NOT be camelized.
    const { output } = compileSource(SOURCE, { camelCase: true });
    const camel = output as unknown as Record<string, unknown>;
    const av = camel.agentVersion as Record<string, unknown>;
    const additional = av.additionalParameters as Record<string, unknown>;
    expect(additional).toHaveProperty('reset_to_initial_node');
    expect(additional).not.toHaveProperty('resetToInitialNode');
  });

  test('preserves snake_case identifiers in string values', () => {
    const { output } = compileSource(SOURCE, { camelCase: true });
    const camel = output as unknown as Record<string, unknown>;
    const av = camel.agentVersion as Record<string, unknown>;
    const stateVars = av.stateVariables as Array<Record<string, unknown>>;
    const internalVar = stateVars.find(v =>
      String(v.developerName ?? '').includes('AgentScriptInternal_next_topic')
    );
    expect(internalVar).toBeDefined();
    expect(internalVar?.developerName).toBe('AgentScriptInternal_next_topic');
  });

  test('remaps source ranges to camelCase keys', () => {
    const { output, ranges } = compileSource(SOURCE, { camelCase: true });
    const camel = output as unknown as Record<string, unknown>;
    const gc = camel.globalConfiguration as object;
    const gcRanges = ranges.get(gc);
    if (gcRanges) {
      // No snake_case key should appear in the remapped ranges.
      for (const key of gcRanges.keys()) {
        expect(key).not.toMatch(/_[a-z]/);
      }
    }
  });
});
