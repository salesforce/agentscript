/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the `workflows:` block — named, independently-executable
 * workflows scoped to the agent. Each routes either to a subagent (`agent`)
 * or runs a free-form `prompt`.
 */

import { describe, expect, test } from 'vitest';
import { StringLiteral, isNamedMap } from '@agentscript/language';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  stripMeta,
  toAstRoot,
  testSchemaCtx,
} from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';
import { createLintEngine } from '../lint/index.js';

describe('workflows block', () => {
  test('parses an agent-routed workflow', () => {
    const doc = parseDocument(
      [
        'workflows:',
        '    lead_generation:',
        '        agent: @subagent.lead_generation',
        'subagent lead_generation:',
        '    description: "lg"',
      ].join('\n')
    );
    expect(isNamedMap(doc.workflows)).toBe(true);
    const wf = doc.workflows?.get('lead_generation');
    expect(wf).toBeDefined();
    expect((wf as { agent?: { property?: string } })?.agent?.property).toBe(
      'lead_generation'
    );
  });

  test('parses a prompt-based workflow', () => {
    const doc = parseDocument(
      [
        'workflows:',
        '    follow_up:',
        '        prompt: "Follow up on last week\'s emails."',
      ].join('\n')
    );
    const wf = doc.workflows?.get('follow_up');
    expect((wf as { prompt?: unknown })?.prompt).toBeInstanceOf(StringLiteral);
  });

  test('agent target must reference an allowed agent namespace', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'workflows:',
          '    bad:',
          '        agent: @variables.x',
          'variables:',
          '    x: mutable string',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-workflow-agent')).toBe(
      true
    );
  });

  test('agent target must specifically reference a subagent', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'actions:',
          '    send:',
          '        target: "flow://send"',
          'workflows:',
          '    bad:',
          '        agent: @actions.send',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-workflow-agent')).toBe(
      true
    );
  });

  test('requires at least one of agent or prompt', () => {
    const neither = toAstRoot(
      parseDocument(['workflows:', '    x:'].join('\n'))
    );
    const { diagnostics } = createLintEngine().run(neither, testSchemaCtx);
    expect(
      diagnostics.some(d => d.code === 'workflow-exactly-one-target')
    ).toBe(true);
  });

  test('allows both agent and prompt together', () => {
    const result = parseWithDiagnostics(
      [
        'workflows:',
        '    follow_up:',
        '        agent: @subagent.lg',
        '        prompt: "Follow up on emails from last week."',
        'subagent lg:',
        '    description: "lg"',
      ].join('\n'),
      AgentScriptSchema
    );
    const ast = toAstRoot(result.value);
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(
      diagnostics.some(d => d.code === 'workflow-exactly-one-target')
    ).toBe(false);
    expect(
      diagnostics.filter(d => d.code === 'invalid-workflow-agent')
    ).toEqual([]);
  });

  test('@workflows namespace resolves a defined workflow', () => {
    const result = parseWithDiagnostics(
      [
        'workflows:',
        '    lead_generation:',
        '        agent: @subagent.lg',
        'subagent lg:',
        '    description: "lg"',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  test('round-trips', () => {
    const source = [
      'workflows:',
      '    lead_generation:',
      '        agent: @subagent.lead_generation',
      '    follow_up:',
      '        prompt: "check emails"',
      'subagent lead_generation:',
      '    description: "lg"',
    ].join('\n');
    const ast1 = parseDocument(source);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });
});
