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
    expect(variantSchema).toHaveProperty('on_init');
    expect(variantSchema).toHaveProperty('on_exit');

    // AF-specific fields
    expect(variantSchema).toHaveProperty('model_config');
    expect(variantSchema).toHaveProperty('security');
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
    schema: "node://commerce/cloud_shopper/v1"
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
    schema: "node://commerce/cloud_shopper/v1"
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
    schema: "node://commerce/cloud_shopper/v1"
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
    schema: "node://commerce/cloud_shopper/v1"
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
    schema: "node://commerce/cloud_shopper/v1"
    description: "Commerce Cloud shopper agent"
`);
    expect(value.start_agent).toBeDefined();
    expect(value.subagent).toBeDefined();
    expect(value.subagent!.has('Order_Management')).toBe(true);
    expect(value.subagent!.has('Commerce_Shopper')).toBe(true);
  });
});

describe('Commerce Cloud Shopper lint: custom-subagent-validation', () => {
  it('reports error when reasoning is present on custom subagent', () => {
    const diagnostics = runLint(`
subagent Commerce_Shopper:
    schema: "node://commerce/cloud_shopper/v1"
    description: "Commerce Cloud shopper agent"
    reasoning:
        instructions: ->
            | This should not be here
`);
    const errors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('reports error when before_reasoning is present on custom subagent', () => {
    const diagnostics = runLint(`
subagent Commerce_Shopper:
    schema: "node://commerce/cloud_shopper/v1"
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
});
