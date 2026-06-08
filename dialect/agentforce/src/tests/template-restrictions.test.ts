import { expect, test, describe } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('Template statement restrictions (Agentforce)', () => {
  test('disallows template in topic before_reasoning', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    | This template should not be allowed
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('Template statements');
    expect(errors[0].message).toContain('reasoning.instructions');
  });

  test('disallows template in topic after_reasoning', () => {
    const source = `
topic main:
  description: "test"
  after_reasoning:
    | This template should not be allowed
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  test('allows templates in topic reasoning.instructions', () => {
    const source = `
topic main:
  description: "test"
  reasoning:
    instructions: ->
      | This template is allowed
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('allows non-template statements in before_reasoning', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    set @variables.x = 1
    if @variables.x == 1:
      transition to @topic.main
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('allows run statements in before_reasoning', () => {
    const source = `
topic main:
  description: "test"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://test"
  before_reasoning:
    run @actions.fetch
      set @variables.result = @outputs.data
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('reports multiple templates in before_reasoning', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    | First template
    set @variables.x = 1
    | Second template
`;
    const result = parseWithDiagnostics(source);
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
    const result = parseWithDiagnostics(source);
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
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows templates in hyperclassifier before_reasoning', () => {
    const source = `
start_agent router:
  description: "Router"
  model_config:
    model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
  before_reasoning:
    | This should not be allowed
  reasoning:
    actions:
      go_billing: @utils.transition to @topic.billing
        description: "Handle billing"
`;
    const result = parseWithDiagnostics(source);
    const templateErrors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(templateErrors).toHaveLength(1);
  });

  test('disallowed template is preserved in AST', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    | This template should be preserved
    set @variables.x = 1
`;
    const result = parseWithDiagnostics(source);

    // Find the topic in the AST
    const topicMap = result.value['topic'] as any;
    expect(topicMap).toBeDefined();

    const topics = Array.from(topicMap.entries()) as any[];
    expect(topics.length).toBeGreaterThan(0);

    const [, topicValue] = topics[0];
    const beforeReasoning = topicValue.before_reasoning;

    // Template should be preserved in AST (diagnostic reported but no mutation)
    expect(beforeReasoning.statements).toHaveLength(2);
    expect(beforeReasoning.statements[0].__kind).toBe('Template');
    expect(beforeReasoning.statements[1].__kind).toBe('SetClause');
  });

  test('template in colinear reasoning instructions is allowed', () => {
    const source = `
topic main:
  description: "test"
  reasoning:
    instructions: | This is allowed in colinear form
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(0);
  });

  test('disallows template in subagent before_reasoning', () => {
    const source = `
subagent helper:
  description: "test"
  before_reasoning:
    | This template should not be allowed
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows template in subagent after_reasoning', () => {
    const source = `
subagent helper:
  description: "test"
  after_reasoning:
    | This template should not be allowed
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows template nested inside if block in before_reasoning', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    if @variables.x == 1:
      | This nested template should not be allowed
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(1);
  });

  test('disallows templates at multiple nesting levels', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    | Top-level template
    if @variables.x == 1:
      | Nested template in if body
    else:
      | Nested template in else
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    expect(errors).toHaveLength(3);
  });

  test('mixed valid and invalid statements', () => {
    const source = `
topic main:
  description: "test"
  before_reasoning:
    set @variables.a = 1
    | Invalid template 1
    if @variables.a == 1:
      set @variables.b = 2
    | Invalid template 2
    set @variables.c = 3
  after_reasoning:
    | Invalid template 3
    set @variables.d = 4
`;
    const result = parseWithDiagnostics(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'template-in-deterministic-procedure'
    );
    // Should find 3 template errors (2 in before_reasoning, 1 in after_reasoning)
    expect(errors).toHaveLength(3);
  });
});
