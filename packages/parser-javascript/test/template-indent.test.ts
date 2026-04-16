/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Comprehensive tests for template indentation edge cases.
 *
 * When a template (| ...) has continuation lines at varying indentation,
 * the lexer must not emit spurious INDENT/DEDENT tokens that corrupt the
 * indent stack. These tests verify that downstream blocks (sibling mappings,
 * control flow, with-statements, etc.) survive template indent variation.
 *
 * Each test verifies two things:
 * 1. No ERROR nodes in the CST (structural correctness)
 * 2. Specific structural properties (the right nodes exist at the right level)
 */
import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lexer.js';
import { TokenKind } from '../src/token.js';
import { parse } from '../src/index.js';

function tokenize(source: string) {
  return new Lexer(source).tokenize();
}

function sexp(source: string): string {
  return parse(source).rootNode.toSExp();
}

describe('template indentation edge cases', () => {
  // --- Template continuation + sibling blocks ---

  it('zigzag indent in template does not swallow sibling mapping', () => {
    const s = sexp(`topic test:
    reasoning:
        instructions: ->
            | line1
                deep
              shallow
                  very_deep
        actions:
            my_action: @actions.test`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('template_content');
    // actions: must be a sibling mapping_element, not inside the procedure
    expect(s).toContain(
      'mapping_element key: (key (id)) block_value: (mapping (mapping_element key: (key (id)) colinear_value:'
    );
  });

  it('single deeper continuation then sibling field', () => {
    const s = sexp(`config:
    instructions: ->
        | hello
           world
    label: "test"`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('template_content');
    // label: must be a sibling of instructions:
    expect(s).toContain('string_content');
  });

  it('blank lines between template and sibling', () => {
    const s = sexp(`topic test:
    reasoning:
        instructions: ->
            | hello
               world

        actions:
            my_action: @actions.test`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('template_content');
  });

  // --- Template + control flow ---

  it('template in if-body followed by run statement', () => {
    const s = sexp(`config:
    msg: ->
        if @x == True:
            | yes
               more
        run @action.after`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('if_statement');
    expect(s).toContain('run_statement');
  });

  it('template in both if and else branches', () => {
    const s = sexp(`config:
    msg: ->
        if @x == True:
            | branch_a
               deep_a
        else:
            | branch_b
               deep_b`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('alternative:');
    // Both branches should have templates
    expect(s.match(/template_content/g)?.length).toBe(2);
  });

  it('template in nested if with statements at both levels', () => {
    const s = sexp(`config:
    msg: ->
        if @a == True:
            if @b == True:
                | nested
                   deep
            run @action.inner
        run @action.outer`);

    expect(s).not.toContain('ERROR');
    // Must have two separate run_statements
    expect(s.match(/run_statement/g)?.length).toBe(2);
  });

  // --- Sequential templates ---

  it('two sequential templates followed by run', () => {
    const s = sexp(`config:
    msg: ->
        | first
           deep1
        | second
           deep2
        run @action.test`);

    expect(s).not.toContain('ERROR');
    expect(s.match(/template/g)!.length).toBeGreaterThanOrEqual(2);
    expect(s).toContain('run_statement');
  });

  it('template with expression then continuation', () => {
    const s = sexp(`config:
    msg: ->
        | hello {!@user.name}
           continuation
        | goodbye`);

    expect(s).not.toContain('ERROR');
    // Should have template_expression for {!...}
    expect(s).toContain('template_expression');
  });

  // --- Edge indent levels ---

  it('continuation at exact pipe indent stays in procedure', () => {
    const s = sexp(`config:
    msg: ->
        | hello
        world_at_pipe_indent`);

    // This is at the same indent as PIPE, so it exits the template
    // and becomes a statement. No ERROR expected.
    expect(s).not.toContain('ERROR');
  });

  it('very deep then back to just above base indent', () => {
    const s = sexp(`a:
    b:
        c: ->
            | start
                         very_deep
             just_above_base
            run @action.test`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('run_statement');
  });

  it('triple nesting with template then sibling field', () => {
    const s = sexp(`a:
    b:
        c:
            d: ->
                | template
                    deep
                  shallow
            e: "sibling"`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('string_content');
  });

  // --- Multiple fields with templates ---

  it('two procedure fields both containing templates', () => {
    const s = sexp(`topic test:
    reasoning:
        instructions: ->
            | prompt1
               deep1
        actions:
            my_action: @actions.a
    instructions: ->
        | prompt2
           deep2`);

    expect(s).not.toContain('ERROR');
    expect(s.match(/template_content/g)?.length).toBe(2);
  });

  it('template then with-statements on action', () => {
    const s = sexp(`topic test:
    reasoning:
        instructions: ->
            | hello
               world
        actions:
            my_action: @actions.test
                with x=@v.x
                with y=@v.y`);

    expect(s).not.toContain('ERROR');
    expect(s.match(/with_statement/g)?.length).toBe(2);
  });

  it('template followed by set statement', () => {
    const s = sexp(`config:
    msg: ->
        | assign after this
           continuation
        set @variables.x = "done"`);

    expect(s).not.toContain('ERROR');
    expect(s).toContain('set_statement');
  });

  // --- Token-level verification ---

  it('no INDENT/DEDENT between template continuation lines', () => {
    const tokens = tokenize(`config:
    msg: ->
        | start
            deep
          shallow
              very_deep
           medium`);

    const kinds = tokens.map(t => t.kind);
    const pipeIdx = kinds.indexOf(TokenKind.PIPE);
    expect(pipeIdx).toBeGreaterThan(-1);

    // After PIPE: ID, INDENT (first entry), then only NEWLINE separators
    const afterPipe = kinds.slice(pipeIdx + 1);
    const firstDedent = afterPipe.indexOf(TokenKind.DEDENT);
    const templateTokens = afterPipe.slice(0, firstDedent);

    const indentCount = templateTokens.filter(
      k => k === TokenKind.INDENT
    ).length;
    const dedentCount = templateTokens.filter(
      k => k === TokenKind.DEDENT
    ).length;

    expect(indentCount).toBe(1); // only the initial entry
    expect(dedentCount).toBe(0); // no spurious DEDENTs
  });

  it('first continuation line after pipe still gets INDENT', () => {
    const tokens = tokenize(`config:
    message: |
        Hello World`);

    const kinds = tokens.map(t => t.kind);
    const pipeIdx = kinds.indexOf(TokenKind.PIPE);
    expect(kinds[pipeIdx + 1]).toBe(TokenKind.INDENT);
  });

  it('indent stack is correct after template with varying indent', () => {
    // After the template ends, the DEDENT count must be correct
    // so that the sibling field parses at the right level.
    const tokens = tokenize(`topic test:
    reasoning:
        instructions: ->
            | foo
                deep
              shallow
        actions:
            my_action: @actions.test`);

    const kinds = tokens.map(t => t.kind);

    // Count total INDENTs and DEDENTs — they must balance
    const indents = kinds.filter(k => k === TokenKind.INDENT).length;
    const dedents = kinds.filter(k => k === TokenKind.DEDENT).length;
    expect(indents).toBe(dedents);
  });
});
