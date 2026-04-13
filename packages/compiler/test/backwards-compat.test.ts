/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests verifying that topic and subagent blocks both use `actions`
 * for action definitions and `reasoning.actions` for reasoning tools.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { STATE_UPDATE_ACTION } from '../src/constants.js';

describe('actions field consistency', () => {
  it('compiles actions and reasoning.actions for a basic topic', () => {
    const source = `
config:
  agent_name: "Test"

start_agent main:
  description: "Main topic"
  actions:
    fetch:
      description: "Fetch data"
      target: "flow://Fetch"
      inputs:
        id: string
  reasoning:
    instructions: ->
      | Use the fetch action when needed
    actions:
      do_fetch: @actions.fetch
        with id="123"
`;

    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0];

    expect(node.action_definitions.length).toBe(1);
    expect(node.action_definitions[0].developer_name).toBe('fetch');
  });

  it('compiles multiple action definitions', () => {
    const source = `
config:
  agent_name: "Test"

start_agent main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
      inputs:
        id: string
    update:
      description: "Update"
      target: "flow://Update"
      inputs:
        data: string
  reasoning:
    instructions: ->
      | Test
`;

    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0];

    expect(node.action_definitions.length).toBe(2);
  });
});

describe('reasoning actions', () => {
  it('compiles reasoning actions referencing action definitions', () => {
    const source = `
config:
  agent_name: "Test"

variables:
  data: mutable string = ""

start_agent main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
      inputs:
        id: string
  reasoning:
    instructions: ->
      | Test instructions
    actions:
      call_fetch: @actions.fetch
        with id="123"
      set_data:
        label: "Set data"
        run:
          set @variables.data = "test"
`;

    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0];

    // Check supervised actions (reasoning actions)
    const actionTools = node.tools.filter(
      t => t.target !== STATE_UPDATE_ACTION
    );

    expect(actionTools.length).toBeGreaterThan(0);
  });

  it('topic and subagent produce equivalent output for transition tools', () => {
    const topicSource = `
config:
  agent_name: "Test"

topic first:
  description: "First topic"
  reasoning:
    instructions: ->
      | Start here
    actions:
      go_to_second:
        label: "Go to second"
        run:
          to @topic.second

topic second:
  description: "Second topic"
  reasoning:
    instructions: ->
      | End here
`;

    const subagentSource = `
config:
  agent_name: "Test"

subagent first:
  description: "First topic"
  reasoning:
    instructions: ->
      | Start here
    actions:
      go_to_second:
        label: "Go to second"
        run:
          to @subagent.second

subagent second:
  description: "Second topic"
  reasoning:
    instructions: ->
      | End here
`;

    const topicOutput = compile(parseSource(topicSource)).output;
    const subagentOutput = compile(parseSource(subagentSource)).output;

    // Both produce the same node structure
    expect(topicOutput.agent_version.nodes.length).toBe(
      subagentOutput.agent_version.nodes.length
    );

    const topicFirstNode = topicOutput.agent_version.nodes.find(
      n => n.developer_name === 'first'
    )!;
    const subagentFirstNode = subagentOutput.agent_version.nodes.find(
      n => n.developer_name === 'first'
    )!;

    expect(topicFirstNode.tools.length).toBe(subagentFirstNode.tools.length);
  });
});

describe('mixed scenarios', () => {
  it('compiles actions and reasoning actions together', () => {
    const source = `
config:
  agent_name: "Test"

variables:
  status: mutable string = ""

start_agent main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
      inputs:
        id: string
    update:
      description: "Update"
      target: "flow://Update"
  reasoning:
    instructions: ->
      | Test
    actions:
      do_fetch: @actions.fetch
        with id="123"
      do_update: @actions.update
      set_status:
        run:
          set @variables.status = "done"
`;

    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0];

    // Check action definitions
    expect(node.action_definitions.length).toBe(2);

    // Check tools
    expect(node.tools.length).toBeGreaterThan(0);
  });

  it('handles documents with co-existing topic and subagent blocks', () => {
    const source = `
config:
  agent_name: "Test"

topic first:
  description: "First"
  actions:
    first_action:
      description: "First action"
      target: "flow://First"
  reasoning:
    instructions: ->
      | First topic
    actions:
      use_first: @actions.first_action

subagent second:
  description: "Second"
  actions:
    second_action:
      description: "Second action"
      target: "flow://Second"
  reasoning:
    instructions: ->
      | Second topic
    actions:
      use_second: @actions.second_action
`;

    const { output } = compile(parseSource(source));

    const firstNode = output.agent_version.nodes.find(
      n => n.developer_name === 'first'
    )!;
    const secondNode = output.agent_version.nodes.find(
      n => n.developer_name === 'second'
    )!;

    expect(firstNode.action_definitions.length).toBe(1);
    expect(firstNode.action_definitions[0].developer_name).toBe('first_action');

    expect(secondNode.action_definitions.length).toBe(1);
    expect(secondNode.action_definitions[0].developer_name).toBe(
      'second_action'
    );
  });
});

describe('router nodes with actions', () => {
  it('produces output for router with actions', () => {
    const source = `
config:
  agent_name: "Test"

topic router:
  description: "Router"
  model_config:
    model: "model://hyperclassifier"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Route to topics
    actions:
      go_first:
        label: "First"
        run:
          to @topic.first

topic first:
  description: "First topic"
  reasoning:
    instructions: ->
      | Handle first
`;

    const { output } = compile(parseSource(source));

    const router = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(router.action_definitions.length).toBe(1);
    expect(router.tools.length).toBeGreaterThan(0);
  });
});
