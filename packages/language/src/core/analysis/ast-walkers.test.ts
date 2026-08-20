/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from '../dialect.js';
import { Block, NamedBlock, NamedCollectionBlock, TypedMap } from '../block.js';
import { ExpressionValue } from '../primitives.js';
import { AGENTSCRIPT_PRIMITIVE_TYPES } from '../primitives-constants.js';
import { decomposeAtMemberExpression } from '../expressions.js';
import { walkAstExpressions } from './ast-walkers.js';

const ValueBlock = NamedBlock('ValueBlock', {
  expr: ExpressionValue.describe('An expression'),
});

// A typed map (like action/response-format `inputs:`) whose entries parse as
// typed declarations carrying a `= <expr>` colinear default value.
const TestSchema = {
  value: NamedCollectionBlock(ValueBlock),
  inputs: TypedMap('InputsBlock', Block('ParamPropsBlock'), {
    primitiveTypes: AGENTSCRIPT_PRIMITIVE_TYPES,
  }),
};

/**
 * Parse source through the dialect and collect every `@namespace.property`
 * reference the walker visits — the same decomposition reference resolution,
 * type inference, and lint passes rely on.
 */
function visitedReferences(source: string): string[] {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const names: string[] = [];
  walkAstExpressions(result.value, expr => {
    const decomposed = decomposeAtMemberExpression(expr);
    if (decomposed) {
      names.push(`${decomposed.namespace}.${decomposed.property}`);
    }
  });
  return names;
}

describe('walkAstExpressions — slice bounds', () => {
  // Regression: SliceExpression is registered as an ExpressionKind, so
  // dispatchAstChildren routes it through forEachExpressionChild. Without a
  // dedicated case there, start/stop/step were never recursed into — so
  // references nested in slice bounds were invisible to reference resolution,
  // type inference, and lint passes (e.g. an undefined-reference check would
  // silently skip `@variables.x` inside `uploaded_files[0:@variables.x]`).

  it('visits a reference in the start bound', () => {
    expect(
      visitedReferences(`
value v:
    expr: @system_variables.uploaded_files[@variables.begin:3]
`)
    ).toContain('variables.begin');
  });

  it('visits a reference in the stop bound', () => {
    expect(
      visitedReferences(`
value v:
    expr: @system_variables.uploaded_files[0:@variables.end]
`)
    ).toContain('variables.end');
  });

  it('visits a reference in the step bound', () => {
    expect(
      visitedReferences(`
value v:
    expr: @system_variables.uploaded_files[0:9:@variables.step]
`)
    ).toContain('variables.step');
  });

  it('visits references in all three bounds at once', () => {
    expect(
      visitedReferences(`
value v:
    expr: @system_variables.uploaded_files[@variables.a:@variables.b:@variables.c]
`)
    ).toEqual(
      expect.arrayContaining(['variables.a', 'variables.b', 'variables.c'])
    );
  });
});

describe('walkAstExpressions — typed declaration default values', () => {
  // The walk must visit references inside a declaration's default value
  // (e.g. `@variables.x` in `count: number = @variables.x`).

  it('visits a reference in a scalar default value', () => {
    expect(
      visitedReferences(`
inputs:
    count: number = @variables.n
`)
    ).toContain('variables.n');
  });

  it('visits references in a list default value', () => {
    expect(
      visitedReferences(`
inputs:
    refs: list[string] = [@variables.a, @variables.b]
`)
    ).toEqual(expect.arrayContaining(['variables.a', 'variables.b']));
  });

  it('does not visit the type keyword as a reference', () => {
    // The `type` field (`number`, `list[string]`) must NOT be walked as a
    // value expression, or identifier/expression validation would flag it.
    const refs = visitedReferences(`
inputs:
    count: number = @variables.n
`);
    expect(refs).toEqual(['variables.n']);
  });
});
