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
import { COMMERCE_SHOPPER_SCHEMA } from '../variants/commerce-cloud-shopper.js';
import { defaultRules } from '../lint/passes/index.js';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

describe('Commerce Cloud Shopper variant schema', () => {
  it('AFSubagentBlock has discriminant on schema field', () => {
    expect(AFSubagentBlock.discriminantField).toBe('schema');
  });

  it('resolves variant schema for commerce shopper discriminant', () => {
    const variantSchema = AFSubagentBlock.resolveSchemaForDiscriminant!(
      COMMERCE_SHOPPER_SCHEMA
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

describe('Commerce Cloud Shopper variant parsing', () => {
  it('parses a basic commerce shopper subagent', () => {
    const value = parseDocument(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`);
    expect(value.subagent).toBeDefined();
    expect(value.subagent!.has('Commerce_Shopper')).toBe(true);
  });

  it('parses commerce shopper with parameters.template', () => {
    const value = parseDocument(`
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    parameters:
        template:
            auth_token: @variables.EndUserId
`);
    const block = value.subagent!.get('Commerce_Shopper')! as Record<
      string,
      unknown
    >;
    expect(block.parameters).toBeDefined();
  });

  it('parses commerce shopper with actions', () => {
    const value = parseDocument(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search the product catalog"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
`);
    const block = value.subagent!.get('Commerce_Shopper')! as Record<
      string,
      unknown
    >;
    expect(block.actions).toBeDefined();
    expect((block.actions as Map<string, unknown>).has('Search_Products')).toBe(
      true
    );
  });

  it('produces no parse errors for a valid commerce shopper subagent', () => {
    const { diagnostics } = parseWithDiagnostics(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    parameters:
        template:
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

subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`);
    expect(value.start_agent).toBeDefined();
    expect(value.subagent).toBeDefined();
    expect(value.subagent!.has('Order_Management')).toBe(true);
    expect(value.subagent!.has('Commerce_Shopper')).toBe(true);
  });
});

describe('Commerce Cloud Shopper lint: custom-subagent-validation', () => {
  it('allows reasoning.actions on custom subagent', () => {
    const diagnostics = runLint(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
    reasoning:
        actions:
            search: @actions.Search_Products
                with query=...
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports error when reasoning.instructions is present on custom subagent', () => {
    const diagnostics = runLint(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    reasoning:
        instructions: ->
            | This should not be here
`);
    // reasoning.instructions is not in the BYON reasoning schema (only actions is)
    expect(diagnostics.length).toBeGreaterThanOrEqual(1);
    expect(diagnostics.some(d => d.message.includes('instructions'))).toBe(
      true
    );
  });

  it('reports error when before_reasoning is present on custom subagent', () => {
    const diagnostics = runLint(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
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

  it('allows a BYON start_agent as the only node', () => {
    const diagnostics = runLint(`
start_agent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`);
    const blocking = diagnostics.filter(
      d =>
        d.code === 'custom-subagent-validation' || d.code === 'unknown-variant'
    );
    expect(blocking).toHaveLength(0);
  });

  it('reports error when before_reasoning is present on a BYON start_agent', () => {
    const diagnostics = runLint(`
start_agent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    before_reasoning:
        set @variables.x = 1
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('does not validate fields on a generic node://byon/* subagent', () => {
    // before_reasoning would error on a commerce variant; on a generic BYON
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

  it('does not warn byon-not-for-production for the commerce schema', () => {
    const diagnostics = runLint(`
subagent Commerce_Shopper:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`);
    const warnings = diagnostics.filter(
      d => d.code === 'byon-not-for-production'
    );
    expect(warnings).toHaveLength(0);
  });
});
