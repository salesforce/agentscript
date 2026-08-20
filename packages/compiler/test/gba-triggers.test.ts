/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('GBA triggers compilation', () => {
  it('compiles workflow trigger with invocation_target_type and target', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    lead_gen:
        prompt: "Generate leads"

trigger:
    daily:
        schedule: "0 7 * * *"
        target: @workflows.lead_gen

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route.
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.triggers).toBeDefined();
    expect(result.output.agent_version.triggers).toHaveLength(1);

    const trigger = result.output.agent_version.triggers?.[0];
    expect(trigger?.id).toBe('daily');
    expect(trigger?.schedule).toBe('0 7 * * *');
    expect(trigger?.invocation_target_type).toBe('workflow');
    expect(trigger?.invocation_target_name).toBe('lead_gen');
  });

  it('compiles bundle workflow trigger with full path', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    targeting:
        target: "bundle://targeting"

trigger:
    every_5:
        schedule: "*/5 * * * *"
        target: @bundles.targeting.workflows.check

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Check status.
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.triggers).toBeDefined();
    expect(result.output.agent_version.triggers).toHaveLength(1);

    const trigger = result.output.agent_version.triggers?.[0];
    expect(trigger?.id).toBe('every_5');
    expect(trigger?.schedule).toBe('*/5 * * * *');
    expect(trigger?.invocation_target_type).toBe('workflow');
    expect(trigger?.invocation_target_name).toBe(
      'bundles.targeting.workflows.check'
    );
  });

  it('compiles subagent trigger with agent invocation_target_type', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

trigger:
    hourly:
        schedule: "0 * * * *"
        target: @subagent.worker

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Delegate.

subagent worker:
    description: "Worker agent"
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.triggers).toBeDefined();
    expect(result.output.agent_version.triggers).toHaveLength(1);

    const trigger = result.output.agent_version.triggers?.[0];
    expect(trigger?.id).toBe('hourly');
    expect(trigger?.schedule).toBe('0 * * * *');
    expect(trigger?.invocation_target_type).toBe('agent');
    expect(trigger?.invocation_target_name).toBe('worker');
  });

  it('compiles multiple triggers with different schedules and targets', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    lead_gen:
        prompt: "Generate"
    follow_up:
        prompt: "Follow up"

trigger:
    every_5:
        schedule: "*/5 * * * *"
        target: @workflows.lead_gen
    daily:
        schedule: "0 7 * * *"
        target: @workflows.follow_up
    weekly:
        schedule: "0 9 * * 1"
        target: @subagent.worker

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route.

subagent worker:
    description: "Worker"
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.triggers).toBeDefined();
    expect(result.output.agent_version.triggers).toHaveLength(3);

    const every5 = result.output.agent_version.triggers?.find(
      t => t.id === 'every_5'
    );
    expect(every5?.schedule).toBe('*/5 * * * *');
    expect(every5?.invocation_target_type).toBe('workflow');
    expect(every5?.invocation_target_name).toBe('lead_gen');

    const daily = result.output.agent_version.triggers?.find(
      t => t.id === 'daily'
    );
    expect(daily?.schedule).toBe('0 7 * * *');
    expect(daily?.invocation_target_type).toBe('workflow');
    expect(daily?.invocation_target_name).toBe('follow_up');

    const weekly = result.output.agent_version.triggers?.find(
      t => t.id === 'weekly'
    );
    expect(weekly?.schedule).toBe('0 9 * * 1');
    expect(weekly?.invocation_target_type).toBe('agent');
    expect(weekly?.invocation_target_name).toBe('worker');
  });
});
