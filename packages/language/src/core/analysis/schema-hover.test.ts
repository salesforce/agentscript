/**
 * Tests for the shared schema-hover module.
 */

import { describe, test, expect } from 'vitest';
import {
  resolveSchemaField,
  formatConstraints,
  formatSchemaHoverMarkdown,
  formatKeywordHoverMarkdown,
  findKeywordInfo,
  type SchemaFieldInfo,
} from './schema-hover.js';
import type { KeywordInfo } from '../types.js';

// ── resolveSchemaField ──────────────────────────────────────────

describe('resolveSchemaField', () => {
  test('resolves a simple top-level field', () => {
    const schema: Record<string, SchemaFieldInfo> = {
      system: { __metadata: { description: 'System block' } },
    };
    const result = resolveSchemaField(['system'], schema);

    expect(result).not.toBeNull();
    expect(result!.lastKey).toBe('system');
    expect(result!.resolvedPath).toEqual(['system']);
    expect(result!.field.__metadata?.description).toBe('System block');
  });

  test('resolves nested fields via schema', () => {
    const schema: Record<string, SchemaFieldInfo> = {
      system: {
        __metadata: { description: 'System block' },
        schema: {
          instructions: {
            __metadata: { description: 'Instructions field' },
          },
        },
      },
    };
    const result = resolveSchemaField(['system', 'instructions'], schema);

    expect(result).not.toBeNull();
    expect(result!.lastKey).toBe('instructions');
    expect(result!.resolvedPath).toEqual(['system', 'instructions']);
  });

  test('skips instance name for isNamed fields', () => {
    const schema: Record<string, SchemaFieldInfo> = {
      topics: {
        isNamed: true,
        __metadata: { description: 'Topics collection' },
        schema: {
          instructions: {
            __metadata: { description: 'Topic instructions' },
          },
        },
      },
    };
    // Path: topics > my_topic (instance name) > instructions
    const result = resolveSchemaField(
      ['topics', 'my_topic', 'instructions'],
      schema
    );

    expect(result).not.toBeNull();
    expect(result!.lastKey).toBe('instructions');
    expect(result!.resolvedPath).toEqual([
      'topics',
      'my_topic',
      'instructions',
    ]);
  });

  test('skips instance name for __isCollection fields', () => {
    const schema: Record<string, SchemaFieldInfo> = {
      actions: {
        __isCollection: true,
        __metadata: { description: 'Actions collection' },
        schema: {
          instructions: {
            __metadata: { description: 'Action instructions' },
          },
        },
      },
    };
    // Path: actions > my_action (instance name) > instructions
    const result = resolveSchemaField(
      ['actions', 'my_action', 'instructions'],
      schema
    );

    expect(result).not.toBeNull();
    expect(result!.lastKey).toBe('instructions');
  });

  test('handles TypedMap with propertiesSchema', () => {
    const schema: Record<string, SchemaFieldInfo> = {
      variables: {
        __isTypedMap: true,
        __metadata: { description: 'Variables' },
        propertiesSchema: {
          label: { __metadata: { description: 'Display label' } },
        },
      },
    };
    // Path: variables > my_var (entry name) > label
    const result = resolveSchemaField(['variables', 'my_var', 'label'], schema);

    expect(result).not.toBeNull();
    expect(result!.lastKey).toBe('label');
  });

  test('returns null for unknown path', () => {
    const schema: Record<string, SchemaFieldInfo> = {};
    const result = resolveSchemaField(['unknown'], schema);
    expect(result).toBeNull();
  });
});

// ── formatConstraints ──────────────────────────────────────────

describe('formatConstraints', () => {
  test('returns undefined when no constraints', () => {
    expect(formatConstraints({})).toBeUndefined();
    expect(formatConstraints({ constraints: undefined })).toBeUndefined();
  });

  test('formats range constraints', () => {
    const result = formatConstraints({
      constraints: { minimum: 0, maximum: 100 },
    });
    expect(result).toContain('0');
    expect(result).toContain('100');
  });

  test('formats length constraints', () => {
    const result = formatConstraints({
      constraints: { minLength: 1, maxLength: 255 },
    });
    expect(result).toContain('1');
    expect(result).toContain('255');
  });

  test('formats enum constraints', () => {
    const result = formatConstraints({
      constraints: { enum: ['a', 'b', 'c'] },
    });
    expect(result).toContain('one of');
    expect(result).toContain('"a"');
  });

  test('formats pattern constraint', () => {
    const result = formatConstraints({
      constraints: { pattern: '^[a-z]+$' },
    });
    expect(result).toContain('pattern');
    expect(result).toContain('^[a-z]+$');
  });
});

