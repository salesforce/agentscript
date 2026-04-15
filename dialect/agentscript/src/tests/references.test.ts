/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { expect, test, describe } from 'vitest';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import {
  findDefinitionAtPosition,
  findReferencesAtPosition,
  findAllReferences,
  resolveReference,
  getDocumentSymbols,
  LintEngine,
  type PositionIndex,
} from '@agentscript/language';
import { defaultRules } from '../lint/passes/index.js';

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

describe('findDefinitionAtPosition', () => {
  test('returns null definition for empty AST', () => {
    const ast = parse('');
    const result = findDefinitionAtPosition(ast, 0, 0, testSchemaCtx);
    expect(result.definition).toBeNull();
    expect(result.reason).toBeDefined();
  });

  test('returns null definition for position not on a reference', () => {
    const source = 'system:\n    instructions: "hello"';
    const ast = parse(source);
    // Position on the string literal value, not a reference or definition key
    const pos = findPosition(source, 'hello');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );
    expect(result.definition).toBeNull();
    expect(result.reason).toBe(
      'Cursor is not on a reference or definition key'
    );
  });

  test('@variables.name resolves to variable declaration', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            foo: @actions.foo',
      '                set @variables.name=@outputs.result',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@variables.name');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('name');
    // Definition should be on line 1 (0-based) where "name:" is declared
    expect(result.definition!.definitionRange.start.line).toBe(1);
  });

  test('@subagent.greeting resolves to topic block via colinear reference', () => {
    const source = [
      'subagent greeting:',
      '    label: "Hello"',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            go: @subagent.greeting',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@subagent.greeting');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('greeting');
    // Definition should be on line 0 where "topic greeting:" is
    expect(result.definition!.definitionRange.start.line).toBe(0);
  });

  test('@actions.fetch resolves to action in enclosing topic', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            description: "Fetch data"',
      '            target: "ext://api"',
      '    reasoning:',
      '        actions:',
      '            do_fetch: @actions.fetch',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@actions.fetch');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('fetch');
    // Definition should be on line 2 where "fetch:" action is defined
    expect(result.definition!.definitionRange.start.line).toBe(2);
  });

  test('@actions in reasoning.instructions resolves to reasoning.actions entry', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        rate:',
      '            description: "Rate"',
      '            target: "ext://api"',
      '    reasoning:',
      '        instructions: ->',
      '            | Use {!@actions.do_rate} to rate',
      '        actions:',
      '            do_rate: @actions.rate',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@actions.do_rate');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('do_rate');
    expect(result.definition!.namespace).toBe('actions');
  });

  test('@actions resolves to topic-level action when same name exists in reasoning.actions', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        collect_info:',
      '            description: "Collect info"',
      '            target: "apex://collect_info"',
      '    reasoning:',
      '        instructions: ->',
      '            | run {!@actions.collect_info}',
      '        actions:',
      '            collect_info: @actions.collect_info',
      '                with name=@variables.name',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@actions.collect_info');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('collect_info');
    // Should resolve to the topic-level action definition (line 2),
    // not the reasoning action binding (line 9)
    expect(result.definition!.definitionRange.start.line).toBe(2);
  });

  describe('@actions references from reasoning.actions bindings', () => {
    // Scenario mirrors v15.agent: a reasoning.actions binding whose value is
    // `@actions.OriginalName`, where `OriginalName` also exists as a sibling
    // reasoning.actions entry. The value reference must resolve to the topic-
    // level action definition, NOT the sibling reasoning binding.
    const source = [
      /* 0  */ 'subagent main:',
      /* 1  */ '    actions:',
      /* 2  */ '        GetToken:',
      /* 3  */ '            description: "Get token"',
      /* 4  */ '            target: "ext://token"',
      /* 5  */ '            inputs:',
      /* 6  */ '                "siteId": string',
      /* 7  */ '                    description: "Site"',
      /* 8  */ '                    is_required: True',
      /* 9  */ '                    is_user_input: False',
      /* 10 */ '            outputs:',
      /* 11 */ '                accessToken: string',
      /* 12 */ '                    description: "Token"',
      /* 13 */ '                    is_displayable: False',
      /* 14 */ '                    filter_from_agent: False',
      /* 15 */ '    reasoning:',
      /* 16 */ '        instructions: ->',
      /* 17 */ '            | Pick a tool',
      /* 18 */ '        actions:',
      /* 19 */ '            RefreshToken: @actions.GetToken',
      /* 20 */ '                description: "Refresh the access token"',
      /* 21 */ '                with siteId = "s"',
      /* 22 */ '            GetToken: @actions.GetToken',
      /* 23 */ '                with siteId = "s"',
    ].join('\n');

    test('bare path (no symbols): RefreshToken value resolves to topic.actions.GetToken', () => {
      const ast = parse(source);
      // First occurrence of `@actions.GetToken` — on line 19, inside
      // RefreshToken binding.
      const pos = findPosition(source, '@actions.GetToken');
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('GetToken');
      // Must resolve to the topic-level definition at line 2,
      // NOT the reasoning sibling binding at line 22.
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });

    test('LSP path (with symbols): RefreshToken value resolves to topic.actions.GetToken', () => {
      const ast = parse(source);
      const symbols = getDocumentSymbols(ast);
      const pos = findPosition(source, '@actions.GetToken');
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx,
        symbols
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('GetToken');
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });

    test('LSP path (symbols + position index): RefreshToken value resolves to topic.actions.GetToken', () => {
      const ast = parse(source);
      const symbols = getDocumentSymbols(ast);

      const engine = new LintEngine({ passes: defaultRules() });
      const { store } = engine.run(ast, testSchemaCtx);
      const index = store.get('position-index' as never) as
        | PositionIndex
        | undefined;

      const pos = findPosition(source, '@actions.GetToken');
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx,
        symbols,
        index
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('GetToken');
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });

    test('self-referencing binding: GetToken value resolves to topic.actions.GetToken (not itself)', () => {
      const ast = parse(source);
      // Second `@actions.GetToken` — inside the GetToken reasoning binding
      // itself. Even though the binding has the same name, the reference
      // must still resolve to the topic-level definition, not to itself.
      const pos = findPosition(source, '@actions.GetToken', 1);
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('GetToken');
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });

    test('self-referencing binding with symbols: GetToken value resolves to topic.actions.GetToken', () => {
      const ast = parse(source);
      const symbols = getDocumentSymbols(ast);
      const pos = findPosition(source, '@actions.GetToken', 1);
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx,
        symbols
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('GetToken');
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });

    test('resolveReference directly with scope: resolves to topic.actions.GetToken', () => {
      const ast = parse(source);
      const symbols = getDocumentSymbols(ast);

      // Resolution with topic scope should give us the topic-level action.
      const resolved = resolveReference(
        ast,
        'actions',
        'GetToken',
        testSchemaCtx,
        { subagent: 'main' },
        symbols
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('GetToken');
      expect(resolved!.definitionRange.start.line).toBe(2);
    });

    test('resolveReference without symbols uses AST path', () => {
      const ast = parse(source);

      const resolved = resolveReference(
        ast,
        'actions',
        'GetToken',
        testSchemaCtx,
        { subagent: 'main' }
      );

      expect(resolved).not.toBeNull();
      expect(resolved!.name).toBe('GetToken');
      expect(resolved!.definitionRange.start.line).toBe(2);
    });

    test('reasoning binding to non-matching topic action: RefreshToken → GetToken when only GetToken exists at topic level', () => {
      // Simpler scenario: reasoning binding value points to an action that
      // does NOT have a sibling entry in reasoning.actions with the same
      // name. Sanity check that the common case works.
      const src = [
        /* 0 */ 'subagent main:',
        /* 1 */ '    actions:',
        /* 2 */ '        GetToken:',
        /* 3 */ '            description: "Get"',
        /* 4 */ '            target: "ext://token"',
        /* 5 */ '    reasoning:',
        /* 6 */ '        actions:',
        /* 7 */ '            Refresh: @actions.GetToken',
      ].join('\n');

      const ast = parse(src);
      const pos = findPosition(src, '@actions.GetToken');
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('GetToken');
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });

    test('undefined reference lint does not flag a valid topic-level action from reasoning.actions', () => {
      const ast = parse(source);
      const engine = new LintEngine({ passes: defaultRules() });
      const { diagnostics } = engine.run(ast, testSchemaCtx);
      // There should be no undefined-reference diagnostics about
      // @actions.GetToken — it exists at topic level.
      const undef = diagnostics.filter(d =>
        d.message.includes("'GetToken' is not defined")
      );
      expect(undef).toEqual([]);
    });

    test('@outputs inside a reasoning binding resolves through the topic-level colinear target', () => {
      // Regression for v15.agent: a reasoning binding
      // `Refresh: @actions.GetToken` has a `set @variables.x = @outputs.x`
      // body. `@outputs` is scoped to the colinear target — here,
      // `topic.actions.GetToken` — whose `outputs` map contains `accessToken`.
      // The lint was incorrectly resolving the colinear target through the
      // inner `reasoning.actions.GetToken` sibling (which has no outputs),
      // then flagging `accessToken` as undefined.
      const src = [
        'subagent main:',
        '    actions:',
        '        GetToken:',
        '            description: "Get"',
        '            target: "ext://token"',
        '            outputs:',
        '                accessToken: string',
        '                    description: "Token"',
        '    reasoning:',
        '        actions:',
        '            Refresh: @actions.GetToken',
        '                set @variables.token = @outputs.accessToken',
        '            GetToken: @actions.GetToken',
        '                set @variables.token = @outputs.accessToken',
      ].join('\n');

      const ast = parse(src);
      const engine = new LintEngine({ passes: defaultRules() });
      const { diagnostics } = engine.run(ast, testSchemaCtx);
      const outputsDiag = diagnostics.filter(
        d =>
          d.code === 'undefined-reference' &&
          d.message.includes("'accessToken' is not defined in outputs")
      );
      expect(outputsDiag).toEqual([]);
    });

    test('@outputs inside a reasoning binding: undefined output is still flagged', () => {
      // Negative: a genuinely missing output should still be flagged.
      const src = [
        'subagent main:',
        '    actions:',
        '        GetToken:',
        '            description: "Get"',
        '            target: "ext://token"',
        '            outputs:',
        '                accessToken: string',
        '                    description: "Token"',
        '    reasoning:',
        '        actions:',
        '            Refresh: @actions.GetToken',
        '                set @variables.token = @outputs.missingField',
      ].join('\n');

      const ast = parse(src);
      const engine = new LintEngine({ passes: defaultRules() });
      const { diagnostics } = engine.run(ast, testSchemaCtx);
      const outputsDiag = diagnostics.filter(
        d =>
          d.code === 'undefined-reference' && d.message.includes('missingField')
      );
      expect(outputsDiag.length).toBeGreaterThan(0);
    });

    test('go-to-definition on self-named binding with topic-level action points to topic-level', () => {
      // Regression: the existing `isSelfReference` path previously routed
      // `CloseCase: @actions.CloseCase` through the lint's standard-miss
      // path (no symbol-based resolution). With outer-first symbol lookup,
      // go-to-definition from the colinear `@actions.CloseCase` should
      // still land on the topic-level definition.
      const src = [
        /* 0 */ 'subagent main:',
        /* 1 */ '    actions:',
        /* 2 */ '        CloseCase:',
        /* 3 */ '            description: "Close"',
        /* 4 */ '            target: "ext://close"',
        /* 5 */ '    reasoning:',
        /* 6 */ '        actions:',
        /* 7 */ '            CloseCase: @actions.CloseCase',
      ].join('\n');

      const ast = parse(src);
      const symbols = getDocumentSymbols(ast);
      const pos = findPosition(src, '@actions.CloseCase');
      const result = findDefinitionAtPosition(
        ast,
        pos.line,
        pos.character,
        testSchemaCtx,
        symbols
      );

      expect(result.definition).not.toBeNull();
      expect(result.definition!.name).toBe('CloseCase');
      expect(result.definition!.definitionRange.start.line).toBe(2);
    });
  });

  test('@variables in template interpolation resolves with position index', () => {
    const source = [
      'variables:',
      '    priority: mutable number = 1',
      'subagent main:',
      '    reasoning:',
      '        instructions: ->',
      '            | Use priority {!@variables.priority} here',
    ].join('\n');

    const ast = parse(source);

    // Build position index (the LSP code path)
    const engine = new LintEngine({ passes: defaultRules() });
    const { store } = engine.run(ast, testSchemaCtx);
    const index = store.get('position-index' as never) as
      | PositionIndex
      | undefined;

    const pos = findPosition(source, '@variables.priority');

    // Without index (full AST walk) - should work
    const withoutIndex = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );
    expect(withoutIndex.definition).not.toBeNull();
    expect(withoutIndex.definition!.name).toBe('priority');

    // With index (LSP path) - was broken: AtIdentifier shadowed MemberExpression
    const withIndex = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx,
      undefined,
      index
    );
    expect(withIndex.definition).not.toBeNull();
    expect(withIndex.definition!.name).toBe('priority');
    expect(withIndex.definition!.namespace).toBe('variables');
  });

  test('@system.instructions resolves to system block field', () => {
    const source = ['system:', '    instructions: "Hello world"'].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, 'instructions');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('instructions');
    expect(result.definition!.namespace).toBe('system');
  });

  test('unknown reference returns null definition with reason', () => {
    const source = [
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            go: @subagent.nonexistent',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@subagent.nonexistent');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).toBeNull();
    expect(result.reason).toContain('nonexistent');
  });

  test('start_agent alias: @subagent.selector resolves to start_agent block', () => {
    const source = [
      'start_agent selector:',
      '    label: "Start"',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            go: @subagent.selector',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@subagent.selector');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    expect(result.definition).not.toBeNull();
    expect(result.definition!.name).toBe('selector');
    expect(result.definition!.definitionRange.start.line).toBe(0);
  });

  test('@outputs.result in set clause resolves to action output', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            outputs:',
      '                result: string',
      '            target: "ext://api"',
      '    reasoning:',
      '        actions:',
      '            do_fetch: @actions.fetch',
      '                set @variables.data=@outputs.result',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@outputs.result');
    const result = findDefinitionAtPosition(
      ast,
      pos.line,
      pos.character,
      testSchemaCtx
    );

    // @outputs.result is scoped to the called action
    // The enclosingAction from walker is "do_fetch" (ReasoningActionBlock)
    // Resolution looks for outputs on "do_fetch" in topic.main.actions
    // This won't resolve since "do_fetch" is a reasoning action, not an action definition
    // For now, this returns null — resolving through colinear expressions is future work
    expect(result.definition).toBeNull();
  });
});

