/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the gba-only-blocks lint pass.
 *
 * GBA-exclusive constructs — top-level `bundles`, `workflows`, `trigger`,
 * `actions`, node-level `bundles` under a subagent, and `context.salesforce`
 * / `context.data_cloud` — must only appear when `config.agent_type` is
 * `"GoalBasedAgent"`. `context.memory` is not GBA-only.
 */

import { describe, expect, test } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';
import { createLintEngine } from '../lint/index.js';
import { toAstRoot, testSchemaCtx } from './test-utils.js';

function lintSource(source: string) {
  const result = parseWithDiagnostics(source, AgentScriptSchema);
  const ast = toAstRoot(result.value);
  const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
  return diagnostics;
}

function gbaErrors(source: string) {
  return lintSource(source).filter(
    d => typeof d.code === 'string' && d.code.startsWith('gba-only-')
  );
}

const GBA_CONFIG = `
config:
    agent_type: "GoalBasedAgent"
`.trim();

const SERVICE_CONFIG = `
config:
    agent_type: "AgentforceServiceAgent"
`.trim();

const SUBAGENT = `
subagent worker:
    description: "Does work."
`.trim();

describe('gba-only-blocks lint pass', () => {
  describe('GoalBasedAgent — all blocks allowed', () => {
    test('no gba-only errors for GBA agent with all five constructs', () => {
      const source = [
        GBA_CONFIG,
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        'workflows:',
        '    lead_gen:',
        '        agent: @subagent.worker',
        'trigger:',
        '    daily:',
        '        schedule: "0 7 * * *"',
        '        target: @workflows.lead_gen',
        'actions:',
        '    log:',
        '        target: "flow://Log"',
        'subagent worker:',
        '    description: "Worker."',
        '    bundles:',
        '        - @bundles.targeting',
        '    reasoning:',
        '        instructions: "Do the work."',
      ].join('\n');

      expect(gbaErrors(source)).toHaveLength(0);
    });
  });

  describe('Non-GBA agent — top-level blocks rejected', () => {
    test('errors on top-level bundles for non-GBA agent', () => {
      const source = [
        SERVICE_CONFIG,
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        SUBAGENT,
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-bundles')).toBe(true);
    });

    test('errors on workflows for non-GBA agent', () => {
      const source = [
        SERVICE_CONFIG,
        'workflows:',
        '    lead_gen:',
        '        agent: @subagent.worker',
        SUBAGENT,
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-workflows')).toBe(true);
    });

    test('errors on trigger for non-GBA agent', () => {
      const source = [
        SERVICE_CONFIG,
        'workflows:',
        '    lead_gen:',
        '        agent: @subagent.worker',
        'trigger:',
        '    daily:',
        '        schedule: "0 7 * * *"',
        '        target: @workflows.lead_gen',
        SUBAGENT,
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-trigger')).toBe(true);
    });

    test('errors on top-level actions for non-GBA agent', () => {
      const source = [
        SERVICE_CONFIG,
        'actions:',
        '    log:',
        '        target: "flow://Log"',
        SUBAGENT,
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-actions')).toBe(true);
    });

    test('errors on node-level bundles under subagent for non-GBA agent', () => {
      const source = [
        SERVICE_CONFIG,
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        'subagent worker:',
        '    description: "Worker."',
        '    bundles:',
        '        - @bundles.targeting',
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-bundles')).toBe(true);
    });

    test('all five gba-only errors fire on the same non-GBA script', () => {
      const source = [
        SERVICE_CONFIG,
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        'workflows:',
        '    lead_gen:',
        '        agent: @subagent.worker',
        'trigger:',
        '    daily:',
        '        schedule: "0 7 * * *"',
        '        target: @workflows.lead_gen',
        'actions:',
        '    log:',
        '        target: "flow://Log"',
        'subagent worker:',
        '    description: "Worker."',
        '    bundles:',
        '        - @bundles.targeting',
      ].join('\n');

      const errs = gbaErrors(source);
      const codes = errs.map(d => d.code);
      expect(codes).toContain('gba-only-bundles');
      expect(codes).toContain('gba-only-workflows');
      expect(codes).toContain('gba-only-trigger');
      expect(codes).toContain('gba-only-actions');
    });
  });

  describe('No agent_type — enforced (defaults to non-GBA)', () => {
    test('errors on GBA blocks when agent_type is absent', () => {
      const source = [
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        'workflows:',
        '    lead_gen:',
        '        agent: @subagent.worker',
        SUBAGENT,
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-bundles')).toBe(true);
      expect(errs.some(d => d.code === 'gba-only-workflows')).toBe(true);
    });

    test('enforces when agent_type is empty string', () => {
      const source = [
        'config:',
        '    agent_type: ""',
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        SUBAGENT,
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-bundles')).toBe(true);
    });
  });

  describe('GoalBasedAgent — case-insensitive matching', () => {
    test('no gba-only errors for lowercase goalbasedagent', () => {
      const source = [
        'config:',
        '    agent_type: "goalbasedagent"',
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        'workflows:',
        '    lead_gen:',
        '        agent: @subagent.worker',
        SUBAGENT,
      ].join('\n');

      expect(gbaErrors(source)).toHaveLength(0);
    });

    test('no gba-only errors for mixed-case GoalBasedAgent', () => {
      const source = [
        'config:',
        '    agent_type: "GOALBASEDAGENT"',
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        SUBAGENT,
      ].join('\n');

      expect(gbaErrors(source)).toHaveLength(0);
    });
  });

  describe('Non-GBA agent — node-level bundles under start_agent rejected', () => {
    test('errors on node-level bundles under start_agent for non-GBA agent', () => {
      const source = [
        SERVICE_CONFIG,
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        'start_agent router:',
        '    description: "Entry point."',
        '    bundles:',
        '        - @bundles.targeting',
      ].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-bundles')).toBe(true);
    });
  });

  describe('GoalBasedAgent — whitespace-tolerant matching', () => {
    test('no gba-only errors when agent_type has surrounding whitespace', () => {
      const source = [
        'config:',
        '    agent_type: " GoalBasedAgent "',
        'bundles:',
        '    targeting:',
        '        target: "bundle://targeting"',
        SUBAGENT,
      ].join('\n');

      expect(gbaErrors(source)).toHaveLength(0);
    });
  });

  describe('Non-GBA agent — no false positives', () => {
    test('no gba-only errors when non-GBA agent uses no GBA blocks', () => {
      const source = [SERVICE_CONFIG, SUBAGENT].join('\n');

      expect(gbaErrors(source)).toHaveLength(0);
    });

    test('errors on empty bundles block for non-GBA agent', () => {
      const source = [SERVICE_CONFIG, 'bundles:', SUBAGENT].join('\n');

      const errs = gbaErrors(source);
      expect(errs.some(d => d.code === 'gba-only-bundles')).toBe(true);
    });
  });
});
