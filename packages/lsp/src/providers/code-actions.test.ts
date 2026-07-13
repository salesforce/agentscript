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
  // Convert (line, character) positions to absolute offsets and apply edits
  // in reverse offset order so earlier edits don't shift later positions.
  function toOffset(text: string, line: number, character: number): number {
    let offset = 0;
    let currentLine = 0;
    for (let i = 0; i < text.length; i++) {
      if (currentLine === line) {
        return offset + character;
      }
      if (text[i] === '\n') {
        currentLine++;
        offset = i + 1;
      }
    }
    // Position past the last newline (or empty file)
    return currentLine === line ? offset + character : text.length;
  }

  const sorted = [...edits].sort((a, b) => {
    const aOff = toOffset(source, a.range.start.line, a.range.start.character);
    const bOff = toOffset(source, b.range.start.line, b.range.start.character);
    return bOff - aOff;
  });
  let out = source;
  for (const edit of sorted) {
    const startOff = toOffset(
      out,
      edit.range.start.line,
      edit.range.start.character
    );
    const endOff = toOffset(out, edit.range.end.line, edit.range.end.character);
    out = out.slice(0, startOff) + edit.newText + out.slice(endOff);
  }
  return out;
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

/** Find the deprecated-field quick-fix that moves default_agent_user. */
function getMoveDefaultAgentUserEdits(source: string): TextEdit[] | null {
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

  const moveAction = actions.find(a =>
    a.title.includes('Move config.default_agent_user')
  );
  if (!moveAction?.edit?.changes) return null;

  const edits = Object.values(moveAction.edit.changes)[0];
  return edits ?? null;
}

describe('config.default_agent_user → access.default_agent_user quick-fix', () => {
  test('emits the moved-to-access deprecation message', () => {
    const source = `config:
    developer_name: "agent"
    default_agent_user: "support@example.com"
`;
    const state = createState(source);
    const dep = state.diagnostics.find(d => d.code === 'deprecated-field');
    expect(dep).toBeDefined();
    expect(dep!.message).toContain(
      'Property default_agent_user has moved from config to access.'
    );
    expect(dep!.message).toContain('Move field to access block.');
  });

  /** Get all top-level blocks (lines starting at column 0 with `name:`). */
  function getBlock(text: string, name: string): string | null {
    const lines = text.split('\n');
    const startIdx = lines.findIndex(l => l.startsWith(`${name}:`));
    if (startIdx === -1) return null;
    const out: string[] = [lines[startIdx]];
    for (let i = startIdx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.length === 0 || line.startsWith(' ') || line.startsWith('\t')) {
        out.push(line);
      } else {
        break;
      }
    }
    return out.join('\n');
  }

  test('inserts a new access block when none exists', () => {
    const source = `config:
    developer_name: "agent"
    default_agent_user: "support@example.com"
`;
    const edits = getMoveDefaultAgentUserEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    // The deprecated line is gone from config.
    const config = getBlock(result, 'config');
    expect(config).not.toBeNull();
    expect(config).not.toContain('default_agent_user');
    // Other config fields are preserved.
    expect(config).toContain('developer_name: "agent"');
    // A top-level access block is created with the moved field.
    const access = getBlock(result, 'access');
    expect(access).not.toBeNull();
    expect(access).toContain('default_agent_user: "support@example.com"');
  });

  test('appends to an existing access block', () => {
    const source = `config:
    developer_name: "agent"
    default_agent_user: "support@example.com"

access:
    sharing_policy:
        use_default_sharing_entities: True
`;
    const edits = getMoveDefaultAgentUserEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    const config = getBlock(result, 'config');
    expect(config).not.toContain('default_agent_user');
    const access = getBlock(result, 'access');
    expect(access).toContain('use_default_sharing_entities: True');
    expect(access).toContain('default_agent_user: "support@example.com"');
    // Only one default_agent_user remains.
    expect(result.match(/default_agent_user/g)?.length).toBe(1);
  });

  test('preserves other top-level blocks', () => {
    const source = `config:
    developer_name: "agent"
    default_agent_user: "support@example.com"

system:
    instructions: "Do things."
`;
    const edits = getMoveDefaultAgentUserEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    expect(result).toContain('developer_name: "agent"');
    const systemBlock = getBlock(result, 'system');
    expect(systemBlock).toContain('instructions: "Do things."');
    const access = getBlock(result, 'access');
    expect(access).toContain('default_agent_user: "support@example.com"');
  });

  test('preserves the document indent style (2-space) in a new access block', () => {
    const source = `config:
  developer_name: "agent"
  default_agent_user: "support@example.com"
`;
    const edits = getMoveDefaultAgentUserEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    // The moved field keeps the config field's 2-space indent, not a hardcoded 4.
    expect(result).toContain(
      'access:\n  default_agent_user: "support@example.com"'
    );
    const config = getBlock(result, 'config');
    expect(config).not.toContain('default_agent_user');
  });

  test('preserves the document indent style (2-space) in an existing access block', () => {
    const source = `config:
  developer_name: "agent"
  default_agent_user: "support@example.com"
access:
  sharing_policy:
    use_default_sharing_entities: True
`;
    const edits = getMoveDefaultAgentUserEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    expect(result).toMatch(/^  default_agent_user: "support@example.com"/m);
    expect(result.match(/default_agent_user/g)?.length).toBe(1);
  });

  test('handles None value', () => {
    const source = `config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"
    default_agent_user: None
`;
    const edits = getMoveDefaultAgentUserEdits(source);
    expect(edits).not.toBeNull();
    const result = applyEdits(source, edits!);

    const access = getBlock(result, 'access');
    expect(access).toContain('default_agent_user: None');
    const config = getBlock(result, 'config');
    expect(config).not.toContain('default_agent_user');
  });
});
