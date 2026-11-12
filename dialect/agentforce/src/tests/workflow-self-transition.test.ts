/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function selfTransitionDiagnostics(source: string) {
  const ast = parseDocument(source);
  const { diagnostics } = new LintEngine({ passes: defaultRules() }).run(
    ast,
    testSchemaCtx
  );
  return diagnostics.filter(d => d.code === 'workflow-self-transition');
}

describe('workflow self transition', () => {
  it('warns on a transition to the enclosing workflow in steps', () => {
    const diagnostics = selfTransitionDiagnostics(`
workflow lookup:
  description: "Look something up"
  steps: ->
    say "Hello"
    transition to @workflow.lookup
`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostics[0].message).toBe(
      "Workflow 'lookup' transitions to itself, which can cause an infinite loop."
    );
    // Anchored to the `@workflow.lookup` target, not the whole statement.
    expect(diagnostics[0].range.start.line).toBe(5);
    expect(diagnostics[0].range.end.line).toBe(5);
  });

  it('warns on a self transition nested in a conditional', () => {
    const diagnostics = selfTransitionDiagnostics(`
workflow lookup:
  description: "Look something up"
  steps: ->
    if @variables.retry:
      transition to @workflow.lookup
`);
    expect(diagnostics).toHaveLength(1);
  });

  it('warns on a self transition inside a named step', () => {
    const diagnostics = selfTransitionDiagnostics(`
workflow lookup:
  description: "Look something up"
  step first:
    transition to @workflow.lookup
`);
    expect(diagnostics).toHaveLength(1);
  });

  it('does not warn on a transition to a different workflow', () => {
    const diagnostics = selfTransitionDiagnostics(`
workflow lookup:
  description: "Look something up"
  steps: ->
    transition to @workflow.refund

workflow refund:
  description: "Issue a refund"
  steps: ->
    say "Refunding"
`);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn on a transition to a subagent sharing the name', () => {
    const diagnostics = selfTransitionDiagnostics(`
workflow lookup:
  description: "Look something up"
  steps: ->
    transition to @subagent.lookup
`);
    expect(diagnostics).toHaveLength(0);
  });
});
