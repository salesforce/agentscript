/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import type { CompileOptions } from '../src/compile.js';
import {
  AGENT_INSTRUCTIONS_VARIABLE,
  RUNTIME_CONDITION_VARIABLE,
  SYSTEM_INSTRUCTIONS_VARIABLE,
} from '../src/constants.js';
import { instructionAppendValue } from '../src/nodes/optimize-actions.js';
import type { Action } from '../src/types.js';
import { parseSource } from './test-utils.js';

const CONDITION_SLOT = `${RUNTIME_CONDITION_VARIABLE}_1`;

// These tests are about conditional system-instruction LOWERING, not about
// the directive-action optimizer, so they compile with `optimize: false` and
// assert the stable pre-optimization shape (separate standalone per-turn
// reset, one append envelope per branch, condition-slot evaluation as its own
// action). That keeps them from churning whenever optimization policy changes.
function findNode(source: string, name: string, options?: CompileOptions) {
  const result = compile(parseSource(source), options);
  const node = result.output.agent_version.nodes.find(
    candidate => candidate.developer_name === name
  );
  expect(node).toBeDefined();
  return { result, node: node! };
}

function stateUpdate(action: Action, name: string): string | undefined {
  return action.state_updates?.find(update => name in update)?.[name];
}

describe('conditional system instructions', () => {
  it('lowers modality branches into per-iteration system instruction updates', () => {
    const { result, node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: ->
        | Always identify the customer need.
        if @system_variables.current_modality == "voice":
            | Keep responses concise.
        else:
            | Provide detailed guidance.

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(result.diagnostics).toEqual([]);
    expect(node.instructions).toBe(`{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`);
    const actions = node.before_reasoning_iteration as Action[];
    // Unoptimized shape: standalone per-turn reset (no fold), one append
    // envelope per statement/branch, condition-slot evaluation as its own
    // action — five actions total, none fused.
    expect(actions).toHaveLength(5);
    expect(actions[0].enabled).toBe('True');
    expect(stateUpdate(actions[0], SYSTEM_INSTRUCTIONS_VARIABLE)).toBe("''");
    expect(actions[1].enabled).toBeUndefined();
    expect(stateUpdate(actions[1], SYSTEM_INSTRUCTIONS_VARIABLE)).toBe(
      instructionAppendValue(
        SYSTEM_INSTRUCTIONS_VARIABLE,
        'Always identify the customer need.'
      )
    );
    expect(actions[2].enabled).toBe('True');
    expect(stateUpdate(actions[2], CONDITION_SLOT)).toBe(
      'system.current_modality == "voice"'
    );

    const voice = actions.find(action =>
      stateUpdate(action, SYSTEM_INSTRUCTIONS_VARIABLE)?.includes(
        'Keep responses concise.'
      )
    );
    const fallback = actions.find(action =>
      stateUpdate(action, SYSTEM_INSTRUCTIONS_VARIABLE)?.includes(
        'Provide detailed guidance.'
      )
    );
    expect(voice?.enabled).toBe(`state.${CONDITION_SLOT}`);
    expect(fallback?.enabled).toBe(`not (state.${CONDITION_SLOT})`);
    expect(
      result.output.agent_version.state_variables.some(
        variable => variable.developer_name === SYSTEM_INSTRUCTIONS_VARIABLE
      )
    ).toBe(true);
  });

  it('keeps dynamic system and reasoning instructions in separate variables', () => {
    const { node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: ->
        if @system_variables.current_connection == "slack":
            | Use Slack formatting.
        else:
            | Use standard formatting.

start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            if @system_variables.current_modality == "voice":
                | Solve concisely.
            else:
                | Solve in detail.
`,
      'main',
      { optimize: false }
    );

    expect(node.instructions).toBe(`{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`);
    expect(node.focus_prompt).toBe(`{{state.${AGENT_INSTRUCTIONS_VARIABLE}}}`);
    const actions = node.before_reasoning_iteration as Action[];
    expect(
      actions.some(action => stateUpdate(action, SYSTEM_INSTRUCTIONS_VARIABLE))
    ).toBe(true);
    expect(
      actions.some(action => stateUpdate(action, AGENT_INSTRUCTIONS_VARIABLE))
    ).toBe(true);
    expect(
      actions.filter(action => stateUpdate(action, CONDITION_SLOT)).length
    ).toBe(2);
  });

  it('preserves static output without declaring dynamic system state', () => {
    const { result, node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: "Static guidance"

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(node.instructions).toBe('Static guidance');
    expect(
      result.output.agent_version.state_variables.some(
        variable => variable.developer_name === SYSTEM_INSTRUCTIONS_VARIABLE
      )
    ).toBe(false);
  });

  it('preserves a same-named user variable when system instructions are static', () => {
    const { result } = findNode(
      `config:
    agent_name: "TestBot"

variables:
    ${SYSTEM_INSTRUCTIONS_VARIABLE}: mutable number = 7

system:
    instructions: "Static guidance"

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(result.diagnostics).toEqual([]);
    expect(
      result.output.agent_version.state_variables.filter(
        variable => variable.developer_name === SYSTEM_INSTRUCTIONS_VARIABLE
      )
    ).toEqual([
      expect.objectContaining({
        data_type: 'number',
        default: 7,
      }),
    ]);
  });

  it('reports a user-variable collision only when dynamic system instructions need the name', () => {
    const { result } = findNode(
      `config:
    agent_name: "TestBot"

variables:
    ${SYSTEM_INSTRUCTIONS_VARIABLE}: mutable number = 7

system:
    instructions: ->
        if @system_variables.current_modality == "voice":
            | Use voice guidance.
        else:
            | Use text guidance.

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'dynamic-system-instructions-variable-conflict',
      })
    );
    expect(
      result.output.agent_version.state_variables.filter(
        variable => variable.developer_name === SYSTEM_INSTRUCTIONS_VARIABLE
      )
    ).toEqual([
      expect.objectContaining({
        data_type: 'string',
        default: "''",
      }),
    ]);
  });

  it('preserves inline ternaries in the existing template form', () => {
    const { result, node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: |
        {! "Voice guidance" if @system_variables.current_modality == "voice" else "Text guidance" }

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(result.diagnostics).toEqual([]);
    expect(node.instructions).toBe(
      '{{"Voice guidance" if system.current_modality == "voice" else "Text guidance"}}'
    );
    expect(node.before_reasoning_iteration).toBeUndefined();
  });

  it('supports dynamic system instructions on router nodes', () => {
    const { node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: ->
        if @system_variables.current_connection == "messaging":
            | Route messaging requests.
        else:
            | Route other requests.

start_agent router:
    description: "Router"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
`,
      'router',
      { optimize: false }
    );

    expect(node.type).toBe('router');
    expect(node.instructions).toBe(`{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`);
    const actions = node.before_reasoning_iteration as Action[];
    // Unoptimized shape: standalone reset (there is no leading append for it
    // to fold into — the `if` is the first statement), condition-slot
    // evaluation, then one append per branch — four actions, none fused.
    expect(actions).toHaveLength(4);
    expect(actions[0].enabled).toBe('True');
    expect(stateUpdate(actions[0], SYSTEM_INSTRUCTIONS_VARIABLE)).toBe("''");
    expect(stateUpdate(actions[1], CONDITION_SLOT)).toBe(
      'system.current_connection == "messaging"'
    );
  });

  it('supports else-if chains and topic-level overrides', () => {
    const { result, node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: "Global guidance"

start_agent main:
    description: "Main"
    system:
        instructions: ->
            if @system_variables.current_modality == "voice":
                | Use voice guidance.
            else if @system_variables.current_connection == "slack":
                | Use Slack guidance.
            else:
                | Use fallback guidance.
`,
      'main',
      { optimize: false }
    );

    expect(node.instructions).toBe(`{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`);
    expect(node.instructions).not.toContain('Global guidance');
    expect(
      result.output.agent_version.state_variables.map(
        variable => variable.developer_name
      )
    ).toEqual(
      expect.arrayContaining([
        `${RUNTIME_CONDITION_VARIABLE}_1`,
        `${RUNTIME_CONDITION_VARIABLE}_2`,
      ])
    );
    expect(JSON.stringify(node.before_reasoning_iteration)).toContain(
      'system.current_connection == \\"slack\\"'
    );
  });

  it('compiles static router system-variable interpolation', () => {
    const { node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: |
        Modality: {!@system_variables.current_modality}
        Connection: {!@system_variables.current_connection}

start_agent router:
    description: "Router"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
`,
      'router',
      { optimize: false }
    );

    expect(node.instructions).toBe(
      'Modality: {{system.current_modality}}\nConnection: {{system.current_connection}}'
    );
  });

  it('reports unsupported statements without emitting side effects', () => {
    const { result, node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: ->
        run @actions.lookup

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported-system-instruction-statement',
      })
    );
    expect(node.before_reasoning_iteration).toBeUndefined();
  });

  it('rejects nested conditionals instead of emitting corrupted branches', () => {
    const { result, node } = findNode(
      `config:
    agent_name: "TestBot"

system:
    instructions: ->
        if @system_variables.current_modality == "voice":
            if @system_variables.current_connection == "slack":
                | Use concise Slack guidance.
            else:
                | Use concise voice guidance.
        else:
            | Use text guidance.

start_agent main:
    description: "Main"
`,
      'main',
      { optimize: false }
    );

    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'unsupported-nested-if' })
    );
    expect(node.instructions).toBe('');
    expect(node.before_reasoning_iteration).toBeUndefined();
  });
});
