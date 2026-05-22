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
import { spreadContextPass } from './spread-context.js';

const ValueBlock = NamedBlock('ValueBlock', {
  expr: ExpressionValue.describe('An expression'),
});

const TestSchema = {
  value: NamedCollectionBlock(ValueBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function analyze(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [spreadContextPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return { diagnostics, rootNode: root };
}

function getDiagnostics(source: string) {
  return analyze(source).diagnostics.filter(
    d => d.code === 'invalid-spread-context'
  );
}

interface CstLike {
  type: string;
  namedChildren: readonly CstLike[];
}

function hasSyntaxError(node: CstLike): boolean {
  if (node.type === 'ERROR') return true;
  return node.namedChildren.some(c => hasSyntaxError(c));
}

describe('spread-context lint pass', () => {
  it('allows spread as a call argument', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(*items)
`);
    expect(diags).toHaveLength(0);
  });

  it('allows spread as a list element', () => {
    const diags = getDiagnostics(`
value v:
    expr: [*items, extra]
`);
    expect(diags).toHaveLength(0);
  });

  it('flags bare spread as an expression value', () => {
    const diags = getDiagnostics(`
value v:
    expr: *items
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('Spread');
  });

  it('flags spread inside a binary expression', () => {
    const diags = getDiagnostics(`
value v:
    expr: *items + 1
`);
    expect(diags).toHaveLength(1);
  });

  it('allows spread inside a nested call', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn(g(*items))
`);
    expect(diags).toHaveLength(0);
  });

  it('allows spread in a list nested inside a call', () => {
    const diags = getDiagnostics(`
value v:
    expr: fn([*items, 1])
`);
    expect(diags).toHaveLength(0);
  });

  it('allows spread in a call nested inside a list', () => {
    const diags = getDiagnostics(`
value v:
    expr: [fn(*items), 2]
`);
    expect(diags).toHaveLength(0);
  });

  it('flags spread used as the callee of a call', () => {
    const diags = getDiagnostics(`
value v:
    expr: (*fn)(x)
`);
    expect(diags.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects spread as a dict key (grammar does not permit it)', () => {
    // Python dicts use **, not *. The grammar should not produce a valid
    // SpreadExpression in dict-key position — it's a syntax error instead.
    const { rootNode } = analyze(`
value v:
    expr: {*items: 1}
`);
    expect(hasSyntaxError(rootNode as unknown as CstLike)).toBe(true);
  });
});
