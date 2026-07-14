/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Custom subagent compilation tests for the Commerce Cloud Shopper variant.
 *
 * Tests that subagent blocks with `schema: "node://commerce/shopper_agent/v1"`
 * compile into BYONNode with type "byon" and hardcoded byo_client configuration.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import type { BYONNode, AgentVersion } from '../src/types.js';

function getVersion(
  output: ReturnType<typeof compile>['output']
): AgentVersion {
  return Array.isArray(output.agent_version)
    ? output.agent_version[0]
    : (output.agent_version as AgentVersion);
}

function findNode(output: ReturnType<typeof compile>['output'], name: string) {
  return getVersion(output).nodes.find(n => n.developer_name === name);
}

const baseConfig = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Handle requests
`;

const baseShopperSubagent = `
subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`;

describe('Custom subagent node compilation', () => {
  it('should compile a commerce shopper subagent with hardcoded byo_client', () => {
    const source = `${baseConfig}${baseShopperSubagent}`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.type).toBe('byon');
    expect(node.developer_name).toBe('Shopper_Agent');
    expect(node.description).toBe('Commerce Cloud shopper agent');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'commerce_shopper_agent',
      node_namespace: 'commerceshopperagent',
    });

    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  it('should compile custom subagent node with label', () => {
    const source = `
