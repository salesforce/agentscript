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
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { STATE_UPDATE_ACTION } from '../src/constants.js';

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
