/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for template whitespace handling, specifically testing the normalizeBlankLines bug.
 *
 * BUG: normalizeBlankLines() in template.ts (line ~305) incorrectly strips leading spaces
 * from nested markdown lists and conditional blocks. The condition `partLines[i].trim().length === 0`
 * treats indent-only lines as blank and strips them, which breaks YAML indentation.
 *
 * These tests parse real AgentScript templates through the full pipeline and verify
 * that indentation is preserved correctly. They should FAIL with the current code
 * and PASS once the bug is fixed.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from './dialect.js';

/**
 * Helper to parse a template expression from source and get its content.
 */
function getTemplateContent(source: string): string {
  // Wrap in minimal structure: key: -> |template
  const fullSource = `key: ->\n        ${source}`;
  const { rootNode } = parse(fullSource);

  // Navigate to find the template node in the CST
  function findNode(node: any, type: string): any {
    if (node.type === type) return node;
    for (const child of node.namedChildren || []) {
      const found = findNode(child, type);
      if (found) return found;
    }
    return null;
  }

  const templateNode = findNode(rootNode, 'template');
  if (!templateNode) {
    throw new Error('No template node found in parsed source');
  }

  // Use Dialect to parse the template node into a TemplateExpression
  const dialect = new Dialect();
  const expr = dialect.parseExpression(templateNode);

  if ((expr as any).__kind !== 'TemplateExpression') {
    throw new Error(`Expected TemplateExpression, got ${(expr as any).__kind}`);
  }

  return (expr as any).content;
}

describe('Template whitespace preservation - normalizeBlankLines bug', () => {
  describe('Nested markdown lists', () => {
    it('should preserve 2-level nested list indentation', () => {
      const output = getTemplateContent(`|- item 1
           - nested item`);

      // After dedent, relative indentation should be preserved
      expect(output).toContain('- item 1');
      expect(output).toContain('   - nested item');
    });

    it('should preserve 3-level nested lists', () => {
      const output = getTemplateContent(`|- Level 1
           - Level 2
               - Level 3`);

      expect(output).toContain('- Level 1');
      expect(output).toContain('   - Level 2');
      expect(output).toContain('       - Level 3');
    });

    it('should preserve mixed list indentation - production bug case', () => {
      const output = getTemplateContent(`|*Rules:*
         - this is
            - this is my test
         - a
            - b
            - c`);

      expect(output).toContain('*Rules:*');
      expect(output).toContain('- this is');
      expect(output).toContain('   - this is my test');
      expect(output).toContain('- a');
      expect(output).toContain('   - b');
      expect(output).toContain('   - c');
    });
  });

  describe('Varying indentation levels', () => {
    it('should preserve increasing indentation', () => {
      const output = getTemplateContent(`|ab
                ab
                       ab`);

      const lines = output.split('\n');

      // First line: no indent
      expect(lines[0]).toBe('ab');

      // Second line: 8 spaces relative indent
      expect(lines[1]).toBe('        ab');

      // Third line: 15 spaces relative indent
      expect(lines[2]).toBe('               ab');
    });

    it('should handle multi-level indentation structure', () => {
      const output = getTemplateContent(`|Level 1
         Level 2
             Level 3
         Back to 2
         Back to 1`);

      expect(output).toContain('Level 1');
      expect(output).toContain(' Level 2');
      expect(output).toContain('     Level 3');
      expect(output).toContain(' Back to 2');
      expect(output).toContain(' Back to 1');
    });
  });

  describe('Edge cases', () => {
    it('should handle blank lines correctly', () => {
      // For bare-pipe multiline, content must be indented MORE than the pipe
      // (following YAML block scalar rules)
      const output = getTemplateContent(`|
          First paragraph

          Second paragraph`);

      // Verify both paragraphs are preserved with blank line between
      expect(output).toContain('First paragraph');
      expect(output).toContain('Second paragraph');
    });

    it('should preserve code block indentation', () => {
      const output = getTemplateContent(`|Code:
           function test() {
               return true;
           }`);

      expect(output).toContain('   function test() {');
      expect(output).toContain('       return true;');
      expect(output).toContain('   }');
    });

    it('should handle numbered lists', () => {
      const output = getTemplateContent(`|Process:
         1. First step
             a. Sub-step a
             b. Sub-step b
         2. Second step`);

      expect(output).toContain('1. First step');
      expect(output).toContain('    a. Sub-step a');
      expect(output).toContain('    b. Sub-step b');
      expect(output).toContain('2. Second step');
    });

    it('should handle lists with multi-line descriptions', () => {
      const output = getTemplateContent(`|Steps:
         - Step 1: First
             Description line 1
             Description line 2
         - Step 2: Second`);

      expect(output).toContain('- Step 1: First');
      expect(output).toContain('    Description line 1');
      expect(output).toContain('    Description line 2');
      expect(output).toContain('- Step 2: Second');
    });
  });

  describe('Minimal bug reproduction', () => {
    it('shows that lines with only spaces lose their indentation', () => {
      // This is THE minimal test case for the bug:
      // A line that after dedent has ONLY spaces (structural indentation)
      // should preserve those spaces, not be normalized to empty string
      const output = getTemplateContent(`|Item
           Nested`);

      const lines = output.split('\n');

      // Expected: Line 0 = "Item", Line 1 = "   Nested" (with 3 spaces)
      // Bug: normalizeBlankLines treats "   " as blank, making it ""
      expect(lines[0]).toBe('Item');
      expect(lines[1]).toBe('   Nested'); // BUG: This will fail - becomes "Nested"
    });

    it('demonstrates the bug with list items', () => {
      const output = getTemplateContent(`|- First
            - Second`);

      // After dedent, "- First" has no indent, "    - Second" has 4 spaces
      // The bug would strip those spaces
      expect(output).toContain('- First');
      expect(output).toContain('    - Second'); // BUG: This will fail
    });
  });
});