${baseConfig}
subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    label: "Shopper Agent"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.label).toBe('Shopper Agent');
  });

  // ---------------------------------------------------------------------------
  // parameters.template → input_parameters
  // ---------------------------------------------------------------------------

  it('should compile parameters.template to input_parameters', () => {
    const source = `
${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    parameters:
        template:
            auth_token: @variables.EndUserId
            org_id: @variables.EndUserId
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.input_parameters).toBeDefined();
    expect(node.input_parameters!['auth_token']).toBe('variables.EndUserId');
    expect(node.input_parameters!['org_id']).toBe('variables.EndUserId');
  });

  it('should not set input_parameters when parameters.template is absent', () => {
    const source = `${baseConfig}${baseShopperSubagent}`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node.input_parameters).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Action definitions
  // ---------------------------------------------------------------------------

  it('should compile custom subagent node with action definitions', () => {
    const source = `
${baseConfig}
subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.action_definitions).toBeDefined();
    expect(node.action_definitions).toHaveLength(1);
    expect(node.action_definitions![0].developer_name).toBe('Search_Products');
  });

  // ---------------------------------------------------------------------------
  // action @variables.X inputs → tools[].bound_inputs
  // ---------------------------------------------------------------------------

  it('should compile action @variables.X inputs to tools[].bound_inputs', () => {
    const source = `
${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
                auth_named_credential: @variables.EndUserId
                    description: "Auth credential"
                    is_required: True
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.action_definitions).toHaveLength(1);

    // tools auto-derived from bound inputs
    expect(node.tools).toBeDefined();
    expect(node.tools).toHaveLength(1);
    const tool = node.tools![0] as {
      type: string;
      target: string;
      name: string;
      bound_inputs: Record<string, unknown>;
    };
    expect(tool.type).toBe('action');
    expect(tool.target).toBe('Search_Products');
    expect(tool.name).toBe('Search_Products');
    expect(tool.bound_inputs).toEqual({
      auth_named_credential: 'variables.EndUserId',
    });
  });

  it('should compile multiple @variables.X inputs on one action to one tools entry', () => {
    const source = `
${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId
    RoutableId: linked string
        source: @MessagingSession.Id

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Get_Auth:
            description: "Get auth token"
            target: "flow://get_auth"
            inputs:
                user_id: @variables.EndUserId
                    is_required: True
                session_id: @variables.RoutableId
                    is_required: True
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node.tools).toHaveLength(1);
    const tool = node.tools![0] as { bound_inputs: Record<string, unknown> };
    expect(tool.bound_inputs).toEqual({
      user_id: 'variables.EndUserId',
      session_id: 'variables.RoutableId',
    });
  });

  it('should emit separate tools entries for multiple actions with bindings', () => {
    const source = `
${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Get_Auth:
            description: "Get auth"
            target: "flow://get_auth"
            inputs:
                credential: @variables.EndUserId
                    is_required: True
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
                auth: @variables.EndUserId
                    is_required: True
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node.action_definitions).toHaveLength(2);
    expect(node.tools).toHaveLength(2);
  });

  it('should not emit tools when no action has @variables.X inputs', () => {
    const source = `
${baseConfig}
subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node.tools).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // reasoning.actions → tools
  // ---------------------------------------------------------------------------

  it('should compile reasoning.actions into tools', () => {
    const source = `
${baseConfig}
subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
    reasoning:
        actions:
            search: @actions.Search_Products
                with query=...
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.tools).toBeDefined();
    expect(node.tools!.length).toBeGreaterThanOrEqual(1);

    const searchTool = node.tools!.find(
      (t: Record<string, unknown>) => t.name === 'search'
    ) as Record<string, unknown>;
    expect(searchTool).toBeDefined();
    expect(searchTool.type).toBe('action');
    expect(searchTool.target).toBe('Search_Products');
  });

  it('should merge reasoning.actions tools with bound_input tools', () => {
    const source = `
${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
    actions:
        Search_Products:
            description: "Search products"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query"
                auth_named_credential: @variables.EndUserId
                    description: "Auth credential"
                    is_required: True
    reasoning:
        actions:
            search: @actions.Search_Products
                with query=...
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node).toBeDefined();
    expect(node.tools).toBeDefined();

    // Should have both the bound_input tool and the reasoning action tool
    const boundInputTool = node.tools!.find(
      (t: Record<string, unknown>) =>
        t.name === 'Search_Products' && t.bound_inputs != null
    );
    const reasoningTool = node.tools!.find(
      (t: Record<string, unknown>) => t.name === 'search'
    );

    expect(boundInputTool).toBeDefined();
    expect(reasoningTool).toBeDefined();
  });

  it('should not produce reasoning tools when reasoning block is absent', () => {
    const source = `${baseConfig}${baseShopperSubagent}`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(node.tools).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // Coexistence
  // ---------------------------------------------------------------------------

  it('should compile an agent whose only node is a BYON start_agent', () => {
    const source = `
config:
    agent_name: "ShopperOnly"

start_agent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`;
    const { output, diagnostics } = compile(parseSource(source));
    const version = getVersion(output);

    expect(version.nodes).toHaveLength(1);
    const node = version.nodes[0] as BYONNode;
    expect(node.type).toBe('byon');
    expect(node.developer_name).toBe('Shopper_Agent');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'commerce_shopper_agent',
      node_namespace: 'commerceshopperagent',
    });
    expect(version.initial_node).toBe('Shopper_Agent');

    const blockingErrors = diagnostics.filter(
      d => d.code === 'schema-validation' || d.code === 'unknown-variant'
    );
    expect(blockingErrors).toHaveLength(0);
  });

  it('should compile custom subagent node alongside regular subagents and start_agent', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent router:
    description: "Route requests"
    reasoning:
        instructions: ->
            | Route requests

subagent Order_Management:
    description: "Handles orders"
    reasoning:
        instructions: ->
            | Handle orders

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent"
`;
    const { output } = compile(parseSource(source));

    const router = findNode(output, 'router');
    const orders = findNode(output, 'Order_Management');
    const shopper = findNode(output, 'Shopper_Agent') as BYONNode;

    expect(router).toBeDefined();
    expect(orders).toBeDefined();
    expect(shopper).toBeDefined();
    expect(shopper.type).toBe('byon');
    // Regular subagent compiles as 'subagent' type
    expect(orders!.type).toBe('subagent');
  });

  it('should compile the full shopper agent fixture', () => {
    const { output, diagnostics } = compile(
      parseSource(`
system:
    instructions: "You are a commerce assistant."
    messages:
        welcome: "Hello!"
        error: "Sorry."

config:
    agent_name: "CommerceBot"
    default_agent_user: "commerce@example.com"

language:
    default_locale: "en_US"

variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

start_agent router:
    description: "Route shopping requests"
    reasoning:
        instructions: ->
            | Route requests

subagent Shopper_Agent:
    schema: "node://commerce/shopper_agent/v1"
    description: "Commerce Cloud shopper agent for assisted buying"
    label: "Shopper Agent"
    parameters:
        template:
            auth_token: @variables.EndUserId
    actions:
        Search_Products:
            description: "Search the product catalog"
            target: "flow://search_products"
            inputs:
                query: string
                    description: "Search query text"
                    is_required: True
                auth_named_credential: @variables.EndUserId
                    description: "Auth credential"
                    is_required: True
        Add_To_Cart:
            description: "Add item to cart"
            target: "flow://add_to_cart"
            inputs:
                product_id: string
                    description: "Product ID"
                    is_required: True
                quantity: number
                    description: "Quantity"
                    is_required: True
                auth_named_credential: @variables.EndUserId
                    description: "Auth credential"
                    is_required: True
`)
    );

    const node = findNode(output, 'Shopper_Agent') as BYONNode;
    expect(node).toBeDefined();
    expect(node.type).toBe('byon');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'commerce_shopper_agent',
      node_namespace: 'commerceshopperagent',
    });
    expect(node.input_parameters).toEqual({
      auth_token: 'variables.EndUserId',
    });
    expect(node.action_definitions).toHaveLength(2);
    expect(node.tools).toHaveLength(2);

    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });
});

describe('Generic BYON subagent compilation (node://byon/*)', () => {
  it('should compile node://byon/<namespace>/<type>/<version> with derived byo_client', () => {
    const source = `${baseConfig}
subagent Custom_Node:
    schema: "node://byon/myteam/widget/v1"
    description: "Generic BYON node"
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = findNode(output, 'Custom_Node') as BYONNode;

    expect(node).toBeDefined();
    expect(node.type).toBe('byon');
    expect(node.developer_name).toBe('Custom_Node');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'widget',
      node_namespace: 'myteam',
    });

    const errors = diagnostics.filter(d => d.severity === 1);
    expect(errors).toEqual([]);
  });

  it('should pass parameters.template, actions, and reasoning through for a generic BYON node', () => {
    const source = `${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Custom_Node:
    schema: "node://byon/myteam/widget/v1"
    description: "Generic BYON node"
    parameters:
        template:
            auth_token: @variables.EndUserId
    actions:
        Do_Thing:
            description: "Do a thing"
            target: "flow://do_thing"
            inputs:
                query: string
                    description: "Query"
                auth: @variables.EndUserId
                    description: "Auth credential"
                    is_required: True
    reasoning:
        actions:
            do_thing: @actions.Do_Thing
                with query=...
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Custom_Node') as BYONNode;

    expect(node.input_parameters).toEqual({
      auth_token: 'variables.EndUserId',
    });
    expect(node.action_definitions).toHaveLength(1);
    // bound-input tool + reasoning-action tool
    expect(node.tools).toHaveLength(2);
  });

  it('should emit a compile error for a malformed node://byon/ URI', () => {
    const source = `${baseConfig}
subagent Custom_Node:
    schema: "node://byon/incomplete"
    description: "Malformed BYON URI"
`;
    const { diagnostics } = compile(parseSource(source));
    const malformed = diagnostics.filter(d =>
      d.message.includes('malformed BYON schema URI')
    );
    expect(malformed.length).toBeGreaterThan(0);
  });

  it('should not run custom-subagent-validation on generic BYON nodes', () => {
    // before_reasoning is NOT in the commerce variant allowed-fields set; it
    // would error on a commerce node but should be silently accepted on a
    // generic BYON node.
    const source = `${baseConfig}
subagent Custom_Node:
    schema: "node://byon/myteam/widget/v1"
    description: "Generic BYON node with arbitrary base fields"
    before_reasoning:
        set @variables.x = 1
`;
    const { diagnostics } = compile(parseSource(source));
    const variantErrors = diagnostics.filter(
      d => d.code === 'custom-subagent-validation'
    );
    expect(variantErrors).toEqual([]);
  });

  it('should compile a BYON start_agent with parameters', () => {
    const source = `
config:
    agent_name: "BYONStartBot"

variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

start_agent Custom_Start:
    schema: "node://byon/myteam/widget/v1"
    description: "A BYON start agent"
    parameters:
        template:
            auth_token: @variables.EndUserId
`;
    const { output, diagnostics } = compile(parseSource(source));
    const version = getVersion(output);

    expect(version.nodes).toHaveLength(1);
    const node = version.nodes[0] as BYONNode;
    expect(node.type).toBe('byon');
    expect(node.developer_name).toBe('Custom_Start');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'widget',
      node_namespace: 'myteam',
    });
    expect(version.initial_node).toBe('Custom_Start');
    expect(node.input_parameters).toEqual({
      auth_token: 'variables.EndUserId',
    });

    const errors = diagnostics.filter(d => d.severity === 1);
    expect(errors).toEqual([]);
  });

  it('should compile multiple parameter groups into input_parameters', () => {
    const source = `${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId
    RoutableId: linked string
        source: @MessagingSession.Id

subagent Custom_Node:
    schema: "node://byon/myteam/widget/v1"
    description: "Generic BYON node"
    parameters:
        template:
            auth_token: @variables.EndUserId
        session_config:
            session_id: @variables.RoutableId
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Custom_Node') as BYONNode;

    expect(node.input_parameters).toEqual({
      auth_token: 'variables.EndUserId',
      session_id: 'variables.RoutableId',
    });
  });
});

