import { expect, test } from 'vitest';
import {
  StringLiteral,
  TemplateExpression,
  TemplateText,
  TemplateInterpolation,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  ListLiteral,
  DictLiteral,
  createNode,
  Ellipsis,
  TEMPLATE_PART_KINDS,
  isTemplatePartKind,
  parseTemplateParts,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { SyntaxNode } from '@agentscript/types';

const ctx = { indent: 0 };

// StringLiteral

test('StringLiteral emits double-quoted string', () => {
  const lit = new StringLiteral('hello');
  expect(lit.__emit(ctx)).toBe('"hello"');
});

test('StringLiteral escapes embedded quotes', () => {
  const lit = new StringLiteral('say "hi"');
  expect(lit.__emit(ctx)).toBe('"say \\"hi\\""');
});

test('StringLiteral escapes backslashes', () => {
  const lit = new StringLiteral('path\\to\\file');
  expect(lit.__emit(ctx)).toBe('"path\\\\to\\\\file"');
});

test('StringLiteral handles empty string', () => {
  const lit = new StringLiteral('');
  expect(lit.__emit(ctx)).toBe('""');
});

// TemplateExpression

test('TemplateExpression emits single line with pipe prefix', () => {
  const tpl = new TemplateExpression([new TemplateText('Hello world')]);
  expect(tpl.__emit(ctx)).toBe('|Hello world');
});

test('TemplateExpression emits multi-line with continuation indented', () => {
  const tpl = new TemplateExpression([
    new TemplateText('Line 1\nLine 2\nLine 3'),
  ]);
  expect(tpl.__emit(ctx)).toBe('|Line 1\n    Line 2\n    Line 3');
});

test('TemplateExpression handles empty content', () => {
  const tpl = new TemplateExpression([]);
  expect(tpl.__emit(ctx)).toBe('|');
});

test('TemplateExpression emits with interpolation', () => {
  const tpl = new TemplateExpression([
    new TemplateText('Hello '),
    new TemplateInterpolation(
      new MemberExpression(new AtIdentifier('variables'), 'name')
    ),
    new TemplateText('!'),
  ]);
  expect(tpl.__emit(ctx)).toBe('|Hello {!@variables.name}!');
});

test('TemplateExpression content getter reconstructs full string', () => {
  const tpl = new TemplateExpression([
    new TemplateText('Hello '),
    new TemplateInterpolation(new Identifier('name')),
  ]);
  expect(tpl.content).toBe('Hello {!name}');
});

test('TemplateExpression with only interpolation, no text', () => {
  const tpl = new TemplateExpression([
    new TemplateInterpolation(
      new MemberExpression(new AtIdentifier('actions'), 'fetch')
    ),
  ]);
  expect(tpl.__emit(ctx)).toBe('|{!@actions.fetch}');
  expect(tpl.content).toBe('{!@actions.fetch}');
});

test('TemplateExpression with adjacent interpolations', () => {
  const tpl = new TemplateExpression([
    new TemplateInterpolation(new Identifier('x')),
    new TemplateInterpolation(new Identifier('y')),
  ]);
  expect(tpl.__emit(ctx)).toBe('|{!x}{!y}');
  expect(tpl.content).toBe('{!x}{!y}');
});

test('TemplateText.__describe() returns truncated preview', () => {
  const short = new TemplateText('Hello');
  expect(short.__describe()).toBe('template text "Hello"');

  const long = new TemplateText(
    'A very long template text that exceeds twenty characters'
  );
  expect(long.__describe()).toBe('template text "A very long template..."');
});

test('TemplateInterpolation.__describe() includes expression description', () => {
  const interp = new TemplateInterpolation(new Identifier('name'));
  expect(interp.__describe()).toBe('interpolation {!identifier "name"}');
});

// TemplatePartKind type system

test('TEMPLATE_PART_KINDS contains both part kinds', () => {
  expect(TEMPLATE_PART_KINDS.has('TemplateText')).toBe(true);
  expect(TEMPLATE_PART_KINDS.has('TemplateInterpolation')).toBe(true);
  expect(TEMPLATE_PART_KINDS.size).toBe(2);
});

test('isTemplatePartKind returns true for part kinds', () => {
  expect(isTemplatePartKind('TemplateText')).toBe(true);
  expect(isTemplatePartKind('TemplateInterpolation')).toBe(true);
});

test('isTemplatePartKind returns false for non-part kinds', () => {
  expect(isTemplatePartKind('StringLiteral')).toBe(false);
  expect(isTemplatePartKind('TemplateExpression')).toBe(false);
  expect(isTemplatePartKind('bogus')).toBe(false);
});

test('TemplateText.kind static matches instance __kind', () => {
  const t = new TemplateText('hello');
  expect(t.__kind).toBe(TemplateText.kind);
  expect(t.__kind).toBe('TemplateText');
});

test('TemplateInterpolation.kind static matches instance __kind', () => {
  const i = new TemplateInterpolation(new Identifier('x'));
  expect(i.__kind).toBe(TemplateInterpolation.kind);
  expect(i.__kind).toBe('TemplateInterpolation');
});

// parseTemplateParts — malformed / unexpected nodes

/** Minimal SyntaxNode stub for testing parseTemplateParts edge cases. */
function stubNode(
  type: string,
  namedChildren: Partial<SyntaxNode>[] = [],
  overrides: Partial<SyntaxNode> = {}
): SyntaxNode {
  return {
    type,
    text: '',
    namedChildren: namedChildren as SyntaxNode[],
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: 0 },
    childForFieldName: () => null,
    ...overrides,
  } as unknown as SyntaxNode;
}

