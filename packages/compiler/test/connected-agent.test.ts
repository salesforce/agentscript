/**
 * Connected agent compilation tests.
 *
 * Tests that `connected_subagent` blocks compile into RelatedAgentNode
 * with type "related_agent", correct field mapping, and bound_inputs
 * from input default expressions.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';

/** Helper to find a node by developer_name in compiled output */
function findNode(output: ReturnType<typeof compile>['output'], name: string) {
  return output.agent_version.nodes.find(n => n.developer_name === name);
}

describe('connected_subagent compilation', () => {
  const baseConfig = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Handle requests
`;

  it('should compile a basic connected agent into a related_agent node', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles order inquiries"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.type).toBe('related_agent');
    expect(node.invocation_target_type).toBe('agentforce');
    expect(node.invocation_target_name).toBe('Order_Agent');
    expect(node.label).toBe('Order Agent');
    expect(node.description).toBe('Handles order inquiries');
  });

  it('should compile loading_text', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    loading_text: "Looking up your order..."
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.loading_text).toBe('Looking up your order...');
  });

  it('should compile inputs with variable references into bound_inputs', () => {
    const source = `
${baseConfig}
variables:
    Order_Id: string
    Customer_Name: string

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        order_id: string = @variables.Order_Id
        customer_name: string = @variables.Customer_Name
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.bound_inputs).toEqual({
      order_id: 'state.Order_Id',
      customer_name: 'state.Customer_Name',
    });
  });

  it('should compile inputs with context variable references', () => {
    const source = `
${baseConfig}
variables:
    Session_Id: linked string

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        session_id: string = @variables.Session_Id
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.bound_inputs).toEqual({
      session_id: 'variables.Session_Id',
    });
  });

  it('should compile connected agent with no inputs', () => {
    const source = `
${baseConfig}
connected_subagent Simple_Agent:
    target: "agentforce://Simple_Agent"
    label: "Simple Agent"
    description: "A simple agent"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Simple_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.type).toBe('related_agent');
    // No bound_inputs when no inputs block
    expect(node.bound_inputs).toBeUndefined();
  });

  it('should compile multiple connected agents', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"

connected_subagent Billing_Agent:
    target: "agentforce://Billing_Agent"
    label: "Billing Agent"
    description: "Handles billing"
`;
    const { output } = compile(parseSource(source));
    const orderNode = findNode(output, 'Order_Agent');
    const billingNode = findNode(output, 'Billing_Agent');

    expect(orderNode).toBeDefined();
    expect(orderNode!.type).toBe('related_agent');

    expect(billingNode).toBeDefined();
    expect(billingNode!.type).toBe('related_agent');
  });

  it('should include connected agents alongside topic nodes', () => {
    const source = `
${baseConfig}
topic Support:
    description: "Support topic"
    reasoning:
        instructions: ->
            | Help customers

connected_subagent External_Agent:
    target: "agentforce://External_Agent"
    label: "External Agent"
    description: "External system"
`;
    const { output } = compile(parseSource(source));

    const mainNode = findNode(output, 'Main');
    const supportNode = findNode(output, 'Support');
    const externalNode = findNode(output, 'External_Agent');

    expect(mainNode).toBeDefined();
    expect(mainNode!.type).toBe('subagent');

    expect(supportNode).toBeDefined();
    expect(supportNode!.type).toBe('subagent');

    expect(externalNode).toBeDefined();
    expect(externalNode!.type).toBe('related_agent');

    // All three should be in the nodes array
    expect(output.agent_version.nodes.length).toBe(3);
  });

  it('should default label to normalized developer name when omitted', () => {
    const source = `
${baseConfig}
connected_subagent My_Custom_Agent:
    target: "agentforce://My_Custom_Agent"
    description: "Custom agent"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'My_Custom_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.label).toBe('My Custom Agent');
  });

  it('should compile inputs with string literal defaults into bound_inputs', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        channel: string = "web"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.bound_inputs).toEqual({
      channel: '"web"',
    });
  });
});

