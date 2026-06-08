import { expect, test } from 'vitest';
import {
  Template,
  WithClause,
  SetClause,
  ToClause,
  AvailableWhen,
  RunStatement,
  IfStatement,
  Identifier,
  AtIdentifier,
  MemberExpression,
  BooleanLiteral,
  StringLiteral,
  ComparisonExpression,
  TemplateText,
  TemplateInterpolation,
  ProcedureValue,
} from '@agentscript/language';
import type { SyntaxNode } from '@agentscript/types';

const ctx = { indent: 0 };

/** Helper to create a Template with a single text part. */
function tpl(text: string): Template {
  return new Template([new TemplateText(text)]);
}

/** Simulate the CST node type the parser would attach (e.g. 'template', 'mapping', 'procedure'). */
function simulateParserCstNodeType(pv: ProcedureValue, type: string): void {
  pv.__cst = {
    node: { type } as unknown as SyntaxNode,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
  };
}

// Template

test('Template emits pipe prefix', () => {
  expect(tpl('Hello world').__emit(ctx)).toBe('|Hello world');
});

test('Template emits with indentation', () => {
  expect(tpl('Indented content').__emit({ indent: 2 })).toBe(
    '        |Indented content'
  );
});

test('Template emits empty content', () => {
  expect(new Template([]).__emit(ctx)).toBe('|');
});

test('Template emits with interpolation', () => {
  const t = new Template([
    new TemplateText('Call '),
    new TemplateInterpolation(
      new MemberExpression(new AtIdentifier('actions'), 'fetch')
    ),
    new TemplateText(' now'),
  ]);
  expect(t.__emit(ctx)).toBe('|Call {!@actions.fetch} now');
});

test('Template content getter reconstructs full string', () => {
  const t = new Template([
    new TemplateText('Hello '),
    new TemplateInterpolation(new Identifier('name')),
  ]);
  expect(t.content).toBe('Hello {!name}');
});

test('Template with only interpolation, no text', () => {
  const t = new Template([
    new TemplateInterpolation(
      new MemberExpression(new AtIdentifier('actions'), 'fetch')
    ),
  ]);
  expect(t.__emit(ctx)).toBe('|{!@actions.fetch}');
  expect(t.content).toBe('{!@actions.fetch}');
});

test('Template with adjacent interpolations', () => {
  const t = new Template([
    new TemplateInterpolation(new Identifier('x')),
    new TemplateInterpolation(new Identifier('y')),
  ]);
  expect(t.__emit(ctx)).toBe('|{!x}{!y}');
});

// WithClause

test('WithClause emits with param=value', () => {
  const clause = new WithClause('name', new StringLiteral('Alice'));
  expect(clause.__emit(ctx)).toBe('with name = "Alice"');
});

test('WithClause emits with reference value', () => {
  const clause = new WithClause(
    'profile_id',
    new MemberExpression(new AtIdentifier('variables'), 'id')
  );
  expect(clause.__emit(ctx)).toBe('with profile_id = @variables.id');
});

test('WithClause emits with indentation', () => {
  const clause = new WithClause('x', new Identifier('y'));
  expect(clause.__emit({ indent: 1 })).toBe('    with x = y');
});

// SetClause

test('SetClause emits set target=value', () => {
  const clause = new SetClause(
    new MemberExpression(new AtIdentifier('variables'), 'result'),
    new MemberExpression(new AtIdentifier('outputs'), 'data')
  );
  expect(clause.__emit(ctx)).toBe('set @variables.result = @outputs.data');
});

test('SetClause emits with simple identifiers', () => {
  const clause = new SetClause(new Identifier('x'), new Identifier('y'));
  expect(clause.__emit(ctx)).toBe('set x = y');
});

test('SetClause emits with indentation', () => {
  const clause = new SetClause(
    new AtIdentifier('result'),
    new StringLiteral('done')
  );
  expect(clause.__emit({ indent: 2 })).toBe('        set @result = "done"');
});

// ToClause

test('ToClause emits to target', () => {
  const clause = new ToClause(
    new MemberExpression(new AtIdentifier('subagent'), 'main')
  );
  expect(clause.__emit(ctx)).toBe('to @subagent.main');
});

test('ToClause emits with simple reference', () => {
  const clause = new ToClause(new AtIdentifier('next_topic'));
  expect(clause.__emit(ctx)).toBe('to @next_topic');
});

test('ToClause emits with indentation', () => {
  const clause = new ToClause(new AtIdentifier('target'));
  expect(clause.__emit({ indent: 1 })).toBe('    to @target');
});

// AvailableWhen

test('AvailableWhen emits available when condition', () => {
  const stmt = new AvailableWhen(new BooleanLiteral(true));
  expect(stmt.__emit(ctx)).toBe('available when True');
});

