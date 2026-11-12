/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { LintEngine } from '@agentscript/language';
import {
  RUN_UTILS_CODE,
  SUBAGENT_UNKNOWN_ACTION_CODE,
  runUtilsMessage,
  subagentUnknownActionMessage,
} from '@agentscript/agentscript-dialect';
import { defaultRules } from '../lint/passes/index.js';
import { parseWithDiagnostics, testSchemaCtx } from './test-utils.js';

function runTargetDiagnostics(text: string) {
  const parsed = parseWithDiagnostics(text);
  return new LintEngine({ passes: defaultRules() })
    .run(parsed.value, testSchemaCtx)
    .diagnostics.filter(
      d => d.code === SUBAGENT_UNKNOWN_ACTION_CODE || d.code === RUN_UTILS_CODE
    );
}

const source = (hook: string, reasoningActions: string) => `
config:
    developer_name: "T"
start_agent main:
    description: "Main"
    ${hook}
    reasoning:
        instructions: ->
            | Help.
        actions:
${reasoningActions}
`;

const ESCALATE = `            escalate_to_human: @utils.escalate
                description: "Escalate."`;

describe('run target', () => {
  it.each(['before_reasoning', 'after_reasoning'])(
    'rejects run on an @utils.escalate reasoning action in %s',
    hook => {
      const diagnostics = runTargetDiagnostics(
        source(`${hook}:\n        run @actions.escalate_to_human`, ESCALATE)
      );
      expect(diagnostics.map(d => d.message)).toEqual([
        subagentUnknownActionMessage('escalate_to_human'),
      ]);
    }
  );

  it('rejects run on any reasoning-only key, not just escalate', () => {
    const diagnostics = runTargetDiagnostics(
      source(
        'before_reasoning:\n        run @actions.go_next',
        `            go_next: @utils.transition to @subagent.other\n                description: "Go"`
      )
    );
    expect(diagnostics).toHaveLength(1);
  });

  it('rejects run on a reasoning-only key nested in a reasoning action', () => {
    const diagnostics = runTargetDiagnostics(
      source(
        '',
        `${ESCALATE}
            lookup: @actions.Lookup
                run @actions.escalate_to_human`
      )
    );
    expect(diagnostics.map(d => d.message)).toEqual([
      subagentUnknownActionMessage('escalate_to_human'),
    ]);
  });

  it.each([
    ['escalate', 'escalate'],
    ['transition', 'transition to @subagent.<name>'],
    ['setVariables', 'set @variables.<name> = <value>'],
    ['end_session', 'end_session'],
  ])(
    'rejects run @utils.%s and points to its statement form',
    (member, statement) => {
      const diagnostics = runTargetDiagnostics(
        source(`before_reasoning:\n        run @utils.${member}`, ESCALATE)
      );
      expect(diagnostics.map(d => d.message)).toEqual([
        runUtilsMessage(member),
      ]);
      expect(diagnostics[0].message).toContain(`Use '${statement}' instead.`);
    }
  );

  it('rejects run @utils nested in a reasoning action', () => {
    const diagnostics = runTargetDiagnostics(
      source(
        '',
        `${ESCALATE}
            lookup: @actions.Lookup
                run @utils.escalate`
      )
    );
    expect(diagnostics.map(d => d.code)).toEqual([RUN_UTILS_CODE]);
  });

  it('rejects run on an unknown @utils member', () => {
    const diagnostics = runTargetDiagnostics(
      source('before_reasoning:\n        run @utils.foo', ESCALATE)
    );
    expect(diagnostics.map(d => d.message)).toEqual([
      "'run' cannot target '@utils.foo'. Only '@actions' can be run.",
    ]);
  });

  it('rejects run @utils inside a workflow step', () => {
    const diagnostics = runTargetDiagnostics(`
config:
    developer_name: "T"
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Route.
        actions:
            go_flow: @utils.transition to @workflow.flow
workflow flow:
    description: "Flow"
    step a: ->
        run @utils.escalate
`);
    expect(diagnostics.map(d => d.message)).toEqual([
      runUtilsMessage('escalate'),
    ]);
  });

  it('accepts run on an action defined in the subagent actions', () => {
    const text = `
config:
    developer_name: "T"
start_agent main:
    description: "Main"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
    before_reasoning:
        run @actions.Lookup
    reasoning:
        instructions: ->
            | Help.
        actions:
            lookup: @actions.Lookup
`;
    expect(runTargetDiagnostics(text)).toEqual([]);
  });

  it('accepts run on an inherited agent-level action with a same-named reasoning key', () => {
    const text = `
config:
    developer_name: "T"
    agent_type: "GoalBasedAgent"
actions:
    Log:
        description: "Log"
        target: "flow://Log"
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            | Route.
subagent worker:
    description: "Worker"
    before_reasoning:
        run @actions.Log
    reasoning:
        instructions: ->
            | Help.
        actions:
            Log: @actions.Log
`;
    expect(runTargetDiagnostics(text)).toEqual([]);
  });
});