// ---------------------------------------------------------------------------
// Tableau Analyze Data variant compilation
// ---------------------------------------------------------------------------

const baseTableauSubagent = `
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`;

describe('Tableau Analyze Data subagent compilation', () => {
  it('should compile a tableau analyze data subagent with hardcoded byo_client', () => {
    const source = `${baseConfig}${baseTableauSubagent}`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = findNode(output, 'Tableau_Analyze') as BYONNode;

    expect(node).toBeDefined();
    expect(node.type).toBe('byon');
    expect(node.developer_name).toBe('Tableau_Analyze');
    expect(node.description).toBe('Tableau Analyze Data agent');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'waii_analytics_agent',
      node_namespace: 'waiianalyticsagent',
    });

    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  it('should compile parameters.context to input_parameters', () => {
    const source = `
${baseConfig}
variables:
    EndUserId: linked string
        source: @MessagingSession.MessagingEndUserId

subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    parameters:
        context:
            auth_token: @variables.EndUserId
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Tableau_Analyze') as BYONNode;

    expect(node).toBeDefined();
    expect(node.input_parameters).toBeDefined();
    expect(node.input_parameters!['auth_token']).toBe('variables.EndUserId');
  });

  it('should compile action definitions', () => {
    const source = `
${baseConfig}
subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
    actions:
        Analyze_Data:
            description: "Analyze data"
            target: "flow://analyze_data"
            inputs:
                query: string
                    description: "Analysis query"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Tableau_Analyze') as BYONNode;

    expect(node).toBeDefined();
    expect(node.action_definitions).toBeDefined();
    expect(node.action_definitions).toHaveLength(1);
    expect(node.action_definitions![0].developer_name).toBe('Analyze_Data');
  });

  it('should compile an agent whose only node is a Tableau Analyze Data start_agent', () => {
    const source = `
config:
    agent_name: "TableauOnly"

start_agent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`;
    const { output, diagnostics } = compile(parseSource(source));
    const version = getVersion(output);

    expect(version.nodes).toHaveLength(1);
    const node = version.nodes[0] as BYONNode;
    expect(node.type).toBe('byon');
    expect(node.developer_name).toBe('Tableau_Analyze');
    expect(node.byo_client.client_ref).toBe('icr-default');
    expect(node.byo_client.configuration).toEqual({
      node_type_id: 'waii_analytics_agent',
      node_namespace: 'waiianalyticsagent',
    });
    expect(version.initial_node).toBe('Tableau_Analyze');

    const blockingErrors = diagnostics.filter(
      d => d.code === 'schema-validation' || d.code === 'unknown-variant'
    );
    expect(blockingErrors).toHaveLength(0);
  });

  it('should compile tableau alongside regular subagents and start_agent', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent router:
    description: "Route requests"
    reasoning:
        instructions: ->
            | Route requests

subagent Order_Management:
    description: "Handles orders"
    reasoning:
        instructions: ->
            | Handle orders

subagent Tableau_Analyze:
    schema: "node://tableau/analyze_data/v1"
    description: "Tableau Analyze Data agent"
`;
    const { output } = compile(parseSource(source));

    const router = findNode(output, 'router');
    const orders = findNode(output, 'Order_Management');
    const tableau = findNode(output, 'Tableau_Analyze') as BYONNode;

    expect(router).toBeDefined();
    expect(orders).toBeDefined();
    expect(tableau).toBeDefined();
    expect(tableau.type).toBe('byon');
    // Regular subagent compiles as 'subagent' type
    expect(orders!.type).toBe('subagent');
  });

  it('sets enable_propagate_internal_org_jwt_to_icr when a tableau node is present', () => {
    const source = `${baseConfig}${baseTableauSubagent}`;
    const { output } = compile(parseSource(source));
    const version = getVersion(output);

    expect(
      version.additional_parameters!.enable_propagate_internal_org_jwt_to_icr
    ).toBe(true);
  });

  it('does not set enable_propagate_internal_org_jwt_to_icr without a tableau node', () => {
    const source = `${baseConfig}${baseShopperSubagent}`;
    const { output } = compile(parseSource(source));
    const version = getVersion(output);

    expect(
      version.additional_parameters?.enable_propagate_internal_org_jwt_to_icr
    ).toBeUndefined();
  });
});
