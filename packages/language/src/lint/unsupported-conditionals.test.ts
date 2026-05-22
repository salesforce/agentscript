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
import { unsupportedConditionalsPass } from './unsupported-conditionals.js';

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
    passes: [unsupportedConditionalsPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  if (!code) return diagnostics;
  return diagnostics.filter(d => d.code === code);
}

describe('unsupported-conditionals lint pass', () => {
  it('does not flag a plain if', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      | hi
`);
    expect(diags).toHaveLength(0);
  });

  it('does not flag a plain if/else', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      | hi
    else:
      | bye
`);
    expect(diags).toHaveLength(0);
  });

  it('flags a single elif', () => {
    const elifDiags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      | a
    elif @variables.x == "b":
      | b
`,
      'unsupported-elif'
    );
    expect(elifDiags).toHaveLength(1);
    expect(elifDiags[0].message).toContain("'elif'");
  });

  it('flags every link in a multi-elif chain', () => {
    const elifDiags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      | a
    elif @variables.x == "b":
      | b
    elif @variables.x == "c":
      | c
    else:
      | d
`,
      'unsupported-elif'
    );
    expect(elifDiags).toHaveLength(2);
  });

  it('flags a nested if inside an if body', () => {
    const nestedDiags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      if @variables.y == "b":
        | inner
`,
      'unsupported-nested-if'
    );
    expect(nestedDiags).toHaveLength(1);
    expect(nestedDiags[0].message).toContain('nested');
  });

  it('flags a nested if inside an else body', () => {
    const nestedDiags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      | a
    else:
      if @variables.y == "b":
        | inner
`,
      'unsupported-nested-if'
    );
    expect(nestedDiags).toHaveLength(1);
  });

  it('does not flag a top-level if inside a run body', () => {
    const diags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    run @actions.do
      if @variables.x == "a":
        | a
`,
      'unsupported-nested-if'
    );
    expect(diags).toHaveLength(0);
  });

  it('flags a nested if inside a run body', () => {
    const nestedDiags = getDiagnostics(
      `
proc one:
  label: "one"
  body: ->
    run @actions.do
      if @variables.x == "a":
        if @variables.y == "b":
          | inner
`,
      'unsupported-nested-if'
    );
    expect(nestedDiags).toHaveLength(1);
  });

  it('emits errors with severity Error', () => {
    const diags = getDiagnostics(`
proc one:
  label: "one"
  body: ->
    if @variables.x == "a":
      | a
    elif @variables.x == "b":
      | b
`);
    const myDiags = diags.filter(
      d => d.code === 'unsupported-elif' || d.code === 'unsupported-nested-if'
    );
    expect(myDiags.length).toBeGreaterThan(0);
    for (const d of myDiags) {
      expect(d.severity).toBe(1); // DiagnosticSeverity.Error === 1
    }
  });
});