// ── formatSchemaHoverMarkdown ──────────────────────────────────

describe('formatSchemaHoverMarkdown', () => {
  test('includes path as bold header', () => {
    const result = formatSchemaHoverMarkdown(['system', 'instructions'], {});
    expect(result).toContain('**system.instructions**');
  });

  test('includes description', () => {
    const result = formatSchemaHoverMarkdown(['field'], {
      description: 'A test field',
    });
    expect(result).toContain('A test field');
  });

  test('includes deprecation info', () => {
    const result = formatSchemaHoverMarkdown(['field'], {
      deprecated: { message: 'Use newField instead' },
    });
    expect(result).toContain('Deprecated');
    expect(result).toContain('Use newField instead');
  });

  test('includes version info', () => {
    const result = formatSchemaHoverMarkdown(['field'], {
      minVersion: '1.2',
    });
    expect(result).toContain('Added in v1.2');
  });

  test('includes experimental flag', () => {
    const result = formatSchemaHoverMarkdown(['field'], {
      experimental: true,
    });
    expect(result).toContain('Experimental');
  });

  test('includes modifiers from KeywordInfo', () => {
    const modifiers: KeywordInfo[] = [
      { keyword: 'mutable', description: 'Can change' },
      { keyword: 'linked', description: 'External' },
    ];
    const result = formatSchemaHoverMarkdown(['field'], {}, modifiers);
    expect(result).toContain('Modifiers');
    expect(result).toContain('mutable');
    expect(result).toContain('linked');
  });

  test('includes types from KeywordInfo', () => {
    const types: KeywordInfo[] = [
      { keyword: 'string', description: 'Text' },
      { keyword: 'number', description: 'Numeric' },
    ];
    const result = formatSchemaHoverMarkdown(['field'], {}, undefined, types);
    expect(result).toContain('Types');
    expect(result).toContain('string');
    expect(result).toContain('number');
  });

  test('includes constraints', () => {
    const result = formatSchemaHoverMarkdown(['field'], {
      constraints: { minimum: 0 },
    });
    expect(result).toContain('Constraints');
  });
});

// ── formatKeywordHoverMarkdown ─────────────────────────────────

describe('formatKeywordHoverMarkdown', () => {
  test('formats modifier keyword', () => {
    const info: KeywordInfo = {
      keyword: 'mutable',
      description: 'A variable that can change.',
    };
    const result = formatKeywordHoverMarkdown('mutable', 'modifier', info);
    expect(result).toContain('**mutable**');
    expect(result).toContain('Modifier');
    expect(result).toContain('A variable that can change.');
  });

  test('formats type keyword', () => {
    const info: KeywordInfo = {
      keyword: 'string',
      description: 'A text value.',
    };
    const result = formatKeywordHoverMarkdown('string', 'type', info);
    expect(result).toContain('**string**');
    expect(result).toContain('Type');
    expect(result).toContain('A text value.');
  });

  test('handles undefined info gracefully', () => {
    const result = formatKeywordHoverMarkdown('unknown', 'type', undefined);
    expect(result).toContain('**unknown**');
    expect(result).toContain('Type');
  });

  test('includes metadata deprecation', () => {
    const info: KeywordInfo = {
      keyword: 'old',
      description: 'Old keyword',
      metadata: {
        deprecated: { message: 'Use new instead' },
      },
    };
    const result = formatKeywordHoverMarkdown('old', 'modifier', info);
    expect(result).toContain('Deprecated');
    expect(result).toContain('Use new instead');
  });

  test('includes metadata version', () => {
    const info: KeywordInfo = {
      keyword: 'new_keyword',
      description: 'New keyword',
      metadata: { minVersion: '2.0' },
    };
    const result = formatKeywordHoverMarkdown('new_keyword', 'type', info);
    expect(result).toContain('Added in v2.0');
  });
});

// ── findKeywordInfo ────────────────────────────────────────────

describe('findKeywordInfo', () => {
  const keywords: KeywordInfo[] = [
    { keyword: 'mutable', description: 'Can change' },
    { keyword: 'linked', description: 'External' },
  ];

  test('finds existing keyword', () => {
    expect(findKeywordInfo('mutable', keywords)).toEqual(keywords[0]);
  });

  test('returns undefined for missing keyword', () => {
    expect(findKeywordInfo('readonly', keywords)).toBeUndefined();
  });
});
