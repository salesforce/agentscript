/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { expect, test, describe } from 'vitest';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import {
  findEnclosingScope,
  getAvailableNamespaces,
  getCompletionCandidates,
  getDocumentSymbols,
  getFieldCompletions,
  SymbolKind,
} from '@agentscript/language';

function parse(source: string) {
  return parseDocument(source);
}

// Helper: find the 0-based line and character of a substring in source
function findPosition(
  source: string,
  substring: string,
  occurrence = 0
): { line: number; character: number } {
  let idx = -1;
  for (let i = 0; i <= occurrence; i++) {
    idx = source.indexOf(substring, idx + 1);
    if (idx === -1)
      throw new Error(
        `Substring not found: "${substring}" (occurrence ${occurrence})`
      );
  }
  const lines = source.slice(0, idx).split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

// ============================================================================
// findEnclosingScope
// ============================================================================

describe('findEnclosingScope', () => {
  test('cursor outside any topic returns empty scope', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      'subagent main:',
      '    label: "Main"',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, 'name: mutable');
    const scope = findEnclosingScope(ast, pos.line, pos.character);
    expect(scope.subagent).toBeUndefined();
    expect(scope.action).toBeUndefined();
  });

  test('cursor inside topic returns enclosingTopic', () => {
    const source = [
      'subagent main:',
      '    label: "Main"',
      '    description: "A topic"',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, 'label');
    const scope = findEnclosingScope(ast, pos.line, pos.character);
    expect(scope.subagent).toBe('main');
    expect(scope.action).toBeUndefined();
  });

  test('cursor inside action returns both enclosingTopic and enclosingAction', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            description: "Fetch data"',
      '            target: "ext://api"',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, 'target');
    const scope = findEnclosingScope(ast, pos.line, pos.character);
    expect(scope.subagent).toBe('main');
    expect(scope.action).toBe('fetch');
  });

  test('works with start_agent alias', () => {
    const source = ['start_agent selector:', '    label: "Selector"'].join(
      '\n'
    );
    const ast = parse(source);
    const pos = findPosition(source, 'label');
    const scope = findEnclosingScope(ast, pos.line, pos.character);
    expect(scope.subagent).toBe('selector');
  });

  test('cursor inside reasoning action returns enclosingAction', () => {
    const source = [
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            do_thing: @actions.do_thing',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, '@actions');
    const scope = findEnclosingScope(ast, pos.line, pos.character);
    expect(scope.subagent).toBe('main');
    expect(scope.action).toBe('do_thing');
  });
});

// ============================================================================
// getAvailableNamespaces
// ============================================================================

