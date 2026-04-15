/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the code actions provider — topic→subagent conversion quick-fix.
 */

import { describe, test, expect } from 'vitest';
import type { TextEdit } from 'vscode-languageserver';
import { provideCodeActions } from './code-actions.js';
import { processDocument } from '../pipeline.js';
import { parse } from '@agentscript/parser';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import type { LspConfig } from '../lsp-config.js';

const agentforceConfig: LspConfig = {
  dialects: [agentforceDialect],
  parser: { parse },
};

function createState(source: string) {
  return processDocument('test://test.agent', source, agentforceConfig);
}

/** Apply text edits to source and return the result. */
function applyEdits(source: string, edits: TextEdit[]): string {
  const lines = source.split('\n');
  // Sort edits in reverse order so earlier edits don't shift positions
  const sorted = [...edits].sort((a, b) => {
    if (a.range.start.line !== b.range.start.line)
      return b.range.start.line - a.range.start.line;
    return b.range.start.character - a.range.start.character;
  });
  for (const edit of sorted) {
    const startLine = edit.range.start.line;
    const endLine = edit.range.end.line;
    const startChar = edit.range.start.character;
    const endChar = edit.range.end.character;

    if (startLine === endLine) {
      const line = lines[startLine];
      lines[startLine] =
        line.slice(0, startChar) + edit.newText + line.slice(endChar);
    }
  }
  return lines.join('\n');
}

/** Find the deprecated-field quick-fix for 'topic' and return its edits. */
function getTopicConversionEdits(source: string): TextEdit[] | null {
  const state = createState(source);
  const deprecatedDiags = state.diagnostics.filter(
    d => d.code === 'deprecated-field'
  );
  if (deprecatedDiags.length === 0) return null;

  const actions = provideCodeActions(
    state,
    { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    deprecatedDiags
  );

  const convertAction = actions.find(a => a.title === 'Convert to subagent');
  if (!convertAction?.edit?.changes) return null;

  const edits = Object.values(convertAction.edit.changes)[0];
  return edits ?? null;
}

// TODO: restore once topic deprecated() is re-enabled in schema.ts
describe.skip('topic → subagent conversion quick-fix', () => {
  test('renames topic keyword to subagent', () => {
    const source = `topic Foo:\n    description: "test"`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);
    expect(result).toContain('subagent Foo:');
    expect(result).not.toContain('topic Foo:');
  });

  test('does not rename actions: field', () => {
    const source = `topic Foo:
    description: "test"
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);
    // actions: stays as actions: (not renamed to tool_definitions:)
    expect(result).toContain('actions:');
    expect(result).not.toContain('tool_definitions:');
  });

  test('does not rename reasoning.actions: field', () => {
    const source = `topic Foo:
    description: "test"
    reasoning:
        instructions: ->
            | help
        actions:
            go: @utils.transition to @topic.Bar
                description: "go"`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);
    // reasoning.actions: stays as actions: (not renamed to tools:)
    expect(result).toMatch(/actions:/m);
    expect(result).not.toContain('tools:');
    // @topic.Bar stays as @topic.Bar (Bar is not being converted)
    expect(result).toContain('@topic.Bar');
  });

  test('does not rename @actions.X references', () => {
    const source = `topic Foo:
    description: "test"
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | help
        actions:
            do_lookup: @actions.Lookup
                with id=...`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);
    // @actions.X stays as @actions.X (not renamed to @tool_definitions.X)
    expect(result).toContain('@actions.Lookup');
    expect(result).not.toContain('@tool_definitions.Lookup');
  });

  test('does not rename @actions in instruction interpolations', () => {
    const source = `topic Foo:
    description: "test"
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | Use {!@actions.do_lookup} to find data
        actions:
            do_lookup: @actions.Lookup`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);
    // @actions references stay unchanged
    expect(result).toContain('{!@actions.do_lookup}');
    expect(result).toContain('@actions.Lookup');
    expect(result).not.toContain('@tools.');
    expect(result).not.toContain('@tool_definitions.');
  });

  test('renames @topic.NAME to @subagent.NAME across the document', () => {
    const source = `topic Foo:
    description: "test"
    reasoning:
        instructions: ->
            | help
        actions:
            go: @utils.transition to @topic.Bar
                description: "go"

topic Bar:
    description: "other"
    reasoning:
        instructions: ->
            | help
        actions:
            back: @utils.transition to @topic.Foo
                description: "back"`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);
    // @topic.Foo references across the document should become @subagent.Foo
    expect(result).toContain('@subagent.Foo');
    // @topic.Bar should NOT change (Bar is still a topic)
    expect(result).toContain('@topic.Bar');
  });

  test('full conversion: keyword + @topic refs only (fields and @actions unchanged)', () => {
    const source = `topic GeneralFAQ:
    label: "General FAQ"
    description: "FAQ"

    actions:
        AnswerQuestions:
            description: "Answer"
            target: "flow://Answer"
            inputs:
                query: string

    reasoning:
        instructions: ->
            | Use {!@actions.answer} to help
        actions:
            answer: @actions.AnswerQuestions
                with query = ...`;
    const edits = getTopicConversionEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    // Keyword renamed
    expect(result).toContain('subagent GeneralFAQ:');
    // actions: stays as actions: (NOT renamed to tool_definitions:)
    expect(result).toMatch(/^\s{4}actions:/m);
    expect(result).not.toContain('tool_definitions:');
    // reasoning.actions: stays as actions: (NOT renamed to tools:)
    expect(result).not.toMatch(/^\s{8}tools:/m);
    // @actions references stay unchanged
    expect(result).toContain('{!@actions.answer}');
    expect(result).toContain('@actions.AnswerQuestions');
    expect(result).not.toContain('@tools.');
    expect(result).not.toContain('@tool_definitions.');
  });
});
