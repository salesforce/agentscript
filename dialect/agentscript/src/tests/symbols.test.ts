/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { expect, test, describe } from 'vitest';
import { parseDocument, parseWithDiagnostics } from './test-utils.js';
import { getDocumentSymbols, SymbolKind } from '@agentscript/language';
import { AgentScriptSchemaAliases, AgentScriptSchema } from '../schema.js';

function symbols(source: string) {
  const ast = parseDocument(source);
  return getDocumentSymbols(ast);
}

describe('getDocumentSymbols', () => {
  test('empty document returns empty array', () => {
    expect(symbols('')).toEqual([]);
  });

  test('single block (system) produces symbol with children', () => {
    const result = symbols(`system:\n    instructions: "hello"`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('system');
    expect(result[0].kind).toBe(SymbolKind.Namespace);
    expect(result[0].children).toBeDefined();

    const instructions = result[0].children!.find(
      c => c.name === 'instructions'
    );
    expect(instructions).toBeDefined();
    expect(instructions!.kind).toBe(SymbolKind.Property);
  });

  test('config block maps to Object kind', () => {
    const result = symbols(`config:\n    description: "Test"`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('config');
    expect(result[0].kind).toBe(SymbolKind.Object);
  });

  test('named blocks (topic) produce "schemaKey entryName" at root level', () => {
    const result = symbols(`subagent main:\n    label: "Main"`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('subagent main');
    expect(result[0].kind).toBe(SymbolKind.Class);
  });

  test('multiple topics produce separate root-level symbols', () => {
    const result = symbols(
      `subagent alpha:\n    label: "A"\nsubagent beta:\n    label: "B"`
    );
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('subagent alpha');
    expect(result[1].name).toBe('subagent beta');
  });

  test('start_agent uses source key in name, not aliased', () => {
    const result = symbols(`start_agent selector:\n    label: "Start"`);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('start_agent selector');
    expect(result[0].kind).toBe(SymbolKind.Class);
  });

  test('SCHEMA_KEY_ALIAS maps start_agent to topic', () => {
    expect(AgentScriptSchemaAliases['start_agent']).toBe('subagent');
  });

  test('variables block produces Namespace with Variable children and detail', () => {
    const result = symbols(
      `variables:\n    name: mutable string\n    age: mutable number`
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('variables');
    expect(result[0].kind).toBe(SymbolKind.Namespace);
    expect(result[0].children).toHaveLength(2);
    expect(result[0].children![0].name).toBe('name');
    expect(result[0].children![0].kind).toBe(SymbolKind.Variable);
    expect(result[0].children![0].detail).toBe('mutable string');
    expect(result[0].children![0].children).toBeUndefined();
    expect(result[0].children![1].name).toBe('age');
    expect(result[0].children![1].kind).toBe(SymbolKind.Variable);
    expect(result[0].children![1].detail).toBe('mutable number');
  });

  test('nested hierarchy: topic > actions (container) > action > inputs > param', () => {
    const result = symbols(
      [
        'subagent main:',
        '    actions:',
        '        fetch:',
        '            description: "Fetch data"',
        '            inputs:',
        '                id: string',
        '            target: "ext://api"',
      ].join('\n')
    );

    expect(result).toHaveLength(1);
    const topic = result[0];
    expect(topic.name).toBe('subagent main');
    expect(topic.kind).toBe(SymbolKind.Class);

    // actions should be a Namespace container
    const actions = topic.children!.find(c => c.name === 'actions');
    expect(actions).toBeDefined();
    expect(actions!.kind).toBe(SymbolKind.Namespace);

    // action entry uses just the name (no "actions" prefix)
    const fetch = actions!.children!.find(c => c.name === 'fetch');
    expect(fetch).toBeDefined();
    expect(fetch!.kind).toBe(SymbolKind.Method);

    // inputs within action is a Namespace container
    const inputs = fetch!.children!.find(c => c.name === 'inputs');
    expect(inputs).toBeDefined();
    expect(inputs!.kind).toBe(SymbolKind.Namespace);

    // param uses just the name, with type as detail
    const id = inputs!.children!.find(c => c.name === 'id');
    expect(id).toBeDefined();
    expect(id!.kind).toBe(SymbolKind.Field);
    expect(id!.detail).toBe('string');
    expect(id!.children).toBeUndefined();
  });

  test('selectionRange is contained within range for parsed nodes', () => {
    const result = symbols(`system:\n    instructions: "hello"`);
    const sym = result[0];

    const { range, selectionRange } = sym;
    // selectionRange start should be >= range start
    expect(
      selectionRange.start.line > range.start.line ||
        (selectionRange.start.line === range.start.line &&
          selectionRange.start.character >= range.start.character)
    ).toBe(true);
    // selectionRange end should be <= range end
    expect(
      selectionRange.end.line < range.end.line ||
        (selectionRange.end.line === range.end.line &&
          selectionRange.end.character <= range.end.character)
    ).toBe(true);
  });

  test('detail on leaf StringLiteral shows value', () => {
    const result = symbols(`system:\n    instructions: "hello"`);
    const instructions = result[0].children!.find(
      c => c.name === 'instructions'
    );
    expect(instructions!.detail).toBe('hello');
  });

  test('detail on topic shows label', () => {
    const result = symbols(`subagent main:\n    label: "Main Topic"`);
    expect(result[0].detail).toBe('Main Topic');
  });

  test('leaf kinds (ProcedureValue) appear as Property, not recursed', () => {
    const result = symbols(
      [
        'subagent main:',
        '    before_reasoning: ->',
        '        | Do something first',
      ].join('\n')
    );

    const topic = result[0];
    const beforeReasoning = topic.children!.find(
      c => c.name === 'before_reasoning'
    );
    expect(beforeReasoning).toBeDefined();
    expect(beforeReasoning!.kind).toBe(SymbolKind.Property);
    // Should NOT have children (statements are not recursed into)
    expect(beforeReasoning!.children).toBeUndefined();
  });

  test('reasoning block produces Namespace kind', () => {
    const result = symbols(
      [
        'subagent main:',
        '    reasoning:',
        '        instructions: ->',
        '            | Think carefully',
      ].join('\n')
    );

    const topic = result[0];
    const reasoning = topic.children!.find(c => c.name === 'reasoning');
    expect(reasoning).toBeDefined();
    expect(reasoning!.kind).toBe(SymbolKind.Namespace);
  });

  test('nested messages block appears as Object child of system', () => {
    const result = symbols(
      [
        'system:',
        '    instructions: "hello"',
        '    messages:',
        '        welcome: "Hi"',
        '        error: "Oops"',
      ].join('\n')
    );

    const system = result[0];
    const messages = system.children!.find(c => c.name === 'messages');
    expect(messages).toBeDefined();
    expect(messages!.kind).toBe(SymbolKind.Object);
    expect(messages!.children).toHaveLength(2);
    expect(messages!.children![0].name).toBe('welcome');
    expect(messages!.children![0].kind).toBe(SymbolKind.Property);
  });
});

describe('unknown block handling', () => {
  test('unknown block diagnostic includes "Did you mean?" suggestion', () => {
    const result = parseWithDiagnostics(
      `subagnet main:\n    label: "Main"`,
      AgentScriptSchema
    );
    const diag = result.diagnostics.find(d => d.code === 'unknown-block');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Did you mean');
    expect(diag!.message).toContain('subagent');
    expect(diag!.data?.suggestion).toBe('subagent');
    expect(diag!.data?.expected).toContain('subagent');
  });

  test('unknown field diagnostic includes suggestion', () => {
    const result = parseWithDiagnostics(
      `system:\n    instuctions: "hello"`,
      AgentScriptSchema
    );
    const diag = result.diagnostics.find(d => d.code === 'unknown-field');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Did you mean');
    expect(diag!.message).toContain('instructions');
    expect(diag!.data?.suggestion).toBe('instructions');
  });

  test('unknown block with nested mapping produces UntypedBlock in symbols', () => {
    const result = symbols(
      `tpoic main:\n    label: "Main"\n    description: "test"`
    );
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('tpoic main');
    expect(result[0].kind).toBe(SymbolKind.Property);
    // UntypedBlock recursively parses children as untyped
    expect(result[0].children).toBeDefined();
    expect(result[0].children!.length).toBeGreaterThan(0);
  });

  test('unknown block round-trips through emit', () => {
    const source = `tpoic main:\n    label: "Main"\n    description: "test"`;
    const ast = parseDocument(source);
    const children = (ast as Record<string, unknown>).__children;
    expect(Array.isArray(children)).toBe(true);
    const untypedChild = (children as Array<Record<string, unknown>>).find(
      c => c.__type === 'untyped'
    );
    expect(untypedChild).toBeDefined();
    expect(untypedChild!.key).toBe('tpoic');
    expect(untypedChild!.name).toBe('main');
  });

  test('unknown block diagnostic data includes expected schema keys', () => {
    const result = parseWithDiagnostics(
      `foobar:\n    name: "x"`,
      AgentScriptSchema
    );
    const diag = result.diagnostics.find(d => d.code === 'unknown-block');
    expect(diag).toBeDefined();
    expect(diag!.data?.expected).toBeDefined();
    expect(Array.isArray(diag!.data?.expected)).toBe(true);
  });

  test('singular block with unexpected name produces diagnostic and preserves block', () => {
    const source = [
      'config:',
      '    developer_name: "test_reasoning_malform"',
      '    description: "Test"',
      '',
      'subagent ServiceCustomerVerification:',
      '    description: "Test"',
      '    reasoning asdfasdf:',
      '        instructions: ->',
      '            | test',
    ].join('\n');
    const result = parseWithDiagnostics(source, AgentScriptSchema);

    // Should have a diagnostic about the unexpected name
    const diag = result.diagnostics.find(
      d => d.code === 'unexpected-block-name'
    );
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('asdfasdf');
    expect(diag!.message).toContain('reasoning');

    // The reasoning block should NOT be silently dropped
    const ast = parseDocument(source);
    const subagentMap = (ast as Record<string, unknown>).subagent as Map<
      string,
      Record<string, unknown>
    >;
    expect(subagentMap).toBeDefined();
    const subagent = subagentMap.get('ServiceCustomerVerification');
    expect(subagent).toBeDefined();
    expect(subagent!.reasoning).toBeDefined();
  });

  test('unrecognized top-level content produces syntax-error diagnostic', () => {
    const source = [
      'system:',
      '  instructions: "You are a helpful assistant"',
      '  messages:',
      '    welcome: "hello"',
      '    error: "goodbye"',
      'config:',
      '  developer_name: "Test"',
      '  agent_id: "1"',
      '  agent_type: "AgentforceServiceAgent"',
      '  default_agent_user: "user"',
      '@actions.sweet!',
    ].join('\n');
    const result = parseWithDiagnostics(source, AgentScriptSchema);
    const diag = result.diagnostics.find(d => d.code === 'syntax-error');
    expect(diag).toBeDefined();
    expect(diag!.message).toContain('Unrecognized syntax');
  });
});
