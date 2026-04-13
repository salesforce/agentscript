/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Router/hyperclassifier node compilation tests.
 *
 * Covers: tool filtering (only transitions), action_definitions preservation,
 * edge cases for non-transition reasoning actions on router nodes.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

function compileSource(source: string) {
  return compile(parseSource(source));
}

/** Minimal hyperclassifier scaffold. */
function hyperclassifierSource(
  reasoningActions: string,
  extras: string = ''
): string {
  return `
system:
    instructions: "System instructions"

config:
    developer_name: "TestRouter"
    default_agent_user: "test@example.com"

${extras}

start_agent router:
    label: "Router"
    description: "Routes requests"

    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"

    actions:
        search_kb:
            description: "Search knowledge base"
            inputs:
                query: string
            outputs:
                result: string
            target: "standardInvocableAction://searchKnowledge"

        create_case:
            description: "Create a case"
            inputs:
                subject: string
            outputs:
                case_ref: string
            target: "flow://Create_Case"

    reasoning:
        instructions: ->
            | Route the user to the best topic.
        actions:
${reasoningActions}

topic support:
    label: "Support"
    description: "Detailed support"
    reasoning:
        instructions: ->
            | Provide support.

topic self_service:
    label: "Self Service"
    description: "Self-service options"
    reasoning:
        instructions: ->
            | Guide through self-service.
`;
}