test('parseTemplateParts produces diagnostic for malformed interpolation (no expression field)', () => {
  // template_expression child with no 'expression' field → fallback to TemplateText + warning
  const interpNode = stubNode('template_expression', [], {
    text: '{!}',
    childForFieldName: () => null,
  });
  const templateNode = stubNode('template', [interpNode]);

  const { parts, diagnostics } = parseTemplateParts(
    templateNode as SyntaxNode,
    () => new Identifier('unused')
  );

  expect(parts).toHaveLength(1);
  expect(parts[0].__kind).toBe('TemplateText');
  expect((parts[0] as TemplateText).value).toBe('{!}');

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].code).toBe('malformed-interpolation');
  expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
  expect(diagnostics[0].message).toContain('missing expression');
});

test('parseTemplateParts produces diagnostic for unexpected child node type', () => {
  // A child with an unexpected type (not template_content, not template_expression)
  const weirdNode = stubNode('ERROR', [], { text: 'garbage' });
  const templateNode = stubNode('template', [weirdNode]);

  const { parts, diagnostics } = parseTemplateParts(
    templateNode as SyntaxNode,
    () => new Identifier('unused')
  );

  // Unexpected nodes are NOT added to parts — only a diagnostic
  expect(parts).toHaveLength(0);

  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].code).toBe('unexpected-template-node');
  expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
  expect(diagnostics[0].message).toContain('ERROR');
});

test('parseTemplateParts handles mixed valid and invalid children', () => {
  const textNode = stubNode('template_content', [], { text: 'hello ' });
  const badInterp = stubNode('template_expression', [], {
    text: '{!}',
    childForFieldName: () => null,
  });
  const goodInterp = stubNode('template_expression', [], {
    text: '{!name}',
    childForFieldName: (name: string) =>
      name === 'expression'
        ? (stubNode('id', [], { text: 'name' }) as SyntaxNode)
        : null,
  });

  const templateNode = stubNode('template', [textNode, badInterp, goodInterp]);

  const { parts, diagnostics } = parseTemplateParts(
    templateNode as SyntaxNode,
    n => new Identifier(n.text)
  );

  // 3 parts: text, fallback text for bad interp, good interp
  expect(parts).toHaveLength(3);
  expect(parts[0].__kind).toBe('TemplateText');
  expect(parts[1].__kind).toBe('TemplateText'); // fallback
  expect(parts[2].__kind).toBe('TemplateInterpolation');

  // 1 diagnostic for the malformed interpolation
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].code).toBe('malformed-interpolation');
});

// NumberLiteral

test('NumberLiteral emits integer', () => {
  const num = new NumberLiteral(42);
  expect(num.__emit(ctx)).toBe('42');
});

test('NumberLiteral emits float', () => {
  const num = new NumberLiteral(3.14);
  expect(num.__emit(ctx)).toBe('3.14');
});

test('NumberLiteral emits negative number', () => {
  const num = new NumberLiteral(-5);
  expect(num.__emit(ctx)).toBe('-5');
});

test('NumberLiteral emits zero', () => {
  const num = new NumberLiteral(0);
  expect(num.__emit(ctx)).toBe('0');
});

// BooleanLiteral

test('BooleanLiteral emits True', () => {
  const bool = new BooleanLiteral(true);
  expect(bool.__emit(ctx)).toBe('True');
});

test('BooleanLiteral emits False', () => {
  const bool = new BooleanLiteral(false);
  expect(bool.__emit(ctx)).toBe('False');
});

