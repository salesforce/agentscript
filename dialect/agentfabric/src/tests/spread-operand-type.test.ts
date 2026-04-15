import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import {
  Dialect,
  NamedBlock,
  NamedCollectionBlock,
  ExpressionValue,
  LintEngine,
  createSchemaContext,
} from '@agentscript/language';
import { spreadOperandTypePass } from '../lint/passes/spread-operand-type.js';

const ValueBlock = NamedBlock('ValueBlock', {
  expr: ExpressionValue.describe('An expression'),
});

const TestSchema = {
  value: NamedCollectionBlock(ValueBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [spreadOperandTypePass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => d.code === 'non-iterable-spread');
}

describe('spread-operand-type lint pass', () => {
  it('allows spread of a variable reference', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*items)
`);
    expect(diags).toHaveLength(0);
  });

  it('allows spread of a member expression', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*@variables.artifacts)
`);
    expect(diags).toHaveLength(0);
  });

  it('allows spread of a call expression', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*other())
`);
    expect(diags).toHaveLength(0);
  });

  it('flags spread of None', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*None)
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('None');
  });

  it('flags spread of a number', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*42)
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('number');
  });

  it('flags spread of a boolean', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*True)
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('boolean');
  });

  it('flags spread of a string literal', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*"hello")
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('string');
  });

  it('allows spread in a list literal (of a valid operand)', () => {
    const diags = getDiagnostics(`
value v:
    expr: [*items, extra]
`);
    expect(diags).toHaveLength(0);
  });

  it('flags spread of None inside a list literal', () => {
    const diags = getDiagnostics(`
value v:
    expr: [*None, extra]
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('None');
  });
});
