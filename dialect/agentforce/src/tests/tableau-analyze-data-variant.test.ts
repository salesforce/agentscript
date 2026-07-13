/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine, collectDiagnostics } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import {
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
} from './test-utils.js';
import { AFSubagentBlock } from '../schema.js';
import { TABLEAU_ANALYZE_DATA_SCHEMA } from '../variants/tableau-analyze-data.js';
import { defaultRules } from '../lint/passes/index.js';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

describe('Tableau Analyze Data variant schema', () => {
  it('AFSubagentBlock has discriminant on schema field', () => {
    expect(AFSubagentBlock.discriminantField).toBe('schema');
  });

  it('resolves variant schema for tableau analyze data discriminant', () => {
    const variantSchema = AFSubagentBlock.resolveSchemaForDiscriminant!(
      TABLEAU_ANALYZE_DATA_SCHEMA
    );

    // Base fields from customSubagentFields
    expect(variantSchema).toHaveProperty('label');
    expect(variantSchema).toHaveProperty('description');
    expect(variantSchema).toHaveProperty('system');
    expect(variantSchema).toHaveProperty('actions');
    expect(variantSchema).toHaveProperty('schema');

    // Custom subagent fields
    expect(variantSchema).toHaveProperty('parameters');
    expect(variantSchema).toHaveProperty('reasoning');
    expect(variantSchema).toHaveProperty('on_init');
    expect(variantSchema).toHaveProperty('on_exit');

    // AF-specific fields
    expect(variantSchema).toHaveProperty('model_config');
    // `access` is intentionally NOT a per-subagent field — it lives only at the top level.
    expect(variantSchema).not.toHaveProperty('access');
  });

  it('returns base schema for unknown discriminant value', () => {
    const baseSchema =
      AFSubagentBlock.resolveSchemaForDiscriminant!('node://unknown/v1');

    // Base schema includes reasoning fields
    expect(baseSchema).toHaveProperty('before_reasoning');
    expect(baseSchema).toHaveProperty('after_reasoning');
    expect(baseSchema).toHaveProperty('reasoning');
  });
});

describe('Tableau Analyze Data variant parsing', () => {
  it('parses a basic tableau analyze data subagent', () => {
    const value = parseDocument(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`);
    expect(value.subagent).toBeDefined();
    expect(value.subagent!.has('Tableau_Analyze')).toBe(true);
  });

  it('parses tableau analyze data with parameters.context', () => {
    const value = parseDocument(`
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    parameters:
        context:
            auth_token: @variables.EndUserId
`);
    const block = value.subagent!.get('Tableau_Analyze')! as Record<
      string,
      unknown
    >;
    expect(block.parameters).toBeDefined();
  });

  it('parses tableau analyze data with actions', () => {
    const value = parseDocument(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    actions:
        Analyze_Data:
            description: "Analyze the data"
            target: "flow://analyze_data"
            inputs:
                query: string
                    description: "Analysis query"
`);
    const block = value.subagent!.get('Tableau_Analyze')! as Record<
      string,
      unknown
    >;
    expect(block.actions).toBeDefined();
    expect((block.actions as Map<string, unknown>).has('Analyze_Data')).toBe(
      true
    );
  });

  it('produces no parse errors for a valid tableau analyze data subagent', () => {
    const { diagnostics } = parseWithDiagnostics(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    parameters:
        context:
            auth_token: @variables.EndUserId
`);
    const errors = diagnostics.filter(d => d.severity === 1);
    expect(errors).toHaveLength(0);
  });

  it('coexists with regular subagent and start_agent blocks', () => {
    const value = parseDocument(`
start_agent router:
    description: "Route requests"
    reasoning:
        instructions: ->
            | Route requests

subagent Order_Management:
    description: "Handles orders"
    reasoning:
        instructions: ->
            | Handle orders

subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`);
    expect(value.start_agent).toBeDefined();
    expect(value.subagent).toBeDefined();
    expect(value.subagent!.has('Order_Management')).toBe(true);
    expect(value.subagent!.has('Tableau_Analyze')).toBe(true);
  });
});

describe('Tableau Analyze Data lint: custom-subagent-validation', () => {
  it('allows reasoning.actions on custom subagent', () => {
    const diagnostics = runLint(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    actions:
        Analyze_Data:
            description: "Analyze data"
            target: "flow://analyze_data"
            inputs:
                query: string
    reasoning:
        actions:
            analyze: @actions.Analyze_Data
                with query=...
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports error when reasoning.instructions is present on custom subagent', () => {
    const diagnostics = runLint(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    reasoning:
        instructions: ->
            | This should not be here
`);
    // reasoning.instructions is not in the Tableau variant reasoning schema (only actions is)
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some(d => d.message.includes('instructions'))).toBe(
      true
    );
  });

  it('reports error when before_reasoning is present on custom subagent', () => {
    const diagnostics = runLint(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    before_reasoning:
        set @variables.x = 1
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('does not report error on regular subagent with reasoning', () => {
    const diagnostics = runLint(`
subagent Order_Management:
    description: "Handles orders"
    reasoning:
        instructions: ->
            | Handle orders
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors).toHaveLength(0);
  });

  it('allows a Tableau Analyze Data start_agent as the only node', () => {
    const diagnostics = runLint(`
start_agent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`);
    const blocking = diagnostics.filter(
      d =>
        d.code === 'custom-subagent-validation' || d.code === 'unknown-variant'
    );
    expect(blocking).toHaveLength(0);
  });

  it('reports error when before_reasoning is present on a Tableau Analyze Data start_agent', () => {
    const diagnostics = runLint(`
start_agent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    before_reasoning:
        set @variables.x = 1
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('does not validate fields on a generic node://byon/* subagent', () => {
    // before_reasoning would error on a tableau variant; on a generic BYON
    // node we expect no custom-subagent-validation diagnostics.
    const diagnostics = runLint(`
subagent Custom_Node:
    schema: "node://byon/myteam/widget/v1"
    description: "Generic BYON node"
    before_reasoning:
        set @variables.x = 1
    reasoning:
        instructions: ->
            | Anything goes
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors).toHaveLength(0);
  });

  it('warns that node://byon/* is for test/lower envs only, not prod', () => {
    const diagnostics = runLint(`
subagent Custom_Node:
    schema: "node://byon/myteam/widget/v1"
    description: "Generic BYON node"
`);
    const warnings = diagnostics.filter(
      d => d.code === 'byon-not-for-production'
    );
    // runLint merges AST-attached diagnostics with engine output, so a single
    // diagnostic can appear twice — match the existing pattern in this file.
    expect(warnings.length).toBeGreaterThanOrEqual(1);
    expect(warnings[0].severity).toBe(2); // Warning
    expect(warnings[0].message).toMatch(/test and lower environments/i);
  });

  it('does not warn byon-not-for-production for the tableau analyze data schema', () => {
    const diagnostics = runLint(`
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`);
    const warnings = diagnostics.filter(
      d => d.code === 'byon-not-for-production'
    );
    expect(warnings).toHaveLength(0);
  });
});
