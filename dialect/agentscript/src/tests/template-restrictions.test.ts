import { expect, test, describe } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('Template statement restrictions', () => {
  test('disallows template in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  before_reasoning:
    | This template should not be allowed
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('Template statements');
    expect(errors[0].message).toContain('reasoning.instructions');
  });

  test('disallows template in after_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  after_reasoning:
    | This template should not be allowed
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  test('allows templates in reasoning.instructions', () => {
    const source = `
subagent main:
  description: "test"
  reasoning:
    instructions: ->
      | This template is allowed
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('allows non-template statements in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  before_reasoning:
    set @variables.x = 1
    if @variables.x == 1:
      transition to @subagent.main
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('allows run statements in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://test"
  before_reasoning:
    run @actions.fetch
      set @variables.result = @outputs.data
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('reports multiple templates in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  before_reasoning:
    | First template
    set @variables.x = 1
    | Second template
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(2);
  });

  test('allows templates in start_agent reasoning.instructions', () => {
    const source = `
start_agent main:
  description: "test"
  reasoning:
    instructions: ->
      | This template is allowed in start_agent too
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('disallows templates in start_agent before_reasoning', () => {
    const source = `
start_agent main:
  description: "test"
  before_reasoning:
    | This should also not be allowed
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows template nested inside if block in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  before_reasoning:
    if @variables.x == 1:
      | This nested template should not be allowed
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows template in else branch of if block in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  before_reasoning:
    if @variables.x == 1:
      set @variables.y = 2
    else:
      | This template in else should not be allowed
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows templates at multiple nesting levels in before_reasoning', () => {
    const source = `
subagent main:
  description: "test"
  before_reasoning:
    | Top-level template
    if @variables.x == 1:
      | Nested template in if body
    else:
      | Nested template in else
`;
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(3);
  });
});
