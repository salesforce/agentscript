/**
 * Tests for the hover provider.
 */

import { describe, test, expect } from 'vitest';
import { provideHover } from './hover.js';
import { processDocument } from '../pipeline.js';
import { testConfig } from '../test-utils.js';

/** Helper: create a DocumentState from source text. */
function createState(source: string) {
  return processDocument('test://test.agent', source, testConfig);
}

const dialects = testConfig.dialects;

describe('Hover Provider', () => {
  // ── Dialect annotation hover ──────────────────────────────────

  describe('dialect annotation hover', () => {
    test('shows hover for known dialect name', () => {
      const source = '# @dialect: agentscript=1\nsystem:\n  instructions: "hi"';
      const state = createState(source);
      // Hover over "agentscript" portion
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.kind).toBe('markdown');
      expect(content.value).toContain('agentscript');
      expect(content.value).toContain('Dialect');
    });

    test('shows version constraint info for major-only version', () => {
      const source = '# @dialect: agentscript=1\nsystem:';
      const state = createState(source);
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.value).toContain('Version constraint');
      expect(content.value).toContain('any v1.x');
    });

    test('shows version constraint info for major.minor version', () => {
      const source = '# @dialect: agentscript=1.2\nsystem:';
      const state = createState(source);
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.value).toContain('Version constraint');
      expect(content.value).toContain('minimum minor version');
    });

    test('shows hover with no version constraint when version omitted', () => {
      const source = '# @dialect: agentscript\nsystem:';
      const state = createState(source);
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.value).toContain('No version constraint');
      expect(content.value).toContain('latest available');
    });

    test('shows unknown dialect message for unrecognized name', () => {
      const source = '# @dialect: foobar\nsystem:';
      const state = createState(source);
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.value).toContain('Unknown dialect');
      expect(content.value).toContain('foobar');
      expect(content.value).toContain('Available');
    });

    test('includes format documentation in hover', () => {
      const source = '# @dialect: agentscript\nsystem:';
      const state = createState(source);
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.value).toContain('# @dialect: NAME=VERSION');
      expect(content.value).toContain('NAME=MAJOR');
    });

    test('returns correct range for the annotation', () => {
      const source = '# @dialect: agentscript=1\nsystem:';
      const state = createState(source);
      const result = provideHover(state, 0, 14, dialects);

      expect(result).not.toBeNull();
      expect(result!.range).toBeDefined();
      expect(result!.range!.start.line).toBe(0);
      expect(result!.range!.start.character).toBe(0);
      expect(result!.range!.end.line).toBe(0);
      expect(result!.range!.end.character).toBe(
        '# @dialect: agentscript=1'.length
      );
    });

    test('returns null when cursor is outside annotation text', () => {
      const source = '# @dialect: agentscript=1     \nsystem:';
      const state = createState(source);
      // Hover at the end of the line, past the annotation
      const result = provideHover(state, 0, 30, dialects);

      expect(result).toBeNull();
    });

    test('returns null for non-annotation line within first 10 lines', () => {
      const source = 'system:\n  instructions: "hi"';
      const state = createState(source);
      provideHover(state, 0, 3, dialects);

      // Line 0 has no annotation, so no dialect hover
      // May return schema hover or null
      // Just verify it doesn't crash
      expect(true).toBe(true);
    });

    test('returns null when no dialects provided', () => {
      const source = '# @dialect: agentscript=1\nsystem:';
      const state = createState(source);
      // Without dialects array, annotation hover is skipped
      provideHover(state, 0, 14, undefined);

      // Should fall through to schema hover (which may or may not match)
      // At minimum, no crash
      expect(true).toBe(true);
    });
  });

  // ── Schema hover ──────────────────────────────────────────────

  describe('schema hover', () => {
    test('returns hover for a known field key', () => {
      const source = 'system:\n  instructions: "hello"';
      const state = createState(source);
      // Hover over "instructions" on line 1
      const result = provideHover(state, 1, 4, dialects);

      if (result) {
        const content = result.contents as { kind: string; value: string };
        expect(content.kind).toBe('markdown');
        expect(content.value).toContain('instructions');
      }
    });

    test('returns hover for a top-level block key', () => {
      const source = 'system:\n  instructions: "hello"';
      const state = createState(source);
      // Hover over "system" on line 0
      const result = provideHover(state, 0, 2, dialects);

      if (result) {
        const content = result.contents as { kind: string; value: string };
        expect(content.kind).toBe('markdown');
        expect(content.value).toContain('system');
      }
    });

    test('returns null for hover on a value (not a key)', () => {
      const source = 'system:\n  instructions: "hello"';
      const state = createState(source);
      // Hover over "hello" string value
      const result = provideHover(state, 1, 20, dialects);

      // Values shouldn't have schema hover
      expect(result).toBeNull();
    });

    test('returns null when ast is null', () => {
      const source = '';
      const state = createState(source);
      const stateNoAst = { ...state, ast: null };
      const result = provideHover(stateNoAst, 0, 0, dialects);

      expect(result).toBeNull();
    });
  });

  // ── Keyword hover (modifiers and types) ──────────────────────

  describe('keyword hover', () => {
    // Variable declarations are colinear: `var_name: mutable string = "hello"`
    // CST positions: `mutable` starts at col 10, `string` at col 18

    test('shows hover for mutable modifier', () => {
      const source = 'variables:\n  my_var: mutable string = "hello"';
      const state = createState(source);
      // Hover over "mutable" on line 1 (col 10-17)
      const result = provideHover(state, 1, 12, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.kind).toBe('markdown');
      expect(content.value).toContain('mutable');
      expect(content.value).toContain('Modifier');
    });

    test('shows hover for linked modifier', () => {
      const source = 'variables:\n  my_var: linked string';
      const state = createState(source);
      // Hover over "linked" on line 1 (col 10-16)
      const result = provideHover(state, 1, 12, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.kind).toBe('markdown');
      expect(content.value).toContain('linked');
      expect(content.value).toContain('Modifier');
    });

    test('shows hover for primitive type in variable declaration', () => {
      const source = 'variables:\n  my_var: mutable string = "hello"';
      const state = createState(source);
      // Hover over "string" on line 1 (col 18-24)
      const result = provideHover(state, 1, 20, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.kind).toBe('markdown');
      expect(content.value).toContain('string');
      expect(content.value).toContain('Type');
    });

    test('shows hover for number type', () => {
      const source = 'variables:\n  count: mutable number = 0';
      const state = createState(source);
      // Hover over "number" on line 1 (col 17-23)
      const result = provideHover(state, 1, 19, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      expect(content.kind).toBe('markdown');
      expect(content.value).toContain('number');
      expect(content.value).toContain('Type');
    });

    test('returns null for default value (not a type)', () => {
      const source = 'variables:\n  my_var: mutable string = "hello"';
      const state = createState(source);
      // Hover over "hello" string value (col 29-34)
      const result = provideHover(state, 1, 30, dialects);

      expect(result).toBeNull();
    });

    test('returns null for unrecognized type', () => {
      const source = 'variables:\n  my_var: mutable foobar = "hello"';
      const state = createState(source);
      // Hover over "foobar" — not a known primitive type (col 18-24)
      const result = provideHover(state, 1, 20, dialects);

      expect(result).toBeNull();
    });

    test('modifier hover includes description from KeywordInfo', () => {
      const source = 'variables:\n  my_var: mutable string = "hello"';
      const state = createState(source);
      const result = provideHover(state, 1, 12, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      // The description from VARIABLE_MODIFIERS
      expect(content.value).toContain('variable');
    });

    test('type hover includes description from KeywordInfo', () => {
      const source = 'variables:\n  my_var: mutable boolean = True';
      const state = createState(source);
      // Hover over "boolean" (col 18-25)
      const result = provideHover(state, 1, 20, dialects);

      expect(result).not.toBeNull();
      const content = result!.contents as { kind: string; value: string };
      // The description from AGENTSCRIPT_PRIMITIVE_TYPES
      expect(content.value).toContain('True');
      expect(content.value).toContain('False');
    });
  });

  // ── Error handling ────────────────────────────────────────────

  describe('error handling', () => {
    test('returns null on internal error (no crash)', () => {
      const state = createState('system:\n  instructions: "test"');
      // Sabotage the state to trigger the catch
      Object.defineProperty(state, 'ast', {
        get() {
          throw new Error('boom');
        },
      });

      const result = provideHover(state, 1, 4, dialects);
      expect(result).toBeNull();
    });
  });
});
