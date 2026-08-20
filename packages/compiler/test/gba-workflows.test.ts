/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('GBA workflows compilation', () => {
  it('compiles agent workflow with invocation_target_type and invocation_target_name', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    lead_gen:
        agent: @subagent.worker

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.

subagent worker:
    description: "Worker agent"
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.workflows).toBeDefined();
    expect(result.output.agent_version.workflows).toHaveLength(1);

    const workflow = result.output.agent_version.workflows?.[0];
    expect(workflow?.id).toBe('lead_gen');
    expect(workflow?.invocation_target_type).toBe('agent');
    expect(workflow?.invocation_target_name).toBe('worker');
    expect(workflow?.prompt).toBeUndefined();
  });

  it('compiles prompt workflow with prompt and no target', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    follow_up:
        prompt: "Follow up on customer emails"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Process emails.
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.workflows).toBeDefined();
    expect(result.output.agent_version.workflows).toHaveLength(1);

    const workflow = result.output.agent_version.workflows?.[0];
    expect(workflow?.id).toBe('follow_up');
    expect(workflow?.invocation_target_type).toBe('prompt');
    expect(workflow?.prompt).toBe('Follow up on customer emails');
    expect(workflow?.invocation_target_name).toBeUndefined();
  });

  it('produces error for workflow with empty prompt', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    bad:
        prompt: ""

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Process.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);

    const promptError = errors.find(e =>
      e.message.toLowerCase().includes('prompt')
    );
    expect(promptError).toBeDefined();

    // Workflow with error should be skipped
    const badWorkflow = result.output.agent_version.workflows?.find(
      w => w.id === 'bad'
    );
    expect(badWorkflow).toBeUndefined();
  });

  it('compiles multiple workflows of different types', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    lead_gen:
        agent: @subagent.worker
    follow_up:
        prompt: "Send follow-up"
    nurture:
        prompt: "Nurture leads"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route.

subagent worker:
    description: "Worker"
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.workflows).toBeDefined();
    expect(result.output.agent_version.workflows).toHaveLength(3);

    const leadGen = result.output.agent_version.workflows?.find(
      w => w.id === 'lead_gen'
    );
    expect(leadGen?.invocation_target_type).toBe('agent');
    expect(leadGen?.invocation_target_name).toBe('worker');

    const followUp = result.output.agent_version.workflows?.find(
      w => w.id === 'follow_up'
    );
    expect(followUp?.invocation_target_type).toBe('prompt');
    expect(followUp?.prompt).toBe('Send follow-up');

    const nurture = result.output.agent_version.workflows?.find(
      w => w.id === 'nurture'
    );
    expect(nurture?.invocation_target_type).toBe('prompt');
    expect(nurture?.prompt).toBe('Nurture leads');
  });
});
