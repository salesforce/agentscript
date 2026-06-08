/**
 * Knowledge block compilation tests -- ported from Python test_knowledge_compilation.py.
 *
 * Covers:
 *  - Knowledge block fields flowing into additional_parameters (rag_feature_config_id)
 *  - Knowledge fields registered in CompilerContext for eager @knowledge resolution
 *  - @knowledge references resolved in expressions
 *  - Error diagnostics for missing knowledge block, invalid fields, and undefined values
 *  - citations_enabled and citations_url field handling
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import { MemberExpression, AtIdentifier } from '@agentscript/language';
import { compile } from '../src/compile.js';
import type { CompileResult } from '../src/compile.js';
import type { InputParameter } from '../src/types.js';
import { CompilerContext } from '../src/compiler-context.js';
import { compileExpression } from '../src/expressions/compile-expression.js';
import { validateKnowledgeReferences } from '../src/validation/validate-knowledge-refs.js';
import { extractAdditionalParameters } from '../src/config/agent-configuration.js';
import { parseSource } from './test-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compile an inline .agent source string and return the CompileResult. */
function compileSource(source: string): CompileResult {
  const ast = parseSource(source);
  return compile(ast);
}

// ---------------------------------------------------------------------------
// Knowledge block -> additional_parameters (full pipeline)
// ---------------------------------------------------------------------------

describe('knowledge: additional_parameters extraction', () => {
  it('should extract rag_feature_config_id into additional_parameters', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_ProductKnowledge_12345"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.rag_feature_config_id).toBe('ARFPC_ProductKnowledge_12345');
  });

  it('should include rag_feature_config_id alongside other additional_parameters', () => {
    const source = `
config:
    agent_name: "TestBot"
    debug: True

knowledge:
    rag_feature_config_id: "ARFPC_123"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
    expect(params?.debug).toBe(true);
  });

  it('should not include additional_parameters.rag_feature_config_id when knowledge block is absent', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    // additional_parameters may still exist for reset_to_initial_node, but
    // should not contain rag_feature_config_id
    expect(params?.rag_feature_config_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Knowledge block with citations fields
// ---------------------------------------------------------------------------

describe('knowledge: citations fields', () => {
  it('should compile knowledge block with citations_enabled=true', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: True

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    // rag_feature_config_id flows to additional_parameters
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
    // No errors expected
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should compile knowledge block with citations_url', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_url: "https://help.example.com"

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should compile knowledge block with all fields', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_ProductKnowledge_12345"
    citations_enabled: True
    citations_url: "https://help.example.com"

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.rag_feature_config_id).toBe('ARFPC_ProductKnowledge_12345');
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should compile knowledge block with citations_enabled=false', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: False

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// validateKnowledgeReferences — populates ctx.knowledgeFields
// ---------------------------------------------------------------------------

describe('knowledge: validateKnowledgeReferences', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = new CompilerContext();
  });

  it('should populate knowledgeFields from knowledge block', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: True
    citations_url: "https://help.example.com"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    validateKnowledgeReferences(ast.knowledge, ctx);

    expect(ctx.knowledgeFields.get('rag_feature_config_id')).toBe('ARFPC_123');
    expect(ctx.knowledgeFields.get('citations_url')).toBe(
      'https://help.example.com'
    );
  });

  it('should not populate knowledgeFields when knowledge block is undefined', () => {
    validateKnowledgeReferences(undefined, ctx);
    expect(ctx.knowledgeFields.size).toBe(0);
  });

  it('should skip internal metadata keys starting with __', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    validateKnowledgeReferences(ast.knowledge, ctx);

    // Should have rag_feature_config_id but no __cst or __kind entries
    const keys = Array.from(ctx.knowledgeFields.keys());
    expect(keys.every(k => !k.startsWith('__'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// extractAdditionalParameters — unit-level
// ---------------------------------------------------------------------------

describe('knowledge: extractAdditionalParameters', () => {
  it('should extract rag_feature_config_id from knowledge block', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const params = extractAdditionalParameters(ast.config, ast.knowledge);
    expect(params).toBeDefined();
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
  });

  it('should return undefined when no additional parameters exist', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const params = extractAdditionalParameters(ast.config, ast.knowledge);
    expect(params).toBeUndefined();
  });

  it('should merge config and knowledge additional parameters', () => {
    const source = `
config:
    agent_name: "TestBot"
    debug: True

knowledge:
    rag_feature_config_id: "ARFPC_123"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const params = extractAdditionalParameters(ast.config, ast.knowledge);
    expect(params).toBeDefined();
    expect(params?.debug).toBe(true);
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
  });
});

// ---------------------------------------------------------------------------
// @knowledge references in expressions (via CompilerContext)
// ---------------------------------------------------------------------------

