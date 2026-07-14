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
import { StringValue, ProcedureValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint-engine.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { unreachableCodePass } from './unreachable-code.js';

const ProcBlock = NamedBlock('ProcBlock', {
  label: StringValue.describe('Label'),
  body: ProcedureValue.describe('Procedure body'),
});

const TestSchema = {
  proc: NamedCollectionBlock(ProcBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [unreachableCodePass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => d.code === 'unreachable-code');
}

describe('unreachable-code lint pass', () => {
  it('flags code after a transition', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    transition to @subagent.next
    | this line is unreachable
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('transition');
  });

  it('does not flag a procedure whose last statement is a transition', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    | greet the user
    transition to @subagent.next
`);
    expect(diags).toHaveLength(0);
  });

  it('flags code after an if/else where both branches transition', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      transition to @subagent.left
    else:
      transition to @subagent.right
    | this line is unreachable
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("'if'");
  });

  it('does not flag code after an if/else where only one branch transitions', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      transition to @subagent.left
    else:
      | stay here
    | this line still runs in the else case
`);
    expect(diags).toHaveLength(0);
  });

  it('flags unreachable code inside a nested if body', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      transition to @subagent.left
      | unreachable inside the if
    | still reachable here
`);
    expect(diags).toHaveLength(1);
  });
});
