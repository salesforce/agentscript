/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';

const RUNTIME_FIELDS = [
  'streaming',
  'thought_chunks',
  'citation',
  'groundedness',
  'reset_to_initial_node',
] as const;

type RuntimeField = (typeof RUNTIME_FIELDS)[number];

function sourceWith(fields: Partial<Record<RuntimeField, boolean>>): string {
  const lines = Object.entries(fields).map(
    ([k, v]) => `        ${k}: ${v ? 'True' : 'False'}`
  );
  const runtimeBlock =
    lines.length > 0 ? `    runtime:\n${lines.join('\n')}\n` : '';
  return `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"
${runtimeBlock}
start_agent main:
    description: "Main topic"
`.trimStart();
}

function compileAndAssertNoErrors(source: string) {
  const ast = parseSource(source);
  const { output, diagnostics } = compile(ast);
  const errors = diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  expect(errors).toHaveLength(0);
  return output;
}

describe('Runtime compilation', () => {
  describe('Field emission', () => {
    it.each(RUNTIME_FIELDS)('emits %s when set to True', field => {
      const output = compileAndAssertNoErrors(sourceWith({ [field]: true }));
      expect(output.global_configuration.runtime).toEqual({ [field]: true });
    });

    it.each(RUNTIME_FIELDS)('emits %s when set to False', field => {
      const output = compileAndAssertNoErrors(sourceWith({ [field]: false }));
      expect(output.global_configuration.runtime).toEqual({ [field]: false });
    });

    it('emits all fields when every field is set', () => {
      const all = Object.fromEntries(
        RUNTIME_FIELDS.map((f, i) => [f, i % 2 === 0])
      ) as Record<RuntimeField, boolean>;

      const output = compileAndAssertNoErrors(sourceWith(all));
      expect(output.global_configuration.runtime).toEqual(all);
    });

    it('emits only the fields that are present in source', () => {
      const subset: Partial<Record<RuntimeField, boolean>> = {
        streaming: true,
        citation: false,
        groundedness: true,
      };

      const output = compileAndAssertNoErrors(sourceWith(subset));
      expect(output.global_configuration.runtime).toEqual(subset);
    });
  });

  describe('Field omission', () => {
    it('omits the runtime block when not present in config', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Main topic"
`.trimStart();

      const output = compileAndAssertNoErrors(source);
      expect(output.global_configuration.runtime).toBeUndefined();
    });

    it('errors when the runtime block is present but empty', () => {
      const source = `
config:
    developer_name: "test_agent"
    default_agent_user: "test@example.com"
    runtime:

start_agent main:
    description: "Main topic"
`.trimStart();

      const ast = parseSource(source);
      const { output, diagnostics } = compile(ast);
      const errors = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(
        /runtime block must declare at least one field/
      );
      expect(output.global_configuration.runtime).toBeUndefined();
    });

    it.each(RUNTIME_FIELDS)(
      'does not emit %s when the source omits it but sets the others',
      omitted => {
        const set = Object.fromEntries(
          RUNTIME_FIELDS.filter(f => f !== omitted).map(f => [f, true])
        ) as Partial<Record<RuntimeField, boolean>>;

        const output = compileAndAssertNoErrors(sourceWith(set));
        expect(output.global_configuration.runtime).not.toHaveProperty(omitted);
        for (const f of RUNTIME_FIELDS) {
          if (f !== omitted) {
            expect(output.global_configuration.runtime).toHaveProperty(f, true);
          }
        }
      }
    );

    it('does not leak unset fields when a subset is present', () => {
      const present: Partial<Record<RuntimeField, boolean>> = {
        streaming: true,
        citation: false,
        groundedness: true,
      };
      const expectedAbsent = RUNTIME_FIELDS.filter(f => !(f in present));

      const output = compileAndAssertNoErrors(sourceWith(present));
      for (const f of expectedAbsent) {
        expect(output.global_configuration.runtime).not.toHaveProperty(f);
      }
    });

    it('preserves False values rather than treating them as unset', () => {
      const allFalse = Object.fromEntries(
        RUNTIME_FIELDS.map(f => [f, false])
      ) as Record<RuntimeField, boolean>;

      const output = compileAndAssertNoErrors(sourceWith(allFalse));
      expect(output.global_configuration.runtime).toEqual(allFalse);
    });
  });

  describe('Integration with full agent', () => {
    it('runtime survives the full compile pipeline alongside other config fields', () => {
      const source = `
config:
    developer_name: "test_agent"
    agent_label: "Test Agent"
    agent_type: "EinsteinServiceAgent"
    default_agent_user: "test@example.com"
    enable_enhanced_event_logs: True
    runtime:
        thought_chunks: True
        streaming: False

start_agent main:
    description: "Main topic"
`.trimStart();

      const output = compileAndAssertNoErrors(source);
      expect(output.global_configuration.developer_name).toBe('test_agent');
      expect(output.global_configuration.enable_enhanced_event_logs).toBe(true);
      expect(output.global_configuration.runtime).toEqual({
        thought_chunks: true,
        streaming: false,
      });
    });
  });
});
