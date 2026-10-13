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

  it('compiles a workflow reference to invocation_target_type "workflow" with the prefix stripped', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    stored:
        target: "workflow://account_summary"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    const workflow = result.output.agent_version.workflows?.find(
      w => w.id === 'stored'
    );
    expect(workflow?.invocation_target_type).toBe('workflow');
    expect(workflow?.invocation_target_name).toBe('account_summary');
    expect(workflow?.prompt).toBeUndefined();
  });

  it('produces an error for a workflow target with an unsupported scheme', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    stored:
        target: "bundle://account_summary"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.message.toLowerCase().includes('scheme'))).toBe(
      true
    );

    const stored = result.output.agent_version.workflows?.find(
      w => w.id === 'stored'
    );
    expect(stored).toBeUndefined();
  });

  it('produces an error for a workflow target with an empty name after the scheme', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    stored:
        target: "workflow://"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);

    // The empty invocation_target_name must never be emitted.
    const stored = result.output.agent_version.workflows?.find(
      w => w.id === 'stored'
    );
    expect(stored).toBeUndefined();
  });

  it('produces an error for a workflow target with no URI scheme separator', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    stored:
        target: "account_summary"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);

    const stored = result.output.agent_version.workflows?.find(
      w => w.id === 'stored'
    );
    expect(stored).toBeUndefined();
  });

  it('produces an error when a workflow combines target with agent', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    conflicted:
        target: "workflow://account_summary"
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

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);

    const conflicted = result.output.agent_version.workflows?.find(
      w => w.id === 'conflicted'
    );
    expect(conflicted).toBeUndefined();
  });

  it('produces an error when a workflow combines target with prompt', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    conflicted:
        target: "workflow://account_summary"
        prompt: "Summarize the account"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);

    const conflicted = result.output.agent_version.workflows?.find(
      w => w.id === 'conflicted'
    );
    expect(conflicted).toBeUndefined();
  });

  it('produces an error for a workflow that sets none of target, agent, or prompt', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

workflows:
    empty:
        description: "no invocation target"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route request.
`;

    const result = compile(parseSource(source));

    const errors = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors.length).toBeGreaterThan(0);

    const empty = result.output.agent_version.workflows?.find(
      w => w.id === 'empty'
    );
    expect(empty).toBeUndefined();
  });
});
