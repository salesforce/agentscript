/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for node-level bundle references inside a subagent's `bundles:` sequence.
 *
 * Each entry must be an @bundles.<name> reference. The undefined-reference pass
 * validates that the referenced bundle is declared at the top level.
 */

import { describe, expect, test } from 'vitest';
import {
  toAstRoot,
  testSchemaCtx,
  parseWithDiagnostics,
} from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';
import { createLintEngine } from '../lint/index.js';

function lintSource(source: string) {
  const result = parseWithDiagnostics(source, AgentScriptSchema);
  const ast = toAstRoot(result.value);
  const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
  return diagnostics;
}

const BASE_SUBAGENT = `
subagent worker:
    description: "Does the work."
`.trim();

describe('node-level bundle reference lint', () => {
  test('passes when @bundles reference matches a declared top-level bundle', () => {
    const source = [
      'bundles:',
      '    targeting:',
      '        target: "bundle://targeting"',
      'subagent worker:',
      '    description: "Executes plan."',
      '    bundles:',
      '        - @bundles.targeting',
    ].join('\n');

    const diagnostics = lintSource(source);
    expect(diagnostics.filter(d => d.code === 'undefined-reference')).toEqual(
      []
    );
  });

  test('errors when @bundles reference does not match any declared bundle', () => {
    const source = [
      'bundles:',
      '    targeting:',
      '        target: "bundle://targeting"',
      'subagent worker:',
      '    description: "Executes plan."',
      '    bundles:',
      '        - @bundles.unknown_bundle',
    ].join('\n');

    const diagnostics = lintSource(source);
    const errs = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0].message).toContain('unknown_bundle');
  });

  test('no error when subagent has no bundles field', () => {
    const source = [
      'bundles:',
      '    targeting:',
      '        target: "bundle://targeting"',
      BASE_SUBAGENT,
    ].join('\n');

    const diagnostics = lintSource(source);
    expect(diagnostics.filter(d => d.code === 'undefined-reference')).toEqual(
      []
    );
  });

  test('validates multiple bundle entries within one subagent', () => {
    const source = [
      'bundles:',
      '    targeting:',
      '        target: "bundle://targeting"',
      'subagent worker:',
      '    description: "Executes plan."',
      '    bundles:',
      '        - @bundles.targeting',
      '        - @bundles.nonexistent',
    ].join('\n');

    const diagnostics = lintSource(source);
    const errs = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some(e => e.message.includes('nonexistent'))).toBe(true);
  });

  test('validates multiple subagents independently', () => {
    const source = [
      'bundles:',
      '    targeting:',
      '        target: "bundle://targeting"',
      '    outreach:',
      '        target: "bundle://outreach"',
      'subagent worker_a:',
      '    description: "A"',
      '    bundles:',
      '        - @bundles.targeting',
      'subagent worker_b:',
      '    description: "B"',
      '    bundles:',
      '        - @bundles.bad_ref',
    ].join('\n');

    const diagnostics = lintSource(source);
    const errs = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.some(e => e.message.includes('bad_ref'))).toBe(true);
  });
});
