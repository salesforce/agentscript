import { describe, it, expect } from 'vitest';
import { getFieldCompletions } from '@agentscript/language';
import {
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
} from './test-utils.js';

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
