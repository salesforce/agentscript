/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Completion tests: a `with` clause nested under a connection `render:` clause
 * suggests the referenced response format's top-level input names.
 *
 * Exercised through the agentforce dialect because `connection` /
 * `response_formats` are agentforce schema (base agentscript has no such
 * blocks). The generator under test is `getWithCompletions`, which routes a
 * render-body `with` to the response format's inputs and falls back to action
 * inputs otherwise.
 */

import { describe, it, expect } from 'vitest';
import { getWithCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

// A connection whose `rich` format declares three top-level inputs.
const CONNECTION = [
  'connection messaging:',
  '    response_formats:',
  '        rich:',
  '            description: "Rich card"',
  '            inputs:',
  '                tone: string',
  '                count: integer',
  '                title: string',
].join('\n');

/**
 * Build a source whose reasoning action renders `renderExpr`, followed by the
 * given `with` lines (the last one is the cursor line). Returns the full
 * source plus the 0-based line index and character of that cursor line.
 */
function renderSource(
  renderExpr: string,
  withLines: string[]
): { source: string; line: number; character: number } {
  const head = [
    CONNECTION,
    '',
    'start_agent main:',
    '    description: "Main"',
    '',
    'subagent handler:',
    '    description: "Handle"',
    '    actions:',
    '        Lookup:',
    '            description: "Look up"',
    '            target: "flow://Lookup"',
    '    reasoning:',
    '        instructions: ->',
    '            | Do it.',
    '        actions:',
    '            Lookup: @actions.Lookup',
    '                when @connection.messaging',
    `                    render: ${renderExpr}`,
  ];
  const all = [...head, ...withLines.map(w => `                        ${w}`)];
  const source = all.join('\n');
  // `CONNECTION` is a multi-line string held in a single array slot, so the
  // cursor's line index must come from the split source, not `all.length`.
  const sourceLines = source.split('\n');
  return {
    source,
    line: sourceLines.length - 1,
    character: sourceLines[sourceLines.length - 1].length,
  };
}

function labelsAt(source: string, line: number, character: number): string[] {
  const ast = parseDocument(source);
  return getWithCompletions(ast, line, character, testSchemaCtx, source).map(
    c => c.name
  );
}

describe('render-with input-name completions', () => {
  it('shortform `@response_formats.X` suggests the format inputs', () => {
    const { source, line, character } = renderSource('@response_formats.rich', [
      'with ',
    ]);
    expect(labelsAt(source, line, character)).toEqual(
      expect.arrayContaining(['tone', 'count', 'title'])
    );
  });

  it('longform `@connection.C.response_formats.X` suggests the format inputs', () => {
    const { source, line, character } = renderSource(
      '@connection.messaging.response_formats.rich',
      ['with ']
    );
    expect(labelsAt(source, line, character)).toEqual(
      expect.arrayContaining(['tone', 'count', 'title'])
    );
  });

  it('excludes inputs already bound by a sibling `with`', () => {
    const { source, line, character } = renderSource('@response_formats.rich', [
      'with tone = "casual"',
      'with ',
    ]);
    const labels = labelsAt(source, line, character);
    expect(labels).not.toContain('tone');
    expect(labels).toEqual(expect.arrayContaining(['count', 'title']));
  });

  it('still fires on a partial input name (`with co`)', () => {
    // The generator returns every input; the editor filters by the typed
    // prefix, so a partial must not suppress the candidate list.
    const { source, line, character } = renderSource('@response_formats.rich', [
      'with co',
    ]);
    expect(labelsAt(source, line, character)).toEqual(
      expect.arrayContaining(['tone', 'count', 'title'])
    );
  });

  it('suggests nothing for a built-in primitive format (json has no inputs)', () => {
    const { source, line, character } = renderSource('@response_formats.json', [
      'with ',
    ]);
    expect(labelsAt(source, line, character)).toEqual([]);
  });

  it('suggests nothing for an unknown format name', () => {
    const { source, line, character } = renderSource(
      '@response_formats.bogus',
      ['with ']
    );
    expect(labelsAt(source, line, character)).toEqual([]);
  });
});