describe('knowledge: @knowledge expression resolution', () => {
  let ctx: CompilerContext;

  beforeEach(() => {
    ctx = new CompilerContext();
  });

  // Python: test_compile_expression_with_knowledge_reference (rag_feature_config_id)
  it('should resolve @knowledge.rag_feature_config_id from context', () => {
    ctx.knowledgeFields.set('rag_feature_config_id', 'ARFPC_123');
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'rag_feature_config_id'
    );
    expect(compileExpression(expr, ctx)).toBe('ARFPC_123');
  });

  // Python: test_compile_expression_with_knowledge_reference (citations_url)
  it('should resolve @knowledge.citations_url from context', () => {
    ctx.knowledgeFields.set('citations_url', 'https://help.example.com');
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_url'
    );
    expect(compileExpression(expr, ctx)).toBe('https://help.example.com');
  });

  // Python: test_compile_expression_with_knowledge_reference (citations_enabled)
  it('should resolve @knowledge.citations_enabled from context', () => {
    ctx.knowledgeFields.set('citations_enabled', 'True');
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_enabled'
    );
    expect(compileExpression(expr, ctx)).toBe('True');
  });

  // Python: test_compile_expression_with_knowledge_reference_no_block
  it('should error for @knowledge.field when no knowledge fields are registered', () => {
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'rag_feature_config_id'
    );
    const result = compileExpression(expr, ctx);
    expect(result).toBe('');
    expect(
      ctx.diagnostics.some(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.message.includes('rag_feature_config_id')
      )
    ).toBe(true);
  });

  // Python: test_compile_expression_with_invalid_knowledge_field
  it('should error for @knowledge.invalid_field', () => {
    ctx.knowledgeFields.set('rag_feature_config_id', 'ARFPC_123');
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'invalid_field'
    );
    const result = compileExpression(expr, ctx);
    expect(result).toBe('');
    expect(
      ctx.diagnostics.some(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.message.includes('invalid_field')
      )
    ).toBe(true);
  });

  it('should resolve multiple different @knowledge fields independently', () => {
    ctx.knowledgeFields.set('rag_feature_config_id', 'ARFPC_123');
    ctx.knowledgeFields.set('citations_url', 'https://help.example.com');
    ctx.knowledgeFields.set('citations_enabled', 'True');

    const expr1 = new MemberExpression(
      new AtIdentifier('knowledge'),
      'rag_feature_config_id'
    );
    const expr2 = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_url'
    );
    const expr3 = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_enabled'
    );

    expect(compileExpression(expr1, ctx)).toBe('ARFPC_123');
    expect(compileExpression(expr2, ctx)).toBe('https://help.example.com');
    expect(compileExpression(expr3, ctx)).toBe('True');
    expect(ctx.diagnostics).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Full-pipeline @knowledge reference resolution
// ---------------------------------------------------------------------------