describe('findReferencesAtPosition', () => {
  test('finds references to a variable from a reference position', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            foo: @actions.foo',
      '                with name=@variables.name',
      '                set @variables.name=@outputs.result',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@variables.name', 1);
    const refs = findReferencesAtPosition(
      ast,
      pos.line,
      pos.character,
      true,
      testSchemaCtx
    );

    // Should find the two @variables.name references + the declaration
    expect(refs.length).toBeGreaterThanOrEqual(2);

    const definitions = refs.filter(r => r.isDefinition);
    const usages = refs.filter(r => !r.isDefinition);
    expect(definitions).toHaveLength(1);
    expect(usages.length).toBeGreaterThanOrEqual(1);
  });

  test('includeDeclaration=false excludes the definition', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            foo: @actions.foo',
      '                with name=@variables.name',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@variables.name');
    const refs = findReferencesAtPosition(
      ast,
      pos.line,
      pos.character,
      false,
      testSchemaCtx
    );

    const definitions = refs.filter(r => r.isDefinition);
    expect(definitions).toHaveLength(0);
  });

  test('finds action references in reasoning', () => {
    const source = [
      'subagent main:',
      '    actions:',
      '        fetch:',
      '            description: "Fetch data"',
      '            target: "ext://api"',
      '    reasoning:',
      '        actions:',
      '            do_fetch: @actions.fetch',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@actions.fetch');
    const refs = findReferencesAtPosition(
      ast,
      pos.line,
      pos.character,
      true,
      testSchemaCtx
    );

    expect(refs.length).toBeGreaterThanOrEqual(1);
  });

  test('returns empty array for non-reference position', () => {
    const source = 'system:\n    instructions: "hello"';
    const ast = parse(source);
    const refs = findReferencesAtPosition(ast, 0, 0, true, testSchemaCtx);
    expect(refs).toEqual([]);
  });
});