// NoneLiteral

test('NoneLiteral emits None', () => {
  const none = new NoneLiteral();
  expect(none.__emit(ctx)).toBe('None');
});

// Identifier

test('Identifier emits plain name', () => {
  const id = new Identifier('foo');
  expect(id.__emit(ctx)).toBe('foo');
});

test('Identifier emits name with underscores', () => {
  const id = new Identifier('my_variable_name');
  expect(id.__emit(ctx)).toBe('my_variable_name');
});

// AtIdentifier

test('AtIdentifier emits @ prefix', () => {
  const id = new AtIdentifier('variables');
  expect(id.__emit(ctx)).toBe('@variables');
});

test('AtIdentifier emits @ with complex name', () => {
  const id = new AtIdentifier('my_action');
  expect(id.__emit(ctx)).toBe('@my_action');
});

// MemberExpression

test('MemberExpression emits object.property', () => {
  const expr = new MemberExpression(new Identifier('foo'), 'bar');
  expect(expr.__emit(ctx)).toBe('foo.bar');
});

test('MemberExpression emits @object.property', () => {
  const expr = new MemberExpression(new AtIdentifier('variables'), 'name');
  expect(expr.__emit(ctx)).toBe('@variables.name');
});

test('MemberExpression emits nested access', () => {
  const inner = new MemberExpression(new AtIdentifier('data'), 'user');
  const outer = new MemberExpression(inner, 'email');
  expect(outer.__emit(ctx)).toBe('@data.user.email');
});

// SubscriptExpression

test('SubscriptExpression emits array access with number', () => {
  const expr = new SubscriptExpression(
    new Identifier('items'),
    new NumberLiteral(0)
  );
  expect(expr.__emit(ctx)).toBe('items[0]');
});

test('SubscriptExpression emits dict access with string', () => {
  const expr = new SubscriptExpression(
    new Identifier('data'),
    new StringLiteral('key')
  );
  expect(expr.__emit(ctx)).toBe('data["key"]');
});

// BinaryExpression

test('BinaryExpression emits addition', () => {
  const expr = new BinaryExpression(
    new NumberLiteral(1),
    '+',
    new NumberLiteral(2)
  );
  expect(expr.__emit(ctx)).toBe('1 + 2');
});

test('BinaryExpression emits subtraction', () => {
  const expr = new BinaryExpression(
    new Identifier('a'),
    '-',
    new Identifier('b')
  );
  expect(expr.__emit(ctx)).toBe('a - b');
});

test('BinaryExpression emits multiplication', () => {
  const expr = new BinaryExpression(
    new Identifier('x'),
    '*',
    new NumberLiteral(3)
  );
  expect(expr.__emit(ctx)).toBe('x * 3');
});

test('BinaryExpression emits division', () => {
  const expr = new BinaryExpression(
    new NumberLiteral(10),
    '/',
    new NumberLiteral(2)
  );
  expect(expr.__emit(ctx)).toBe('10 / 2');
});

test('BinaryExpression emits and', () => {
  const expr = new BinaryExpression(
    new Identifier('a'),
    'and',
    new Identifier('b')
  );
  expect(expr.__emit(ctx)).toBe('a and b');
});

test('BinaryExpression emits or', () => {
  const expr = new BinaryExpression(
    new Identifier('x'),
    'or',
    new Identifier('y')
  );
  expect(expr.__emit(ctx)).toBe('x or y');
});

// UnaryExpression

test('UnaryExpression emits not', () => {
  const expr = new UnaryExpression('not', new Identifier('done'));
  expect(expr.__emit(ctx)).toBe('not done');
});

test('UnaryExpression emits negative', () => {
  const expr = new UnaryExpression('-', new NumberLiteral(5));
  expect(expr.__emit(ctx)).toBe('-5');
});

test('UnaryExpression emits positive', () => {
  const expr = new UnaryExpression('+', new Identifier('x'));
  expect(expr.__emit(ctx)).toBe('+x');
});

// ComparisonExpression

test('ComparisonExpression emits ==', () => {
  const expr = new ComparisonExpression(
    new Identifier('a'),
    '==',
    new NumberLiteral(1)
  );
  expect(expr.__emit(ctx)).toBe('a == 1');
});

test('ComparisonExpression emits !=', () => {
  const expr = new ComparisonExpression(
    new Identifier('x'),
    '!=',
    new Identifier('y')
  );
  expect(expr.__emit(ctx)).toBe('x != y');
});