describe('knowledge: full pipeline @knowledge in expressions', () => {
  it('should register knowledge fields so expressions resolve during compilation', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_ProductKnowledge_12345"
    citations_enabled: True
    citations_url: "https://help.example.com"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    // The knowledge block should compile without errors
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should produce no errors when knowledge block has only rag_feature_config_id', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should produce no errors when knowledge block has citations_enabled without citations_url', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: True

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should produce no errors when knowledge block has citations_enabled=false without citations_url', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: False

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error diagnostics for @knowledge references
// ---------------------------------------------------------------------------

describe('knowledge: error diagnostics', () => {
  it('should error when @knowledge reference used but no knowledge block exists', () => {
    // Directly exercise the expression compiler with no knowledge fields
    const ctx = new CompilerContext();
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'rag_feature_config_id'
    );
    const result = compileExpression(expr, ctx);
    expect(result).toBe('');
    const errorDiag = ctx.diagnostics.find(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.message).toContain('rag_feature_config_id');
  });

  it('should error for @knowledge reference to a non-existent field', () => {
    const ctx = new CompilerContext();
    ctx.knowledgeFields.set('rag_feature_config_id', 'ARFPC_123');
    ctx.knowledgeFields.set('citations_url', 'https://help.example.com');

    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'nonexistent_field'
    );
    const result = compileExpression(expr, ctx);
    expect(result).toBe('');
    const errorDiag = ctx.diagnostics.find(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.message).toContain('nonexistent_field');
  });

  it('should error for bare @knowledge without property', () => {
    const ctx = new CompilerContext();
    const expr = new AtIdentifier('knowledge');
    compileExpression(expr, ctx);
    const errorDiag = ctx.diagnostics.find(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errorDiag).toBeDefined();
    expect(errorDiag?.message).toContain('@knowledge');
    expect(errorDiag?.message).toContain('property');
  });

  it('should return empty string for unknown @knowledge field', () => {
    const ctx = new CompilerContext();
    const expr = new MemberExpression(new AtIdentifier('knowledge'), 'unknown');
    const result = compileExpression(expr, ctx);
    expect(result).toBe('');
  });

  it('should include field name in error message for unknown @knowledge field', () => {
    const ctx = new CompilerContext();
    const expr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_bogus'
    );
    compileExpression(expr, ctx);
    const errorDiag = ctx.diagnostics.find(
      d =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes('citations_bogus')
    );
    expect(errorDiag).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('knowledge: edge cases', () => {
  it('should handle knowledge block with no rag_feature_config_id (only citations)', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_enabled: True
    citations_url: "https://help.example.com"

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    // Without rag_feature_config_id, it should not appear in additional_parameters
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.rag_feature_config_id).toBeUndefined();
    // No compile errors
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('should still compile other parts of the agent when knowledge block is present', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: True
    citations_url: "https://help.example.com"

start_agent main:
    description: "Test topic"
    reasoning:
        instructions: "Do things"
`;
    const { output } = compileSource(source);
    expect(output.schema_version).toBe('2.0');
    expect(output.global_configuration.developer_name).toBe('TestBot');
    expect(output.agent_version.initial_node).toBe('main');
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.rag_feature_config_id).toBe('ARFPC_123');
  });

  it('should populate knowledge fields for downstream expression resolution during full compile', () => {
    // Verifies the full pipeline: knowledge block -> validateKnowledgeReferences
    // -> ctx.knowledgeFields populated -> expressions can resolve @knowledge refs
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    rag_feature_config_id: "ARFPC_123"
    citations_enabled: True
    citations_url: "https://help.example.com"

start_agent main:
    description: "desc"
`;
    // We confirm this works by checking no errors are emitted.
    // Expression resolution of @knowledge happens inside action parameter
    // defaults and reasoning conditions, which are tested at the unit level above.
    const { diagnostics } = compileSource(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Boolean value extraction
// ---------------------------------------------------------------------------

describe('knowledge: boolean value extraction', () => {
  it('should extract boolean True from knowledge block', () => {
    const ctx = new CompilerContext();
    const knowledge = {
      citations_enabled: true,
    };

    validateKnowledgeReferences(knowledge, ctx);
    expect(ctx.knowledgeFields.get('citations_enabled')).toBe(true);
  });

  it('should extract boolean False from knowledge block', () => {
    const ctx = new CompilerContext();
    const knowledge = {
      citations_enabled: false,
    };

    validateKnowledgeReferences(knowledge, ctx);
    expect(ctx.knowledgeFields.get('citations_enabled')).toBe(false);
  });

  it('should handle mixed string and boolean knowledge values', () => {
    const ctx = new CompilerContext();
    const knowledge = {
      citations_url: 'https://api.example.com',
      citations_enabled: true,
      rag_feature_config_id: 'WorldKnowledge',
    };

    validateKnowledgeReferences(knowledge, ctx);

    expect(ctx.knowledgeFields.get('citations_url')).toBe(
      'https://api.example.com'
    );
    expect(ctx.knowledgeFields.get('citations_enabled')).toBe(true);
    expect(ctx.knowledgeFields.get('rag_feature_config_id')).toBe(
      'WorldKnowledge'
    );
  });

  it('should resolve @knowledge boolean in expressions to "True" or "False" strings', () => {
    const ctx = new CompilerContext();
    ctx.knowledgeFields.set('citations_enabled', true);

    const trueExpr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_enabled'
    );

    expect(compileExpression(trueExpr, ctx)).toBe('True');

    // Test False case
    ctx.knowledgeFields.set('citations_enabled', false);
    const falseExpr = new MemberExpression(
      new AtIdentifier('knowledge'),
      'citations_enabled'
    );

    expect(compileExpression(falseExpr, ctx)).toBe('False');
  });

  it('should use boolean knowledge values in action constant_value fields', () => {
    const source = `
config:
    agent_name: "TestBot"

knowledge:
    citations_enabled: True
    rag_feature_config_id: "WorldKnowledge"

start_agent main:
    description: "Test"
    actions:
      test_action:
        target: "flow://Action"
        inputs:
          cite: boolean = @knowledge.citations_enabled
          rag_id: string = @knowledge.rag_feature_config_id
`;
    const { output } = compileSource(source);
    const node = output.agent_version.nodes[0];
    const params = node.action_definitions[0].input_type;

    const citeParam = params.find(
      (p: InputParameter) => p.developer_name === 'cite'
    );
    const ragIdParam = params.find(
      (p: InputParameter) => p.developer_name === 'rag_id'
    );

    expect(citeParam!.constant_value).toBe(true);
    expect(ragIdParam!.constant_value).toBe('WorldKnowledge');
  });
});
