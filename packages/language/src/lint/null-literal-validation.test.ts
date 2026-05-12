import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from '../core/dialect.js';
import { NamedBlock, NamedCollectionBlock } from '../core/block.js';
import { ExpressionValue, ProcedureValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { nullLiteralValidationPass } from './null-literal-validation.js';

const ValueBlock = NamedBlock('ValueBlock', {
  expr: ExpressionValue.describe('An expression'),
});

const ActionBlock = NamedBlock(
  'ActionBlock',
  {},
  { colinear: ExpressionValue, body: ProcedureValue }
);

const TestSchema = {
  value: NamedCollectionBlock(ValueBlock),
  action: NamedCollectionBlock(ActionBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [nullLiteralValidationPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => d.code === 'null-not-allowed');
}

describe('null-literal-validation lint pass', () => {
  it('flags null used as an expression value', () => {
    const diags = getDiagnostics(`
value v:
    expr: null
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('null');
    expect(diags[0].message).toContain('None');
    expect(diags[0].severity).toBe(1); // Error
  });

  it('does not flag None (the correct keyword)', () => {
    const diags = getDiagnostics(`
value v:
    expr: None
`);
    expect(diags).toHaveLength(0);
  });

  it('does not flag identifiers that are not null', () => {
    const diags = getDiagnostics(`
value v:
    expr: some_variable
`);
    expect(diags).toHaveLength(0);
  });

  it('flags NULL (case-insensitive check)', () => {
    const diags = getDiagnostics(`
value v:
    expr: NULL
`);
    expect(diags).toHaveLength(1);
  });

  it('flags Null (case-insensitive check)', () => {
    const diags = getDiagnostics(`
value v:
    expr: Null
`);
    expect(diags).toHaveLength(1);
  });

  it('flags null in a binary expression', () => {
    const diags = getDiagnostics(`
value v:
    expr: null == None
`);
    expect(diags).toHaveLength(1);
  });

  it('flags null passed via a with-clause on an action invocation', () => {
    const diags = getDiagnostics(`
action some_action: @actions.Get_Details
    with order_number = null
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('null');
    expect(diags[0].message).toContain('None');
  });
});
