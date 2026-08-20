/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import {
  type Expression,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  Identifier,
  MemberExpression,
  AtIdentifier,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  SubscriptExpression,
  SliceExpression,
  TemplateExpression,
  TemplateText,
  TemplateInterpolation,
  CallExpression,
  SpreadExpression,
} from '@agentscript/language';
import {
  compileExpression,
  compileValueExpression,
} from '../src/expressions/compile-expression.js';
import { CompilerContext } from '../src/compiler-context.js';

let ctx: CompilerContext;

beforeEach(() => {
  ctx = new CompilerContext();
});

describe('compileExpression', () => {
  describe('literals', () => {
    it('should compile string literals with double quotes', () => {
      const expr = new StringLiteral('hello');
      expect(compileExpression(expr, ctx)).toBe('"hello"');
    });

    it('should escape newlines in string literals', () => {
      const expr = new StringLiteral(
        'talk about basketball \n talk about football'
      );
      expect(compileExpression(expr, ctx)).toBe(
        '"talk about basketball \\n talk about football"'
      );
    });

    it('should escape tabs in string literals', () => {
      const expr = new StringLiteral('col1\tcol2');
      expect(compileExpression(expr, ctx)).toBe('"col1\\tcol2"');
    });

    it('should escape carriage returns in string literals', () => {
      const expr = new StringLiteral('line1\rline2');
      expect(compileExpression(expr, ctx)).toBe('"line1\\rline2"');
    });

    it('should escape backslashes in string literals', () => {
      const expr = new StringLiteral('path\\to\\file');
      expect(compileExpression(expr, ctx)).toBe('"path\\\\to\\\\file"');
    });

    it('should escape double quotes in string literals', () => {
      const expr = new StringLiteral('say "hello"');
      expect(compileExpression(expr, ctx)).toBe('"say \\"hello\\""');
    });

    it('should escape multiple special characters together', () => {
      const expr = new StringLiteral('line1\nline2\ttab\r\n"quoted"');
      expect(compileExpression(expr, ctx)).toBe(
        '"line1\\nline2\\ttab\\r\\n\\"quoted\\""'
      );
    });

    it('should compile number literals', () => {
      const expr = new NumberLiteral(42);
      expect(compileExpression(expr, ctx)).toBe('42');
    });

    it('should compile boolean true as True', () => {
      const expr = new BooleanLiteral(true);
      expect(compileExpression(expr, ctx)).toBe('True');
    });

    it('should compile boolean false as False', () => {
      const expr = new BooleanLiteral(false);
      expect(compileExpression(expr, ctx)).toBe('False');
    });

    it('should compile identifiers', () => {
      const expr = new Identifier('foo');
      expect(compileExpression(expr, ctx)).toBe('foo');
    });
  });

  describe('@variables references', () => {
    it('should compile mutable @variables.x as state.x', () => {
      ctx.mutableVariableNames.add('user_name');
      const expr = new MemberExpression(
        new AtIdentifier('variables'),
        'user_name'
      );
      expect(compileExpression(expr, ctx)).toBe('state.user_name');
    });

    it('should compile linked @variables.x as variables.x', () => {
      ctx.linkedVariableNames.add('account_id');
      const expr = new MemberExpression(
        new AtIdentifier('variables'),
        'account_id'
      );
      expect(compileExpression(expr, ctx)).toBe('variables.account_id');
    });

    it('should compile unknown @variables.x as state.x with warning', () => {
      const expr = new MemberExpression(
        new AtIdentifier('variables'),
        'unknown_var'
      );
      expect(compileExpression(expr, ctx)).toBe('state.unknown_var');
      expect(
        ctx.diagnostics.some(
          d =>
            d.severity === DiagnosticSeverity.Warning &&
            d.message.includes('unknown_var')
        )
      ).toBe(true);
    });

    it('should compile linked @variables in system message context as $Context.x', () => {
      ctx.linkedVariableNames.add('name');
      const expr = new MemberExpression(new AtIdentifier('variables'), 'name');
      expect(compileExpression(expr, ctx, { isSystemMessage: true })).toBe(
        '$Context.name'
      );
    });

    it('should compile mutable @variables in system message context as state.x', () => {
      ctx.mutableVariableNames.add('name');
      const expr = new MemberExpression(new AtIdentifier('variables'), 'name');
      expect(compileExpression(expr, ctx, { isSystemMessage: true })).toBe(
        'state.name'
      );
    });
  });

  describe('@outputs references', () => {
    it('should compile @outputs.x as result.x', () => {
      const expr = new MemberExpression(
        new AtIdentifier('outputs'),
        'response'
      );
      expect(compileExpression(expr, ctx)).toBe('result.response');
    });
  });

  describe('@actions references', () => {
    it('should compile @actions.x as action.x when allowed', () => {
      const expr = new MemberExpression(
        new AtIdentifier('actions'),
        'myAction'
      );
      expect(
        compileExpression(expr, ctx, { allowActionReferences: true })
      ).toBe('action.myAction');
    });

    it('should error for @actions.x when not allowed', () => {
      const expr = new MemberExpression(
        new AtIdentifier('actions'),
        'myAction'
      );
      compileExpression(expr, ctx, { allowActionReferences: false });
      expect(
        ctx.diagnostics.some(d => d.severity === DiagnosticSeverity.Error)
      ).toBe(true);
    });
  });

  describe('@response_formats references', () => {
    it('should compile @response_formats.x as response_formats.x when allowed', () => {
      const expr = new MemberExpression(
        new AtIdentifier('response_formats'),
        'myFormat'
      );
      expect(
        compileExpression(expr, ctx, { allowFormatReferences: true })
      ).toBe('response_formats.myFormat');
    });

    it('should error for @response_formats.x when not allowed', () => {
      const expr = new MemberExpression(
        new AtIdentifier('response_formats'),
        'myFormat'
      );
      compileExpression(expr, ctx, { allowFormatReferences: false });
      expect(
        ctx.diagnostics.some(d => d.severity === DiagnosticSeverity.Error)
      ).toBe(true);
    });
  });

  describe('@response_actions references', () => {
    it('should compile @response_actions.x as response_formats.x when allowed', () => {
      const expr = new MemberExpression(
        new AtIdentifier('response_actions'),
        'myFormat'
      );
      expect(
        compileExpression(expr, ctx, { allowFormatReferences: true })
      ).toBe('response_formats.myFormat');
    });

    it('should error for @response_actions.x when not allowed', () => {
      const expr = new MemberExpression(
        new AtIdentifier('response_actions'),
        'myFormat'
      );
      compileExpression(expr, ctx, { allowFormatReferences: false });
      expect(
        ctx.diagnostics.some(d => d.severity === DiagnosticSeverity.Error)
      ).toBe(true);
    });
  });

  describe('@system_variables references', () => {
    it('should compile @system_variables.user_input as system.input_text', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'user_input'
      );
      expect(compileExpression(expr, ctx)).toBe('system.input_text');
    });

    // Python: test_compile_expression_replaces_system_variables_user_input_in_expression
    it('should compile @system_variables.user_input in comparison expression', () => {
      const expr = new ComparisonExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'user_input'
        ),
        '==',
        new StringLiteral('test')
      );
      expect(compileExpression(expr, ctx)).toBe('system.input_text == "test"');
    });

    it('should compile @system_variables.current_modality as system.current_modality', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'current_modality'
      );
      expect(compileExpression(expr, ctx)).toBe('system.current_modality');
    });

    it('should compile @system_variables.current_connection as system.current_connection', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'current_connection'
      );
      expect(compileExpression(expr, ctx)).toBe('system.current_connection');
    });

    it('should compile @system_variables.last_reply as system.last_reply', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'last_reply'
      );
      expect(compileExpression(expr, ctx)).toBe('system.last_reply');
    });

    it('should compile @system_variables.last_reply.interrupted as system.last_reply.interrupted', () => {
      const expr = new MemberExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'last_reply'
        ),
        'interrupted'
      );
      expect(compileExpression(expr, ctx)).toBe(
        'system.last_reply.interrupted'
      );
    });

    it('should compile @system_variables.last_reply.interrupted_heard_text as system.last_reply.interrupted_heard_text', () => {
      const expr = new MemberExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'last_reply'
        ),
        'interrupted_heard_text'
      );
      expect(compileExpression(expr, ctx)).toBe(
        'system.last_reply.interrupted_heard_text'
      );
    });

    it('should compile @system_variables.uploaded_files as system.uploaded_files', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'uploaded_files'
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files');
    });

    it('should error for unknown system variable', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'unknown_var'
      );
      compileExpression(expr, ctx);
      expect(
        ctx.diagnostics.some(d => d.severity === DiagnosticSeverity.Error)
      ).toBe(true);
    });
  });

  describe('@knowledge references', () => {
    it('should resolve @knowledge eagerly from context', () => {
      ctx.knowledgeFields.set('api_key', 'sk-123');
      const expr = new MemberExpression(
        new AtIdentifier('knowledge'),
        'api_key'
      );
      expect(compileExpression(expr, ctx)).toBe('"sk-123"');
    });

    it('should error for unknown @knowledge field', () => {
      const expr = new MemberExpression(
        new AtIdentifier('knowledge'),
        'missing'
      );
      compileExpression(expr, ctx);
      expect(
        ctx.diagnostics.some(d => d.severity === DiagnosticSeverity.Error)
      ).toBe(true);
    });
  });

  describe('binary expressions', () => {
    it('should compile binary addition', () => {
      const expr = new BinaryExpression(
        new NumberLiteral(1),
        '+',
        new NumberLiteral(2)
      );
      expect(compileExpression(expr, ctx)).toBe('1 + 2');
    });

    it('should compile binary and', () => {
      const expr = new BinaryExpression(
        new BooleanLiteral(true),
        'and',
        new BooleanLiteral(false)
      );
      expect(compileExpression(expr, ctx)).toBe('True and False');
    });
  });

  describe('unary expressions', () => {
    it('should compile not operator', () => {
      const expr = new UnaryExpression('not', new BooleanLiteral(true));
      expect(compileExpression(expr, ctx)).toBe('not True');
    });

    it('should compile negation operator', () => {
      const expr = new UnaryExpression('-', new NumberLiteral(5));
      expect(compileExpression(expr, ctx)).toBe('-5');
    });
  });

  describe('comparison expressions', () => {
    it('should compile == comparison', () => {
      ctx.mutableVariableNames.add('x');
      const expr = new ComparisonExpression(
        new MemberExpression(new AtIdentifier('variables'), 'x'),
        '==',
        new StringLiteral('hello')
      );
      expect(compileExpression(expr, ctx)).toBe('state.x == "hello"');
    });

    it('should compile != comparison', () => {
      ctx.mutableVariableNames.add('x');
      const expr = new ComparisonExpression(
        new MemberExpression(new AtIdentifier('variables'), 'x'),
        '!=',
        new StringLiteral('')
      );
      expect(compileExpression(expr, ctx)).toBe('state.x != ""');
    });
  });

  describe('subscript expressions', () => {
    it('should compile @outputs[x] as result[x]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('outputs'),
        new NumberLiteral(0)
      );
      expect(compileExpression(expr, ctx)).toBe('result[0]');
    });

    // Python: test_compile_expression_replaces_system_variables_user_input_with_brackets
    it('should compile @system_variables["user_input"] as system["input_text"]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new StringLiteral('user_input')
      );
      expect(compileExpression(expr, ctx)).toBe('system["input_text"]');
    });

    it('should compile @system_variables["current_modality"] as system["current_modality"]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new StringLiteral('current_modality')
      );
      expect(compileExpression(expr, ctx)).toBe('system["current_modality"]');
    });

    it('should compile @system_variables["current_connection"] as system["current_connection"]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new StringLiteral('current_connection')
      );
      expect(compileExpression(expr, ctx)).toBe('system["current_connection"]');
    });

    it('should compile @system_variables["last_reply"] as system["last_reply"]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new StringLiteral('last_reply')
      );
      expect(compileExpression(expr, ctx)).toBe('system["last_reply"]');
    });

    it('should compile @system_variables["last_reply"].interrupted as system["last_reply"].interrupted', () => {
      const expr = new MemberExpression(
        new SubscriptExpression(
          new AtIdentifier('system_variables'),
          new StringLiteral('last_reply')
        ),
        'interrupted'
      );
      expect(compileExpression(expr, ctx)).toBe(
        'system["last_reply"].interrupted'
      );
    });

    it('should compile @system_variables["uploaded_files"] as system["uploaded_files"]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new StringLiteral('uploaded_files')
      );
      expect(compileExpression(expr, ctx)).toBe('system["uploaded_files"]');
    });
  });

  describe('slice expressions', () => {
    it('should compile a full-form slice [a:b] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(
          new NumberLiteral(0),
          new NumberLiteral(3),
          undefined
        )
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[0:3]');
    });

    it('should compile an open-end slice [a:] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(new NumberLiteral(2), undefined, undefined)
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[2:]');
    });

    it('should compile an open-start slice [:b] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(undefined, new NumberLiteral(5), undefined)
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[:5]');
    });

    it('should compile a slice with step [a:b:c] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(
          new NumberLiteral(0),
          new NumberLiteral(9),
          new NumberLiteral(2)
        )
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[0:9:2]');
    });

    it('should compile an integer index [n] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new NumberLiteral(0)
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[0]');
    });

    it('should compile a negative index [-1] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new UnaryExpression('-', new NumberLiteral(1))
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[-1]');
    });

    it('should compile a negative-start slice [-a:] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(
          new UnaryExpression('-', new NumberLiteral(3)),
          undefined,
          undefined
        )
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[-3:]');
    });

    it('should compile a negative-stop slice [:-b] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(
          undefined,
          new UnaryExpression('-', new NumberLiteral(1)),
          undefined
        )
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[:-1]');
    });

    it('should compile a reversed slice [::-1] on @system_variables.uploaded_files', () => {
      const expr = new SubscriptExpression(
        new MemberExpression(
          new AtIdentifier('system_variables'),
          'uploaded_files'
        ),
        new SliceExpression(
          undefined,
          undefined,
          new UnaryExpression('-', new NumberLiteral(1))
        )
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[::-1]');
    });

    it('should compile attribute access on a negative-indexed @system_variables.uploaded_files element', () => {
      const expr = new MemberExpression(
        new SubscriptExpression(
          new MemberExpression(
            new AtIdentifier('system_variables'),
            'uploaded_files'
          ),
          new UnaryExpression('-', new NumberLiteral(1))
        ),
        'id'
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[-1].id');
    });

    it('should compile attribute access on a slice of @system_variables.uploaded_files', () => {
      const expr = new MemberExpression(
        new SubscriptExpression(
          new MemberExpression(
            new AtIdentifier('system_variables'),
            'uploaded_files'
          ),
          new SliceExpression(
            new NumberLiteral(0),
            new NumberLiteral(3),
            undefined
          )
        ),
        'file_url'
      );
      expect(compileExpression(expr, ctx)).toBe(
        'system.uploaded_files[0:3].file_url'
      );
    });

    it('should compile attribute access on an indexed @system_variables.uploaded_files element', () => {
      const expr = new MemberExpression(
        new SubscriptExpression(
          new MemberExpression(
            new AtIdentifier('system_variables'),
            'uploaded_files'
          ),
          new NumberLiteral(0)
        ),
        'id'
      );
      expect(compileExpression(expr, ctx)).toBe('system.uploaded_files[0].id');
    });

    it('should reject slices directly on @system_variables', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new SliceExpression(
          new NumberLiteral(0),
          new NumberLiteral(1),
          undefined
        )
      );
      compileExpression(expr, ctx);
      const errors = ctx.diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/Slices are not supported/);
    });

    it('should reject a bare slice outside a subscript', () => {
      const bare = new SliceExpression(
        new NumberLiteral(0),
        new NumberLiteral(1),
        undefined
      );
      compileExpression(bare, ctx);
      const errors = ctx.diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].message).toMatch(/only valid inside a subscript/);
    });
  });

  describe('template expressions', () => {
    it('should compile template with interpolations', () => {
      ctx.mutableVariableNames.add('name');
      const expr = new TemplateExpression([
        new TemplateText('Hello '),
        new TemplateInterpolation(
          new MemberExpression(new AtIdentifier('variables'), 'name')
        ),
        new TemplateText('!'),
      ]);
      expect(compileExpression(expr, ctx)).toBe('Hello {{state.name}}!');
    });

    it('should compile template in system message mode for linked vars', () => {
      ctx.linkedVariableNames.add('name');
      const expr = new TemplateExpression([
        new TemplateText('Hello '),
        new TemplateInterpolation(
          new MemberExpression(new AtIdentifier('variables'), 'name')
        ),
        new TemplateText('!'),
      ]);
      expect(compileExpression(expr, ctx, { isSystemMessage: true })).toBe(
        'Hello {!$Context.name}!'
      );
    });

    it('should compile template in system message mode for mutable vars', () => {
      ctx.mutableVariableNames.add('name');
      const expr = new TemplateExpression([
        new TemplateText('Hello '),
        new TemplateInterpolation(
          new MemberExpression(new AtIdentifier('variables'), 'name')
        ),
        new TemplateText('!'),
      ]);
      expect(compileExpression(expr, ctx, { isSystemMessage: true })).toBe(
        'Hello {{state.name}}!'
      );
    });
  });

  describe('bare @identifier errors', () => {
    it('should error for bare @variables without property', () => {
      const expr = new AtIdentifier('variables');
      compileExpression(expr, ctx);
      expect(
        ctx.diagnostics.some(d => d.severity === DiagnosticSeverity.Error)
      ).toBe(true);
    });
  });

  describe('spread expressions', () => {
    it('should compile spread of identifier', () => {
      const expr = new SpreadExpression(new Identifier('items'));
      expect(compileExpression(expr, ctx)).toBe('*items');
    });

    it('should compile spread of @variables member', () => {
      ctx.mutableVariableNames.add('artifacts');
      const expr = new SpreadExpression(
        new MemberExpression(new AtIdentifier('variables'), 'artifacts')
      );
      expect(compileExpression(expr, ctx)).toBe('*state.artifacts');
    });

    it('should compile spread of linked @variables member', () => {
      ctx.linkedVariableNames.add('artifacts');
      const expr = new SpreadExpression(
        new MemberExpression(new AtIdentifier('variables'), 'artifacts')
      );
      expect(compileExpression(expr, ctx)).toBe('*variables.artifacts');
    });

    it('should compile spread inside call expression', () => {
      ctx.mutableVariableNames.add('artifacts');
      const expr = new CallExpression(new Identifier('a2a_parts'), [
        new SpreadExpression(
          new MemberExpression(new AtIdentifier('variables'), 'artifacts')
        ),
      ]);
      expect(compileExpression(expr, ctx)).toBe('a2a_parts(*state.artifacts)');
    });
  });

  describe('json_path calls', () => {
    it('should render two arguments and rewrite mutable variables to state', () => {
      ctx.mutableVariableNames.add('payload');
      const expr = new CallExpression(new Identifier('json_path'), [
        new MemberExpression(new AtIdentifier('variables'), 'payload'),
        new StringLiteral('$.items[0].name'),
      ]);

      expect(compileExpression(expr, ctx)).toBe(
        'json_path(state.payload, "$.items[0].name")'
      );
    });

    it('should render the optional default and escape selector quotes and backslashes', () => {
      ctx.mutableVariableNames.add('payload');
      const selector = String.raw`$["customer\"key"]["path\\name"]`;
      const expr = new CallExpression(new Identifier('json_path'), [
        new MemberExpression(new AtIdentifier('variables'), 'payload'),
        new StringLiteral(selector),
        new StringLiteral('missing'),
      ]);

      expect(compileExpression(expr, ctx)).toBe(
        `json_path(state.payload, ${JSON.stringify(selector)}, "missing")`
      );
    });
  });

  describe('lower/upper/to_json/from_json calls', () => {
    it.each(['lower', 'upper', 'to_json', 'from_json'])(
      'should render %s(...) and rewrite mutable variables to state',
      name => {
        ctx.mutableVariableNames.add('text');
        const expr = new CallExpression(new Identifier(name), [
          new MemberExpression(new AtIdentifier('variables'), 'text'),
        ]);

        expect(compileExpression(expr, ctx)).toBe(`${name}(state.text)`);
      }
    );

    it('should compile to_json() on a string literal argument', () => {
      const expr = new CallExpression(new Identifier('to_json'), [
        new StringLiteral('hello'),
      ]);

      expect(compileExpression(expr, ctx)).toBe('to_json("hello")');
    });
  });

  describe('null expression handling', () => {
    it('should not throw when expression is null', () => {
      // Parser may produce null expr nodes for incomplete syntax
      // (e.g. `set foo = ` with nothing after `=`).
      expect(() =>
        compileExpression(null as unknown as Expression, ctx)
      ).not.toThrow();
    });

    it('should emit COMPILER_NULL_EXPRESSION diagnostic for null expression', () => {
      compileExpression(null as unknown as Expression, ctx);
      expect(
        ctx.diagnostics.some(
          d =>
            d.severity === DiagnosticSeverity.Error &&
            d.code === 'COMPILER_NULL_EXPRESSION'
        )
      ).toBe(true);
    });

    it('should not throw when nested expression is null (e.g. spread of null)', () => {
      const expr = new SpreadExpression(null as unknown as Expression);
      expect(() => compileExpression(expr, ctx)).not.toThrow();
      expect(
        ctx.diagnostics.some(d => d.code === 'COMPILER_NULL_EXPRESSION')
      ).toBe(true);
    });

    it('compileValueExpression should not throw when expression is null', () => {
      expect(() =>
        compileValueExpression(null as unknown as Expression, ctx)
      ).not.toThrow();
    });

    it('compileValueExpression should emit only COMPILER_NULL_EXPRESSION for null input', () => {
      const result = compileValueExpression(null as unknown as Expression, ctx);
      expect(result).toBe('');
      const errors = ctx.diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Error
      );
      expect(errors.length).toBe(1);
      expect(errors[0].code).toBe('COMPILER_NULL_EXPRESSION');
    });
  });
});
