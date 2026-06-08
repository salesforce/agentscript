import { describe, test, expect } from 'vitest';
import {
  // Expressions
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Ellipsis,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  TernaryExpression,
  CallExpression,
  ListLiteral,
  DictLiteral,
  TemplateText,
  TemplateInterpolation,
  TemplateExpression,
  createNode,
  ErrorValue,
  // Statements
  Template,
  WithClause,
  SetClause,
  ToClause,
  AvailableWhen,
  RunStatement,
  IfStatement,
  TransitionStatement,
  UnknownStatement,
} from '@agentscript/language';

const ctx = { indent: 0 };
const indented = { indent: 1 };

describe('programmatic construction and emit', () => {
  describe('literal expressions', () => {
    test('StringLiteral emits quoted string', () => {
      expect(new StringLiteral('hello').__emit(ctx)).toBe('"hello"');
    });

    test('StringLiteral escapes special characters', () => {
      expect(new StringLiteral('say "hi"').__emit(ctx)).toBe('"say \\"hi\\""');
    });

    test('StringLiteral escapes newlines and tabs', () => {
      expect(new StringLiteral('a\nb\tc').__emit(ctx)).toBe('"a\\nb\\tc"');
    });

    test('StringLiteral with empty string', () => {
      expect(new StringLiteral('').__emit(ctx)).toBe('""');
    });

    test('NumberLiteral emits integer', () => {
      expect(new NumberLiteral(42).__emit(ctx)).toBe('42');
    });

    test('NumberLiteral emits negative', () => {
      expect(new NumberLiteral(-7).__emit(ctx)).toBe('-7');
    });

    test('NumberLiteral emits decimal', () => {
      expect(new NumberLiteral(3.14).__emit(ctx)).toBe('3.14');
    });

    test('NumberLiteral emits zero', () => {
      expect(new NumberLiteral(0).__emit(ctx)).toBe('0');
    });

    test('BooleanLiteral emits True', () => {
      expect(new BooleanLiteral(true).__emit(ctx)).toBe('True');
    });

    test('BooleanLiteral emits False', () => {
      expect(new BooleanLiteral(false).__emit(ctx)).toBe('False');
    });

    test('NoneLiteral emits None', () => {
      expect(new NoneLiteral().__emit(ctx)).toBe('None');
    });

    test('Ellipsis emits ...', () => {
      expect(new Ellipsis().__emit(ctx)).toBe('...');
    });
  });

  describe('identifier expressions', () => {
    test('Identifier emits name', () => {
      expect(new Identifier('myVar').__emit(ctx)).toBe('myVar');
    });

    test('AtIdentifier emits @name', () => {
      expect(new AtIdentifier('variables').__emit(ctx)).toBe('@variables');
    });

    test('MemberExpression emits object.property', () => {
      const expr = new MemberExpression(
        new AtIdentifier('variables'),
        'user_city'
      );
      expect(expr.__emit(ctx)).toBe('@variables.user_city');
    });

    test('nested MemberExpression', () => {
      const expr = new MemberExpression(
        new MemberExpression(new AtIdentifier('outputs'), 'result'),
        'value'
      );
      expect(expr.__emit(ctx)).toBe('@outputs.result.value');
    });

    test('SubscriptExpression emits object[index]', () => {
      const expr = new SubscriptExpression(
        new Identifier('items'),
        new NumberLiteral(0)
      );
      expect(expr.__emit(ctx)).toBe('items[0]');
    });

    test('SubscriptExpression with string index', () => {
      const expr = new SubscriptExpression(
        new Identifier('data'),
        new StringLiteral('key')
      );
      expect(expr.__emit(ctx)).toBe('data["key"]');
    });
  });

  describe('compound expressions', () => {
    test('BinaryExpression with arithmetic', () => {
      const expr = new BinaryExpression(
        new NumberLiteral(1),
        '+',
        new NumberLiteral(2)
      );
      expect(expr.__emit(ctx)).toBe('1 + 2');
    });

    test('BinaryExpression with logical and', () => {
      const expr = new BinaryExpression(
        new Identifier('a'),
        'and',
        new Identifier('b')
      );
      expect(expr.__emit(ctx)).toBe('a and b');
    });

    test('BinaryExpression with logical or', () => {
      const expr = new BinaryExpression(
        new Identifier('x'),
        'or',
        new Identifier('y')
      );
      expect(expr.__emit(ctx)).toBe('x or y');
    });

    test('nested BinaryExpression', () => {
      const expr = new BinaryExpression(
        new BinaryExpression(new Identifier('a'), '+', new Identifier('b')),
        '*',
        new Identifier('c')
      );
      expect(expr.__emit(ctx)).toBe('a + b * c');
    });

    test('UnaryExpression with not', () => {
      const expr = new UnaryExpression('not', new Identifier('done'));
      expect(expr.__emit(ctx)).toBe('not done');
    });

    test('UnaryExpression with negation', () => {
      const expr = new UnaryExpression('-', new NumberLiteral(5));
      expect(expr.__emit(ctx)).toBe('-5');
    });

    test('UnaryExpression with positive', () => {
      const expr = new UnaryExpression('+', new NumberLiteral(5));
      expect(expr.__emit(ctx)).toBe('+5');
    });

    test('ComparisonExpression with ==', () => {
      const expr = new ComparisonExpression(
        new Identifier('x'),
        '==',
        new NumberLiteral(1)
      );
      expect(expr.__emit(ctx)).toBe('x == 1');
    });

    test('ComparisonExpression with !=', () => {
      const expr = new ComparisonExpression(
        new Identifier('status'),
        '!=',
        new StringLiteral('done')
      );
      expect(expr.__emit(ctx)).toBe('status != "done"');
    });

    test('ComparisonExpression with is', () => {
      const expr = new ComparisonExpression(
        new Identifier('value'),
        'is',
        new NoneLiteral()
      );
      expect(expr.__emit(ctx)).toBe('value is None');
    });

    test('ComparisonExpression with is not', () => {
      const expr = new ComparisonExpression(
        new Identifier('value'),
        'is not',
        new NoneLiteral()
      );
      expect(expr.__emit(ctx)).toBe('value is not None');
    });

    test('TernaryExpression emits consequence if condition else alternative', () => {
      const expr = new TernaryExpression(
        new StringLiteral('yes'),
        new Identifier('flag'),
        new StringLiteral('no')
      );
      expect(expr.__emit(ctx)).toBe('"yes" if flag else "no"');
    });

    test('CallExpression with no args', () => {
      const expr = new CallExpression(new Identifier('doStuff'), []);
      expect(expr.__emit(ctx)).toBe('doStuff()');
    });

    test('CallExpression with args', () => {
      const expr = new CallExpression(new Identifier('len'), [
        new Identifier('items'),
      ]);
      expect(expr.__emit(ctx)).toBe('len(items)');
    });

    test('CallExpression with multiple args', () => {
      const expr = new CallExpression(new Identifier('max'), [
        new NumberLiteral(1),
        new NumberLiteral(2),
        new NumberLiteral(3),
      ]);
      expect(expr.__emit(ctx)).toBe('max(1, 2, 3)');
    });

    test('CallExpression on member expression', () => {
      const expr = new CallExpression(
        new MemberExpression(new AtIdentifier('actions'), 'GetWeather'),
        []
      );
      expect(expr.__emit(ctx)).toBe('@actions.GetWeather()');
    });
  });

  describe('collection expressions', () => {
    test('ListLiteral empty', () => {
      expect(new ListLiteral([]).__emit(ctx)).toBe('[]');
    });

    test('ListLiteral with elements', () => {
      const list = new ListLiteral([
        new NumberLiteral(1),
        new NumberLiteral(2),
        new NumberLiteral(3),
      ]);
      expect(list.__emit(ctx)).toBe('[1, 2, 3]');
    });

    test('ListLiteral with mixed types', () => {
      const list = new ListLiteral([
        new StringLiteral('hello'),
        new NumberLiteral(42),
        new BooleanLiteral(true),
      ]);
      expect(list.__emit(ctx)).toBe('["hello", 42, True]');
    });

    test('nested ListLiteral', () => {
      const list = new ListLiteral([
        new ListLiteral([new NumberLiteral(1), new NumberLiteral(2)]),
        new ListLiteral([new NumberLiteral(3), new NumberLiteral(4)]),
      ]);
      expect(list.__emit(ctx)).toBe('[[1, 2], [3, 4]]');
    });

    test('DictLiteral empty', () => {
      expect(new DictLiteral([]).__emit(ctx)).toBe('{}');
    });

    test('DictLiteral with entries', () => {
      const dict = new DictLiteral([
        createNode({
          key: new StringLiteral('name'),
          value: new StringLiteral('Alice'),
        }),
        createNode({
          key: new StringLiteral('age'),
          value: new NumberLiteral(30),
        }),
      ]);
      expect(dict.__emit(ctx)).toBe('{"name": "Alice", "age": 30}');
    });
  });

  describe('template expressions', () => {
    test('TemplateText emits raw text', () => {
      expect(new TemplateText('Hello world').__emit(ctx)).toBe('Hello world');
    });

    test('TemplateInterpolation emits {!expr}', () => {
      const interp = new TemplateInterpolation(new Identifier('name'));
      expect(interp.__emit(ctx)).toBe('{!name}');
    });

    test('TemplateExpression with text only', () => {
      const tmpl = new TemplateExpression([new TemplateText('Hello')]);
      expect(tmpl.__emit(ctx)).toBe('|Hello');
    });

    test('TemplateExpression with interpolation', () => {
      const tmpl = new TemplateExpression([
        new TemplateText('Hello '),
        new TemplateInterpolation(new Identifier('name')),
        new TemplateText('!'),
      ]);
      expect(tmpl.__emit(ctx)).toBe('|Hello {!name}!');
    });
  });

  describe('statements', () => {
    test('WithClause with StringLiteral', () => {
      const clause = new WithClause(
        'contactRecord',
        new StringLiteral('hello')
      );
      expect(clause.__emit(ctx)).toBe('with contactRecord = "hello"');
    });

    test('WithClause with Ellipsis', () => {
      const clause = new WithClause('param', new Ellipsis());
      expect(clause.__emit(ctx)).toBe('with param = ...');
    });

    test('WithClause with MemberExpression', () => {
      const clause = new WithClause(
        'city',
        new MemberExpression(new AtIdentifier('variables'), 'user_city')
      );
      expect(clause.__emit(ctx)).toBe('with city = @variables.user_city');
    });

    test('WithClause with NumberLiteral', () => {
      const clause = new WithClause('count', new NumberLiteral(5));
      expect(clause.__emit(ctx)).toBe('with count = 5');
    });

    test('WithClause with BooleanLiteral', () => {
      const clause = new WithClause('enabled', new BooleanLiteral(true));
      expect(clause.__emit(ctx)).toBe('with enabled = True');
    });

    test('WithClause respects indent', () => {
      const clause = new WithClause('x', new NumberLiteral(1));
      expect(clause.__emit(indented)).toBe('    with x = 1');
    });

    test('SetClause emits set target = value', () => {
      const stmt = new SetClause(
        new MemberExpression(new AtIdentifier('variables'), 'status'),
        new StringLiteral('active')
      );
      expect(stmt.__emit(ctx)).toBe('set @variables.status = "active"');
    });

    test('SetClause with AtIdentifier value', () => {
      const stmt = new SetClause(
        new MemberExpression(new AtIdentifier('variables'), 'result'),
        new MemberExpression(new AtIdentifier('outputs'), 'data')
      );
      expect(stmt.__emit(ctx)).toBe('set @variables.result = @outputs.data');
    });

    test('SetClause respects indent', () => {
      const stmt = new SetClause(new Identifier('x'), new NumberLiteral(42));
      expect(stmt.__emit(indented)).toBe('    set x = 42');
    });

    test('ToClause emits to target', () => {
      const stmt = new ToClause(new Identifier('billing'));
      expect(stmt.__emit(ctx)).toBe('to billing');
    });

    test('ToClause with AtIdentifier', () => {
      const stmt = new ToClause(
        new MemberExpression(new AtIdentifier('topics'), 'Billing')
      );
      expect(stmt.__emit(ctx)).toBe('to @topics.Billing');
    });

    test('AvailableWhen emits condition', () => {
      const stmt = new AvailableWhen(
        new ComparisonExpression(
          new MemberExpression(new AtIdentifier('variables'), 'role'),
          '==',
          new StringLiteral('admin')
        )
      );
      expect(stmt.__emit(ctx)).toBe(
        'available when @variables.role == "admin"'
      );
    });

    test('Template emits pipe syntax', () => {
      const tmpl = new Template([new TemplateText('Hello world')]);
      expect(tmpl.__emit(ctx)).toBe('|Hello world');
    });

    test('Template with interpolation', () => {
      const tmpl = new Template([
        new TemplateText('Welcome '),
        new TemplateInterpolation(
          new MemberExpression(new AtIdentifier('variables'), 'name')
        ),
      ]);
      expect(tmpl.__emit(ctx)).toBe('|Welcome {!@variables.name}');
    });

    test('Template respects indent', () => {
      const tmpl = new Template([new TemplateText('Hello')]);
      expect(tmpl.__emit(indented)).toBe('    |Hello');
    });

    test('UnknownStatement emits raw text', () => {
      const stmt = new UnknownStatement('some invalid syntax');
      expect(stmt.__emit(ctx)).toBe('some invalid syntax');
    });

    test('UnknownStatement respects indent', () => {
      const stmt = new UnknownStatement('broken');
      expect(stmt.__emit(indented)).toBe('    broken');
    });
  });

  describe('compound statements', () => {
    test('RunStatement with no body', () => {
      const stmt = new RunStatement(
        new MemberExpression(new AtIdentifier('actions'), 'GetWeather'),
        []
      );
      expect(stmt.__emit(ctx)).toBe('run @actions.GetWeather');
    });

    test('RunStatement with body', () => {
      const stmt = new RunStatement(
        new MemberExpression(new AtIdentifier('actions'), 'GetWeather'),
        [
          new WithClause(
            'city',
            new MemberExpression(new AtIdentifier('variables'), 'user_city')
          ),
          new SetClause(
            new MemberExpression(new AtIdentifier('variables'), 'forecast'),
            new MemberExpression(new AtIdentifier('outputs'), 'result')
          ),
        ]
      );
      const emitted = stmt.__emit(ctx);
      expect(emitted).toBe(
        [
          'run @actions.GetWeather',
          '    with city = @variables.user_city',
          '    set @variables.forecast = @outputs.result',
        ].join('\n')
      );
    });

    test('RunStatement respects indent', () => {
      const stmt = new RunStatement(new Identifier('MyAction'), [
        new WithClause('x', new NumberLiteral(1)),
      ]);
      const emitted = stmt.__emit(indented);
      expect(emitted).toBe(
        ['    run MyAction', '        with x = 1'].join('\n')
      );
    });

    test('IfStatement with body only', () => {
      const stmt = new IfStatement(
        new ComparisonExpression(
          new Identifier('x'),
          '==',
          new NumberLiteral(1)
        ),
        [
          new RunStatement(
            new MemberExpression(new AtIdentifier('actions'), 'DoThing'),
            []
          ),
        ]
      );
      const emitted = stmt.__emit(ctx);
      expect(emitted).toBe(
        ['if x == 1:', '    run @actions.DoThing'].join('\n')
      );
    });

    test('IfStatement with else', () => {
      const stmt = new IfStatement(
        new ComparisonExpression(
          new Identifier('x'),
          '>',
          new NumberLiteral(0)
        ),
        [new RunStatement(new Identifier('Positive'), [])],
        [new RunStatement(new Identifier('NonPositive'), [])]
      );
      const emitted = stmt.__emit(ctx);
      expect(emitted).toBe(
        ['if x > 0:', '    run Positive', 'else:', '    run NonPositive'].join(
          '\n'
        )
      );
    });

    test('IfStatement with elif chain', () => {
      const stmt = new IfStatement(
        new ComparisonExpression(
          new Identifier('x'),
          '==',
          new NumberLiteral(1)
        ),
        [new RunStatement(new Identifier('One'), [])],
        [
          new IfStatement(
            new ComparisonExpression(
              new Identifier('x'),
              '==',
              new NumberLiteral(2)
            ),
            [new RunStatement(new Identifier('Two'), [])],
            [new RunStatement(new Identifier('Other'), [])]
          ),
        ]
      );
      const emitted = stmt.__emit(ctx);
      expect(emitted).toBe(
        [
          'if x == 1:',
          '    run One',
          'elif x == 2:',
          '    run Two',
          'else:',
          '    run Other',
        ].join('\n')
      );
    });

    test('IfStatement respects indent', () => {
      const stmt = new IfStatement(new BooleanLiteral(true), [
        new RunStatement(new Identifier('Action'), []),
      ]);
      const emitted = stmt.__emit(indented);
      expect(emitted).toBe(['    if True:', '        run Action'].join('\n'));
    });

    test('TransitionStatement with to clause', () => {
      const stmt = new TransitionStatement([
        new ToClause(new Identifier('billing')),
      ]);
      expect(stmt.__emit(ctx)).toBe('transition to billing');
    });

    test('TransitionStatement with multiple clauses', () => {
      const stmt = new TransitionStatement([
        new WithClause('reason', new StringLiteral('done')),
        new ToClause(new Identifier('end')),
      ]);
      expect(stmt.__emit(ctx)).toBe('transition with reason = "done", to end');
    });
  });

  describe('complex compositions', () => {
    test('RunStatement with if in body', () => {
      const stmt = new RunStatement(
        new MemberExpression(new AtIdentifier('actions'), 'Process'),
        [
          new WithClause(
            'input',
            new MemberExpression(new AtIdentifier('variables'), 'data')
          ),
          new IfStatement(
            new ComparisonExpression(
              new MemberExpression(new AtIdentifier('outputs'), 'status'),
              '==',
              new StringLiteral('success')
            ),
            [
              new SetClause(
                new MemberExpression(new AtIdentifier('variables'), 'result'),
                new MemberExpression(new AtIdentifier('outputs'), 'data')
              ),
            ]
          ),
        ]
      );
      const emitted = stmt.__emit(ctx);
      expect(emitted).toBe(
        [
          'run @actions.Process',
          '    with input = @variables.data',
          '    if @outputs.status == "success":',
          '        set @variables.result = @outputs.data',
        ].join('\n')
      );
    });

    test('WithClause with complex expression value', () => {
      const clause = new WithClause(
        'query',
        new BinaryExpression(
          new StringLiteral('Hello '),
          '+',
          new MemberExpression(new AtIdentifier('variables'), 'name')
        )
      );
      expect(clause.__emit(ctx)).toBe(
        'with query = "Hello " + @variables.name'
      );
    });

    test('SetClause with ternary value', () => {
      const stmt = new SetClause(
        new MemberExpression(new AtIdentifier('variables'), 'label'),
        new TernaryExpression(
          new StringLiteral('active'),
          new MemberExpression(new AtIdentifier('variables'), 'enabled'),
          new StringLiteral('inactive')
        )
      );
      expect(stmt.__emit(ctx)).toBe(
        'set @variables.label = "active" if @variables.enabled else "inactive"'
      );
    });

    test('WithClause with list value', () => {
      const clause = new WithClause(
        'ids',
        new ListLiteral([
          new NumberLiteral(1),
          new NumberLiteral(2),
          new NumberLiteral(3),
        ])
      );
      expect(clause.__emit(ctx)).toBe('with ids = [1, 2, 3]');
    });

    test('WithClause with call expression value', () => {
      const clause = new WithClause(
        'count',
        new CallExpression(new Identifier('len'), [
          new MemberExpression(new AtIdentifier('variables'), 'items'),
        ])
      );
      expect(clause.__emit(ctx)).toBe('with count = len(@variables.items)');
    });

    test('AvailableWhen with compound condition', () => {
      const stmt = new AvailableWhen(
        new BinaryExpression(
          new ComparisonExpression(
            new MemberExpression(new AtIdentifier('variables'), 'role'),
            '==',
            new StringLiteral('admin')
          ),
          'and',
          new ComparisonExpression(
            new MemberExpression(new AtIdentifier('variables'), 'active'),
            '==',
            new BooleanLiteral(true)
          )
        )
      );
      expect(stmt.__emit(ctx)).toBe(
        'available when @variables.role == "admin" and @variables.active == True'
      );
    });
  });

  describe('edge cases and adversarial inputs', () => {
    describe('string escaping', () => {
      test('StringLiteral with backslashes', () => {
        expect(new StringLiteral('path\\to\\file').__emit(ctx)).toBe(
          '"path\\\\to\\\\file"'
        );
      });

      test('StringLiteral with nested quotes and backslashes', () => {
        // Input: she said "it's \\"fine\\"" (contains quotes and backslashes)
        const input = 'she said "it\'s \\\\"fine\\\\""';
        const emitted = new StringLiteral(input).__emit(ctx);
        // Verify round-trip: the emitted string, when parsed as a JS string
        // literal (minus outer quotes), should yield the original input
        expect(emitted.startsWith('"')).toBe(true);
        expect(emitted.endsWith('"')).toBe(true);
        // Check that internal quotes are escaped
        expect(emitted).toContain('\\"');
        // Check that backslashes are escaped
        expect(emitted).toContain('\\\\');
      });

      test('StringLiteral with carriage return', () => {
        expect(new StringLiteral('line1\r\nline2').__emit(ctx)).toBe(
          '"line1\\r\\nline2"'
        );
      });

      test('StringLiteral with unicode', () => {
        expect(new StringLiteral('café ☕ 日本語').__emit(ctx)).toBe(
          '"café ☕ 日本語"'
        );
      });

      test('StringLiteral with only special characters', () => {
        expect(new StringLiteral('"\\\n\t\r').__emit(ctx)).toBe(
          '"\\"\\\\\\n\\t\\r"'
        );
      });

      test('StringLiteral with very long string', () => {
        const long = 'a'.repeat(10000);
        const result = new StringLiteral(long).__emit(ctx);
        expect(result).toBe(`"${long}"`);
        expect(result.length).toBe(10002);
      });
    });

    describe('numeric edge cases', () => {
      test('NumberLiteral with NaN', () => {
        expect(new NumberLiteral(NaN).__emit(ctx)).toBe('NaN');
      });

      test('NumberLiteral with Infinity', () => {
        expect(new NumberLiteral(Infinity).__emit(ctx)).toBe('Infinity');
      });

      test('NumberLiteral with -Infinity', () => {
        expect(new NumberLiteral(-Infinity).__emit(ctx)).toBe('-Infinity');
      });

      test('NumberLiteral with very small decimal', () => {
        expect(new NumberLiteral(0.000001).__emit(ctx)).toBe('0.000001');
      });

      test('NumberLiteral with very large number', () => {
        expect(new NumberLiteral(9999999999999).__emit(ctx)).toBe(
          '9999999999999'
        );
      });

      test('NumberLiteral with negative zero', () => {
        // JavaScript distinguishes -0 from 0
        const result = new NumberLiteral(-0).__emit(ctx);
        expect(result).toBe('0');
      });
    });

    describe('key name quoting in WithClause', () => {
      test('param name with spaces gets quoted', () => {
        const clause = new WithClause('my param', new Ellipsis());
        expect(clause.__emit(ctx)).toBe('with "my param" = ...');
      });

      test('param name with special characters gets quoted', () => {
        const clause = new WithClause('param-name', new NumberLiteral(1));
        expect(clause.__emit(ctx)).toBe('with "param-name" = 1');
      });

      test('param name with dots gets quoted', () => {
        const clause = new WithClause('a.b.c', new NumberLiteral(1));
        expect(clause.__emit(ctx)).toBe('with "a.b.c" = 1');
      });

      test('param name starting with digit gets quoted', () => {
        const clause = new WithClause('123abc', new Ellipsis());
        expect(clause.__emit(ctx)).toBe('with "123abc" = ...');
      });

      test('param name with embedded quotes gets escaped and quoted', () => {
        const clause = new WithClause('say "hi"', new Ellipsis());
        expect(clause.__emit(ctx)).toBe('with "say \\"hi\\"" = ...');
      });

      test('empty param name gets quoted', () => {
        const clause = new WithClause('', new Ellipsis());
        expect(clause.__emit(ctx)).toBe('with "" = ...');
      });

      test('param name with newline gets escaped', () => {
        const clause = new WithClause('line\nbreak', new Ellipsis());
        expect(clause.__emit(ctx)).toBe('with "line\\nbreak" = ...');
      });
    });

    describe('empty and degenerate structures', () => {
      test('RunStatement with empty body', () => {
        const stmt = new RunStatement(new Identifier('Action'), []);
        expect(stmt.__emit(ctx)).toBe('run Action');
      });

      test('IfStatement with empty body', () => {
        const stmt = new IfStatement(new BooleanLiteral(true), []);
        expect(stmt.__emit(ctx)).toBe('if True:\n');
      });

      test('IfStatement with empty body and empty else', () => {
        const stmt = new IfStatement(new BooleanLiteral(true), [], []);
        expect(stmt.__emit(ctx)).toBe('if True:\n');
      });

      test('TransitionStatement with empty clauses', () => {
        const stmt = new TransitionStatement([]);
        expect(stmt.__emit(ctx)).toBe('transition ');
      });

      test('ListLiteral with single element', () => {
        expect(new ListLiteral([new StringLiteral('only')]).__emit(ctx)).toBe(
          '["only"]'
        );
      });

      test('Template with empty text', () => {
        const tmpl = new Template([new TemplateText('')]);
        expect(tmpl.__emit(ctx)).toBe('|');
      });

      test('Template with empty parts array', () => {
        const tmpl = new Template([]);
        expect(tmpl.__emit(ctx)).toBe('|');
      });

      test('CallExpression with empty function name', () => {
        const expr = new CallExpression(new Identifier(''), []);
        expect(expr.__emit(ctx)).toBe('()');
      });

      test('ErrorValue preserves raw text', () => {
        const expr = new ErrorValue('!!!broken syntax!!!');
        expect(expr.__emit(ctx)).toBe('!!!broken syntax!!!');
      });

      test('ErrorValue with empty text', () => {
        expect(new ErrorValue('').__emit(ctx)).toBe('');
      });

      test('UnknownStatement with multiline text', () => {
        const stmt = new UnknownStatement('line1\nline2\nline3');
        expect(stmt.__emit(ctx)).toBe('line1\nline2\nline3');
      });

      test('UnknownStatement with multiline text at indent', () => {
        const stmt = new UnknownStatement('line1\nline2');
        expect(stmt.__emit(indented)).toBe('    line1\n    line2');
      });
    });

    describe('deep nesting', () => {
      test('deeply nested MemberExpression', () => {
        let expr: MemberExpression | AtIdentifier = new AtIdentifier('root');
        for (let i = 0; i < 20; i++) {
          expr = new MemberExpression(expr, `level${i}`);
        }
        const emitted = expr.__emit(ctx);
        expect(emitted).toMatch(/^@root\.level0\.level1/);
        expect(emitted.split('.').length).toBe(21);
      });

      test('deeply nested BinaryExpression', () => {
        let expr: BinaryExpression | NumberLiteral = new NumberLiteral(0);
        for (let i = 1; i <= 10; i++) {
          expr = new BinaryExpression(expr, '+', new NumberLiteral(i));
        }
        expect(expr.__emit(ctx)).toBe(
          '0 + 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8 + 9 + 10'
        );
      });

      test('deeply nested IfStatement (elif chain)', () => {
        // Build if/elif/elif/.../elif — no else at the end
        let stmt: IfStatement = new IfStatement(
          new ComparisonExpression(
            new Identifier('x'),
            '==',
            new NumberLiteral(5)
          ),
          [new RunStatement(new Identifier('Last'), [])]
        );
        for (let i = 4; i >= 0; i--) {
          stmt = new IfStatement(
            new ComparisonExpression(
              new Identifier('x'),
              '==',
              new NumberLiteral(i)
            ),
            [new RunStatement(new Identifier(`Action${i}`), [])],
            [stmt]
          );
        }
        const emitted = stmt.__emit(ctx);
        const lines = emitted.split('\n');
        expect(lines[0]).toBe('if x == 0:');
        expect(lines[1]).toBe('    run Action0');
        expect(lines[2]).toBe('elif x == 1:');
        // The deepest nested IfStatement has no else, so it emits as
        // the final elif (not else:)
        expect(lines[lines.length - 2]).toBe('elif x == 5:');
        expect(lines[lines.length - 1]).toBe('    run Last');
        // Should produce exactly 6 elif lines + 1 if line
        expect(lines.filter(l => l.startsWith('elif')).length).toBe(5);
      });

      test('RunStatement nested 3 levels deep', () => {
        const stmt = new RunStatement(new Identifier('Outer'), [
          new RunStatement(new Identifier('Middle'), [
            new RunStatement(new Identifier('Inner'), [
              new WithClause('x', new NumberLiteral(1)),
            ]),
          ]),
        ]);
        expect(stmt.__emit(ctx)).toBe(
          [
            'run Outer',
            '    run Middle',
            '        run Inner',
            '            with x = 1',
          ].join('\n')
        );
      });

      test('deep indent level', () => {
        const clause = new WithClause('x', new NumberLiteral(1));
        const emitted = clause.__emit({ indent: 5 });
        expect(emitted).toBe('                    with x = 1');
        expect(emitted.indexOf('with')).toBe(20); // 5 * 4 spaces
      });

      test('deep indent with custom tabSize', () => {
        const clause = new WithClause('x', new NumberLiteral(1));
        const emitted = clause.__emit({ indent: 3, tabSize: 2 });
        expect(emitted).toBe('      with x = 1');
        expect(emitted.indexOf('with')).toBe(6); // 3 * 2 spaces
      });
    });

    describe('expression in unexpected value positions', () => {
      test('SetClause where target is a complex expression', () => {
        const stmt = new SetClause(
          new SubscriptExpression(
            new MemberExpression(new AtIdentifier('variables'), 'items'),
            new NumberLiteral(0)
          ),
          new StringLiteral('first')
        );
        expect(stmt.__emit(ctx)).toBe('set @variables.items[0] = "first"');
      });

      test('WithClause with dict value', () => {
        const clause = new WithClause(
          'config',
          new DictLiteral([
            createNode({
              key: new StringLiteral('key'),
              value: new BooleanLiteral(true),
            }),
          ])
        );
        expect(clause.__emit(ctx)).toBe('with config = {"key": True}');
      });

      test('WithClause with nested list of dicts', () => {
        const clause = new WithClause(
          'records',
          new ListLiteral([
            new DictLiteral([
              createNode({
                key: new StringLiteral('id'),
                value: new NumberLiteral(1),
              }),
            ]),
            new DictLiteral([
              createNode({
                key: new StringLiteral('id'),
                value: new NumberLiteral(2),
              }),
            ]),
          ])
        );
        expect(clause.__emit(ctx)).toBe(
          'with records = [{"id": 1}, {"id": 2}]'
        );
      });

      test('AvailableWhen with not + comparison', () => {
        const stmt = new AvailableWhen(
          new UnaryExpression(
            'not',
            new ComparisonExpression(
              new Identifier('status'),
              '==',
              new StringLiteral('disabled')
            )
          )
        );
        expect(stmt.__emit(ctx)).toBe(
          'available when not status == "disabled"'
        );
      });

      test('ToClause with subscript expression', () => {
        const stmt = new ToClause(
          new SubscriptExpression(
            new MemberExpression(new AtIdentifier('topics'), 'list'),
            new NumberLiteral(0)
          )
        );
        expect(stmt.__emit(ctx)).toBe('to @topics.list[0]');
      });

      test('CallExpression with nested call args', () => {
        const expr = new CallExpression(new Identifier('outer'), [
          new CallExpression(new Identifier('inner'), [
            new CallExpression(new Identifier('deepest'), []),
          ]),
        ]);
        expect(expr.__emit(ctx)).toBe('outer(inner(deepest()))');
      });

      test('TernaryExpression with ternary sub-expressions', () => {
        const expr = new TernaryExpression(
          new TernaryExpression(
            new StringLiteral('a'),
            new Identifier('x'),
            new StringLiteral('b')
          ),
          new Identifier('outer'),
          new StringLiteral('c')
        );
        expect(expr.__emit(ctx)).toBe('"a" if x else "b" if outer else "c"');
      });
    });

    describe('template edge cases', () => {
      test('Template with only interpolation', () => {
        const tmpl = new Template([
          new TemplateInterpolation(new Identifier('x')),
        ]);
        expect(tmpl.__emit(ctx)).toBe('|{!x}');
      });

      test('Template with multiple interpolations adjacent', () => {
        const tmpl = new Template([
          new TemplateInterpolation(new Identifier('a')),
          new TemplateInterpolation(new Identifier('b')),
        ]);
        expect(tmpl.__emit(ctx)).toBe('|{!a}{!b}');
      });

      test('TemplateExpression with multiline text', () => {
        // TemplateExpression is an *expression* — it doesn't emit leading
        // indent (the containing statement owns that). Continuation lines
        // get indent+1 from the context.
        const tmpl = new TemplateExpression([
          new TemplateText('line1\nline2\nline3'),
        ]);
        const emitted = tmpl.__emit(ctx);
        // At indent 0: continuation lines get indent 1 = 4 spaces
        expect(emitted).toBe('|line1\n    line2\n    line3');
      });

      test('TemplateExpression multiline at indent', () => {
        const tmpl = new TemplateExpression([new TemplateText('line1\nline2')]);
        const emitted = tmpl.__emit(indented);
        // At indent 1: no leading indent on first line (expression),
        // continuation lines get indent 2 = 8 spaces
        expect(emitted).toBe('|line1\n        line2');
      });

      test('TemplateInterpolation with complex expression', () => {
        const interp = new TemplateInterpolation(
          new BinaryExpression(new Identifier('a'), '+', new NumberLiteral(1))
        );
        expect(interp.__emit(ctx)).toBe('{!a + 1}');
      });

      test('Template barePipeMultiline mode', () => {
        const tmpl = new Template([new TemplateText('line1\nline2')]);
        tmpl.barePipeMultiline = true;
        const emitted = tmpl.__emit(ctx);
        expect(emitted).toBe('|\n    line1\n    line2');
      });

      test('Template spaceAfterPipe mode', () => {
        const tmpl = new Template([new TemplateText('Hello')]);
        tmpl.spaceAfterPipe = true;
        expect(tmpl.__emit(ctx)).toBe('| Hello');
      });
    });

    describe('mixed statement bodies', () => {
      test('RunStatement with all statement types in body', () => {
        const stmt = new RunStatement(
          new MemberExpression(new AtIdentifier('actions'), 'Complex'),
          [
            new WithClause('input', new StringLiteral('data')),
            new SetClause(
              new MemberExpression(new AtIdentifier('variables'), 'a'),
              new MemberExpression(new AtIdentifier('outputs'), 'x')
            ),
            new IfStatement(
              new ComparisonExpression(
                new MemberExpression(new AtIdentifier('outputs'), 'ok'),
                '==',
                new BooleanLiteral(true)
              ),
              [
                new SetClause(
                  new MemberExpression(new AtIdentifier('variables'), 'done'),
                  new BooleanLiteral(true)
                ),
              ],
              [
                new SetClause(
                  new MemberExpression(new AtIdentifier('variables'), 'done'),
                  new BooleanLiteral(false)
                ),
              ]
            ),
          ]
        );
        expect(stmt.__emit(ctx)).toBe(
          [
            'run @actions.Complex',
            '    with input = "data"',
            '    set @variables.a = @outputs.x',
            '    if @outputs.ok == True:',
            '        set @variables.done = True',
            '    else:',
            '        set @variables.done = False',
          ].join('\n')
        );
      });

      test('IfStatement body with multiple run statements', () => {
        const stmt = new IfStatement(new BooleanLiteral(true), [
          new RunStatement(new Identifier('A'), [
            new WithClause('x', new NumberLiteral(1)),
          ]),
          new RunStatement(new Identifier('B'), [
            new WithClause('y', new NumberLiteral(2)),
          ]),
        ]);
        expect(stmt.__emit(ctx)).toBe(
          [
            'if True:',
            '    run A',
            '        with x = 1',
            '    run B',
            '        with y = 2',
          ].join('\n')
        );
      });
    });
  });
});
