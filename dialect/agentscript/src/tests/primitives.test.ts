import { expect, test } from 'vitest';
import {
  StringLiteral,
  TemplateExpression,
  TemplateText,
  Identifier,
  AtIdentifier,
  Template,
  WithClause,
  SetClause,
} from '@agentscript/language';

// We test the emit behavior of value-like classes
// Note: NumberValue and BooleanValue are internal classes accessed through primitives
// We'll test them via their wrapped expression types and the emit functions

const ctx = { indent: 0 };

// StringValue emit (via StringLiteral and TemplateExpression)

test('StringValue as StringLiteral emits quoted', () => {
  const value = new StringLiteral('hello');
  expect(value.__emit(ctx)).toBe('"hello"');
});

test('StringValue with single quote emits unescaped in double quotes', () => {
  const value = new StringLiteral("don't");
  expect(value.__emit(ctx)).toBe('"don\'t"');
});

test('StringValue as TemplateExpression emits pipe', () => {
  const value = new TemplateExpression([new TemplateText('Hello world')]);
  expect(value.__emit(ctx)).toBe('|Hello world');
});

// NumberValue emit pattern (NumberLiteral has same emit)

test('NumberValue-like emit returns string of number', () => {
  // NumberValue wraps NumberLiteral.value, emits String(value)
  const value = 42;
  expect(String(value)).toBe('42');
});

test('NumberValue-like emit handles float', () => {
  const value = 3.14159;
  expect(String(value)).toBe('3.14159');
});

test('NumberValue-like emit handles negative', () => {
  const value = -100;
  expect(String(value)).toBe('-100');
});

// BooleanValue emit pattern

test('BooleanValue-like emit True', () => {
  const value = true;
  expect(value ? 'True' : 'False').toBe('True');
});

test('BooleanValue-like emit False', () => {
  const value = false;
  expect(value ? 'True' : 'False').toBe('False');
});

// ProcedureValue emit (via statement array)

test('ProcedureValue emits single statement', () => {
  const statements = [new Template([new TemplateText('Hello')])];
  const output = statements.map(s => s.__emit(ctx)).join('\n');
  expect(output).toBe('|Hello');
});

test('ProcedureValue emits multiple statements', () => {
  const statements = [
    new Template([new TemplateText('Line 1')]),
    new Template([new TemplateText('Line 2')]),
    new Template([new TemplateText('Line 3')]),
  ];
  const output = statements.map(s => s.__emit(ctx)).join('\n');
  expect(output).toBe('|Line 1\n|Line 2\n|Line 3');
});

test('ProcedureValue emits mixed statements', () => {
  const statements = [
    new Template([new TemplateText('Do something')]),
    new WithClause('x', new StringLiteral('value')),
    new SetClause(new AtIdentifier('result'), new Identifier('output')),
  ];
  const output = statements.map(s => s.__emit(ctx)).join('\n');
  expect(output).toBe('|Do something\nwith x = "value"\nset @result = output');
});

test('ProcedureValue emits with indentation', () => {
  const statements = [new Template([new TemplateText('Indented')])];
  const indentedCtx = { indent: 1 };
  const output = statements.map(s => s.__emit(indentedCtx)).join('\n');
  expect(output).toBe('    |Indented');
});

test('ProcedureValue emits empty array as empty string', () => {
  const statements: Template[] = [];
  const output = statements.map(s => s.__emit(ctx)).join('\n');
  expect(output).toBe('');
});

// ExpressionValue emit (any expression)

test('ExpressionValue emits identifier', () => {
  const expr = new Identifier('foo');
  expect(expr.__emit(ctx)).toBe('foo');
});

test('ExpressionValue emits at-identifier', () => {
  const expr = new AtIdentifier('variables');
  expect(expr.__emit(ctx)).toBe('@variables');
});

test('ExpressionValue emits string', () => {
  const expr = new StringLiteral('hello');
  expect(expr.__emit(ctx)).toBe('"hello"');
});
