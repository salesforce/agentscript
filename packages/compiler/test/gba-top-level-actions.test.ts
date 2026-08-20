/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, checkSchemaConformance } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('GBA: Top-level actions inheritance', () => {
  const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

actions:
    log_activity:
        description: "Log activity to Salesforce"
        target: "flow://LogActivity"
    query_crm:
        description: "Query CRM"
        target: "apex://CRMController.query"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | Route.

subagent worker:
    description: "Worker"
`;

  it('injects top-level actions into regular subagents but not start_agent', () => {
    const { output, diagnostics } = compile(parseSource(source));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    const nodes = output.agent_version.nodes;
    expect(nodes).toHaveLength(2);

    const mainNode = nodes.find(n => n.developer_name === 'main');
    const workerNode = nodes.find(n => n.developer_name === 'worker');
    expect(mainNode).toBeDefined();
    expect(workerNode).toBeDefined();

    // start_agent (router) node does NOT receive top-level actions.
    expect(mainNode!.action_definitions ?? []).toHaveLength(0);
    expect(
      (mainNode!.tools ?? []).filter(t => t.type === 'action')
    ).toHaveLength(0);

    // Regular subagent node DOES receive top-level actions.
    const workerActionNames = (workerNode!.action_definitions ?? []).map(
      a => a.developer_name
    );
    expect(workerActionNames).toContain('log_activity');
    expect(workerActionNames).toContain('query_crm');
  });

  it('creates tools with correct shape including name field on regular subagents', () => {
    const { output } = compile(parseSource(source));
    const workerNode = output.agent_version.nodes.find(
      n => n.developer_name === 'worker'
    );
    expect(workerNode).toBeDefined();

    expect(workerNode!.tools).toBeDefined();
    const actionTools = workerNode!.tools!.filter(t => t.type === 'action');
    expect(actionTools.length).toBeGreaterThanOrEqual(2);

    const logTool = actionTools.find(t => t.target === 'log_activity');
    expect(logTool).toBeDefined();
    expect(logTool!.name).toBe('log_activity');
    expect(logTool!.description).toBe('Log activity to Salesforce');
    expect(logTool!.bound_inputs).toEqual({});
    expect(logTool!.llm_inputs).toEqual([]);
    expect(logTool!.state_updates).toEqual([]);

    const crmTool = actionTools.find(t => t.target === 'query_crm');
    expect(crmTool).toBeDefined();
    expect(crmTool!.name).toBe('query_crm');
    expect(crmTool!.description).toBe('Query CRM');
  });

  it('start_agent node does not inherit top-level actions', () => {
    const { output } = compile(parseSource(source));
    const startNode = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );

    expect(startNode).toBeDefined();
    expect(startNode!.action_definitions ?? []).toHaveLength(0);
    expect(
      (startNode!.tools ?? []).filter(t => t.type === 'action')
    ).toHaveLength(0);
  });

  it('emits exactly one tool with preserved llm_inputs when a node reasoning references an inherited action', () => {
    // Regression: a subagent whose reasoning.actions references an inherited
    // top-level action must NOT emit two tools for the same target, and the
    // surviving tool must keep the action's required llm_inputs even though the
    // node's own compileActionDefinitions cleared the per-node signature map.
    const src = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

actions:
    send_email:
        description: "Send an email"
        inputs:
            recipient: string
                is_required: True
        target: "flow://SendEmail"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | Route.

subagent worker:
    description: "Worker"
    reasoning:
        instructions: ->
            | Do work.
        actions:
            send_email: @actions.send_email
`;
    const { output, diagnostics } = compile(parseSource(src));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    const worker = output.agent_version.nodes.find(
      n => n.developer_name === 'worker'
    );
    expect(worker).toBeDefined();

    const emailTools = (worker!.tools ?? []).filter(
      t => t.type === 'action' && t.target === 'send_email'
    );
    // Exactly one tool for the target — no duplicate from the inheritance merge.
    expect(emailTools).toHaveLength(1);
    // Required, unbound input surfaced to the planner.
    expect(emailTools[0]!.llm_inputs).toContain('recipient');

    // And a single action definition for the target.
    const emailDefs = (worker!.action_definitions ?? []).filter(
      a => a.developer_name === 'send_email'
    );
    expect(emailDefs).toHaveLength(1);
  });

  it('produces schema-conformant output', () => {
    const { output } = compile(parseSource(source));
    const violations = checkSchemaConformance(output);
    expect(violations).toEqual([]);
  });

  it('seeds llm_inputs with required, unbound inputs of top-level actions', () => {
    const withInputs = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

actions:
    send_email:
        description: "Send an email"
        inputs:
            recipient: string
                is_required: True
            subject: string
                is_required: True
        target: "flow://SendEmail"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | Route.

subagent worker:
    description: "Worker"
`;
    const { output, diagnostics } = compile(parseSource(withInputs));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    // The seeded llm_inputs live on the regular subagent node, since the
    // start_agent router does not receive top-level actions.
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'worker'
    );
    expect(node).toBeDefined();
    const tool = node!.tools!.find(t => t.target === 'send_email');
    expect(tool).toBeDefined();
    // Required, unbound inputs must be surfaced to the planner via llm_inputs,
    // just like an ordinary reasoning-referenced action.
    expect(tool!.llm_inputs).toContain('recipient');
    expect(tool!.llm_inputs).toContain('subject');
  });
});
