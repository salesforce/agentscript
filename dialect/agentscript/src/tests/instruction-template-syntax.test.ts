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

  function getOutputReferenceWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics.filter(
      (d: Diagnostic) =>
        d.severity === DiagnosticSeverity.Warning &&
        d.code === 'instruction-output-reference'
    );
  }

  function getInputReferenceWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics.filter(
      (d: Diagnostic) =>
        d.severity === DiagnosticSeverity.Warning &&
        d.code === 'instruction-input-reference'
    );
  }

  function rangesOf(source: string, text: string): Diagnostic['range'][] {
    const ranges: Diagnostic['range'][] = [];
    let offset = source.indexOf(text);

    while (offset !== -1) {
      const prefix = source.slice(0, offset);
      const line = prefix.split('\n').length - 1;
      const lineStart = prefix.lastIndexOf('\n') + 1;
      const character = offset - lineStart;
      ranges.push({
        start: { line, character },
        end: { line, character: character + text.length },
      });
      offset = source.indexOf(text, offset + text.length);
    }

    return ranges;
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
      expect(infos[0].range).toEqual({
        start: { line: 2, character: 21 },
        end: { line: 2, character: 37 },
      });
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
      expect(infos[0].range).toEqual({
        start: { line: 4, character: 13 },
        end: { line: 4, character: 43 },
      });
    });

    it('should report the exact range in an inline pipe template', () => {
      const source = `system:
  instructions: | Use {@variables.foo} in your response
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].range).toEqual({
        start: { line: 1, character: 22 },
        end: { line: 1, character: 38 },
      });
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

    it('should flag {@actions.X} (missing !) - actions ARE valid in template interpolation', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MyAction: @utils.end_session
        description: "Test action"
    instructions: |
      Use {@actions.MyAction} here
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // @actions is NOW detected as a data-holding namespace
      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@actions.MyAction}');
      expect(infos[0].message).toContain('exclamation mark');
    });

    it('should target invalid syntax after a valid multiline interpolation', () => {
      const source = `start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Use {!@actions.AnswerQuestionsWithKnowledge} when needed.
              Continue with the answer.
              Then use {@variables.test} in the response.
        actions:
            AnswerQuestionsWithKnowledge: @utils.end_session
                description: "Answer"
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos).toHaveLength(1);
      expect(infos[0]).toMatchObject({
        code: 'instruction-template-syntax',
        source: 'agentscript-lint',
        severity: DiagnosticSeverity.Information,
        message:
          "Reference syntax should be {!@variables.test} (note the exclamation mark). The '!' is required for template interpolation.",
        range: {
          start: { line: 6, character: 23 },
          end: { line: 6, character: 40 },
        },
      });
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

  describe('Bare variable reference detection', () => {
    it('should detect @variables.X reference without {! wrapper', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use @variables.foo in your response
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('@variables.foo');
      expect(infos[0].message).toContain('{!@variables.foo}');
    });

    it('should detect variables.X reference without @ or {! wrapper', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use variables.foo in your response
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('variables.foo');
      expect(infos[0].message).toContain('{!@variables.foo}');
    });

    it('should not flag when correctly used with template syntax', () => {
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

    it('should detect multiple bare variable references', () => {
      const source = `
variables:
  foo: string
  bar: number

system:
  instructions: |
    Use @variables.foo and variables.bar together
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(2);
      expect(infos[0].message).toContain('@variables.foo');
      expect(infos[1].message).toContain('variables.bar');
    });

    it('should not flag common English words that happen to be variable names', () => {
      const source = `
variables:
  name: string

system:
  instructions: |
    The name is important
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // No longer produces false positives - only detects @variables.name or variables.name
      expect(infos.length).toBe(0);
    });

    it('should not flag partial matches', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use variables.foobar and @variables.barfoo without flagging
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // Should not match partial name matches
      expect(infos.length).toBe(0);
    });

    it('should require a complete namespace boundary before bare references', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Ignore myvariables.foo, x@variables.foo, and @@variables.foo.
    Report @variables.foo.
`;
      const infos = getTemplateSyntaxInfos(lint(source));

      expect(infos).toHaveLength(1);
      expect(infos[0].range).toEqual(rangesOf(source, '@variables.foo').at(-1));
    });

    it.each([
      ['opening', 'An unmatched { before @variables.foo.', '@variables.foo'],
      ['closing', 'A bare variables.foo before unmatched }.', 'variables.foo'],
    ])(
      'should not let an unmatched %s brace hide a bare reference',
      (_kind, instruction, reference) => {
        const source = `
variables:
  foo: string

system:
  instructions: |
    ${instruction}
`;
        const infos = getTemplateSyntaxInfos(lint(source));

        expect(infos).toHaveLength(1);
        expect(infos[0].range).toEqual(rangesOf(source, reference)[0]);
      }
    );

    it('should not flag references inside interpolation with nested braces', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    Use {!{ nested: "value" } == @variables.foo}.
`;

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
    });

    it.each(['{!@variables.foo', '{@variables.foo'])(
      'should not add bare-reference guidance for unfinished wrapper %s',
      instruction => {
        const source = `
variables:
  foo: string

system:
  instructions: |
    ${instruction}
`;

        expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
      }
    );

    it('should preserve a valid wrapper after an unrelated unmatched brace', () => {
      const source = `
variables:
  foo: string

system:
  instructions: |
    An unmatched { before {!@variables.foo}.
`;

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
    });

    it('scans large balanced-brace text without pathological backtracking', () => {
      const repeatedReferences = Array.from(
        { length: 50_000 },
        () => '@variables.foo'
      ).join(' ');
      const source = `
variables:
  foo: string

system:
  instructions: "Treat { ${repeatedReferences} } as literal text"
`;

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
    }, 5_000);

    it('maps many emitted diagnostics without quadratic range rescans', () => {
      const repeatedReferences = Array.from(
        { length: 40_000 },
        () => '@variables.foo'
      ).join(' ');
      const source = `
variables:
  foo: string

system:
  instructions: "${repeatedReferences}"
`;

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(40_000);
    }, 4_000);
  });

  describe('Action template syntax detection', () => {
    function sourceWithActionInstruction(instruction: string): string {
      const indentedInstruction = instruction
        .split('\n')
        .map(line => `      ${line}`)
        .join('\n');

      return `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MyAction: @utils.end_session
        description: "Test action"
    instructions: |
${indentedInstruction}
`;
    }

    it('should detect {@actions.X} pattern (missing !)', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MyAction: @utils.transition to @subagent.next
        description: "Test action"
    instructions: |
      Use {@actions.MyAction} here
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@actions.MyAction}');
      expect(infos[0].message).toContain('exclamation mark');
    });

    it('should not flag correct syntax {!@actions.X}', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MyAction: @utils.transition to @subagent.next
        description: "Test action"
    instructions: |
      Use {!@actions.MyAction} here
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(0);
    });

    it('should detect @actions.X reference without {! wrapper', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      Get_User_Data: @utils.transition to @subagent.data
        description: "Fetch user data"
    instructions: |
      Use @actions.Get_User_Data to fetch the information
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('@actions.Get_User_Data');
      expect(infos[0].message).toContain('{!@actions.Get_User_Data}');
    });

    it('should detect actions.X reference without @ or {! wrapper', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      Get_User_Data: @utils.transition to @subagent.data
        description: "Fetch user data"
    instructions: |
      Use actions.Get_User_Data to fetch the information
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('actions.Get_User_Data');
      expect(infos[0].message).toContain('{!@actions.Get_User_Data}');
    });

    it('should not flag action references inside braces', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MyAction: @utils.transition to @subagent.next
        description: "Test action"
    instructions: |
      Reference {@actions.MyAction} here
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // Should only flag the missing !, not the "actions.MyAction" inside braces
      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('{!@actions.MyAction}');
      expect(infos[0].message).toContain('exclamation mark');
    });

    it('should detect actions from multiple subagents', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MainAction: @utils.transition to @subagent.sub1
        description: "Main action"
    instructions: |
      Use @actions.MainAction to start

subagent sub1:
  description: "Sub agent"
  reasoning:
    actions:
      SubAction: @utils.end_session
        description: "Sub action"
    instructions: |
      Use actions.SubAction to finish
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(2);
      expect(infos[0].message).toContain('@actions.MainAction');
      expect(infos[1].message).toContain('actions.SubAction');
    });

    it('should detect both {@actions.X} and bare action references', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      FirstAction: @utils.transition to @subagent.next
        description: "First"
      SecondAction: @utils.end_session
        description: "Second"
    instructions: |
      Use {@actions.FirstAction} and also actions.SecondAction
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(2);
      expect(infos[0].message).toContain('FirstAction');
      expect(infos[0].message).toContain('exclamation mark');
      expect(infos[1].message).toContain('actions.SecondAction');
      expect(infos[1].message).toContain('{!@actions.SecondAction}');
    });

    it('should not flag partial action name matches', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      Send: @utils.end_session
        description: "Send action"
    instructions: |
      Sending messages or actions.SendEmail are not flagged
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      // Should not match "Send" inside "Sending" or "SendEmail"
      expect(infos.length).toBe(0);
    });

    it('should require a complete namespace boundary before bare action references', () => {
      const source = sourceWithActionInstruction(
        'Ignore myactions.MyAction, x@actions.MyAction, and @@actions.MyAction.\nReport @actions.MyAction.'
      );
      const infos = getTemplateSyntaxInfos(lint(source));

      expect(infos).toHaveLength(1);
      expect(infos[0].range).toEqual(
        rangesOf(source, '@actions.MyAction').at(-1)
      );
    });

    it.each([
      [
        'opening',
        'An unmatched { before @actions.MyAction.',
        '@actions.MyAction',
      ],
      [
        'closing',
        'A bare actions.MyAction before unmatched }.',
        'actions.MyAction',
      ],
    ])(
      'should not let an unmatched %s brace hide a bare action reference',
      (_kind, instruction, reference) => {
        const source = sourceWithActionInstruction(instruction);
        const infos = getTemplateSyntaxInfos(lint(source));

        expect(infos).toHaveLength(1);
        expect(infos[0].range).toEqual(rangesOf(source, reference)[0]);
      }
    );

    it('should not flag action references inside interpolation with nested braces', () => {
      const source = sourceWithActionInstruction(
        'Use {!{ nested: "value" } == @actions.MyAction}.'
      );

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
    });

    it.each(['{!@actions.MyAction', '{@actions.MyAction'])(
      'should not add bare-action guidance for unfinished wrapper %s',
      instruction => {
        const source = sourceWithActionInstruction(instruction);

        expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
      }
    );

    it('should preserve a valid action wrapper after an unrelated unmatched brace', () => {
      const source = sourceWithActionInstruction(
        'An unmatched { before {!@actions.MyAction}.'
      );

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
    });

    it('scans large balanced-brace action text without pathological backtracking', () => {
      const repeatedReferences = Array.from(
        { length: 50_000 },
        () => '@actions.MyAction'
      ).join(' ');
      const source = sourceWithActionInstruction(
        `Treat { ${repeatedReferences} } as literal text`
      );

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(0);
    }, 5_000);

    it('maps many emitted action diagnostics without quadratic range rescans', () => {
      const repeatedReferences = Array.from(
        { length: 40_000 },
        () => '@actions.MyAction'
      ).join(' ');
      const source = sourceWithActionInstruction(repeatedReferences);

      expect(getTemplateSyntaxInfos(lint(source))).toHaveLength(40_000);
    }, 4_000);

    it('should work in system instructions too', () => {
      const source = `
start_agent main:
  description: "Main agent"
  reasoning:
    actions:
      MyAction: @utils.end_session
        description: "Test"
    instructions: "Do reasoning"
  system:
    instructions: |
      Use @actions.MyAction when needed
`;
      const diagnostics = lint(source);
      const infos = getTemplateSyntaxInfos(diagnostics);

      expect(infos.length).toBe(1);
      expect(infos[0].message).toContain('@actions.MyAction');
    });
  });

  describe('Output reference detection', () => {
    const expectedMessage =
      "@outputs cannot be referenced in instructions or prompts. Assign the action result to @variables in the set clause immediately following the action's run statement, then reference that variable instead.";

    it('reports bare, wrapped, member, and subscript references in system instructions', () => {
      const source = [
        'system:',
        '  instructions: |',
        '    Bare @outputs, wrapped {!@outputs.value}, member @outputs.result,',
        '    and subscript @outputs["result"].',
      ].join('\n');

      const warnings = getOutputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(4);
      expect(warnings.map(d => d.message)).toEqual(
        Array.from({ length: 4 }, () => expectedMessage)
      );
      expect(warnings.map(d => d.range)).toEqual(rangesOf(source, '@outputs'));
    });

    it('reports references in quoted system instructions', () => {
      const source = 'system:\n  instructions: "Use @outputs.value"';

      const warnings = getOutputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatchObject({
        code: 'instruction-output-reference',
        source: 'agentscript-lint',
        severity: DiagnosticSeverity.Warning,
        message: expectedMessage,
        range: rangesOf(source, '@outputs')[0],
      });
    });

    it('reports references in reasoning instruction templates at any procedure depth', () => {
      const source = [
        'subagent test:',
        '  description: "Test agent"',
        '  reasoning:',
        '    instructions: ->',
        '      | Top-level @outputs.top',
        '      if @variables.ready:',
        '        | Nested @outputs.nested',
        '        if @variables.confirmed:',
        '          | Deeply nested {!@outputs.deep}',
        '      else:',
        '        | Alternate @outputs["alternate"]',
      ].join('\n');

      const warnings = getOutputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(4);
      expect(warnings.map(d => d.range)).toEqual(rangesOf(source, '@outputs'));
    });

    it('reports references in workflow prompts', () => {
      const source = [
        'workflows:',
        '  follow_up:',
        '    prompt: "Use @outputs.result in the follow-up"',
      ].join('\n');

      const warnings = getOutputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(1);
      expect(warnings[0].range).toEqual(rangesOf(source, '@outputs')[0]);
    });

    it.each(['Unterminated {!@outputs.value', 'Missing bang {@outputs.other}'])(
      'reports a reference inside the malformed wrapper %s without duplicates',
      instruction => {
        const source = [
          'system:',
          '  instructions: |',
          `    ${instruction}`,
        ].join('\n');

        const warnings = getOutputReferenceWarnings(lint(source));

        expect(warnings).toHaveLength(1);
        expect(warnings[0].range).toEqual(rangesOf(source, '@outputs')[0]);
      }
    );

    it('preserves source order and does not duplicate matches', () => {
      const source = [
        'system:',
        '  instructions: "First @outputs.system"',
        'workflows:',
        '  follow_up:',
        '    prompt: "Second {!@outputs.workflow}"',
        'subagent test:',
        '  description: "Test agent"',
        '  reasoning:',
        '    instructions: ->',
        '      if @variables.ready:',
        '        | Third @outputs.reasoning and fourth @outputs[0]',
      ].join('\n');

      const warnings = getOutputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(4);
      expect(warnings.map(d => d.range)).toEqual(rangesOf(source, '@outputs'));
    });

    it('does not report a valid action output in its result-binding set clause', () => {
      const source = [
        'variables:',
        '  result: mutable string',
        'subagent test:',
        '  description: "Test agent"',
        '  actions:',
        '    fetch:',
        '      description: "Fetch data"',
        '      target: "externalService://fetch"',
        '      outputs:',
        '        data: string',
        '  reasoning:',
        '    instructions: ->',
        '      | Fetch the data',
        '    actions:',
        '      fetch: @actions.fetch',
        '        set @variables.result=@outputs.data',
      ].join('\n');

      expect(getOutputReferenceWarnings(lint(source))).toHaveLength(0);
    });

    it('does not report output references outside instructions and workflow prompts', () => {
      const source = [
        'system:',
        '  messages:',
        '    welcome: "Welcome @outputs.welcome"',
        '    error: "Error @outputs.error"',
        'subagent test:',
        '  label: "Label @outputs.label"',
        '  description: "Description @outputs.description"',
        '  reasoning:',
        '    instructions: "Safe instructions"',
      ].join('\n');

      expect(getOutputReferenceWarnings(lint(source))).toHaveLength(0);
    });

    it('requires identifier-safe boundaries around @outputs', () => {
      const source = [
        'system:',
        '  instructions: |',
        '    Ignore x@outputs, @@outputs, @outputs_extra, @outputs2, and @outputs-name.',
        '    Report @outputs.value.',
      ].join('\n');

      const warnings = getOutputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(1);
      expect(warnings[0].range).toEqual(rangesOf(source, '@outputs').at(-1));
    });
  });

  describe('Input reference detection', () => {
    const expectedMessage =
      '@inputs can only be referenced in connection instructions. For other Agent Script instructions or prompts, declare the value under variables and reference it with @variables.<name> instead. In Prompt Builder, use $Input merge-field syntax.';

    it('reports bare and merge-field-wrapped input references with exact ranges', () => {
      const source = [
        'system:',
        '  instructions: |',
        '    Bare @inputs.first and wrapped {!@inputs.second}.',
      ].join('\n');

      const warnings = getInputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(2);
      expect(warnings).toEqual(
        rangesOf(source, '@inputs').map(range =>
          expect.objectContaining({
            code: 'instruction-input-reference',
            source: 'agentscript-lint',
            severity: DiagnosticSeverity.Warning,
            message: expectedMessage,
            range,
          })
        )
      );
    });

    it('reports input references in workflow prompts', () => {
      const source = [
        'workflows:',
        '  follow_up:',
        '    prompt: "Use {!@inputs.ddd}"',
      ].join('\n');

      const warnings = getInputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(1);
      expect(warnings[0].range).toEqual(rangesOf(source, '@inputs')[0]);
    });

    it('allows Agent Script variables and Prompt Builder $Input syntax', () => {
      const source = [
        'system:',
        '  instructions: |',
        '    Use @variables.ddd in Agent Script.',
        '    Prompt Builder uses {!$Input.ddd}.',
      ].join('\n');

      expect(getInputReferenceWarnings(lint(source))).toHaveLength(0);
    });

    it('requires identifier-safe boundaries around @inputs', () => {
      const source = [
        'system:',
        '  instructions: |',
        '    Ignore x@inputs, @@inputs, @inputs_extra, @inputs2, and @inputs-name.',
        '    Report @inputs.value.',
      ].join('\n');

      const warnings = getInputReferenceWarnings(lint(source));

      expect(warnings).toHaveLength(1);
      expect(warnings[0].range).toEqual(rangesOf(source, '@inputs').at(-1));
    });
  });
});