describe('connected agent as tool invocation', () => {
  const baseConfig = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
`;

  it('should resolve @connected_subagent.X target to the connected agent name', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_support: @connected_subagent.Support_Agent
                description: "Invoke support agent"

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { output } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    const tool = mainNode.tools.find(t => t.name === 'call_support');
    expect(tool).toBeDefined();
    expect(tool!.target).toBe('Support_Agent');
  });

  it('should use reasoning action key as display name', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            invoke_billing: @connected_subagent.Billing_Agent
                description: "Invoke billing agent"

connected_subagent Billing_Agent:
    target: "agentforce://Billing_Agent"
    label: "Billing Agent"
    description: "Handles billing"
`;
    const { output } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    const tool = mainNode.tools.find(t => t.name === 'invoke_billing');
    expect(tool).toBeDefined();
    expect(tool!.target).toBe('Billing_Agent');
    expect(tool!.description).toBe('Invoke billing agent');
  });

  it('should compile alongside regular @actions tools', () => {
    const source = `
${baseConfig}
    actions:
        Lookup_Order:
            description: "Look up order"
            target: "flow://Lookup_Order"
            inputs:
                order_id: string
            outputs:
                status: string
    reasoning:
        instructions: ->
            | Handle requests
        actions:
            lookup: @actions.Lookup_Order
                with order_id = "123"
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
`;
    const { output } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    const lookupTool = mainNode.tools.find(t => t.name === 'lookup');
    expect(lookupTool).toBeDefined();
    expect(lookupTool!.target).toBe('Lookup_Order');

    const agentTool = mainNode.tools.find(t => t.name === 'call_agent');
    expect(agentTool).toBeDefined();
    expect(agentTool!.target).toBe('Order_Agent');
  });

  it('should warn when transitioning to @connected_subagent.X in reasoning', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            transfer: @utils.transition to @connected_subagent.Support_Agent
                description: "Transfer to support"

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { diagnostics } = compile(parseSource(source));
    const transitionWarnings = diagnostics.filter(d =>
      d.message.includes('Transition to connected agent')
    );
    expect(transitionWarnings.length).toBeGreaterThan(0);
    expect(transitionWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it('should warn when transitioning to @connected_subagent.X in after_reasoning', () => {
    const source = `
${baseConfig}
    after_reasoning:
        transition to @connected_subagent.Support_Agent
    reasoning:
        instructions: ->
            | Help the user.

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { diagnostics } = compile(parseSource(source));
    const transitionWarnings = diagnostics.filter(d =>
      d.message.includes('Transition to connected agent')
    );
    expect(transitionWarnings.length).toBeGreaterThan(0);
    expect(transitionWarnings[0].severity).toBe(DiagnosticSeverity.Warning);
  });

  it('should warn on unknown input for @connected_subagent.X tool invocation', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"
                with typo_input = "foo"

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        customer_id: string
`;
    const { diagnostics } = compile(parseSource(source));
    expect(
      diagnostics.some(d => d.message.includes('Unknown input "typo_input"'))
    ).toBe(true);
  });

  it('should warn on missing required input for @connected_subagent.X tool invocation', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        customer_id: string
`;
    const { diagnostics } = compile(parseSource(source));
    expect(
      diagnostics.some(d =>
        d.message.includes('Missing required input "customer_id"')
      )
    ).toBe(true);
  });

  it('should not warn when input has a definition default', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"

variables:
    Default_Id: string

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        customer_id: string = @variables.Default_Id
`;
    const { diagnostics } = compile(parseSource(source));
    expect(
      diagnostics.some(d => d.message.includes('Missing required input'))
    ).toBe(false);
  });

  it('should not warn when all inputs are provided via with clauses', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"
                with customer_id = "abc"

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        customer_id: string
`;
    const { diagnostics } = compile(parseSource(source));
    expect(diagnostics.some(d => d.message.includes('Unknown input'))).toBe(
      false
    );
    expect(
      diagnostics.some(d => d.message.includes('Missing required input'))
    ).toBe(false);
  });
});

describe('connected agent tool output shape', () => {
  const baseConfig = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
`;

  it('should compile with clauses but not include bound_inputs or llm_inputs on the tool', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"
                with customer_id = "abc"
                with search_query = ...

variables:
    Cid: string

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        customer_id: string
        search_query: string
`;
    const { output } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    const tool = mainNode.tools.find(t => t.name === 'call_agent');
    expect(tool).toBeDefined();
    expect(tool!.type).toBe('supervision');
    expect(tool!.target).toBe('Order_Agent');
    expect(tool!.bound_inputs).toBeUndefined();
    expect(tool!.llm_inputs).toBeUndefined();
  });

  it('should compile connected agent tool alongside a transition', () => {
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Support_Agent
                description: "Invoke support"
            go_billing: @utils.transition to @topic.Billing
                description: "Route to billing"

topic Billing:
    description: "Billing topic"
    reasoning:
        instructions: ->
            | Handle billing

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { output } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    // Connected agent tool
    const agentTool = mainNode.tools.find(t => t.name === 'call_agent');
    expect(agentTool).toBeDefined();
    expect(agentTool!.target).toBe('Support_Agent');
    expect(agentTool!.type).toBe('supervision');
    expect(agentTool!.bound_inputs).toBeUndefined();
    expect(agentTool!.llm_inputs).toBeUndefined();

    // Transition tool
    const transitionTool = mainNode.tools.find(t => t.name === 'go_billing');
    expect(transitionTool).toBeDefined();
    expect(transitionTool!.target).toBe('__state_update_action__');

    // Handoff
    expect(mainNode.after_all_tool_calls).toBeDefined();
    expect(
      mainNode.after_all_tool_calls!.some(h => h.target === 'Billing')
    ).toBe(true);
  });
});

describe('connected agent — referencing non-existent agent', () => {
  it('should silently skip validation when connected agent is not defined', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Nonexistent_Agent
                description: "Invoke nonexistent agent"
                with some_input = "value"
`;
    // When a connected agent is referenced but not defined,
    // ctx.connectedAgentInputs.get(target) returns undefined and
    // input validation is skipped. No crash, no warning about unknown inputs.
    const { output, diagnostics } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    const tool = mainNode.tools.find(t => t.name === 'call_agent');
    expect(tool).toBeDefined();
    expect(tool!.target).toBe('Nonexistent_Agent');

    // No input validation warnings (sig lookup returned undefined)
    expect(diagnostics.some(d => d.message.includes('Unknown input'))).toBe(
      false
    );
    expect(
      diagnostics.some(d => d.message.includes('Missing required input'))
    ).toBe(false);
  });
});