describe('getAvailableNamespaces', () => {
  test('without scope returns global namespaces only', () => {
    const candidates = getAvailableNamespaces(testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('variables');
    expect(names).toContain('subagent');
    expect(names).not.toContain('actions');
    expect(names).not.toContain('inputs');
    expect(names).not.toContain('outputs');
  });

  test('with topic scope includes actions', () => {
    const candidates = getAvailableNamespaces(testSchemaCtx, {
      subagent: 'main',
    });
    const names = candidates.map(c => c.name);
    expect(names).toContain('variables');
    expect(names).toContain('actions');
    expect(names).not.toContain('inputs');
    expect(names).not.toContain('outputs');
  });

  test('with action scope includes inputs and outputs', () => {
    const candidates = getAvailableNamespaces(testSchemaCtx, {
      subagent: 'main',
      action: 'fetch',
    });
    const names = candidates.map(c => c.name);
    expect(names).toContain('variables');
    expect(names).toContain('actions');
    expect(names).toContain('inputs');
    expect(names).toContain('outputs');
  });

  test('all namespace candidates have Namespace kind', () => {
    const candidates = getAvailableNamespaces(testSchemaCtx, {
      subagent: 'main',
      action: 'fetch',
    });
    for (const c of candidates) {
      expect(c.kind).toBe(SymbolKind.Namespace);
    }
  });
});

// ============================================================================
// getCompletionCandidates
// ============================================================================

describe('getCompletionCandidates', () => {
  test('variables namespace returns variable names with type detail', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      '    age: mutable number',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'variables', testSchemaCtx);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('name');
    expect(candidates[0].kind).toBe(SymbolKind.Variable);
    expect(candidates[0].detail).toBe('mutable string');
    expect(candidates[1].name).toBe('age');
    expect(candidates[1].detail).toBe('mutable number');
  });

  test('subagent namespace returns topic names with label detail', () => {
    const source = [
      'subagent main:',
      '    label: "Main Topic"',
      'subagent help:',
      '    label: "Help Topic"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'subagent', testSchemaCtx);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('main');
    expect(candidates[0].detail).toBe('Main Topic');
    expect(candidates[1].name).toBe('help');
    expect(candidates[1].detail).toBe('Help Topic');
  });

  test('subagent namespace includes start_agent entries', () => {
    const source = [
      'subagent main:',
      '    label: "Main"',
      'start_agent selector:',
      '    label: "Selector"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'subagent', testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('main');
    expect(names).toContain('selector');
  });

  test('actions namespace inside topic returns that topics actions', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            description: "Fetch data"',
      '            label: "Fetch"',
      '            target: "ext://api"',
      '        save:',
      '            description: "Save data"',
      '            target: "ext://db"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'actions', testSchemaCtx, {
      subagent: 'main',
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('fetch');
    expect(candidates[0].detail).toBe('Fetch');
    expect(candidates[0].documentation).toBe('Fetch data');
    expect(candidates[1].name).toBe('save');
  });

  test('actions namespace outside topic returns empty', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            target: "ext://api"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'actions', testSchemaCtx);
    expect(candidates).toHaveLength(0);
  });

  test('inputs namespace inside action returns input params', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            inputs:',
      '                id: string',
      '                query: string',
      '            target: "ext://api"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'inputs', testSchemaCtx, {
      subagent: 'main',
      action: 'fetch',
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('id');
    expect(candidates[0].detail).toBe('string');
    expect(candidates[1].name).toBe('query');
  });

  test('outputs namespace inside action returns output params', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            outputs:',
      '                result: string',
      '                count: number',
      '            target: "ext://api"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'outputs', testSchemaCtx, {
      subagent: 'main',
      action: 'fetch',
    });
    expect(candidates).toHaveLength(2);
    expect(candidates[0].name).toBe('result');
    expect(candidates[0].detail).toBe('string');
    expect(candidates[1].name).toBe('count');
    expect(candidates[1].detail).toBe('number');
  });

  test('outputs in nested `run X` set clause completes from run target (not outer)', () => {
    // Regression: the v17.agent Preboarding case. Inside a reasoning.actions
    // binding body, a nested `run @actions.inner` establishes a new
    // action-call frame for its `set` clauses. `@outputs.` completion in
    // those set clauses must resolve against `inner`, not the outer binding.
    //
    // Source uses `@outputs.x` (parseable) and positions the cursor right
    // after the dot — same position an LSP client would report when
    // offering completion after `@outputs.`.
    const source = [
      'variables:',
      '    x: mutable string',
      'subagent main:',
      '    actions:',
      '        outer:',
      '            outputs:',
      '                outerResult: string',
      '            target: "ext://outer"',
      '        inner:',
      '            outputs:',
      '                innerResult: string',
      '            target: "ext://inner"',
      '    reasoning:',
      '        instructions: ->',
      '            | do',
      '        actions:',
      '            outer: @actions.outer',
      '                run @actions.inner',
      '                    set @variables.x=@outputs.x',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, '@outputs.x');
    // cursor placed right after the dot, inside the member expression
    const cursor = {
      line: pos.line,
      character: pos.character + '@outputs.'.length,
    };
    const candidates = getCompletionCandidates(
      ast,
      'outputs',
      testSchemaCtx,
      { subagent: 'main', action: 'outer' },
      undefined,
      cursor.line,
      cursor.character
    );
    const names = candidates.map(c => c.name);
    expect(names).toContain('innerResult');
    expect(names).not.toContain('outerResult');
  });

  test('outputs in nested `run X` with clause completes from OUTER (not run target)', () => {
    // Twin: `with` RHS of nested run references the outer scope's outputs,
    // so completion must offer the outer action's outputs, not the run
    // target's. (Semantic reason: `with` passes inputs TO the inner call.)
    const source = [
      'subagent main:',
      '    actions:',
      '        outer:',
      '            outputs:',
      '                outerResult: string',
      '            target: "ext://outer"',
      '        inner:',
      '            inputs:',
      '                arg: string',
      '            outputs:',
      '                innerResult: string',
      '            target: "ext://inner"',
      '    reasoning:',
      '        instructions: ->',
      '            | do',
      '        actions:',
      '            outer: @actions.outer',
      '                run @actions.inner',
      '                    with arg=@outputs.x',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, '@outputs.x');
    const cursor = {
      line: pos.line,
      character: pos.character + '@outputs.'.length,
    };
    const candidates = getCompletionCandidates(
      ast,
      'outputs',
      testSchemaCtx,
      { subagent: 'main', action: 'outer' },
      undefined,
      cursor.line,
      cursor.character
    );
    const names = candidates.map(c => c.name);
    expect(names).toContain('outerResult');
    expect(names).not.toContain('innerResult');
  });

  test('outputs in plain set clause (no nested run) still completes from outer', () => {
    // Control: confirms the nested-run override doesn't regress the
    // plain single-level case where `set @outputs.X` sits directly under
    // the binding body.
    const source = [
      'variables:',
      '    x: mutable string',
      'subagent main:',
      '    actions:',
      '        outer:',
      '            outputs:',
      '                outerResult: string',
      '            target: "ext://outer"',
      '    reasoning:',
      '        instructions: ->',
      '            | do',
      '        actions:',
      '            outer: @actions.outer',
      '                set @variables.x=@outputs.x',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, '@outputs.x');
    const cursor = {
      line: pos.line,
      character: pos.character + '@outputs.'.length,
    };
    const candidates = getCompletionCandidates(
      ast,
      'outputs',
      testSchemaCtx,
      { subagent: 'main', action: 'outer' },
      undefined,
      cursor.line,
      cursor.character
    );
    const names = candidates.map(c => c.name);
    expect(names).toContain('outerResult');
  });

  test('@actions in reasoning.instructions completes from reasoning.actions only', () => {
    // Innermost-wins (shadowing): inside reasoning.instructions, the
    // templated `@actions.X` references the binding name from
    // `reasoning.actions`, not the underlying `subagent.actions` definition.
    const source = [
      'subagent main:',
      '    actions:',
      '        Outer:',
      '            description: "outer"',
      '            target: "ext://o"',
      '    reasoning:',
      '        instructions: ->',
      '            | use {!@actions.x}',
      '        actions:',
      '            Inner: @actions.Outer',
      '                with foo = ...',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, '@actions.x');
    const cursor = {
      line: pos.line,
      character: pos.character + '@actions.'.length,
    };
    const symbols = getDocumentSymbols(ast);
    const candidates = getCompletionCandidates(
      ast,
      'actions',
      testSchemaCtx,
      { subagent: 'main' },
      symbols,
      cursor.line,
      cursor.character
    );
    const names = candidates.map(c => c.name);
    expect(names).toContain('Inner');
    expect(names).not.toContain('Outer');
  });

  test('@actions in a reasoning.actions binding RHS completes from subagent.actions', () => {
    // Counter-case: the cursor is inside reasoning.actions itself. The
    // binding RHS resolves into the underlying definitions, so the walk
    // must skip the enclosing `reasoning.actions` map and use
    // `subagent.actions`.
    const source = [
      'subagent main:',
      '    actions:',
      '        Outer:',
      '            description: "outer"',
      '            target: "ext://o"',
      '    reasoning:',
      '        instructions: ->',
      '            | go',
      '        actions:',
      '            Inner: @actions.x',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, '@actions.x');
    const cursor = {
      line: pos.line,
      character: pos.character + '@actions.'.length,
    };
    const symbols = getDocumentSymbols(ast);
    const candidates = getCompletionCandidates(
      ast,
      'actions',
      testSchemaCtx,
      { subagent: 'main' },
      symbols,
      cursor.line,
      cursor.character
    );
    const names = candidates.map(c => c.name);
    expect(names).toContain('Outer');
    expect(names).not.toContain('Inner');
  });

  test('config namespace returns config block fields', () => {
    const source = ['config:', '    description: "My Agent"'].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'config', testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('description');
  });

  test('system namespace returns system block fields', () => {
    const source = ['system:', '    instructions: "Hello"'].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'system', testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('instructions');
  });

  test('language namespace returns language block fields', () => {
    const source = [
      'language:',
      '    default_locale: "en_US"',
      '    all_additional_locales: True',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'language', testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('default_locale');
    expect(names).toContain('all_additional_locales');
  });

  test('unknown namespace returns empty', () => {
    const ast = parse('');
    const candidates = getCompletionCandidates(
      ast,
      'nonexistent',
      testSchemaCtx
    );
    expect(candidates).toHaveLength(0);
  });

  test('utils global scope returns known members via fallback', () => {
    const ast = parse('');
    const candidates = getCompletionCandidates(ast, 'utils', testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('transition');
    expect(names).toContain('setVariables');
    expect(names).toContain('escalate');
    expect(names).toContain('end_session');
    expect(candidates).toHaveLength(4);
  });

  test('system_variables global scope returns known members', () => {
    const ast = parse('');
    const candidates = getCompletionCandidates(
      ast,
      'system_variables',
      testSchemaCtx
    );
    const names = candidates.map(c => c.name);
    expect(names).toContain('user_input');
    expect(candidates).toHaveLength(1);
  });

  test('global scope completions have Property kind', () => {
    const ast = parse('');
    const candidates = getCompletionCandidates(ast, 'utils', testSchemaCtx);
    for (const c of candidates) {
      expect(c.kind).toBe(SymbolKind.Property);
    }
  });

  test('global scopes appear in available namespaces', () => {
    const candidates = getAvailableNamespaces(testSchemaCtx);
    const names = candidates.map(c => c.name);
    expect(names).toContain('utils');
    expect(names).toContain('system_variables');
  });

  test('variables with linked modifier shows correct detail', () => {
    const source = 'variables:\n    user_id: linked string';
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'variables', testSchemaCtx);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].name).toBe('user_id');
    expect(candidates[0].detail).toBe('linked string');
  });

  test('action with description provides documentation', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            description: "Fetches user profile data"',
      '            target: "ext://api"',
    ].join('\n');
    const ast = parse(source);
    const candidates = getCompletionCandidates(ast, 'actions', testSchemaCtx, {
      subagent: 'main',
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].documentation).toBe('Fetches user profile data');
  });
});

