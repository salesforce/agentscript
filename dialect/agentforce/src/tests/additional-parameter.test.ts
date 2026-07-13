/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { getFieldCompletions, LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import {
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
} from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

/**
 * Parse + run the Agentforce lint passes. `engine.run` already collects every
 * node-attached diagnostic (both parse-time and lint-time) plus system
 * diagnostics, so its return value is the complete set.
 */
function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  return engine.run(ast, testSchemaCtx).diagnostics;
}

describe('additional_parameter__ wildcard fields', () => {
  it('should parse known additional_parameter__ fields without diagnostics', () => {
    const source = `
config:
    developer_name: "test"
    additional_parameter__reset_to_initial_node: True
    additional_parameter__DISABLE_GROUNDEDNESS: True

start_agent main:
    description: "desc"
`;
    const { diagnostics } = parseWithDiagnostics(source);
    const unknownFieldDiags = diagnostics.filter(
      d => d.code === 'unknown-field'
    );
    expect(unknownFieldDiags).toHaveLength(0);
  });

  it('should parse arbitrary additional_parameter__ fields without diagnostics', () => {
    const source = `
config:
    developer_name: "test"
    additional_parameter__custom_flag: True
    additional_parameter__MY_SETTING: "hello"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = parseWithDiagnostics(source);
    const unknownFieldDiags = diagnostics.filter(
      d => d.code === 'unknown-field'
    );
    expect(unknownFieldDiags).toHaveLength(0);
  });

  it('should store wildcard field values on the parsed config block', () => {
    const source = `
config:
    developer_name: "test"
    additional_parameter__custom_flag: True

start_agent main:
    description: "desc"
`;
    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config['additional_parameter__custom_flag']).toBeDefined();
  });

  it('should emit an error for additional_parameter__disable_graph_runtime', () => {
    const source = `
config:
    developer_name: "test"
    additional_parameter__disable_graph_runtime: True

start_agent main:
    description: "desc"
`;
    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'disabled-additional-parameter'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('graph runtime');

    // The diagnostic highlights the whole `key: value` line: it starts at the
    // field's key column (indent = 4), not deep in the line where the value
    // `True` begins. This locks in getFieldLineRange over the value-only range.
    const { range } = errors[0];
    expect(range.start.character).toBe(4);
    expect(range.end.character).toBeGreaterThan(
      range.start.character +
        'additional_parameter__disable_graph_runtime'.length
    );

    // The field is no longer declared in the schema, so it must not fall back
    // to a deprecation warning or an unknown-field error.
    const deprecated = diagnostics.filter(d => d.code === 'deprecated-field');
    expect(deprecated).toHaveLength(0);
    const unknownFieldDiags = diagnostics.filter(
      d => d.code === 'unknown-field'
    );
    expect(unknownFieldDiags).toHaveLength(0);
  });

  it('should not flag non-forbidden additional_parameter__ fields', () => {
    const source = `
config:
    developer_name: "test"
    additional_parameter__custom_flag: True

start_agent main:
    description: "desc"
`;
    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'disabled-additional-parameter'
    );
    expect(errors).toHaveLength(0);
  });

  it('should not include additional_parameter__ fields in completions', () => {
    const source = `
config:
    developer_name: "test"
    `;
    const ast = parseDocument(source);
    // Get completions inside the config block
    const completions = getFieldCompletions(ast, 3, 4, testSchemaCtx, source);
    const additionalParamCompletions = completions.filter(c =>
      c.name.startsWith('additional_parameter__')
    );
    expect(additionalParamCompletions).toHaveLength(0);
    // But regular config fields should still appear
    const regularFields = completions.filter(
      c => c.name === 'agent_type' || c.name === 'description'
    );
    expect(regularFields.length).toBeGreaterThan(0);
  });
});
