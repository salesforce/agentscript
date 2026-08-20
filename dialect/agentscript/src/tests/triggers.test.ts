/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the `trigger:` block — scheduled triggers that fire a workflow on
 * a cron schedule. The schedule is validated against a 5-field cron pattern;
 * the target is a workflow reference.
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

describe('trigger block', () => {
  test('parses a trigger with schedule and workflow target', () => {
    const doc = parseDocument(
      [
        'trigger:',
        '    daily_lead_gen:',
        '        schedule: "30 8 * * *"',
        '        target: @workflows.lead_generation',
        'workflows:',
        '    lead_generation:',
        '        agent: @subagent.lg',
        'subagent lg:',
        '    description: "lg"',
      ].join('\n')
    );
    expect(isNamedMap(doc.trigger)).toBe(true);
    const trig = doc.trigger?.get('daily_lead_gen');
    expect((trig as { schedule?: unknown })?.schedule).toBeInstanceOf(
      StringLiteral
    );
    expect(
      (trig as { target?: { object?: { name?: string }; property?: string } })
        ?.target?.object?.name
    ).toBe('workflows');
  });

  test('supports multiple triggers for one workflow', () => {
    const doc = parseDocument(
      [
        'trigger:',
        '    monday_10am:',
        '        schedule: "0 10 * * 1"',
        '        target: @workflows.follow_up',
        '    daily:',
        '        schedule: "30 8 * * *"',
        '        target: @workflows.follow_up',
        'workflows:',
        '    follow_up:',
        '        prompt: "x"',
      ].join('\n')
    );
    expect(doc.trigger?.get('monday_10am')).toBeDefined();
    expect(doc.trigger?.get('daily')).toBeDefined();
  });

  test('invalid cron schedule is flagged', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    bad:',
          '        schedule: "not a cron"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      true
    );
  });

  test('five arbitrary tokens are not accepted as cron syntax', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    bad:',
          '        schedule: "hello there five field cron"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      true
    );
  });

  test('valid cron schedule produces no pattern diagnostic', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    ok:',
          '        schedule: "0 10 * * 1"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'constraint-pattern')).toBe(false);
  });

  test('named day-of-week (MON-FRI) is accepted', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    weekdays:',
          '        schedule: "0 8 * * MON-FRI"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      false
    );
  });

  test('named month (JAN) is accepted', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    new_year:',
          '        schedule: "0 0 1 JAN *"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      false
    );
  });

  test('@daily shorthand is accepted', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    every_day:',
          '        schedule: "@daily"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      false
    );
  });

  test('@hourly shorthand is accepted', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    every_hour:',
          '        schedule: "@hourly"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      false
    );
  });

  test('unknown shorthand is rejected', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'trigger:',
          '    bad:',
          '        schedule: "@everyminute"',
          '        target: @workflows.x',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-cron-schedule')).toBe(
      true
    );
  });

  test('schedule is required', () => {
    const result = parseWithDiagnostics(
      ['trigger:', '    bad:', '        target: @workflows.x'].join('\n'),
      AgentScriptSchema
    );
    const ast = toAstRoot(result.value);
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(
      diagnostics.some(
        d => d.message.includes('schedule') && d.message.includes('required')
      )
    ).toBe(true);
  });

  test('target is required', () => {
    const ast = toAstRoot(
      parseDocument(
        ['trigger:', '    bad:', '        schedule: "0 10 * * 1"'].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(
      diagnostics.some(
        d => d.code === 'missing-required-field' && d.message.includes('target')
      )
    ).toBe(true);
  });

  test('target must reference a workflow', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'actions:',
          '    send:',
          '        target: "flow://send"',
          'trigger:',
          '    bad:',
          '        schedule: "0 10 * * 1"',
          '        target: @actions.send',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'invalid-trigger-target')).toBe(
      true
    );
  });

  test('round-trips', () => {
    const source = [
      'trigger:',
      '    daily_lead_gen:',
      '        schedule: "30 8 * * *"',
      '        target: @workflows.lead_generation',
    ].join('\n');
    const ast1 = parseDocument(source);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });
});
