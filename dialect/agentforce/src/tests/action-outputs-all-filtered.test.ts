/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the `action-outputs-all-filtered` lint rule: warns when every
 * output of a planner-exposed action is hidden from the agent, so the LLM
 * sees the call but gets an empty result.
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  return engine.run(ast, testSchemaCtx).diagnostics;
}

/**
 * Wrap a single action's `outputs:` block in a minimal subagent shell. The
 * action is exposed to the planner via `reasoning.actions` (`do_a: @actions.A`)
 * so the rule's planner-exposure gate doesn't suppress these cases.
 */
const wrap = (outputs: string): string => `
subagent S:
  description: "S"
  actions:
    A:
      description: "A"
      outputs:
${outputs}
      target: "flow://A"
  reasoning:
    instructions: ->
      |Do it
    actions:
      do_a: @actions.A
`;

function filteredWarnings(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.code === 'action-outputs-all-filtered');
}

describe('action-outputs-all-filtered rule', () => {
  it('warns when every output has filter_from_agent: True', () => {
    const diagnostics = runLint(
      wrap(
        `        status: string\n` +
          `          filter_from_agent: True\n` +
          `        order_id: string\n` +
          `          filter_from_agent: True\n`
      )
    );
    const warnings = filteredWarnings(diagnostics);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(warnings[0].message).toContain("'A'");
  });

  it('does not warn when one output is True and another is False', () => {
    const diagnostics = runLint(
      wrap(
        `        status: string\n` +
          `          filter_from_agent: True\n` +
          `        summary: string\n` +
          `          filter_from_agent: False\n`
      )
    );
    expect(filteredWarnings(diagnostics)).toHaveLength(0);
  });

  it('does not warn when one output is True and another omits the flag', () => {
    const diagnostics = runLint(
      wrap(
        `        status: string\n` +
          `          filter_from_agent: True\n` +
          `        summary: string\n` +
          `          description: "A visible summary"\n`
      )
    );
    expect(filteredWarnings(diagnostics)).toHaveLength(0);
  });

  it('warns for a single output with filter_from_agent: True', () => {
    const diagnostics = runLint(
      wrap(`        status: string\n` + `          filter_from_agent: True\n`)
    );
    const warnings = filteredWarnings(diagnostics);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it('does not warn when all outputs omit filter_from_agent (default visible)', () => {
    const diagnostics = runLint(
      wrap(
        `        status: string\n` +
          `          description: "Status"\n` +
          `        order_id: string\n` +
          `          description: "Order id"\n`
      )
    );
    expect(filteredWarnings(diagnostics)).toHaveLength(0);
  });

  it('does not fire for an action with no outputs block', () => {
    const source = `
subagent S:
  description: "S"
  actions:
    A:
      description: "A"
      target: "flow://A"
  reasoning:
    instructions: ->
      |Do it
    actions:
      do_a: @actions.A
`;
    expect(filteredWarnings(runLint(source))).toHaveLength(0);
  });

  it('warns when filter_from_agent: True is combined with is_displayable: True', () => {
    // is_displayable only controls whether a human sees the output via a
    // custom renderer; the planner still never sees it, so the rule must
    // keep warning even though a human-facing surface shows the value.
    const diagnostics = runLint(
      wrap(
        `        status: string\n` +
          `          filter_from_agent: True\n` +
          `          is_displayable: True\n`
      )
    );
    expect(filteredWarnings(diagnostics)).toHaveLength(1);
  });

  describe('is_used_by_planner interplay (mirrors compiler precedence)', () => {
    it('warns when the sole output sets is_used_by_planner: False without filter_from_agent', () => {
      const diagnostics = runLint(
        wrap(
          `        status: string\n` + `          is_used_by_planner: False\n`
        )
      );
      expect(filteredWarnings(diagnostics)).toHaveLength(1);
    });

    it('warns when filter_from_agent: False is combined with is_used_by_planner: False', () => {
      // The compiler only treats `is_used_by_planner` as authoritative when
      // `filter_from_agent` is not True; here filter_from_agent is explicitly
      // False, so the explicit is_used_by_planner: False still hides the output.
      const diagnostics = runLint(
        wrap(
          `        status: string\n` +
            `          filter_from_agent: False\n` +
            `          is_used_by_planner: False\n`
        )
      );
      expect(filteredWarnings(diagnostics)).toHaveLength(1);
    });

    it('still warns when filter_from_agent: True overrides an explicit is_used_by_planner: True', () => {
      // filter_from_agent takes precedence over is_used_by_planner in the
      // compiler (compileOutputParameter) — True always forces the output
      // hidden regardless of what is_used_by_planner says.
      const diagnostics = runLint(
        wrap(
          `        status: string\n` +
            `          filter_from_agent: True\n` +
            `          is_used_by_planner: True\n`
        )
      );
      expect(filteredWarnings(diagnostics)).toHaveLength(1);
    });

    it('does not warn when one output is hidden via is_used_by_planner: False and another is left visible', () => {
      const diagnostics = runLint(
        wrap(
          `        status: string\n` +
            `          is_used_by_planner: False\n` +
            `        summary: string\n` +
            `          description: "A visible summary"\n`
        )
      );
      expect(filteredWarnings(diagnostics)).toHaveLength(0);
    });
  });

  describe('planner-exposure gating', () => {
    it('does not warn for a run-only action captured via before_reasoning set, never exposed as a tool', () => {
      const source = `
subagent S:
  description: "S"
  actions:
    A:
      description: "A"
      outputs:
        status: string
          filter_from_agent: True
        detail: string
          filter_from_agent: True
      target: "flow://A"
  before_reasoning:
    run @actions.A
      set @variables.status = @outputs.status
  reasoning:
    instructions: ->
      |Do it
`;
      expect(filteredWarnings(runLint(source))).toHaveLength(0);
    });

    it('warns when the same action is both run deterministically and exposed via reasoning.actions', () => {
      const source = `
subagent S:
  description: "S"
  actions:
    A:
      description: "A"
      outputs:
        status: string
          filter_from_agent: True
        detail: string
          filter_from_agent: True
      target: "flow://A"
  before_reasoning:
    run @actions.A
      set @variables.status = @outputs.status
  reasoning:
    instructions: ->
      |Do it
    actions:
      do_a: @actions.A
`;
      expect(filteredWarnings(runLint(source))).toHaveLength(1);
    });
  });

  describe('orchestrator coverage', () => {
    it('warns for an orchestrator action exposed to the planner with every output filtered', () => {
      const source = `
orchestrator agent:
  description: "agent"
  actions:
    A:
      description: "A"
      outputs:
        status: string
          filter_from_agent: True
      target: "flow://A"
  reasoning:
    instructions: ->
      |Do it
    actions:
      do_a: @actions.A
`;
      expect(filteredWarnings(runLint(source))).toHaveLength(1);
    });

    it('does not warn for an orchestrator action that is never exposed via reasoning.actions', () => {
      const source = `
orchestrator agent:
  description: "agent"
  actions:
    A:
      description: "A"
      outputs:
        status: string
          filter_from_agent: True
      target: "flow://A"
  reasoning:
    instructions: ->
      |Do it
`;
      expect(filteredWarnings(runLint(source))).toHaveLength(0);
    });
  });

  describe('workflow coverage', () => {
    const workflow = (body: string): string => `
workflow W:
  description: "W"
  actions:
    A:
      description: "A"
      outputs:
        status: string
          filter_from_agent: True
      target: "flow://A"
${body}
`;

    it('warns for a workflow action exposed as a tool in a step directive', () => {
      const source = workflow(`  step collect: ->
    | Call {!@actions.A} to look up the order.`);
      const warnings = filteredWarnings(runLint(source));
      expect(warnings).toHaveLength(1);
      expect(warnings[0].message).toContain("'A'");
    });

    it('warns for a workflow action exposed as a tool in unnamed steps', () => {
      const source = workflow(`  steps: ->
    | Call {!@actions.A} to look up the order.`);
      expect(filteredWarnings(runLint(source))).toHaveLength(1);
    });

    it('does not warn for a workflow action that is only run deterministically', () => {
      const source = workflow(`  steps: ->
    run @actions.A
      set @variables.status = @outputs.status`);
      expect(filteredWarnings(runLint(source))).toHaveLength(0);
    });
  });

  it('anchors the warning on the outputs block', () => {
    const source = wrap(
      `        status: string\n` +
        `          filter_from_agent: True\n` +
        `        order_id: string\n` +
        `          filter_from_agent: True\n`
    );
    const [warning] = filteredWarnings(runLint(source));
    const lines = source.split('\n');
    const firstOutputLine = lines.indexOf('        status: string');
    const lastOutputLine = lines.lastIndexOf(
      '          filter_from_agent: True'
    );

    // The range covers the output declarations, not the whole action (its
    // `description:` above or `target:` below).
    expect(warning.range.start.line).toBe(firstOutputLine);
    expect(warning.range.end.line).toBe(lastOutputLine);
  });
});
