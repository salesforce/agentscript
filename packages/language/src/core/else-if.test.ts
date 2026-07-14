/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Unit tests for `else if` clause handling at the language IR layer.
 *
 * Covers:
 *   - IfStatement.parse builds a chain of nested IfStatements when given an
 *     `else_if_clause` CST alternative.
 *   - The chain links carry CST type `else_if_clause` (so the lint and
 *     compiler nesting checks can distinguish them from user-written nested
 *     ifs).
 *   - IfStatement.__emit reproduces `else if` source text from a chain.
 */
import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from './dialect.js';
import { NamedBlock, NamedCollectionBlock } from './block.js';
import { StringValue, ProcedureValue } from './primitives.js';
import { IfStatement } from './statements.js';

const ProcBlock = NamedBlock('ProcBlock', {
  label: StringValue.describe('Label'),
  body: ProcedureValue.describe('Procedure body'),
});

const TestSchema = {
  proc: NamedCollectionBlock(ProcBlock),
};

function parseProcBody(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;
  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  // Walk the NamedCollectionBlock structure: result.value.proc is a NamedMap
  // whose `__children` array holds entries shaped { name, value, ... }.
  const proc = (result.value as { proc?: unknown }).proc as
    | { __children?: Array<{ name: string; value: unknown }> }
    | undefined;
  const main = proc?.__children?.find(c => c.name === 'main')?.value as
    | { body?: { statements?: unknown[] } }
    | undefined;
  const stmts = main?.body?.statements ?? [];
  return { stmts, diagnostics: result.diagnostics };
}

describe('IfStatement parsing of else if chains', () => {
  it('parses a single else if into a nested IfStatement in orelse', () => {
    const { stmts, diagnostics } = parseProcBody(`
proc main:
  label: "main"
  body: ->
    if @variables.x == "a":
      | a
    else if @variables.x == "b":
      | b
`);

    expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
    expect(stmts).toHaveLength(1);

    const outer = stmts[0] as IfStatement;
    expect(outer).toBeInstanceOf(IfStatement);
    expect(outer.orelse).toHaveLength(1);

    const link = outer.orelse[0] as IfStatement;
    expect(link).toBeInstanceOf(IfStatement);
    expect(link.__cst?.node?.type).toBe('else_if_clause');
    expect(link.orelse).toHaveLength(0);
  });

  it('parses a multi-link else if/else chain into a flat-rooted nested IR', () => {
    const { stmts, diagnostics } = parseProcBody(`
proc main:
  label: "main"
  body: ->
    if @variables.x == "a":
      | a
    else if @variables.x == "b":
      | b
    else if @variables.x == "c":
      | c
    else:
      | d
`);

    expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);
    const outer = stmts[0] as IfStatement;
    expect(outer.__cst?.node?.type).toBe('if_statement');

    // Walk the chain — each link should be CST type else_if_clause.
    const link1 = outer.orelse[0] as IfStatement;
    expect(link1.__cst?.node?.type).toBe('else_if_clause');

    const link2 = link1.orelse[0] as IfStatement;
    expect(link2.__cst?.node?.type).toBe('else_if_clause');

    // Innermost link's orelse holds the final else body (a Template).
    expect(link2.orelse).toHaveLength(1);
    expect((link2.orelse[0] as { __kind?: string }).__kind).toBe('Template');
  });
});

describe('IfStatement emit of else if chains', () => {
  it('emits "else if" between chain links', () => {
    const { stmts } = parseProcBody(`
proc main:
  label: "main"
  body: ->
    if @variables.x == "a":
      | a
    else if @variables.x == "b":
      | b
`);

    const outer = stmts[0] as IfStatement;
    const emitted = outer.__emit({ indent: 0 });

    expect(emitted).toContain('if @variables.x == "a":');
    expect(emitted).toContain('else if @variables.x == "b":');
    expect(emitted).not.toMatch(/\belif\b/);
  });

  it('emits "else if" for every link in a multi-link chain with else', () => {
    const { stmts } = parseProcBody(`
proc main:
  label: "main"
  body: ->
    if @variables.x == "a":
      | a
    else if @variables.x == "b":
      | b
    else if @variables.x == "c":
      | c
    else:
      | d
`);

    const outer = stmts[0] as IfStatement;
    const emitted = outer.__emit({ indent: 0 });

    // Two `else if` lines (b, c) plus one trailing else.
    const elseIfMatches = emitted.match(/^else if /gm) ?? [];
    expect(elseIfMatches).toHaveLength(2);
    expect(emitted).toMatch(/^else:$/m);
    expect(emitted).not.toMatch(/\belif\b/);
  });
});
