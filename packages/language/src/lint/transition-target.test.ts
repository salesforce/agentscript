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
import { transitionTargetPass } from './transition-target.js';

const ProcBlock = NamedBlock('ProcBlock', {
  label: StringValue.describe('Label'),
  body: ProcedureValue.describe('Procedure body'),
});

const TestSchema = {
  proc: NamedCollectionBlock(ProcBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(source: string, code?: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [transitionTargetPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  if (!code) return diagnostics;
  return diagnostics.filter(d => d.code === code);
}

describe('transition-target lint pass', () => {
  it('does not flag a valid `transition to <target>`', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    transition to @subagent.a
`);
    expect(diags).toHaveLength(0);
  });

  it('flags a bare `transition` with no target (F1)', () => {
    const diags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    transition
`,
      'transition-missing-target'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('requires a target');
    expect(diags[0].severity).toBe(1); // Error
  });

  it('flags multiple `to` clauses on a single transition (F2)', () => {
    const diags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    transition to @subagent.a, to @subagent.b
`,
      'transition-multiple-targets'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('single');
    expect(diags[0].severity).toBe(1);
  });

  it('flags every extra `to` in a 3-target transition', () => {
    const diags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    transition to @subagent.a, to @subagent.b, to @subagent.c
`,
      'transition-multiple-targets'
    );
    expect(diags).toHaveLength(2);
  });

  it('does not flag `transition to <target> with k=v`', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    transition to @subagent.a with x="hi"
`);
    expect(diags).toHaveLength(0);
  });
});
