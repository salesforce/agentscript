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

  test('resolves only actions of the workflow', () => {
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic =>
        diagnostic.code === 'workflow-unknown-action' ||
        diagnostic.code === 'undefined-reference'
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'workflow-unknown-action',
        message: expect.stringContaining("'run' target 'fallback'"),
        range: expect.objectContaining({
          start: positionOf(source, '@actions.fallback'),
        }),
      }),
    ]);

    const document = parseDocument(source);
    expect(
      getCompletionCandidates(document, 'actions', testSchemaCtx, {
        workflow: 'process',
      }).map(candidate => candidate.name)
    ).toEqual(['shared']);
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
    expect(
      findDefinitionAtPosition(
        document,
        fallbackReference.line,
        fallbackReference.character,
        testSchemaCtx
      ).definition
    ).toBeNull();
  });

  test('offers no top-level actions to a workflow without actions', () => {
    const document = parseDocument(
      [
        'actions:',
        '    fallback:',
        '        description: "Global fallback"',
        '        target: "flow://fallback"',
        'workflow process:',
        '    description: "Process"',
        '    steps:',
        '        run @actions.fallback',
      ].join('\n')
    );
    expect(
      getCompletionCandidates(document, 'actions', testSchemaCtx, {
        workflow: 'process',
      })
    ).toEqual([]);
  });

  test('does not suggest top-level actions for an unknown action', () => {
    const source = [
      'actions:',
      '    fallback:',
      '        description: "Global fallback"',
      '        target: "flow://fallback"',
      'workflow process:',
      '    description: "Process"',
      '    steps:',
      '        run @actions.fallbak',
    ].join('\n');
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic => diagnostic.code === 'undefined-reference'
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: "'fallbak' is not defined in actions",
      }),
    ]);
  });

  test('still resolves top-level actions in a subagent', () => {
    const source = [
      'actions:',
      '    fallback:',
      '        description: "Global fallback"',
      '        target: "flow://fallback"',
      'subagent main:',
      '    description: "Main"',
      '    actions:',
      '        local:',
      '            description: "Local"',
      '            target: "flow://local"',
      '    reasoning:',
      '        instructions: "Help"',
      '        actions:',
      '            call_fallback: @actions.fallback',
    ].join('\n');
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
        subagent: 'main',
      }).map(candidate => candidate.name)
    ).toEqual(['local', 'call_fallback', 'fallback']);

    const reference = positionOf(source, '@actions.fallback');
    expect(
      findDefinitionAtPosition(
        document,
        reference.line,
        reference.character,
        testSchemaCtx
      ).definition?.definitionRange.start.line
    ).toBe(positionOf(source, '    fallback:').line);
  });
});

describe('workflow-scoped actions in do directives', () => {
  const source = [
    'config:',
    '    agent_type: "GoalBasedAgent"',
    'actions:',
    '    fallback:',
    '        description: "Global fallback"',
    '        target: "flow://fallback"',
    'workflow process:',
    '    description: "Process"',
    '    actions:',
    '        local:',
    '            description: "Local"',
    '            target: "flow://local"',
    '    steps:',
    '        | Call {!@actions.local}',
    '        if True:',
    '            | Then call {!@actions.fallback}',
    '        else:',
    '            | Else call {!@actions.fallback}',
    '        | Or call {!@actions.missing}',
  ].join('\n');

  test('accepts only actions of the workflow', () => {
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic =>
        diagnostic.code === 'workflow-unknown-action' ||
        diagnostic.code === 'undefined-reference'
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'workflow-unknown-action',
        message: expect.stringContaining(
          "'{!@actions.fallback}' in a '|' line"
        ),
        range: expect.objectContaining({
          start: positionOf(source, '@actions.fallback'),
        }),
      }),
      expect.objectContaining({
        code: 'workflow-unknown-action',
        range: expect.objectContaining({
          start: positionOf(source, '@actions.fallback}', 1),
        }),
      }),
      expect.objectContaining({
        code: 'undefined-reference',
        message: expect.stringContaining("'missing'"),
        range: expect.objectContaining({
          start: positionOf(source, '@actions.missing'),
        }),
      }),
    ]);
  });
});

describe('unsupported references in do directives', () => {
  test.each([
    '@utils.escalate',
    '@utils.transition',
    '@utils.end_session',
    '@outputs.found',
    '@subagent.support',
    '@outputs.order.id',
  ])('rejects {!%s}', reference => {
    const source = [
      'workflow process:',
      '    description: "Process"',
      '    steps:',
      `        | If the user is upset, use {!${reference}}`,
    ].join('\n');
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic => diagnostic.code === 'workflow-do-unsupported-reference'
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(`'${reference}'`),
        range: expect.objectContaining({
          start: positionOf(source, reference),
        }),
      }),
    ]);
  });

  test.each([
    ['@outputs.items[0]', '@outputs.items'],
    ['len(@outputs.items)', '@outputs.items'],
    ['@utils.escalate if @variables.ready else ""', '@utils.escalate'],
    ['@actions.lookup if @variables.ready else ""', '@actions.lookup'],
    [
      '@actions.lookup if @variables.ready else @actions.refund',
      '@actions.lookup',
    ],
  ])('rejects the reference inside {!%s}', (expression, reference) => {
    const source = [
      'workflow process:',
      '    description: "Process"',
      '    steps:',
      `        | Use {!${expression}}`,
    ].join('\n');
    const diagnostics = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.filter(
      diagnostic => diagnostic.code === 'workflow-do-unsupported-reference'
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        message: expect.stringContaining(`'${reference}'`),
        range: expect.objectContaining({
          start: positionOf(source, reference),
        }),
      }),
    ]);
  });

  test.each([
    '@variables.order_id',
    '@system_variables.user_input',
    '@system_variables.last_reply.interrupted',
    '@system_variables.uploaded_files[0].name',
    'len(@variables.items)',
    '"VIP" if @variables.ready else "regular"',
  ])('accepts {!%s}', reference => {
    const source = [
      'workflow process:',
      '    description: "Process"',
      '    steps:',
      `        | Reply to {!${reference}}`,
    ].join('\n');
    const codes = parseAndLint(
      parse(source).rootNode,
      agentscriptDialect
    ).diagnostics.map(diagnostic => diagnostic.code);

    expect(codes).not.toContain('workflow-do-unsupported-reference');
  });
});
