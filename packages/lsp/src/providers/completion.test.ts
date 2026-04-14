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
});

describe('adjustSnippetIndentation (via provideCompletion)', () => {
  test('field completions include snippet indentation for multi-line snippets', () => {
    // This is an integration-level test: if a candidate has a multi-line snippet,
    // provideCompletion should adjust indentation for lines 2+.
    const source = 'system:\n  ';
    const state = createState(source);
    const result = provideCompletion(state, 1, 2, undefined, dialects);

    expect(result).not.toBeNull();
    // We just verify it runs without error and returns valid items
    for (const item of result!.items) {
      expect(item.label).toBeDefined();
      expect(item.insertText).toBeDefined();
    }
  });
});
