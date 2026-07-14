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
import { VariablesBlock } from '../blocks.js';
import { unusedVariablePass } from './unused-variable.js';

const ValueBlock = NamedBlock('ValueBlock', {
  expr: ExpressionValue.describe('An expression that may reference variables'),
});

const TestSchema = {
  variables: VariablesBlock,
  value: NamedCollectionBlock(ValueBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [unusedVariablePass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => d.code === 'unused-variable');
}

describe('unused-variable lint pass', () => {
  it('flags a variable that is declared but never referenced', () => {
    const diags = getDiagnostics(`
variables:
    unused: mutable string = ""
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('unused');
  });

  it('does not flag a variable that is referenced in an expression', () => {
    const diags = getDiagnostics(`
variables:
    used: mutable string = ""

value v:
    expr: @variables.used
`);
    expect(diags).toHaveLength(0);
  });

  it('flags only the unused variables when multiple are declared', () => {
    const diags = getDiagnostics(`
variables:
    used: mutable string = ""
    unused: mutable string = ""

value v:
    expr: @variables.used
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('unused');
  });

  it('reports one diagnostic per unused variable', () => {
    const diags = getDiagnostics(`
variables:
    a: mutable string = ""
    b: mutable string = ""
    c: mutable string = ""
`);
    expect(diags).toHaveLength(3);
  });

  it('does not flag variables when no `variables:` block is declared', () => {
    const diags = getDiagnostics(`
value v:
    expr: @variables.foo
`);
    expect(diags).toHaveLength(0);
  });
});