test('AvailableWhen emits with comparison', () => {
  const condition = new ComparisonExpression(
    new MemberExpression(new AtIdentifier('variables'), 'status'),
    '==',
    new StringLiteral('active')
  );
  const stmt = new AvailableWhen(condition);
  expect(stmt.__emit(ctx)).toBe('available when @variables.status == "active"');
});

test('AvailableWhen emits with indentation', () => {
  const stmt = new AvailableWhen(new Identifier('condition'));
  expect(stmt.__emit({ indent: 1 })).toBe('    available when condition');
});

// RunStatement

test('RunStatement emits run target', () => {
  const stmt = new RunStatement(
    new MemberExpression(new AtIdentifier('actions'), 'fetch_data'),
    []
  );
  expect(stmt.__emit(ctx)).toBe('run @actions.fetch_data');
});

test('RunStatement emits with body clauses', () => {
  const stmt = new RunStatement(new AtIdentifier('my_action'), [
    new WithClause('x', new StringLiteral('value')),
    new SetClause(new AtIdentifier('result'), new AtIdentifier('output')),
  ]);
  expect(stmt.__emit(ctx)).toBe(
    'run @my_action\n    with x = "value"\n    set @result = @output'
  );
});

test('RunStatement emits with indentation', () => {
  const stmt = new RunStatement(new AtIdentifier('action'), []);
  expect(stmt.__emit({ indent: 1 })).toBe('    run @action');
});

// IfStatement

test('IfStatement emits if condition:', () => {
  const stmt = new IfStatement(new BooleanLiteral(true), [tpl('Then do this')]);
  expect(stmt.__emit(ctx)).toBe('if True:\n    |Then do this');
});

test('IfStatement emits with comparison condition', () => {
  const condition = new ComparisonExpression(
    new Identifier('x'),
    '>',
    new Identifier('y')
  );
  const stmt = new IfStatement(condition, [tpl('x is greater')]);
  expect(stmt.__emit(ctx)).toBe('if x > y:\n    |x is greater');
});

test('IfStatement emits with else (orelse)', () => {
  const stmt = new IfStatement(
    new BooleanLiteral(true),
    [tpl('if body')],
    [tpl('else body')]
  );
  expect(stmt.__emit(ctx)).toBe(
    'if True:\n    |if body\nelse:\n    |else body'
  );
});

test('IfStatement emits with indentation', () => {
  const stmt = new IfStatement(new Identifier('cond'), [tpl('indented')]);
  expect(stmt.__emit({ indent: 1 })).toBe('    if cond:\n        |indented');
});

// IfStatement with elif (Python-style: elif is IfStatement in orelse)

test('IfStatement emits elif (single IfStatement in orelse)', () => {
  const stmt = new IfStatement(
    new BooleanLiteral(true),
    [tpl('if body')],
    [
      new IfStatement(
        new ComparisonExpression(
          new Identifier('x'),
          '==',
          new StringLiteral('b')
        ),
        [tpl('elif body')]
      ),
    ]
  );
  expect(stmt.__emit(ctx)).toBe(
    'if True:\n    |if body\nelif x == "b":\n    |elif body'
  );
});

test('IfStatement emits elif with else', () => {
  const stmt = new IfStatement(
    new Identifier('cond'),
    [tpl('if')],
    [new IfStatement(new Identifier('cond2'), [tpl('elif')], [tpl('else')])]
  );
  expect(stmt.__emit(ctx)).toBe(
    'if cond:\n    |if\nelif cond2:\n    |elif\nelse:\n    |else'
  );
});

// Else with multiple statements

test('IfStatement emits else with multiple body statements', () => {
  const stmt = new IfStatement(
    new BooleanLiteral(true),
    [tpl('if')],
    [tpl('line 1'), tpl('line 2')]
  );
  expect(stmt.__emit(ctx)).toBe(
    'if True:\n    |if\nelse:\n    |line 1\n    |line 2'
  );
});

test('IfStatement emits else with indentation', () => {
  const stmt = new IfStatement(
    new BooleanLiteral(true),
    [tpl('if body')],
    [tpl('indented')]
  );
  expect(stmt.__emit({ indent: 1 })).toBe(
    '    if True:\n        |if body\n    else:\n        |indented'
  );
});

// Complex nested structures

test('IfStatement with elif and else chain (Python-style)', () => {
  // if x == "a": case a / elif x == "b": case b / else: default
  const stmt = new IfStatement(
    new ComparisonExpression(new Identifier('x'), '==', new StringLiteral('a')),
    [tpl('case a')],
    [
      new IfStatement(
        new ComparisonExpression(
          new Identifier('x'),
          '==',
          new StringLiteral('b')
        ),
        [tpl('case b')],
        [tpl('default')]
      ),
    ]
  );
  expect(stmt.__emit(ctx)).toBe(
    'if x == "a":\n    |case a\nelif x == "b":\n    |case b\nelse:\n    |default'
  );
});

