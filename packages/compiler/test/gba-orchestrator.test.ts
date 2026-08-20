/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Compiler tests for the GBA orchestrator block — verifying that
 * `orchestrator <name>:` compiles to an OrchestratorNode in the AgentJSON output.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, checkSchemaConformance } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

function compileOrchestrator(source: string) {
  const { output, diagnostics } = compile(parseSource(source));
  const errors = diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  return { agentVersion: output.agent_version, errors };
}

describe('GBA orchestrator block compilation', () => {
  it('compiles a bare orchestrator block', () => {
    const { agentVersion, errors } = compileOrchestrator(`
system:
    instructions: |
        A goal-based agent.
    messages:
        welcome: "Hello!"
        error: "Error."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
orchestrator agent:
    reasoning:
        instructions: ->
            | Determine user intent.
`);
    expect(errors).toHaveLength(0);
    expect(agentVersion.initial_node).toBe('agent');
    const orch = agentVersion.nodes.find(n => n.type === 'orchestrator');
    expect(orch).toBeDefined();
    expect(orch!.developer_name).toBe('agent');
    expect(orch!.instructions).toContain('Determine user intent');
    expect(checkSchemaConformance(agentVersion)).toEqual([]);
  });

  it('compiles orchestrator with top-level action_definitions', () => {
    const { agentVersion, errors } = compileOrchestrator(`
system:
    instructions: "A GBA."
    messages:
        welcome: "Hi!"
        error: "Err."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
orchestrator agent:
    actions:
        lookup:
            description: "Look up data"
            target: "flow://Lookup"
`);
    expect(errors).toHaveLength(0);
    const orch = agentVersion.nodes.find(n => n.type === 'orchestrator');
    expect(orch).toBeDefined();
    expect(orch!.action_definitions).toHaveLength(1);
    expect(orch!.action_definitions![0].developer_name).toBe('lookup');
    expect(checkSchemaConformance(agentVersion)).toEqual([]);
  });

  it('compiles orchestrator with reasoning tools', () => {
    const { agentVersion, errors } = compileOrchestrator(`
system:
    instructions: "A GBA."
    messages:
        welcome: "Hi!"
        error: "Err."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
orchestrator agent:
    reasoning:
        instructions: ->
            | You are a helpful agent.
        actions:
            lookup:
                description: "Look up data"
`);
    expect(errors).toHaveLength(0);
    const orch = agentVersion.nodes.find(n => n.type === 'orchestrator');
    expect(orch).toBeDefined();
    expect(orch!.tools).toHaveLength(1);
    expect(orch!.tools![0]).toMatchObject({ name: 'lookup', type: 'action' });
    expect(checkSchemaConformance(agentVersion)).toEqual([]);
  });

  it('errors when reasoning.instructions contains procedural statements', () => {
    const { errors } = compileOrchestrator(`
system:
    instructions: "A GBA."
    messages:
        welcome: "Hi!"
        error: "Err."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
orchestrator agent:
    reasoning:
        instructions: ->
            | You are a sales agent.
            if @variables.ready is True:
                run @actions.lookup
            | Help the user with queries.
        actions:
            lookup:
                description: "Look up data"
`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Procedural statements');
  });

  it('errors when more than one orchestrator block is declared', () => {
    const { errors } = compileOrchestrator(`
system:
    instructions: "A GBA."
    messages:
        welcome: "Hi!"
        error: "Err."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
orchestrator main:
    reasoning:
        instructions: ->
            | First orchestrator.
orchestrator secondary:
    reasoning:
        instructions: ->
            | Second orchestrator.
`);
    expect(errors.some(e => e.message.includes('one orchestrator block'))).toBe(
      true
    );
    const orchNodes = errors; // there should be exactly one cardinality error
    expect(orchNodes.length).toBeGreaterThanOrEqual(1);
  });

  it('errors when reasoning.actions references a connected agent', () => {
    const { errors } = compileOrchestrator(`
system:
    instructions: "A GBA."
    messages:
        welcome: "Hi!"
        error: "Err."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
connected_subagent researcher:
    target: "agent://Researcher"
    description: "Researches accounts."
orchestrator agent:
    reasoning:
        instructions: ->
            | Orchestrate work.
        actions:
            delegate: @connected_subagent.researcher
`);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('connected agents');
  });

  it('sets initial_node to the orchestrator developer name', () => {
    const { agentVersion, errors } = compileOrchestrator(`
system:
    instructions: "A GBA."
    messages:
        welcome: "Hi!"
        error: "Err."
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
orchestrator main_orchestrator:
    reasoning:
        instructions: ->
            | Act.
`);
    expect(errors).toHaveLength(0);
    expect(agentVersion.initial_node).toBe('main_orchestrator');
  });
});
