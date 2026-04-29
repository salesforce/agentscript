/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import {
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
  TemplateExpression,
  TemplateText,
  TemplateInterpolation,
  CallExpression,
  SpreadExpression,
} from '@agentscript/language';
import { compileExpression } from '../src/expressions/compile-expression.js';
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

    it('should compile @variables in system message context as $Context.x', () => {
      ctx.mutableVariableNames.add('name');
      const expr = new MemberExpression(new AtIdentifier('variables'), 'name');
      expect(compileExpression(expr, ctx, { isSystemMessage: true })).toBe(
        '$Context.name'
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
    it('should compile @system_variables.user_input as state.__user_input__', () => {
      const expr = new MemberExpression(
        new AtIdentifier('system_variables'),
        'user_input'
      );
      expect(compileExpression(expr, ctx)).toBe('state.__user_input__');
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
      expect(compileExpression(expr, ctx)).toBe(
        'state.__user_input__ == "test"'
      );
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
      ctx.knowledgeFields.set('api_key', "'sk-123'");
      const expr = new MemberExpression(
        new AtIdentifier('knowledge'),
        'api_key'
      );
      expect(compileExpression(expr, ctx)).toBe("'sk-123'");
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
    it('should compile @system_variables["user_input"] as state["__user_input__"]', () => {
      const expr = new SubscriptExpression(
        new AtIdentifier('system_variables'),
        new StringLiteral('user_input')
      );
      expect(compileExpression(expr, ctx)).toBe('state["__user_input__"]');
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

    it('should compile template in system message mode', () => {
      ctx.mutableVariableNames.add('name');
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
});
