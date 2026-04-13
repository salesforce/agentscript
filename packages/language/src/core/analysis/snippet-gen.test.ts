/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { generateFieldSnippet, escapeSnippetText } from './snippet-gen.js';
import { StringValue, BooleanValue, NumberValue } from '../primitives.js';
import { Block } from '../block.js';

describe('generateFieldSnippet', () => {
  describe('leaf primitives return undefined', () => {
    it('returns undefined for StringValue', () => {
      expect(generateFieldSnippet('description', StringValue)).toBeUndefined();
    });

    it('returns undefined for BooleanValue', () => {
      expect(generateFieldSnippet('enabled', BooleanValue)).toBeUndefined();
    });

    it('returns undefined for NumberValue', () => {
      expect(generateFieldSnippet('count', NumberValue)).toBeUndefined();
    });
  });

  describe('Block snippets', () => {
    it('generates snippet for a simple block with primitives', () => {
      const TestBlock = Block('TestBlock', {
        name: StringValue.describe('The name'),
        enabled: BooleanValue.describe('Whether enabled'),
      });

      const snippet = generateFieldSnippet('config', TestBlock);
      expect(snippet).toBeDefined();
      // Should contain the block name and children
      expect(snippet).toContain('config:');
      expect(snippet).toContain('name:');
      expect(snippet).toContain('enabled:');
      // StringValue should be quoted
      expect(snippet).toMatch(/".*\$\{.*name.*\}.*"/);
      // BooleanValue should NOT be quoted
      expect(snippet).toMatch(/enabled: \$\{\d+:True\}/);
      // Should end with $0
      expect(snippet!.endsWith('$0')).toBe(true);
    });

    it('includes required fields at depth 2', () => {
      const InnerBlock = Block('InnerBlock', {
        required_field: StringValue.describe('Required').required(),
        optional_field: StringValue.describe('Optional'),
      });
      const OuterBlock = Block('OuterBlock', {
        inner: InnerBlock,
      });

      const snippet = generateFieldSnippet('outer', OuterBlock);
      expect(snippet).toBeDefined();
      expect(snippet).toContain('inner:');
      expect(snippet).toContain('required_field:');
      // optional_field at depth 2 should NOT be included
      expect(snippet).not.toContain('optional_field');
    });

    it('includes blocks at depth 1 that have required children', () => {
      const MessagesBlock = Block('MessagesBlock', {
        welcome: StringValue.describe('Welcome message'),
        error: StringValue.describe('Error message').required(),
      });
      const SystemBlock = Block('SystemBlock', {
        instructions: StringValue.describe('Instructions'),
        messages: MessagesBlock,
      });

      const snippet = generateFieldSnippet('system', SystemBlock);
      expect(snippet).toBeDefined();
      // instructions is a primitive at depth 1 — included
      expect(snippet).toContain('instructions:');
      // messages is a block with a required child — included
      expect(snippet).toContain('messages:');
      // error is required at depth 2 — included
      expect(snippet).toContain('error:');
      // welcome is NOT required at depth 2 — excluded
      expect(snippet).not.toContain('welcome');
    });

    it('excludes non-required blocks without required children at depth 1', () => {
      const OptionalBlock = Block('OptionalBlock', {
        foo: StringValue.describe('Foo'),
        bar: StringValue.describe('Bar'),
      });
      const ParentBlock = Block('ParentBlock', {
        name: StringValue.describe('Name'),
        extras: OptionalBlock,
      });

      const snippet = generateFieldSnippet('parent', ParentBlock);
      expect(snippet).toBeDefined();
      expect(snippet).toContain('name:');
      // extras has no required children — excluded
      expect(snippet).not.toContain('extras');
    });
  });

  describe('tab stop numbering', () => {
    it('numbers tab stops sequentially', () => {
      const TestBlock = Block('TestBlock', {
        first: StringValue.describe('First'),
        second: BooleanValue.describe('Second'),
        third: NumberValue.describe('Third'),
      });

      const snippet = generateFieldSnippet('test', TestBlock);
      expect(snippet).toBeDefined();
      expect(snippet).toContain('${1:');
      expect(snippet).toContain('${2:');
      expect(snippet).toContain('${3:');
    });
  });

  describe('indentation', () => {
    it('uses 4-space indentation by default', () => {
      const TestBlock = Block('TestBlock', {
        name: StringValue.describe('Name'),
      });

      const snippet = generateFieldSnippet('test', TestBlock);
      expect(snippet).toBeDefined();
      const lines = snippet!.split('\n');
      expect(lines[0]).toBe('test:');
      expect(lines[1]).toMatch(/^ {4}name:/);
    });

    it('respects custom tabSize', () => {
      const TestBlock = Block('TestBlock', {
        name: StringValue.describe('Name'),
      });

      const snippet = generateFieldSnippet('test', TestBlock, { tabSize: 2 });
      expect(snippet).toBeDefined();
      const lines = snippet!.split('\n');
      expect(lines[1]).toMatch(/^ {2}name:/);
    });
  });
});

describe('escapeSnippetText', () => {
  it('escapes $ characters', () => {
    expect(escapeSnippetText('costs $5')).toBe('costs \\$5');
  });

  it('escapes } characters', () => {
    expect(escapeSnippetText('obj}')).toBe('obj\\}');
  });

  it('escapes backslashes', () => {
    expect(escapeSnippetText('path\\to')).toBe('path\\\\to');
  });

  it('escapes multiple special characters', () => {
    // Only $, }, and \ are special in LSP snippets — { is not
    expect(escapeSnippetText('${value}')).toBe('\\${value\\}');
  });

  it('leaves normal text unchanged', () => {
    expect(escapeSnippetText('hello world')).toBe('hello world');
  });
});