describe('connected agent — set clause on invocation', () => {
  it('should compile set clause on connected agent tool invocation', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    Last_Agent: mutable string = ""

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Support_Agent
                description: "Invoke support"
                set @variables.Last_Agent = "Support_Agent"

connected_subagent Support_Agent:
    target: "agentforce://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { output, diagnostics } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;

    const tool = mainNode.tools.find(t => t.name === 'call_agent');
    expect(tool).toBeDefined();
    expect(tool!.target).toBe('Support_Agent');
    expect(tool!.state_updates).toEqual([{ Last_Agent: '"Support_Agent"' }]);

    // connectedAgentSignature returns empty outputs, so no output-related
    // diagnostic is expected — the set clause targets a variable, not an output.
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toHaveLength(0);
  });
});

describe('connected agent — successful compilations assert zero diagnostics', () => {
  it('should produce zero diagnostics for valid connected agent definition', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Handle requests

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
`;
    const { diagnostics } = compile(parseSource(source));
    expect(diagnostics).toHaveLength(0);
  });

  it('should produce zero diagnostics for valid connected agent tool invocation', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"
                with order_id = "123"

connected_subagent Order_Agent:
    target: "agentforce://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        order_id: string
`;
    const { diagnostics } = compile(parseSource(source));
    expect(diagnostics).toHaveLength(0);
  });
});
