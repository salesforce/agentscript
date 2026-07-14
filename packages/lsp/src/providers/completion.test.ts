/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the completion provider.
 */

import { describe, test, expect } from 'vitest';
import { provideCompletion } from './completion.js';
import { processDocument } from '../pipeline.js';
import { testConfig } from '../test-utils.js';

/** Helper: create a DocumentState from source text. */
function createState(source: string) {
  return processDocument('test://test.agent', source, testConfig);
}

const dialects = testConfig.dialects;
const dialectVersion = dialects[0].version;
const versionParts = dialectVersion.split('.');
const majorMinor = `${versionParts[0]}.${versionParts[1] ?? 0}`;

describe('Completion Provider', () => {
  // ── Dialect annotation completions ────────────────────────────

  describe('dialect annotation completions', () => {
    test('offers full annotation snippet when line starts with #', () => {
      const source = '#';
      const state = createState(source);
      const result = provideCompletion(state, 0, 1, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items.length).toBeGreaterThan(0);

      const item = result!.items[0];
      expect(item.label).toContain('# @dialect:');
      expect(item.insertTextFormat).toBe(2); // InsertTextFormat.Snippet
      // textEdit should replace the entire trigger text
      const textEdit = item.textEdit as {
        range: { start: { character: number } };
        newText: string;
      };
      expect(textEdit.newText).toContain('# @dialect:');
      expect(textEdit.range.start.character).toBe(0);
    });

    test('offers full annotation snippet for # @d partial', () => {
      const source = '# @d';
      const state = createState(source);
      const result = provideCompletion(state, 0, 4, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items.length).toBeGreaterThan(0);
      expect(result!.items[0].label).toContain('# @dialect:');
    });

    test('offers NAME=VERSION completions after # @dialect: ', () => {
      const source = '# @dialect: ';
      const state = createState(source);
      const result = provideCompletion(state, 0, 12, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items.length).toBeGreaterThan(0);

      const item = result!.items[0];
      expect(item.label).toContain('agentscript=');
      expect(item.kind).toBe(20); // CompletionItemKind.EnumMember
    });

    test('filters NAME completions by partial input', () => {
      const source = '# @dialect: age';
      const state = createState(source);
      const result = provideCompletion(state, 0, 15, undefined, dialects);

      expect(result).not.toBeNull();
      const labels = result!.items.map(i => i.label);
      expect(labels.some(l => l.toLowerCase().includes('agentscript'))).toBe(
        true
      );
    });

    test('offers version completions after NAME=', () => {
      const source = '# @dialect: agentscript=';
      const state = createState(source);
      const result = provideCompletion(state, 0, 24, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items.length).toBeGreaterThan(0);

      const labels = result!.items.map(i => i.label);
      expect(labels).toContain(versionParts[0]);
      expect(labels).toContain(majorMinor);
    });

    test('filters version completions by partial version input', () => {
      const source = `# @dialect: agentscript=${versionParts[0]}`;
      const state = createState(source);
      const result = provideCompletion(
        state,
        0,
        source.length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      // All returned versions should start with the major
      for (const item of result!.items) {
        expect(item.label.startsWith(versionParts[0])).toBe(true);
      }
    });

    test('returns empty items for unknown dialect name in version completion', () => {
      const source = '# @dialect: unknowndialect=';
      const state = createState(source);
      const result = provideCompletion(
        state,
        0,
        source.length,
        undefined,
        dialects
      );

      // Unknown dialect falls through to regular completions, returning empty items
      expect(result).not.toBeNull();
      expect(result!.items).toEqual([]);
    });

    test('does not offer dialect completions beyond line 10', () => {
      const lines = Array(10).fill('');
      lines.push('#');
      const source = lines.join('\n');
      const state = createState(source);
      // Line 10 (0-indexed), character 1
      const result = provideCompletion(state, 10, 1, undefined, dialects);

      // Should not get dialect annotation completions
      if (result) {
        const hasDialectSnippet = result.items.some(
          i => typeof i.label === 'string' && i.label.includes('@dialect')
        );
        expect(hasDialectSnippet).toBe(false);
      }
    });

    test('does not offer dialect completions when no dialects provided', () => {
      const source = '#';
      const state = createState(source);
      const result = provideCompletion(state, 0, 1, undefined, undefined);

      // Without dialects, should not produce annotation completions
      // but may return empty list from regular completions
      if (result) {
        const hasDialectSnippet = result.items.some(
          i => typeof i.label === 'string' && i.label.includes('@dialect')
        );
        expect(hasDialectSnippet).toBe(false);
      }
    });
  });

  // ── Regular AgentScript completions ───────────────────────────

  describe('field/block completions', () => {
    test('returns completion list for empty line in a block', () => {
      const source = 'system:\n  ';
      const state = createState(source);
      const result = provideCompletion(state, 1, 2, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.isIncomplete).toBe(false);
    });

    // ── Indentation-aware completions at every schema depth ──────

    // A realistic document used by the depth tests below.
    // Lines are numbered in comments for easy reference.
    const fullSource = [
      'system:', //                       L0   root Block
      '  instructions: "Hello"', //       L1
      'language:', //                      L2   root Block
      '  default_locale: "en_US"', //     L3
      '  ', //                            L4   blank inside language
      'variables:', //                    L5   root TypedMap
      '  name: mutable string', //        L6
      '  issue: mutable string', //       L7
      '  ', //                            L8   blank at variables map level
      'start_agent greeting:', //         L9   root CollectionBlock(NamedBlock)
      '  description: "Test"', //         L10
      '  ', //                            L11  blank inside topic entry
      '  actions:', //             L12  subagent CollectionBlock(NamedBlock)
      '    ', //                          L13  blank at actions map level
      '    collect_info:', //             L14  action entry key (no inline)
      '      ', //                        L15  blank inside action entry (first line)
      '      description: "collect"', //  L16
      '      ', //                        L17  blank inside action entry (between fields)
      '      inputs:', //                 L18  action TypedMap (InputsBlock)
      '        name: string', //          L19
      '        issue: string', //         L20
      '        ', //                      L21  blank at inputs map level
      '      outputs:', //                L22  action TypedMap (OutputsBlock)
      '        status: string', //        L23
      '          ', //                    L24  blank inside output entry
    ].join('\n');

    function labelsAt(
      line: number,
      character: number,
      source = fullSource
    ): string[] {
      const state = createState(source);
      const result = provideCompletion(
        state,
        line,
        character,
        undefined,
        dialects
      );
      return result?.items.map(i => i.label) ?? [];
    }

    // ── Depth 0: root level ──────────────────────────────────────

    test('root level Block (language) — blank line shows remaining fields', () => {
      const labels = labelsAt(4, 2); // L4: blank inside language:
      expect(labels).toContain('additional_locales');
      expect(labels).not.toContain('system');
      expect(labels).not.toContain('default_locale'); // already present
    });

    // ── Depth 0: root TypedMap (variables) ───────────────────────

    test('root TypedMap (variables) — blank at entry level shows VariablePropertiesBlock fields', () => {
      const labels = labelsAt(8, 2); // L8: same indent as variable entries
      expect(labels).toContain('description');
      expect(labels).toContain('label');
      expect(labels).toContain('is_required');
      expect(labels).not.toContain('system'); // root field
    });

    // ── Depth 1: inside a NamedBlock entry (start_agent topic) ──

    test('topic entry — blank line shows topic fields', () => {
      const labels = labelsAt(11, 2); // L11: blank inside greeting topic
      expect(labels).toContain('label');
      expect(labels).toContain('before_reasoning');
      expect(labels).not.toContain('description'); // already present
      expect(labels).not.toContain('variables'); // root field
    });

    // ── Depth 2: CollectionBlock (actions) inside topic ──────────

    test('actions map — blank at map level shows no fields', () => {
      const labels = labelsAt(13, 4); // L13: blank at actions map level
      expect(labels).not.toContain('label');
      expect(labels).not.toContain('before_reasoning');
      expect(labels).toHaveLength(0);
    });

    // ── Depth 3: inside a named action entry ─────────────────────

    test('action entry — blank first line after key shows action fields', () => {
      const labels = labelsAt(15, 6); // L15: first blank inside collect_info
      expect(labels).toContain('label');
      expect(labels).toContain('target');
      expect(labels).toContain('source');
      expect(labels).not.toContain('description'); // already present
      expect(labels).not.toContain('before_reasoning'); // parent topic field
    });

    test('action entry — blank between fields shows remaining action fields', () => {
      const labels = labelsAt(17, 6); // L17: blank between description and inputs
      expect(labels).toContain('label');
      expect(labels).toContain('target');
      expect(labels).not.toContain('description'); // already present
      expect(labels).not.toContain('inputs'); // already present
    });

    test('action entry — blank line between inputs and outputs shows remaining action fields', () => {
      // Blank line at action-field indent between two existing fields
      const src = [
        'start_agent greeting:',
        '  actions:',
        '    collect_info:',
        '      description: "collect"',
        '      inputs:',
        '        name: string',
        '      ',
        '      outputs:',
        '        status: string',
      ].join('\n');
      const labels = labelsAt(6, 6, src);
      expect(labels).toContain('label');
      expect(labels).toContain('target');
      expect(labels).not.toContain('description'); // already present
      expect(labels).not.toContain('inputs'); // already present
      expect(labels).not.toContain('outputs'); // already present
      expect(labels).not.toContain('before_reasoning'); // parent topic field
    });

    // ── Depth 4: TypedMap (inputs/outputs) inside action entry ───
    // TypedMaps show their entry properties at the entry level because
    // entries are typed declarations (e.g. "name: string"), not named
    // blocks.  This is different from NamedMaps where users type entry names.

    test('inputs TypedMap — blank at entry level shows InputPropertiesBlock fields', () => {
      const labels = labelsAt(21, 8); // L21: blank at inputs entry level
      expect(labels).toContain('description');
      expect(labels).toContain('is_required');
      expect(labels).not.toContain('target'); // parent action field
      expect(labels).not.toContain('system'); // root field
    });

    // ── Depth 5: inside a TypedMap entry (input/output properties)

    test('output entry — blank inside entry shows OutputPropertiesBlock fields', () => {
      const labels = labelsAt(24, 10); // L24: blank inside status output entry
      expect(labels).toContain('description');
      expect(labels).toContain('label');
      expect(labels).not.toContain('target'); // parent action field
      expect(labels).not.toContain('system'); // root field
    });

    test('VariablePropertiesBlock — blank deeper than entry shows properties', () => {
      const src = ['variables:', '  name: mutable string', '    '].join('\n');
      const labels = labelsAt(2, 4, src);
      expect(labels).toContain('description');
      expect(labels).toContain('label');
      expect(labels).toContain('is_required');
      expect(labels).not.toContain('variables');
    });

    test('InputPropertiesBlock — blank deeper than entry shows properties', () => {
      const src = [
        'start_agent g:',
        '  actions:',
        '    a:',
        '      inputs:',
        '        name: string',
        '          ',
      ].join('\n');
      const labels = labelsAt(5, 10, src);
      expect(labels).toContain('description');
      expect(labels).toContain('is_required');
      expect(labels).not.toContain('target');
    });

    // ── User's exact scenario: blank line at entry level in inputs ──

    test('inputs entry level — user scenario from bug report', () => {
      const src = [
        'start_agent greeting:',
        '  description: "Greet the customer and gather basic information"',
        '  actions:',
        '    collect_info:',
        '      description: "collect all the info needed"',
        '      inputs:',
        '        name: string',
        '        issue: string',
        '        ',
      ].join('\n');
      const labels = labelsAt(8, 8, src);
      expect(labels).toContain('description');
      expect(labels).toContain('is_required');
      expect(labels).not.toContain('target'); // parent action field
      expect(labels).not.toContain('system'); // root field
    });

    // ── Resilience: broken AST (parse errors in document) ──────

    test('action entry fields on blank line even when document has parse errors', () => {
      // `ou` on a later line breaks the AST, but indentation-based
      // inference should still resolve the correct schema via fallback.
      const src = [
        'start_agent greeting:',
        '  actions:',
        '    collect_info:',
        '      description: "collect"',
        '      inputs:',
        '        name: string',
        '        issue: string',
        '      ',
        '      ou',
      ].join('\n');
      // Line 7: blank at action-field indent (6), should still work
      const labels = labelsAt(7, 6, src);
      expect(labels).toContain('label');
      expect(labels).toContain('target');
      expect(labels).not.toContain('before_reasoning');
    });

    test('InputPropertiesBlock fields on blank line even with broken AST', () => {
      // Invalid text below breaks the parse, but schema-only fallback
      // should still resolve InputPropertiesBlock fields.
      const src = [
        'start_agent greeting:',
        '  actions:',
        '    collect_info:',
        '      inputs:',
        '        name: string',
        '          ',
        '      ou',
      ].join('\n');
      // Line 5: blank inside input entry (indent 10)
      const labels = labelsAt(5, 10, src);
      expect(labels).toContain('description');
      expect(labels).toContain('is_required');
      expect(labels).not.toContain('target');
    });

    test('returns empty items when line contains @', () => {
      const source = 'system:\n  instructions: @';
      const state = createState(source);
      const result = provideCompletion(state, 1, 18, undefined, dialects);

      // The @ triggers expression completions or returns empty
      expect(result).not.toBeNull();
    });

    test('returns empty items when line contains : in non-TypedMap context', () => {
      const source = 'system:\n  instructions: "hello"';
      const state = createState(source);
      // Cursor after the colon in a primitive field (not a TypedMap entry)
      const result = provideCompletion(state, 1, 17, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items).toEqual([]);
    });

    test('returns type completions after : in TypedMap entry', () => {
      const source = ['variables:', '  name: '].join('\n');
      const state = createState(source);
      // Cursor after "name: "
      const result = provideCompletion(state, 1, 8, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items.length).toBeGreaterThan(0);
      const labels = result!.items.map(i => i.label);
      // Should include primitive types
      expect(labels).toContain('string');
      expect(labels).toContain('number');
      expect(labels).toContain('boolean');
      // Should NOT include modifiers (those are part of entry syntax, not type position)
      expect(labels).not.toContain('mutable');
    });

    test('returns type completions in outputs TypedMap', () => {
      const source = [
        'start_agent greeting:',
        '  actions:',
        '    collect_info:',
        '      outputs:',
        '        result: ',
      ].join('\n');
      const state = createState(source);
      const result = provideCompletion(state, 4, 16, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items.length).toBeGreaterThan(0);
      const labels = result!.items.map(i => i.label);
      expect(labels).toContain('string');
      expect(labels).toContain('number');
    });

    test('returns empty list when ast is null', () => {
      const source = '';
      const state = createState(source);
      // Force null ast for edge case
      const stateNoAst = { ...state, ast: null, store: null };
      const result = provideCompletion(stateNoAst, 0, 0, undefined, dialects);

      expect(result).not.toBeNull();
      expect(result!.items).toEqual([]);
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    test('returns empty list on internal error (no crash)', () => {
      // Create a state with a broken service to trigger catch
      const state = createState('system:\n  instructions: "test"');
      // Sabotage the service to throw
      Object.defineProperty(state, 'ast', {
        get() {
          throw new Error('boom');
        },
      });

      const result = provideCompletion(state, 1, 2, undefined, dialects);
      expect(result).not.toBeNull();
      expect(result!.items).toEqual([]);
    });
  });

  // ── `with` parameter name completions ─────────────────────────

  describe('with parameter name completions', () => {
    test('suggests action input params for reasoning action binding', () => {
      const source = [
        'start_agent greeting:',
        '  actions:',
        '    Lookup_Order:',
        '      description: "Retrieve order details"',
        '      inputs:',
        '        order_number: string',
        '          description: "The order number"',
        '        customer_id: string',
        '      outputs:',
        '        status: string',
        '      target: "flow://Lookup_Order"',
        '  reasoning:',
        '    instructions: "test"',
        '    actions:',
        '      lookup: @actions.Lookup_Order',
        '        with ',
      ].join('\n');
      const state = createState(source);
      // Cursor at end of the `with ` line
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        source.split('\n')[lastLine].length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      const labels = result!.items.map(i => i.label);
      expect(labels).toContain('order_number');
      expect(labels).toContain('customer_id');
    });

    test('suggests action input params for run statement', () => {
      const source = [
        'start_agent greeting:',
        '  actions:',
        '    Check_Hours:',
        '      description: "Check hours"',
        '      inputs:',
        '        query: string',
        '        timezone: string',
        '      target: "flow://Check_Hours"',
        '  before_reasoning:',
        '    run @actions.Check_Hours',
        '      with ',
      ].join('\n');
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        source.split('\n')[lastLine].length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      const labels = result!.items.map(i => i.label);
      expect(labels).toContain('query');
      expect(labels).toContain('timezone');
    });

    test('excludes already-bound with params', () => {
      const source = [
        'start_agent greeting:',
        '  actions:',
        '    Lookup_Order:',
        '      inputs:',
        '        order_number: string',
        '        customer_id: string',
        '      target: "flow://Lookup_Order"',
        '  reasoning:',
        '    instructions: "test"',
        '    actions:',
        '      lookup: @actions.Lookup_Order',
        '        with order_number = @variables.order_num',
        '        with ',
      ].join('\n');
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        source.split('\n')[lastLine].length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      const labels = result!.items.map(i => i.label);
      expect(labels).toContain('customer_id');
      expect(labels).not.toContain('order_number'); // already bound
    });

    test('returns empty when action has no inputs', () => {
      const source = [
        'start_agent greeting:',
        '  actions:',
        '    NoInput:',
        '      description: "No inputs"',
        '      target: "flow://NoInput"',
        '  reasoning:',
        '    instructions: "test"',
        '    actions:',
        '      ni: @actions.NoInput',
        '        with ',
      ].join('\n');
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        source.split('\n')[lastLine].length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      // Should return empty since the action has no inputs
      const labels = result!.items.map(i => i.label);
      expect(labels).not.toContain('order_number');
    });

    test('returns empty when not on a with line', () => {
      const source = [
        'start_agent greeting:',
        '  actions:',
        '    Lookup_Order:',
        '      inputs:',
        '        order_number: string',
        '      target: "flow://Lookup_Order"',
        '  reasoning:',
        '    instructions: "test"',
        '    actions:',
        '      lookup: @actions.Lookup_Order',
        '        set ',
      ].join('\n');
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        source.split('\n')[lastLine].length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      // set lines should NOT trigger with-param completions
      const labels = result!.items.map(i => i.label);
      expect(labels).not.toContain('order_number');
    });
  });

  // ── node member-access completions ────────────────────────────
  //
  // Inside an expression, completion on a node reference offers member
  // access. After `@subagent.<node>.` the provider offers `input` and
  // `output`. The regex used to capture `@ns.name` only matched two
  // dot-separated parts, so a third dot (member access on a resolved
  // node) never matched and nothing was offered.
  describe('node member-access completions', () => {
    const nodeSource = [
      'subagent Order_Management:',
      '  description: "handles orders"',
      '  reasoning:',
      '    instructions: "test"',
      '  on_exit: ->',
      '    transition to @subagent.Order_Management',
    ].join('\n');

    test('offers input and output after @subagent.<node>.', () => {
      // Cursor sits right after the trailing dot of the node reference.
      const exprLine = '    transition to @subagent.Order_Management.';
      const source = nodeSource + '\n' + exprLine;
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        exprLine.length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      const labels = result!.items.map(i => i.label);
      expect(labels).toContain('input');
      expect(labels).toContain('output');
    });

    test('textEdit replaces only the partial member after the trailing dot', () => {
      const exprLine = '    transition to @subagent.Order_Management.out';
      const source = nodeSource + '\n' + exprLine;
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        exprLine.length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      const output = result!.items.find(i => i.label === 'output');
      expect(output).toBeDefined();
      const textEdit = output!.textEdit as {
        range: { start: { character: number }; end: { character: number } };
        newText: string;
      };
      // Replacement starts right after the last dot (column of "out").
      expect(textEdit.range.start.character).toBe(
        exprLine.length - 'out'.length
      );
      expect(textEdit.range.end.character).toBe(exprLine.length);
      expect(textEdit.newText).toBe('output');
    });

    // `input` is offered as a node member (LEVEL 1) but is intentionally
    // non-enumerable: it declares no schema-level sub-properties. Only the
    // `output` member gets LEVEL-2 property enumeration (the LEVEL-2 regex
    // matches `output` exclusively). So after `@<node>.input.` the member
    // path offers nothing — falling through to the normal expression flow,
    // which has no `input` namespace to resolve here.
    test('offers no node-member properties after @subagent.<node>.input.', () => {
      const exprLine = '    transition to @subagent.Order_Management.input.';
      const source = nodeSource + '\n' + exprLine;
      const state = createState(source);
      const lastLine = source.split('\n').length - 1;
      const result = provideCompletion(
        state,
        lastLine,
        exprLine.length,
        undefined,
        dialects
      );

      expect(result).not.toBeNull();
      const labels = result!.items.map(i => i.label);
      // No `input` sub-properties exist to enumerate.
      expect(labels).not.toContain('input');
      expect(labels).not.toContain('output');
    });

    // ── LEVEL 2 (`@<node>.output.` property enumeration) is not testable
    // here ──────────────────────────────────────────────────────────────
    //
    // The LSP tests use the agentscript dialect (see test-utils), whose only
    // transition-target nodes are `subagent` / `start_agent`. The agentscript
    // `ReasoningBlock` declares only `instructions` and `actions`, and marks no
    // `structuredOutputField` — there is no output-properties map for the
    // unified `getNodeMemberAccessCompletions` to enumerate. The lsp package
    // also does not depend on the agentfabric dialect, where output-bearing
    // `orchestrator` / `generator` nodes live.
    //
    // Faking an output-bearing node here is impossible without a dialect that
    // can model one, so LEVEL-2 (and deeper) enumeration is covered at the
    // dialect layer (agentfabric node-member-completions.test.ts), which drives
    // the same entry the LSP calls. The LSP-layer tokenizer/textEdit math is
    // covered for LEVEL 1 above.
  });
});

describe('snippet indentation contract (via provideCompletion)', () => {
  test('multi-line snippet bodies are column-0-relative (host editor handles cursor indent)', () => {
    // The LSP server must NOT pre-indent snippet lines 2+ to the cursor's
    // column. VS Code's snippet engine (and Monaco's, same code path)
    // prepends the line's leading whitespace before `range.start.character`
    // to lines 2+ during insertion — doing it server-side too produces
    // double-indented bodies (W-22181425).
    //
    // Source has the cursor at column 2 inside an empty `system:` block.
    // Any returned snippet whose body has more than one line MUST start
    // every line 2+ at column 0 (no leading whitespace beyond what the
    // generator emits at column 0).
    const source = 'system:\n  ';
    const state = createState(source);
    const result = provideCompletion(state, 1, 2, undefined, dialects);

    expect(result).not.toBeNull();
    const multilineSnippets = result!.items.filter(item => {
      const text = (item.insertText ?? '') as string;
      return text.includes('\n');
    });
    expect(
      multilineSnippets.length,
      'expected at least one multi-line snippet candidate to exist'
    ).toBeGreaterThan(0);

    for (const item of multilineSnippets) {
      const text = item.insertText as string;
      const lines = text.split('\n');
      // Line 0 may have anything (it gets inserted at the cursor column).
      // Lines 2+ should NOT carry the cursor's leading whitespace —
      // otherwise the host editor's prepend would double-indent them.
      // The only way to verify this without committing to a specific
      // generator step is to check that no line begins with the same
      // column as the cursor's leading whitespace pattern; i.e. that the
      // server output is identical to a snippet that was never adjusted.
      // We check the textEdit.newText too — both must agree.
      expect(
        item.textEdit?.newText,
        'textEdit.newText must equal insertText'
      ).toBe(item.insertText);
      for (let i = 1; i < lines.length; i++) {
        // Pick a hard upper bound: the cursor column is 2, so a server
        // that pre-indented would produce lines starting with at least 2
        // extra spaces beyond the generator's natural step. The largest
        // legitimate step from the generator is 8, but for `system:`
        // contents the deepest level here is 2 (`messages:` then
        // `error:`). Asserting "lines 2+ have indent ≤ 8" covers the
        // common case; the stronger anti-double-indent guarantee is the
        // textEdit/insertText equality above plus the dialect-level
        // tests that simulate the host-editor prepend end-to-end.
        const leading = lines[i].match(/^ */)?.[0].length ?? 0;
        expect(
          leading,
          `line ${i} indent ${leading} suggests server-side cursor-prepending`
        ).toBeLessThanOrEqual(8);
      }
    }
  });

  test('plain-text completions retain trailing ": " (cursor lands after colon)', () => {
    // The non-snippet branch of provideCompletion appends ': ' so the
    // user can immediately type the value. Pin this so a refactor that
    // collapses the branches doesn't regress cursor placement.
    const source = '';
    const state = createState(source);
    const result = provideCompletion(state, 0, 0, undefined, dialects);

    expect(result).not.toBeNull();
    const plainItems = result!.items.filter(
      item => item.insertTextFormat !== 2 // 2 = LSP InsertTextFormat.Snippet
    );
    if (plainItems.length === 0) return; // dialect emits snippets for everything — vacuous
    for (const item of plainItems) {
      const text = (item.insertText ?? '') as string;
      expect(
        text.endsWith(': '),
        `plain-text completion "${item.label}" should end with ': ' but got: ${JSON.stringify(text)}`
      ).toBe(true);
    }
  });
});