test('ComparisonExpression emits <', () => {
  const expr = new ComparisonExpression(
    new Identifier('age'),
    '<',
    new NumberLiteral(18)
  );
  expect(expr.__emit(ctx)).toBe('age < 18');
});

test('ComparisonExpression emits >', () => {
  const expr = new ComparisonExpression(
    new Identifier('count'),
    '>',
    new NumberLiteral(0)
  );
  expect(expr.__emit(ctx)).toBe('count > 0');
});

test('ComparisonExpression emits <=', () => {
  const expr = new ComparisonExpression(
    new Identifier('x'),
    '<=',
    new NumberLiteral(10)
  );
  expect(expr.__emit(ctx)).toBe('x <= 10');
});

test('ComparisonExpression emits >=', () => {
  const expr = new ComparisonExpression(
    new Identifier('y'),
    '>=',
    new NumberLiteral(0)
  );
  expect(expr.__emit(ctx)).toBe('y >= 0');
});

test('ComparisonExpression emits is', () => {
  const expr = new ComparisonExpression(
    new Identifier('value'),
    'is',
    new NoneLiteral()
  );
  expect(expr.__emit(ctx)).toBe('value is None');
});

test('ComparisonExpression emits is not', () => {
  const expr = new ComparisonExpression(
    new Identifier('data'),
    'is not',
    new NoneLiteral()
  );
  expect(expr.__emit(ctx)).toBe('data is not None');
});

// ListLiteral

test('ListLiteral emits empty list', () => {
  const list = new ListLiteral([]);
  expect(list.__emit(ctx)).toBe('[]');
});

test('ListLiteral emits list with elements', () => {
  const list = new ListLiteral([
    new NumberLiteral(1),
    new NumberLiteral(2),
    new NumberLiteral(3),
  ]);
  expect(list.__emit(ctx)).toBe('[1, 2, 3]');
});

test('ListLiteral emits list with mixed types', () => {
  const list = new ListLiteral([
    new StringLiteral('hello'),
    new NumberLiteral(42),
    new BooleanLiteral(true),
  ]);
  expect(list.__emit(ctx)).toBe('["hello", 42, True]');
});

// ListLiteral.parse

test('ListLiteral.parse parses list with string elements', () => {
  const node = stubNode('list', [
    stubNode('expression', [], { text: 'a' }),
    stubNode('expression', [], { text: 'b' }),
    stubNode('expression', [], { text: 'c' }),
  ]);
  const result = ListLiteral.parse(node, n => new StringLiteral(n.text));
  expect(result.elements).toHaveLength(3);
  expect(result.__emit(ctx)).toBe('["a", "b", "c"]');
});

test('ListLiteral.parse parses empty list', () => {
  const node = stubNode('list', []);
  const result = ListLiteral.parse(node, n => new StringLiteral(n.text));
  expect(result.elements).toHaveLength(0);
  expect(result.__emit(ctx)).toBe('[]');
});

test('ListLiteral.parse parses list with single element', () => {
  const node = stubNode('list', [stubNode('expression', [], { text: '42' })]);
  const result = ListLiteral.parse(
    node,
    n => new NumberLiteral(Number(n.text))
  );
  expect(result.elements).toHaveLength(1);
  expect(result.__emit(ctx)).toBe('[42]');
});

// DictLiteral

test('DictLiteral emits empty dict', () => {
  const dict = new DictLiteral([]);
  expect(dict.__emit(ctx)).toBe('{}');
});

test('DictLiteral emits dict with entries', () => {
  const dict = new DictLiteral([
    createNode({
      key: new StringLiteral('name'),
      value: new StringLiteral('Alice'),
    }),
    createNode({ key: new StringLiteral('age'), value: new NumberLiteral(30) }),
  ]);
  expect(dict.__emit(ctx)).toBe('{"name": "Alice", "age": 30}');
});

// Ellipsis

test('Ellipsis emits ...', () => {
  const ellipsis = new Ellipsis();
  expect(ellipsis.__emit(ctx)).toBe('...');
});

// __describe methods

test('StringLiteral __describe returns description', () => {
  const lit = new StringLiteral('hello');
  expect(lit.__describe()).toBe('string "hello"');
});

test('NumberLiteral __describe returns description', () => {
  const num = new NumberLiteral(42);
  expect(num.__describe()).toBe('number 42');
});

test('Identifier __describe returns description', () => {
  const id = new Identifier('foo');
  expect(id.__describe()).toBe('identifier "foo"');
});

test('AtIdentifier __describe returns description', () => {
  const id = new AtIdentifier('variables');
  expect(id.__describe()).toBe('reference @variables');
});
