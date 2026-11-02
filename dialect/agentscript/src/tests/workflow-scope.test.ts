/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import { parse } from '@agentscript/parser';
import {
  findDefinitionAtPosition,
  getAvailableNamespaces,
  getCompletionCandidates,
  parseAndLint,
} from '@agentscript/language';

import { agentscriptDialect } from '../index.js';
import { parseDocument, testSchemaCtx } from './test-utils.js';

function positionOf(source: string, substring: string, occurrence = 0) {
  let offset = -1;
  for (let index = 0; index <= occurrence; index++) {
    offset = source.indexOf(substring, offset + 1);
  }
  if (offset < 0) throw new Error(`Substring not found: ${substring}`);
  const before = source.slice(0, offset).split('\n');
  return {
    line: before.length - 1,
    character: before[before.length - 1].length,
  };
}

describe('workflow-scoped step references', () => {
  const source = [
    'variables:',
    '    next_step: mutable string',
    'workflow first:',
    '    description: "First"',
    '    step collect:',
    '        set @variables.next_step = @step.close',
    '    step close:',
    '        set @variables.next_step = "closed"',
    'workflow second:',
    '    description: "Second"',
    '    steps:',
    '        set @variables.next_step = @step.collect',
    'subagent outside:',
    '    description: "Outside"',
    '    before_reasoning: ->',
    '        set @variables.next_step = @step.collect',
  ].join('\n');

  test('resolves only named steps in the owning workflow', () => {
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic => diagnostic.code === 'undefined-reference'
    );
    expect(diagnostics).toHaveLength(2);

    const document = parseDocument(source);
    const reference = positionOf(source, '@step.close');
    const definition = findDefinitionAtPosition(
      document,
      reference.line,
      reference.character,
      testSchemaCtx
    );
    expect(definition.definition?.name).toBe('close');

    expect(
      getCompletionCandidates(document, 'step', testSchemaCtx, {
        workflow: 'first',
      }).map(candidate => candidate.name)
    ).toEqual(['collect', 'close']);
    expect(
      getCompletionCandidates(document, 'step', testSchemaCtx, {
        workflow: 'second',
      })
    ).toEqual([]);
  });

  test('hides the step namespace outside workflows', () => {
    expect(
      getAvailableNamespaces(testSchemaCtx).map(candidate => candidate.name)
    ).not.toContain('step');
    expect(
      getAvailableNamespaces(testSchemaCtx, { workflow: 'first' }).map(
        candidate => candidate.name
      )
    ).toContain('step');
  });
});

describe('workflow-scoped actions', () => {
  const source = [
    'variables:',
    '    order_id: mutable string',
    'actions:',
    '    shared:',
    '        description: "Global shared"',
    '        target: "flow://global_shared"',
    '    fallback:',
    '        description: "Global fallback"',
    '        target: "flow://fallback"',
    'workflow process:',
    '    description: "Process"',
    '    actions:',
    '        shared:',
    '            description: "Local shared"',
    '            target: "flow://local_shared"',
    '    steps:',
    '        run @actions.shared',
    '        run @actions.fallback',
  ].join('\n');

  test('prefers local actions and falls back to global actions', () => {
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic => diagnostic.code === 'undefined-reference'
    );
    expect(diagnostics).toEqual([]);

    const document = parseDocument(source);
    expect(
      getCompletionCandidates(document, 'actions', testSchemaCtx, {
        workflow: 'process',
      }).map(candidate => candidate.name)
    ).toEqual(['shared', 'fallback']);
    expect(
      getCompletionCandidates(document, 'actions', testSchemaCtx).map(
        candidate => candidate.name
      )
    ).toEqual(['shared', 'fallback']);

    const localReference = positionOf(source, '@actions.shared', 0);
    const localDefinition = findDefinitionAtPosition(
      document,
      localReference.line,
      localReference.character,
      testSchemaCtx
    ).definition;
    expect(localDefinition?.definitionRange.start.line).toBe(
      positionOf(source, '        shared:').line
    );

    const fallbackReference = positionOf(source, '@actions.fallback', 0);
    const fallbackDefinition = findDefinitionAtPosition(
      document,
      fallbackReference.line,
      fallbackReference.character,
      testSchemaCtx
    ).definition;
    expect(fallbackDefinition?.definitionRange.start.line).toBe(
      positionOf(source, '    fallback:').line
    );
  });
});