describe('resolveReference — singular blocks', () => {
  test('resolves @config.description', () => {
    const source = ['config:', '    description: "My Agent"'].join('\n');

    const ast = parse(source);
    const result = resolveReference(
      ast,
      'config',
      'description',
      testSchemaCtx
    );

    expect(result).not.toBeNull();
    expect(result!.name).toBe('description');
    expect(result!.namespace).toBe('config');
  });
});

describe('nameRange (for rename)', () => {
  test('nameRange covers only the property name for expression references', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            foo: @actions.foo',
      '                with name=@variables.name',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@variables.name');
    const refs = findReferencesAtPosition(
      ast,
      pos.line,
      pos.character,
      true,
      testSchemaCtx
    );

    const usages = refs.filter(r => !r.isDefinition);
    expect(usages.length).toBeGreaterThanOrEqual(1);

    for (const usage of usages) {
      // nameRange should cover only "name", not "@variables.name"
      const nameLen =
        usage.nameRange.end.character - usage.nameRange.start.character;
      expect(nameLen).toBe('name'.length);
    }

    // Definition nameRange should also cover just the key "name"
    const def = refs.find(r => r.isDefinition);
    expect(def).toBeDefined();
    const defLen =
      def!.nameRange.end.character - def!.nameRange.start.character;
    expect(defLen).toBe('name'.length);
  });

  test('nameRange in template interpolation covers only the property', () => {
    const source = [
      'variables:',
      '    priority: mutable number = 1',
      'subagent main:',
      '    reasoning:',
      '        instructions: ->',
      '            | Use {!@variables.priority} here',
    ].join('\n');

    const ast = parse(source);
    const pos = findPosition(source, '@variables.priority');
    const refs = findReferencesAtPosition(
      ast,
      pos.line,
      pos.character,
      false,
      testSchemaCtx
    );

    expect(refs).toHaveLength(1);
    const ref = refs[0];
    // Full range should cover "@variables.priority"
    const fullLen = ref.range.end.character - ref.range.start.character;
    expect(fullLen).toBe('@variables.priority'.length);
    // nameRange should cover only "priority"
    const nameLen = ref.nameRange.end.character - ref.nameRange.start.character;
    expect(nameLen).toBe('priority'.length);
  });
});

describe('findAllReferences', () => {
  test('finds all @variables.name references across the document', () => {
    const source = [
      'variables:',
      '    name: mutable string',
      'subagent main:',
      '    reasoning:',
      '        actions:',
      '            a: @actions.a',
      '                with name=@variables.name',
      '            b: @actions.b',
      '                set @variables.name=@outputs.result',
    ].join('\n');

    const ast = parse(source);
    const refs = findAllReferences(
      ast,
      'variables',
      'name',
      testSchemaCtx,
      {},
      true
    );

    // At least 2 usages + 1 declaration
    const usages = refs.filter(r => !r.isDefinition);
    const definitions = refs.filter(r => r.isDefinition);
    expect(usages.length).toBeGreaterThanOrEqual(2);
    expect(definitions).toHaveLength(1);
  });
});
