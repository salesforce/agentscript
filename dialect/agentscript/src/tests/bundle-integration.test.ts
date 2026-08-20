/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for integrating bundles into the agent dialect:
 *
 *   - agent-level `bundles:` block (`BundleBlock`, `scopeAlias: 'bundles'`)
 *     with `bundle://` targets, making `@bundles.X` referenceable;
 *   - triggers whose target is a deep reference into a bundle's workflows
 *     (`@bundles.X.workflows.Y`).
 */

import { describe, expect, test } from 'vitest';
import { isNamedMap } from '@agentscript/language';
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

describe('bundle block', () => {
  test('parses agent-level bundle references', () => {
    const doc = parseDocument(
      [
        'bundles:',
        '    prospecting:',
        '        target: "bundle://prospecting"',
        '    outreach:',
        '        target: "bundle://outreach"',
      ].join('\n')
    );
    expect(isNamedMap(doc.bundles)).toBe(true);
    const prospecting = doc.bundles?.get('prospecting');
    expect(
      (prospecting as { target?: { value?: string } })?.target?.value
    ).toBe('bundle://prospecting');
    expect(doc.bundles?.get('outreach')).toBeDefined();
  });

  test('a non-bundle:// target is reported', () => {
    const ast = toAstRoot(
      parseDocument(
        ['bundles:', '    bad:', '        target: "agent://not_a_bundle"'].join(
          '\n'
        )
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'constraint-pattern')).toBe(true);
  });

  test('@bundles namespace resolves a declared bundle', () => {
    const result = parseWithDiagnostics(
      [
        'bundles:',
        '    prospecting:',
        '        target: "bundle://prospecting"',
        'subagent worker:',
        '    description: "Does the work."',
        '    bundles:',
        '        - @bundles.prospecting',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
    const ast = toAstRoot(result.value);
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.filter(d => d.code === 'undefined-reference')).toEqual(
      []
    );
  });
});

describe('trigger targeting a bundle workflow', () => {
  test('accepts exactly @bundles.X.workflows.Y', () => {
    const result = parseWithDiagnostics(
      [
        'config:',
        '    agent_type: "GoalBasedAgent"',
        'bundles:',
        '    outreach:',
        '        target: "bundle://outreach"',
        'trigger every_5_mins:',
        '    schedule: "*/5 * * * *"',
        '    target: @bundles.outreach.workflows.send_emails',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);

    const ast = toAstRoot(result.value);
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics).toEqual([]);
  });

  test.each([
    '@bundles.outreach',
    '@bundles.outreach.workflows',
    '@bundles.outreach.actions.send_emails',
    '@bundles.outreach.workflows.send_emails.extra',
  ])('rejects invalid bundle workflow target %s', target => {
    const result = parseWithDiagnostics(
      [
        'bundles:',
        '    outreach:',
        '        target: "bundle://outreach"',
        'trigger invalid:',
        '    schedule: "*/5 * * * *"',
        `    target: ${target}`,
      ].join('\n'),
      AgentScriptSchema
    );
    const ast = toAstRoot(result.value);
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.map(d => d.code)).toContain('invalid-trigger-target');
  });
});

describe('complete example with bundle integration', () => {
  const AUTONOMOUS_AE = [
    'config:',
    '    agent_type: "GoalBasedAgent"',
    '',
    'system:',
    '    instructions: |',
    '        Sales Pipeline Accelerator. Domain: Sales.',
    '',
    'orchestrator agent:',
    '    reasoning:',
    '        instructions: ->',
    '            | You are a goal-based sales agent.',
    '',
    'bundles:',
    '    prospecting:',
    '        target: "bundle://prospecting"',
    '    outreach:',
    '        target: "bundle://outreach"',
    '',
    'workflows:',
    '    engineering:',
    '        agent: @connected_subagent.agent_1',
    '',
    'trigger:',
    '    every_5_mins:',
    '        schedule: "*/5 * * * *"',
    '        target: @bundles.outreach.workflows.send_emails',
    '',
    'connected_subagent agent_1:',
    '    target: "agent://Agent_1"',
    '    label: "Agent 1"',
    '    description: "Agent 1"',
  ].join('\n');

  test('parses with no diagnostics', () => {
    const result = parseWithDiagnostics(AUTONOMOUS_AE, AgentScriptSchema);
    expect(result.diagnostics).toHaveLength(0);
  });

  test('exposes bundles block, orchestrator, and deep trigger target', () => {
    const doc = parseDocument(AUTONOMOUS_AE);
    expect(doc.bundles?.get('prospecting')).toBeDefined();
    expect(doc.bundles?.get('outreach')).toBeDefined();
    expect(doc.orchestrator?.get('agent')).toBeDefined();
    expect(doc.trigger?.get('every_5_mins')).toBeDefined();
  });

  test('round-trips', () => {
    const ast1 = parseDocument(AUTONOMOUS_AE);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });
});
