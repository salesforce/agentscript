/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for instruction template syntax validation.
 */

import { describe, it, expect } from 'vitest';
import { parseDocument, testSchemaCtx, toAstRoot } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { createLintEngine } from '../lint/index.js';

describe('instructionTemplateSyntaxPass', () => {
  function lint(source: string): Diagnostic[] {
    const parsed = parseDocument(source);
    const ast = toAstRoot(parsed);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  function getTemplateSyntaxInfos(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics.filter(
      (d: Diagnostic) =>
        d.severity === DiagnosticSeverity.Information &&
        d.code === 'instruction-template-syntax'
    );
  }

  describe('System instructions - StringLiteral', () => {
    it('should detect {@variables.X} pattern (missing !)', () => {
      const source = `
system:
  instructions: "Use {@variables.foo} in your response"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@variables.foo}');
      expect(infos[0].message).toContain('exclamation mark');
    });

    it('should detect {@system_variables.X} pattern (missing !)', () => {
      const source = `
system:
  instructions: "Use {@system_variables.user_input} in your response"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@system_variables.user_input}');
      expect(infos[0].message).toContain('exclamation mark');
    });

    it('should not flag correct syntax {!@variables.X}', () => {
      const source = `
system:
  instructions: "Use {!@variables.foo} in your response"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should not flag correct syntax {!@system_variables.X}', () => {
      const source = `
system:
  instructions: "Use {!@system_variables.user_input} in your response"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should detect multiple patterns in same instruction', () => {
      const source = `
system:
  instructions: "Use {@variables.foo} and {@system_variables.user_input} together"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(2);
      expect(infos[0].message).toContain('@variables.foo');
      expect(infos[1].message).toContain('@system_variables.user_input');
    });

    it('should handle whitespace variations { @variables.X }', () => {
      const source = `
system:
  instructions: "Use { @variables.foo } in response"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@variables.foo}');
    });
  });

  describe('System instructions - TemplateExpression (pipe syntax)', () => {
    it('should detect {@variables.X} in pipe template', () => {
      const source = `
system:
  instructions: |
    Use {@variables.foo} in your response
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@variables.foo}');
    });

    it('should detect {@system_variables.X} in multi-line pipe template', () => {
      const source = `
system:
  instructions: |
    First, analyze the request.
    Then use {@system_variables.user_input}.
    Finally, respond to the user.
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@system_variables.user_input}');
    });

    it('should not flag correct {!@variables.X} in pipe template', () => {
      const source = `
system:
  instructions: |
    Use {!@variables.foo} correctly
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });
  });

  describe('Reasoning instructions', () => {
    it('should detect {@variables.X} in subagent reasoning', () => {
      const source = `
subagent test:
  description: "Test agent"
  reasoning:
    instructions: |
      Think about {@variables.bar} carefully
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@variables.bar}');
    });

    it('should not flag {@actions.X} - actions are not valid in template interpolation', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    instructions: |
      Use {@actions.MyAction} here
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // @actions is not detected because it's not a data-holding namespace
      expect(infos.length).toBe(0);
    });
  });

  describe('Negative cases - should NOT flag', () => {
    it('should not flag {@variables.X} in description field', () => {
      const source = `
subagent test:
  description: "Uses {@variables.foo} in logic"
  reasoning:
    instructions: "Do something"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should not flag {@variables.X} in label field', () => {
      const source = `
subagent test:
  label: "Test {@variables.name}"
  description: "Test agent"
  reasoning:
    instructions: "Do something"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should not flag {@utils.X} pattern', () => {
      const source = `
system:
  instructions: "Call {@utils.transition} here"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });
  });

  describe('Mixed correct and incorrect', () => {
    it('should flag only incorrect pattern when mixed with correct', () => {
      const source = `
system:
  instructions: "Use {!@variables.correct} and {@variables.wrong} here"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@variables.wrong}');
    });
  });

  describe('Empty and edge cases', () => {
    it('should handle empty instructions gracefully', () => {
      const source = `
system:
  instructions: ""
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should handle instructions with no patterns', () => {
      const source = `
system:
  instructions: "Just plain text without any references"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });
  });

  describe('Bare variable name detection', () => {
    it('should detect bare variable name in instructions', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use foo in your response
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('foo');
      expect(infos[0].message).toContain('{!@variables.foo}');
    });

    it('should not flag bare variable name when correctly used with template syntax', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use {!@variables.foo} correctly
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should not flag bare variable name inside braces', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Reference {@variables.foo} here
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // Should only flag the missing !, not the bare "foo" inside braces
      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@variables.foo}');
      expect(infos[0].message).toContain('exclamation mark');
    });

    it('should detect multiple bare variable names', () => {
      const source = `
variables:
  foo: string
  bar: number

system:
  instructions: |
    Use foo and bar together
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(2);
      expect(infos[0].message).toContain('foo');
      expect(infos[1].message).toContain('bar');
    });

    it('should handle common English word as variable name (accepted false positive)', () => {
      const source = `
variables:
  name: string

system:
  instructions: |
    The name is important
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // Accepts false positive for common English words
      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('name');
    });

    it('should respect word boundaries', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use foobar and barfoo without flagging
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // Should not match "foo" inside "foobar" or "barfoo"
      expect(infos.length).toBe(0);
    });
  });
});
