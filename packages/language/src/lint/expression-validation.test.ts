/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from '../core/dialect.js';
import { NamedBlock, NamedCollectionBlock } from '../core/block.js';
import { ExpressionValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint-engine.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import {
  expressionValidationPass,
  type ExpressionValidationOptions,
} from './expression-validation.js';

const ExprBlock = NamedBlock('ExprBlock', {
  value: ExpressionValue.describe('Expression under test'),
});

const TestSchema = {
  expr: NamedCollectionBlock(ExprBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

const PASS_CODES = new Set([
  'unknown-function',
  'indirect-function-call',
  'namespace-function-call',
  'function-argument-count',
  'malformed-ast',
  'unsupported-operator',
  'unsupported-slice-target',
  'bare-uploaded-files-reference',
]);

function getDiagnostics(
  expression: string,
  options?: ExpressionValidationOptions
) {
  const { rootNode: root } = parse(`
expr one:
  value: ${expression}
`);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [expressionValidationPass(options)],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  // Guard against assertions passing on an expression that failed to parse.
  expect(diagnostics.filter(d => d.code === 'syntax-error')).toHaveLength(0);
  return diagnostics.filter(d => PASS_CODES.has(d.code as string));
}

describe('expression-validation lint pass', () => {
  describe('function calls', () => {
    it('does not flag a call to a built-in function', () => {
      expect(getDiagnostics('len(@variables.items)')).toHaveLength(0);
    });

    it('flags an unknown function and suggests a close match', () => {
      const diags = getDiagnostics('lenn(@variables.items)');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('unknown-function');
      expect(diags[0].message).toContain("'lenn' is not a recognized function");
      expect(diags[0].data).toEqual({ suggestion: 'len' });
    });

    it('flags a method call on a member expression', () => {
      const diags = getDiagnostics('@variables.items.append(1)');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('namespace-function-call');
    });

    it('flags an indirect call through a subscript', () => {
      const diags = getDiagnostics('@variables.fns[0](1)');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('indirect-function-call');
    });

    it('flags a call with the wrong number of arguments', () => {
      const diags = getDiagnostics('len(@variables.a, @variables.b)');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('function-argument-count');
      expect(diags[0].message).toBe(
        "'len' expects exactly 1 argument but received 2"
      );
    });

    it('flags a variadic function called with too few arguments', () => {
      const diags = getDiagnostics('max()');
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toBe(
        "'max' expects at least 1 argument but received 0"
      );
    });

    it('accepts any function in a custom name-only function set', () => {
      const options = { functions: new Set(['custom']) };
      expect(getDiagnostics('custom()', options)).toHaveLength(0);
      expect(getDiagnostics('custom(1, 2, 3)', options)).toHaveLength(0);
      expect(getDiagnostics('len(@variables.items)', options)).toHaveLength(1);
    });
  });

  describe('namespaced function calls', () => {
    const options = { namespacedFunctions: { a2a: new Set(['task']) } };

    it('does not flag an allowed namespaced function', () => {
      expect(getDiagnostics('a2a.task(@variables.x)', options)).toHaveLength(0);
    });

    it('flags an unknown function in a known namespace', () => {
      const diags = getDiagnostics('a2a.tsk(@variables.x)', options);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('unknown-function');
      expect(diags[0].message).toContain("in namespace 'a2a'");
      expect(diags[0].data).toEqual({ suggestion: 'task' });
    });

    it('flags an unknown namespace', () => {
      const diags = getDiagnostics('foo.task(@variables.x)', options);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('unknown-function');
      expect(diags[0].message).toContain("'foo' is not a recognized function");
    });
  });

  describe('operators', () => {
    it('does not flag supported operators', () => {
      expect(getDiagnostics('@variables.a + 1 == 2')).toHaveLength(0);
    });

    it('flags an operator outside the supported set', () => {
      const diags = getDiagnostics('@variables.a * 2');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('unsupported-operator');
      expect(diags[0].message).toBe("Operator '*' is not supported");
    });

    it('respects a custom supportedOperators set', () => {
      const options = { supportedOperators: new Set(['*']) };
      expect(getDiagnostics('@variables.a * 2', options)).toHaveLength(0);
      expect(getDiagnostics('@variables.a + 2', options)).toHaveLength(1);
    });
  });

  describe('@system_variables.uploaded_files', () => {
    it('flags a bare reference', () => {
      const diags = getDiagnostics('@system_variables.uploaded_files');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('bare-uploaded-files-reference');
    });

    it('flags a bare bracket-form reference', () => {
      const diags = getDiagnostics('@system_variables["uploaded_files"]');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('bare-uploaded-files-reference');
    });

    it('does not flag an indexed, sliced, or len() reference', () => {
      expect(
        getDiagnostics('@system_variables.uploaded_files[0]')
      ).toHaveLength(0);
      expect(
        getDiagnostics('@system_variables.uploaded_files[0:2]')
      ).toHaveLength(0);
      expect(
        getDiagnostics('len(@system_variables.uploaded_files)')
      ).toHaveLength(0);
    });

    it('flags a slice on @system_variables itself', () => {
      const diags = getDiagnostics('@system_variables[0:2]');
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('unsupported-slice-target');
    });
  });
});
