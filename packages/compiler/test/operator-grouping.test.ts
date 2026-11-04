/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * End-to-end checks that operator grouping survives the full compile:
 * parse -> compile -> inspect the emitted expression strings.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import {
  RUNTIME_CONDITION_VARIABLE,
  STATE_UPDATE_ACTION,
} from '../src/constants.js';

const HEADER = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    a: mutable boolean = False
    b: mutable boolean = False
    c: mutable boolean = False
    total: mutable number = 0
    amount: mutable number = 0
`;

function compileOutput(body: string) {
  const { output, diagnostics } = compile(parseSource(HEADER + body));
  expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);
  return output;
}

describe('operator grouping end to end', () => {
  it('keeps grouping on arithmetic assigned in a set statement', () => {
    const output = compileOutput(`
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            set @variables.total = (1 + 2) * (3 + 4)
            | Do something
`);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    const updates = (node.before_reasoning_iteration ?? []).flatMap(
      a =>
        (a as { state_updates?: Record<string, string>[] }).state_updates ?? []
    );
    expect(updates).toContainEqual({ total: '(1 + 2) * (3 + 4)' });
  });

  it('keeps grouping under not in an if condition', () => {
    const output = compileOutput(`
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if not (@variables.a and @variables.b):
                set @variables.c = True
            | Do something
`);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    const updates = (node.before_reasoning_iteration ?? []).flatMap(
      a =>
        (a as { state_updates?: Record<string, string>[] }).state_updates ?? []
    );
    expect(
      updates.some(u => Object.values(u).includes('not (state.a and state.b)'))
    ).toBe(true);
  });

  it('keeps grouping in an available when clause', () => {
    const output = compileOutput(`
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | Test
        actions:
            go: @utils.transition to @topic.destination
                available when (@variables.a or @variables.b) and @variables.c

topic destination:
    description: "destination"
`);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    const tool = node.tools.find(t => t.target === STATE_UPDATE_ACTION)!;
    expect(tool.enabled).toBe('(state.a or state.b) and state.c');
  });

  it('keeps grouping inside a template interpolation', () => {
    const output = compileOutput(`
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            | Total {!(@variables.total + 1) * 2}
`);
    expect(JSON.stringify(output)).toContain('{{(state.total + 1) * 2}}');
  });
});

describe('comparison chains end to end', () => {
  /** Compile `if <condition>:` and return the emitted condition expression. */
  function compileCondition(condition: string): string {
    const output = compileOutput(`
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if ${condition}:
                set @variables.c = True
            | Test
`);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;
    const updates = (node.before_reasoning_iteration ?? []).flatMap(
      a =>
        (a as { state_updates?: Record<string, string>[] }).state_updates ?? []
    );
    const slot = `${RUNTIME_CONDITION_VARIABLE}_1`;
    const update = updates.find(u => slot in u);
    expect(update).toBeDefined();
    return update![slot];
  }

  /** Evaluate a compiled expression with Python, the language it runs as. */
  function evaluate(expression: string, state: Record<string, unknown>) {
    const script = [
      'import json, sys, types',
      'state = types.SimpleNamespace(**json.loads(sys.argv[2]))',
      'print(json.dumps(eval(sys.argv[1], {"state": state})))',
    ].join('\n');
    const stdout = execFileSync(
      'python3',
      ['-c', script, expression, JSON.stringify(state)],
      { encoding: 'utf8' }
    );
    return JSON.parse(stdout) as unknown;
  }

  const hasPython = spawnSync('python3', ['--version']).status === 0;

  it('keeps a numeric range guard chained', () => {
    expect(compileCondition('0 < @variables.amount < 10')).toBe(
      '0 < state.amount < 10'
    );
  });

  it('keeps a string chain chained', () => {
    expect(compileCondition('"a" < "b" < "c"')).toBe('"a" < "b" < "c"');
  });

  it('keeps an explicitly grouped comparison grouped', () => {
    expect(compileCondition('(3 > 2) > 1')).toBe('(3 > 2) > 1');
  });

  describe.skipIf(!hasPython)('evaluated as Python', () => {
    it.each([
      [100, false],
      [-5, false],
      [0, false],
      [10, false],
      [5, true],
    ])('a range guard with amount %s is %s', (amount, expected) => {
      const condition = compileCondition('0 < @variables.amount < 10');
      expect(evaluate(condition, { amount })).toBe(expected);
    });

    it('a string chain is True', () => {
      expect(evaluate(compileCondition('"a" < "b" < "c"'), {})).toBe(true);
    });

    it('a grouped comparison compares the inner result', () => {
      expect(evaluate(compileCondition('3 > 2 > 1'), {})).toBe(true);
      expect(evaluate(compileCondition('(3 > 2) > 1'), {})).toBe(false);
    });
  });
});