test('IfStatement with multiple elifs (Python-style)', () => {
  // if x == "a": case a / elif x == "b": case b / elif x == "c": case c / else: default
  const stmt = new IfStatement(
    new ComparisonExpression(new Identifier('x'), '==', new StringLiteral('a')),
    [tpl('case a')],
    [
      new IfStatement(
        new ComparisonExpression(
          new Identifier('x'),
          '==',
          new StringLiteral('b')
        ),
        [tpl('case b')],
        [
          new IfStatement(
            new ComparisonExpression(
              new Identifier('x'),
              '==',
              new StringLiteral('c')
            ),
            [tpl('case c')],
            [tpl('default')]
          ),
        ]
      ),
    ]
  );
  expect(stmt.__emit(ctx)).toBe(
    'if x == "a":\n    |case a\nelif x == "b":\n    |case b\nelif x == "c":\n    |case c\nelse:\n    |default'
  );
});

test('RunStatement with nested clauses preserves structure', () => {
  const stmt = new RunStatement(
    new MemberExpression(new AtIdentifier('actions'), 'process'),
    [
      new WithClause('input', new AtIdentifier('data')),
      new ToClause(new MemberExpression(new AtIdentifier('subagent'), 'next')),
    ]
  );
  expect(stmt.__emit(ctx)).toBe(
    'run @actions.process\n    with input = @data\n    to @subagent.next'
  );
});

// ProcedureValue.__emit (body-level)

test('ProcedureValue emits single template', () => {
  const pv = new ProcedureValue([tpl('Hello')]);
  expect(pv.__emit(ctx)).toBe('|Hello');
});

test('ProcedureValue emits multiple templates', () => {
  const pv = new ProcedureValue([tpl('line one'), tpl('line two')]);
  expect(pv.__emit(ctx)).toBe('|line one\n|line two');
});

test('ProcedureValue emits mixed statements (template + run)', () => {
  const pv = new ProcedureValue([
    tpl('Do something'),
    new RunStatement(new AtIdentifier('action'), []),
  ]);
  expect(pv.__emit(ctx)).toBe('|Do something\nrun @action');
});

// ProcedureValue.emitField — bare pipe (CST type = 'template')

test('ProcedureValue.emitField: bare pipe single line', () => {
  const pv = new ProcedureValue([tpl('content')]);
  simulateParserCstNodeType(pv, 'template');
  expect(ProcedureValue.emitField('instructions', pv, ctx)).toBe(
    'instructions: |content'
  );
});

test('ProcedureValue.emitField: bare pipe empty', () => {
  const pv = new ProcedureValue([new Template([])]);
  simulateParserCstNodeType(pv, 'template');
  expect(ProcedureValue.emitField('instructions', pv, ctx)).toBe(
    'instructions: |'
  );
});

test('ProcedureValue.emitField: bare pipe with indentation', () => {
  const pv = new ProcedureValue([tpl('content')]);
  simulateParserCstNodeType(pv, 'template');
  expect(ProcedureValue.emitField('instructions', pv, { indent: 2 })).toBe(
    '        instructions: |content'
  );
});

// ProcedureValue.emitField — block pipe (CST type = 'mapping')

test('ProcedureValue.emitField: block pipe single line', () => {
  const pv = new ProcedureValue([tpl('content')]);
  simulateParserCstNodeType(pv, 'mapping');
  expect(ProcedureValue.emitField('instructions', pv, ctx)).toBe(
    'instructions:\n    |content'
  );
});

test('ProcedureValue.emitField: block pipe with indentation', () => {
  const pv = new ProcedureValue([tpl('content')]);
  simulateParserCstNodeType(pv, 'mapping');
  expect(ProcedureValue.emitField('instructions', pv, { indent: 1 })).toBe(
    '    instructions:\n        |content'
  );
});

// ProcedureValue.emitField — arrow form (default / multiple statements)

test('ProcedureValue.emitField: arrow fallback when no CST', () => {
  const pv = new ProcedureValue([tpl('content')]);
  expect(ProcedureValue.emitField('instructions', pv, ctx)).toBe(
    'instructions: ->\n    |content'
  );
});

test('ProcedureValue.emitField: arrow when multiple templates', () => {
  const pv = new ProcedureValue([tpl('line one'), tpl('line two')]);
  expect(ProcedureValue.emitField('instructions', pv, ctx)).toBe(
    'instructions: ->\n    |line one\n    |line two'
  );
});

test('ProcedureValue.emitField: arrow when mixed statements', () => {
  const pv = new ProcedureValue([
    tpl('text'),
    new RunStatement(new AtIdentifier('action'), []),
  ]);
  expect(ProcedureValue.emitField('instructions', pv, ctx)).toBe(
    'instructions: ->\n    |text\n    run @action'
  );
});

test('ProcedureValue.emitField: arrow with indentation', () => {
  const pv = new ProcedureValue([tpl('content')]);
  expect(ProcedureValue.emitField('instructions', pv, { indent: 1 })).toBe(
    '    instructions: ->\n        |content'
  );
});