describe('router node: tool filtering', () => {
  it('should only include transition tools, not regular action tools', () => {
    const result = compileSource(
      hyperclassifierSource(`
            do_search: @actions.search_kb
                with query=...
            make_case: @actions.create_case
                with subject=...
            go_support: @utils.transition to @topic.support
                description: "Route to support"
            go_self_service: @utils.transition to @topic.self_service
                description: "Route to self-service"`)
    );

    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node).toBeDefined();
    expect(node.type).toBe('router');

    // Only transitions should appear as tools
    expect(node.tools.length).toBe(2);
    expect(node.tools[0].name).toBe('go_support');
    expect(node.tools[0].target).toBe('support');
    expect(node.tools[0].description).toBe('Route to support');
    expect(node.tools[1].name).toBe('go_self_service');
    expect(node.tools[1].target).toBe('self_service');
    expect(node.tools[1].description).toBe('Route to self-service');
  });

  it('should still compile regular actions as action_definitions', () => {
    const result = compileSource(
      hyperclassifierSource(`
            do_search: @actions.search_kb
                with query=...
            go_support: @utils.transition to @topic.support
                description: "Route to support"
            go_self_service: @utils.transition to @topic.self_service
                description: "Route to self-service"`)
    );

    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    // action_definitions should contain the underlying actions
    const actionNames = node.action_definitions.map(a => a.developer_name);
    expect(actionNames).toContain('search_kb');
    expect(actionNames).toContain('create_case');
  });

  it('should compile router with only transitions', () => {
    const result = compileSource(
      hyperclassifierSource(`
            go_support: @utils.transition to @topic.support
                description: "Route to support"
            go_self_service: @utils.transition to @topic.self_service
                description: "Route to self-service"`)
    );

    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node.tools.length).toBe(2);
    expect(node.tools[0].name).toBe('go_support');
    expect(node.tools[1].name).toBe('go_self_service');
  });

  it('should exclude escalation from router tools', () => {
    const result = compileSource(
      hyperclassifierSource(`
            escalate_human: @utils.escalate
                description: "Escalate to human"
            go_support: @utils.transition to @topic.support
                description: "Route to support"
            go_self_service: @utils.transition to @topic.self_service
                description: "Route to self-service"`)
    );

    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    // Only transitions — escalation should be excluded
    expect(node.tools.length).toBe(2);
    expect(node.tools.every(t => t.name.startsWith('go_'))).toBe(true);
  });

  it('should have empty tools when no reasoning actions defined', () => {
    const source = `
config:
    developer_name: "TestRouter"
    default_agent_user: "test@example.com"

start_agent router:
    description: "Routes requests"

    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"

    reasoning:
        instructions: ->
            | Route the user.

topic support:
    description: "Support"
    reasoning:
        instructions: ->
            | Help.
`;
    const result = compileSource(source);
    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node.tools.length).toBe(0);
  });

  it('should include connected-agent tools alongside transitions', () => {
    const result = compileSource(
      hyperclassifierSource(
        `
            go_support: @utils.transition to @topic.support
                description: "Route to support"
            call_crm: @connected_subagent.CRM_Agent
                description: "Delegate to CRM agent"
            do_search: @actions.search_kb
                with query=...
            go_self_service: @utils.transition to @topic.self_service
                description: "Route to self-service"`,
        `
connected_subagent CRM_Agent:
    target: "agentforce://CRM_Agent"
    label: "CRM Agent"
    description: "Handles CRM operations"
    inputs:
        customer_id: string
`
      )
    );

    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node).toBeDefined();
    expect(node.type).toBe('router');

    // Should include 2 transitions + 1 connected-agent = 3 tools
    // Regular action (do_search) should be filtered out
    expect(node.tools.length).toBe(3);

    // Verify transitions
    const goSupport = node.tools.find(t => t.name === 'go_support');
    expect(goSupport).toBeDefined();
    expect(goSupport!.target).toBe('support');
    expect(goSupport!.description).toBe('Route to support');

    const goSelfService = node.tools.find(t => t.name === 'go_self_service');
    expect(goSelfService).toBeDefined();
    expect(goSelfService!.target).toBe('self_service');

    // Verify connected-agent tool
    const callCrm = node.tools.find(t => t.name === 'call_crm');
    expect(callCrm).toBeDefined();
    expect(callCrm!.target).toBe('CRM_Agent');
    expect(callCrm!.description).toBe('Delegate to CRM agent');

    // Verify related-agent node was created
    const relatedAgentNode = result.output.agent_version.nodes.find(
      n => n.type === 'related_agent' && n.developer_name === 'CRM_Agent'
    );
    expect(relatedAgentNode).toBeDefined();
    expect(relatedAgentNode!.label).toBe('CRM Agent');
  });

  it('should support router with only connected-agents', () => {
    const result = compileSource(
      hyperclassifierSource(
        `
            call_crm: @connected_subagent.CRM_Agent
                description: "Delegate to CRM"
            call_support: @connected_subagent.Support_Agent
                description: "Delegate to support"`,
        `
connected_subagent CRM_Agent:
    target: "agentforce://CRM_Agent"
    label: "CRM Agent"
    description: "Handles CRM"
    inputs:
        customer_id: string

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
    inputs:
        ticket_id: string
`
      )
    );

    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node.tools.length).toBe(2);
    expect(node.tools[0].name).toBe('call_crm');
    expect(node.tools[0].target).toBe('CRM_Agent');
    expect(node.tools[1].name).toBe('call_support');
    expect(node.tools[1].target).toBe('Support_Agent');

    // Verify both related-agent nodes exist
    const relatedAgents = result.output.agent_version.nodes.filter(
      n => n.type === 'related_agent'
    );
    expect(relatedAgents.length).toBe(2);
  });

  it('should emit errors for disallowed action types in router nodes', () => {
    const result = compileSource(
      hyperclassifierSource(`
            do_search: @actions.search_kb
                with query=...
            escalate_now: @utils.escalate
                description: "Escalate"
            set_vars: @utils.setVariables
            go_support: @utils.transition to @topic.support
                description: "Route to support"`)
    );

    // Check that diagnostics were emitted for disallowed actions
    const errors = result.diagnostics.filter(d => d.severity === 1); // Error = 1

    // Should have errors for: regular action with LLM inputs, escalate, setVariables
    expect(errors.length).toBeGreaterThanOrEqual(3);

    // Check that error messages are helpful
    const errorMessages = errors.map(e => e.message);

    // Regular action with LLM inputs gets specific error
    const actionError = errorMessages.find(
      m => m.includes('do_search') && m.includes('LLM inputs')
    );
    expect(actionError).toBeDefined();
    expect(actionError).toContain('hyperclassifier');

    // Escalate error
    const escalateError = errorMessages.find(
      m => m.includes('escalate_now') || m.includes('escalate')
    );
    expect(escalateError).toBeDefined();

    // SetVariables error
    const setVarsError = errorMessages.find(m => m.includes('set_vars'));
    expect(setVarsError).toBeDefined();

    // Router should only have the transition tool (disallowed actions filtered out)
    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;
    expect(node.tools.length).toBe(1);
    expect(node.tools[0].name).toBe('go_support');
  });

  it('should emit specific error for actions with LLM inputs in router nodes', () => {
    const result = compileSource(
      hyperclassifierSource(`
            do_search: @actions.search_kb
                with query=...
            go_support: @utils.transition to @topic.support
                description: "Route to support"`)
    );

    // Check that error was emitted specifically about LLM inputs
    const errors = result.diagnostics.filter(d => d.severity === 1); // Error = 1

    expect(errors.length).toBeGreaterThanOrEqual(1);

    // Find the LLM input error
    const llmInputError = errors.find(
      m => m.message.includes('LLM inputs') && m.message.includes('do_search')
    );

    expect(llmInputError).toBeDefined();
    expect(llmInputError!.message).toContain('hyperclassifier');
    expect(llmInputError!.message).toContain('param=...');

    // Router should only have the transition tool
    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;
    expect(node.tools.length).toBe(1);
    expect(node.tools[0].name).toBe('go_support');
  });

  it('should allow actions with explicit values (no LLM inputs) in router nodes', () => {
    const result = compileSource(
      hyperclassifierSource(`
            do_search: @actions.search_kb
                with query="fixed query"
            go_support: @utils.transition to @topic.support
                description: "Route to support"`)
    );

    // Should still have an error because regular actions aren't allowed,
    // but it should NOT be the LLM input error
    const errors = result.diagnostics.filter(d => d.severity === 1);
    const errorMessages = errors.map(e => e.message);

    // Should have generic "router nodes only support" error, not LLM input error
    const llmInputError = errorMessages.find(m => m.includes('LLM inputs'));
    expect(llmInputError).toBeUndefined();

    const genericError = errorMessages.find(m =>
      m.includes('Router nodes only support')
    );
    expect(genericError).toBeDefined();
  });

  it('should reject model without URI scheme', () => {
    const source = `
config:
    developer_name: "TestRouter"
    default_agent_user: "test@example.com"

start_agent router:
    description: "Routes requests"

    model_config:
        model: "sfdc_ai__DefaultEinsteinHyperClassifier"

    reasoning:
        instructions: ->
            | Route the user.
        actions:
            go_support: @utils.transition to @topic.support
                description: "Route to support"

topic support:
    description: "Support"
    reasoning:
        instructions: ->
            | Help.
`;
    const result = compileSource(source);
    const node = result.output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    )!;

    expect(node).toBeDefined();
    expect(node.type).toBe('router');
    expect(node.model_configuration).toBeUndefined();

    // Should have an error about missing URI scheme
    expect(
      result.diagnostics.some(
        d =>
          d.message.includes('Model URI must include a scheme') &&
          d.message.includes('sfdc_ai__DefaultEinsteinHyperClassifier')
      )
    ).toBe(true);
  });
});

// Hyperclassifier linting is now handled by the lint pass in
// dialect/agentforce/src/lint/passes/hyperclassifier.ts
// See dialect/agentforce/src/tests/lint-hyperclassifier.test.ts for lint-level tests.
