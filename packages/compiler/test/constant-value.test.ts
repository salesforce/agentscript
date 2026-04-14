/**
 * Constant value compilation tests.
 *
 * Covers:
 *  - extractConstantValue() resolution for @knowledge references
 *  - Literal string and boolean defaults
 *  - Edge cases: empty strings, false booleans, null values
 *  - Full compilation pipeline for constant_value in InputParameters
 */
import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import type { InputParameter } from '../src/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile an inline .agent source string and return the CompileResult. */
function compileSource(source: string) {
  const ast = parseSource(source);
  return compile(ast);
}

// ---------------------------------------------------------------------------
// @knowledge references
// ---------------------------------------------------------------------------

describe('constant_value: @knowledge references', () => {
  it('should resolve @knowledge.field to string value', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_url: "https://api.example.com"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          url: string = @knowledge.citations_url
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'url'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe('https://api.example.com');
    expect(param!.data_type).toBe('String');
  });

  it('should resolve @knowledge.field to boolean true value', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_enabled: True

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          debug: boolean = @knowledge.citations_enabled
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'debug'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe(true);
    expect(param!.data_type).toBe('Boolean');
  });

  it('should resolve @knowledge.field to boolean false value', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_enabled: False

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          debug: boolean = @knowledge.citations_enabled
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'debug'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe(false);
    expect(param!.data_type).toBe('Boolean');
  });

  it('should error on unknown @knowledge field', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_url: "https://api.example.com"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          url: string = @knowledge.unknown_field
`;
    const { diagnostics } = compileSource(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );

    expect(errors.length).toBeGreaterThan(0);
    expect(
      errors.some(e => e.message.includes('Unknown @knowledge field'))
    ).toBe(true);
  });

  it('should handle multiple @knowledge references in same action', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_url: "https://api.example.com"
    rag_feature_config_id: "WorldKnowledge"
    citations_enabled: False

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          url: string = @knowledge.citations_url
          rag_id: string = @knowledge.rag_feature_config_id
          cite: boolean = @knowledge.citations_enabled
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const params = node.action_definitions[0].input_type;

    const urlParam = params.find(
      (p: InputParameter) => p.developer_name === 'url'
    );
    const ragIdParam = params.find(
      (p: InputParameter) => p.developer_name === 'rag_id'
    );
    const citeParam = params.find(
      (p: InputParameter) => p.developer_name === 'cite'
    );

    expect(urlParam!.constant_value).toBe('https://api.example.com');
    expect(ragIdParam!.constant_value).toBe('WorldKnowledge');
    expect(citeParam!.constant_value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Literal values
// ---------------------------------------------------------------------------

describe('constant_value: literal values', () => {
  it('should handle literal string default', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          url: string = "https://example.com"
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'url'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe('https://example.com');
    expect(param!.data_type).toBe('String');
  });

  it('should handle boolean True literal default', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          enabled: boolean = True
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'enabled'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe(true);
    expect(param!.data_type).toBe('Boolean');
  });

  it('should handle boolean False literal default', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          enabled: boolean = False
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'enabled'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe(false);
    expect(param!.data_type).toBe('Boolean');
  });

  it('should handle empty string literal default', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          optional_field: string = ""
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'optional_field'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe('');
    expect(param!.data_type).toBe('String');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('constant_value: edge cases', () => {
  it('should preserve false boolean (not confuse with null/undefined)', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          enabled: boolean = False
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'enabled'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe(false);
    expect(param!.constant_value).not.toBeUndefined();
    expect(param!.constant_value).not.toBeNull();
  });

  it('should preserve empty string (not confuse with null/undefined)', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          optional: string = ""
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'optional'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe('');
    expect(param!.constant_value).not.toBeUndefined();
    expect(param!.constant_value).not.toBeNull();
  });

  it('should not include constant_value when no default provided', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          required_param: string
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'required_param'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBeUndefined();
  });

  it('should handle @knowledge field with empty string', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_url: ""

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          optional: string = @knowledge.citations_url
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'optional'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe('');
  });

  it('should handle @knowledge field with false boolean', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_enabled: False

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          enabled: boolean = @knowledge.citations_enabled
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const param = node.action_definitions[0].input_type.find(
      (p: InputParameter) => p.developer_name === 'enabled'
    );

    expect(param).toBeDefined();
    expect(param!.constant_value).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('constant_value: integration', () => {
  it('should compile action with mixed constant value types', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_url: "https://api.example.com"
    citations_enabled: False

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          url: string = @knowledge.citations_url
          cite: boolean = @knowledge.citations_enabled
          timeout: string = "30"
          retry: boolean = True
          optional: string
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const params = node.action_definitions[0].input_type;

    const urlParam = params.find(
      (p: InputParameter) => p.developer_name === 'url'
    );
    const citeParam = params.find(
      (p: InputParameter) => p.developer_name === 'cite'
    );
    const timeoutParam = params.find(
      (p: InputParameter) => p.developer_name === 'timeout'
    );
    const retryParam = params.find(
      (p: InputParameter) => p.developer_name === 'retry'
    );
    const optionalParam = params.find(
      (p: InputParameter) => p.developer_name === 'optional'
    );

    expect(urlParam!.constant_value).toBe('https://api.example.com');
    expect(citeParam!.constant_value).toBe(false);
    expect(timeoutParam!.constant_value).toBe('30');
    expect(retryParam!.constant_value).toBe(true);
    expect(optionalParam!.constant_value).toBeUndefined();
  });

  it('should compile multiple actions with different constant values', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_url: "https://api.example.com"

start_agent main:
    description: "Test"
    actions:
      action1:
        target: "flow://Action1"
        inputs:
          url: string = @knowledge.citations_url
      action2:
        target: "flow://Action2"
        inputs:
          enabled: boolean = True
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const action1 = node.action_definitions.find(
      a => a.developer_name === 'action1'
    );
    const action2 = node.action_definitions.find(
      a => a.developer_name === 'action2'
    );

    expect(action1!.input_type[0].constant_value).toBe(
      'https://api.example.com'
    );
    expect(action2!.input_type[0].constant_value).toBe(true);
  });

  it('should preserve constant_value in action_definitions output structure', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          url: string = "https://example.com"
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const actionDef = node.action_definitions[0];

    expect(actionDef).toHaveProperty('developer_name', 'test_action');
    expect(actionDef).toHaveProperty('input_type');
    expect(Array.isArray(actionDef.input_type)).toBe(true);
    expect(actionDef.input_type[0]).toHaveProperty('developer_name', 'url');
    expect(actionDef.input_type[0]).toHaveProperty(
      'constant_value',
      'https://example.com'
    );
  });
});