describe('getFieldCompletions', () => {
  test('returns top-level schema keys at root level', () => {
    const ast = parse('');
    const candidates = getFieldCompletions(ast, 0, 0, testSchemaCtx);
    const names = candidates.map(c => c.name);

    // Should include top-level blocks
    expect(names).toContain('system');
    expect(names).toContain('config');
    expect(names).toContain('variables');
    expect(names).toContain('subagent');
    // Should NOT include aliases
    expect(names).not.toContain('start_agent');
  });

  test('returns fields for system block', () => {
    const source = 'system:\n    instructions: "Test"';
    const ast = parse(source);
    // Position inside the system block, after "instructions"
    const pos = findPosition(source, 'instructions');
    const candidates = getFieldCompletions(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );
    const names = candidates.map(c => c.name);

    // Should suggest other system block fields (messages, etc.)
    // Should NOT suggest "instructions" since it's already present
    expect(names).not.toContain('instructions');
  });

  test('returns fields for topic block', () => {
    const source = [
      'subagent main:',
      '    label: "Main"',
      '    description: "Main topic"',
    ].join('\n');
    const ast = parse(source);
    const pos = findPosition(source, 'label');
    const candidates = getFieldCompletions(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );
    const names = candidates.map(c => c.name);

    // Should suggest remaining topic fields
    expect(names).not.toContain('label');
    expect(names).not.toContain('description');
    // Should include available fields like reasoning, actions, etc.
    expect(names).toContain('reasoning');
    expect(names).toContain('actions');
  });

  test('excludes already present blocks at root level', () => {
    const source = 'system:\n    instructions: "Test"';
    const ast = parse(source);
    const candidates = getFieldCompletions(ast, 0, 0, testSchemaCtx);
    const names = candidates.map(c => c.name);

    // system is already present (as a singular block) — should be excluded
    expect(names).not.toContain('system');
    // topic is a NamedBlock (Map) — should still be available
    expect(names).toContain('subagent');
  });

  test('on blank line, indentation inference overrides shallow CST result', () => {
    const source = [
      'subagent main:',
      '    reasoning:',
      '        instructions: "Think step by step"',
      '        ', // blank line — CST may resolve to topic, but we want reasoning
    ].join('\n');
    const ast = parse(source);
    // Cursor on the blank line at reasoning indent level
    const pos = { line: 3, character: 8 };
    const candidates = getFieldCompletions(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx,
      source
    );
    const names = candidates.map(c => c.name);

    // Should be inside reasoning block, not topic
    // "instructions" is already present so should be excluded
    expect(names).not.toContain('instructions');
    // Should include other reasoning fields
    expect(names).toContain('actions');
  });

  test('on non-blank line, CST result is preferred over indentation inference', () => {
    const source = [
      'subagent main:',
      '    label: "Main"',
      '    reasoning:',
      '        instructions: "Think"',
    ].join('\n');
    const ast = parse(source);
    // Position inside the reasoning block on an existing line
    const pos = findPosition(source, 'instructions');
    const candidates = getFieldCompletions(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx,
      source
    );
    const names = candidates.map(c => c.name);

    // CST correctly resolves to reasoning block — should see reasoning fields
    expect(names).not.toContain('instructions'); // already present
    expect(names).toContain('actions');
    // Should NOT see topic-level fields (that would mean CST was wrongly overridden)
    expect(names).not.toContain('label');
  });

  test('indentation inference used as fallback when CST returns null', () => {
    // Use source with enough structure that indentation can infer context
    // but position the cursor where CST can't resolve
    const source = [
      'subagent main:',
      '    reasoning:',
      '        instructions: "Think"',
      '        actions:',
      '            fetch:',
      '                target: "ext://api"',
      '    ', // blank line at topic level
    ].join('\n');
    const ast = parse(source);
    const pos = { line: 6, character: 4 };
    const candidates = getFieldCompletions(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx,
      source
    );
    const names = candidates.map(c => c.name);

    // Should resolve to topic level via indentation fallback
    expect(names).toContain('description');
  });

  test('returns no field completions inside a procedure body', () => {
    const source = [
      'subagent main:',
      '    reasoning:',
      '        instructions: ->',
      '            | some text',
      '            ',
    ].join('\n');
    const ast = parse(source);
    // Position cursor on the empty line inside the procedure body
    const pos = { line: 4, character: 12 };
    const candidates = getFieldCompletions(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx,
      source
    );

    // Inside a procedure body, no schema-based field completions apply
    expect(candidates).toHaveLength(0);
  });
});
