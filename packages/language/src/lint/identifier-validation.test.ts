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
import { ExpressionValue, ProcedureValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint-engine.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { identifierValidationPass } from './identifier-validation.js';

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

const IDENTIFIER_CODES = [
  'identifier-confusable-none',
  'identifier-confusable-boolean',
  'null-not-allowed',
  'unknown-identifier',
];

function getDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [identifierValidationPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => IDENTIFIER_CODES.includes(d.code ?? ''));
}

describe('identifier-validation lint pass', () => {
  describe('null (back-compat)', () => {
    it('flags null used as an expression value', () => {
      const diags = getDiagnostics(`
value v:
    expr: null
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('null-not-allowed');
      expect(diags[0].message).toContain('null');
      expect(diags[0].message).toContain('None');
      expect(diags[0].severity).toBe(1); // Error
    });

    it('flags NULL / Null (case-insensitive)', () => {
      expect(getDiagnostics(`\nvalue v:\n    expr: NULL\n`)).toHaveLength(1);
      expect(getDiagnostics(`\nvalue v:\n    expr: Null\n`)).toHaveLength(1);
    });

    it('flags null in a binary expression', () => {
      const diags = getDiagnostics(`
value v:
    expr: null == None
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('null-not-allowed');
    });

    it('flags null passed via a with-clause on an action invocation', () => {
      const diags = getDiagnostics(`
action some_action: @actions.Get_Details
    with order_number = null
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('null-not-allowed');
    });
  });

  describe('confusable literals', () => {
    it('flags lowercase none, steering to None', () => {
      const diags = getDiagnostics(`
value v:
    expr: @variables.x == none
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('identifier-confusable-none');
      expect(diags[0].message).toContain('None');
    });

    it('flags lowercase true / false, steering to True / False', () => {
      const t = getDiagnostics(`\nvalue v:\n    expr: @variables.x == true\n`);
      expect(t).toHaveLength(1);
      expect(t[0].code).toBe('identifier-confusable-boolean');
      expect(t[0].message).toContain('True');

      const f = getDiagnostics(`\nvalue v:\n    expr: @variables.x == false\n`);
      expect(f).toHaveLength(1);
      expect(f[0].code).toBe('identifier-confusable-boolean');
      expect(f[0].message).toContain('False');
    });
  });

  describe('unknown identifiers', () => {
    it('flags an arbitrary bareword', () => {
      const diags = getDiagnostics(`
value v:
    expr: @variables.x == abcd
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].code).toBe('unknown-identifier');
      expect(diags[0].message).toContain('abcd');
    });
  });

  describe('negatives', () => {
    it('does not flag None / True / False literals', () => {
      expect(
        getDiagnostics(`\nvalue v:\n    expr: @variables.x == None\n`)
      ).toHaveLength(0);
      expect(
        getDiagnostics(`\nvalue v:\n    expr: @variables.x == True\n`)
      ).toHaveLength(0);
      expect(
        getDiagnostics(`\nvalue v:\n    expr: @variables.x == False\n`)
      ).toHaveLength(0);
    });

    it('does not flag string / number literals', () => {
      expect(
        getDiagnostics(`\nvalue v:\n    expr: @variables.x == "abcd"\n`)
      ).toHaveLength(0);
      expect(
        getDiagnostics(`\nvalue v:\n    expr: @variables.x == 3\n`)
      ).toHaveLength(0);
    });

    it('does not flag a function callee (len)', () => {
      const diags = getDiagnostics(`
value v:
    expr: len(@variables.items) == 0
`);
      expect(diags).toHaveLength(0);
    });

    it('does not flag @variables references', () => {
      expect(
        getDiagnostics(`\nvalue v:\n    expr: @variables.some_variable\n`)
      ).toHaveLength(0);
    });
  });
});
