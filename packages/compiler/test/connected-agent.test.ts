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
import {
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  STATE_UPDATE_ACTION,
  RUNTIME_CONDITION_VARIABLE,
} from '../src/constants.js';

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
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles order inquiries"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.type).toBe('related_agent');
    expect(node.invocation_target_type).toBe('agent');
    expect(node.invocation_target_name).toBe('Order_Agent');
    expect(node.label).toBe('Order Agent');
    expect(node.description).toBe('Handles order inquiries');
  });

  it('should compile loading_text', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Simple_Agent"
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
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"

connected_subagent Billing_Agent:
    target: "agent://Billing_Agent"
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
    target: "agent://External_Agent"
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
    target: "agent://My_Custom_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Support_Agent"
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
    target: "agent://Billing_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Support_Agent"
    label: "Support Agent"
    description: "Handles support"
`;
    const { output, diagnostics } = compile(parseSource(source));
    const transitionWarnings = diagnostics.filter(d =>
      d.message.includes('Transition to connected agent')
    );
    expect(transitionWarnings.length).toBeGreaterThan(0);
    expect(transitionWarnings[0].severity).toBe(DiagnosticSeverity.Warning);

    // Warning should not block compilation — transition tool should still be present
    const node = findNode(output, 'Main');
    expect(node?.tools.some(t => t.name === 'transfer')).toBe(true);
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
    target: "agent://Support_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
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

  it('does not auto-fill llm_inputs for connected agents missing required inputs', () => {
    // Regression: the default LLM slot-fill for regular @actions.X tools must
    // not bleed into the @connected_subagent.X path. Connected agents have
    // their own explicit "Missing required input" warning and intentionally
    // omit bound_inputs / llm_inputs from the compiled supervision tool.
    const source = `
${baseConfig}
    reasoning:
        instructions: ->
            | Route requests
        actions:
            call_agent: @connected_subagent.Order_Agent
                description: "Invoke order agent"

connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        customer_id: string
`;
    const { output, diagnostics } = compile(parseSource(source));
    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'Main'
    )!;
    const tool = mainNode.tools.find(t => t.name === 'call_agent');
    expect(tool).toBeDefined();
    expect(tool!.bound_inputs).toBeUndefined();
    expect(tool!.llm_inputs).toBeUndefined();
    expect(
      diagnostics.some(d =>
        d.message.includes('Missing required input "customer_id"')
      )
    ).toBe(true);
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
    target: "agent://Support_Agent"
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
    target: "agent://Support_Agent"
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
    target: "agent://Order_Agent"
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
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    inputs:
        order_id: string
`;
    const { diagnostics } = compile(parseSource(source));
    expect(diagnostics).toHaveLength(0);
  });
});

describe('connected_subagent after_response', () => {
  const baseConfig = `
config:
    agent_name: "TestBot"

start_agent Main:
    description: "Main topic"
    reasoning:
        instructions: ->
            | Handle requests
`;

  it('should not emit after_response when omitted', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node).toBeDefined();
    expect(node.after_response).toBeUndefined();
  });

  it('should compile a set directive into a state update action', () => {
    const source = `
${baseConfig}
variables:
    Refund_Done: mutable boolean

connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    after_response:
        set @variables.Refund_Done = True
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node.after_response).toBeDefined();
    const actions = node.after_response as Record<string, unknown>[];

    const setAction = actions.find(
      a =>
        a.target === STATE_UPDATE_ACTION &&
        Array.isArray(a.state_updates) &&
        (a.state_updates as Record<string, string>[]).some(
          su => 'Refund_Done' in su
        )
    );
    expect(setAction).toBeDefined();
  });

  it('should compile a transition directive into state update + handoff', () => {
    const source = `
${baseConfig}
topic Wrap_Up:
    description: "Wrap up"
    reasoning:
        instructions: ->
            | Wrap up

connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    after_response:
        transition to @topic.Wrap_Up
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node.after_response).toBeDefined();
    const actions = node.after_response as Record<string, unknown>[];

    const handoff = actions.find(
      a => a.type === 'handoff' && a.target === 'Wrap_Up'
    ) as Record<string, unknown> | undefined;
    expect(handoff).toBeDefined();
    expect(handoff!.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="Wrap_Up"`);
    expect(handoff!.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);
  });

  it('should compile if/else directives with runtime condition gating', () => {
    const source = `
${baseConfig}
variables:
    Refund_Done: mutable boolean
    Refund_Failed: mutable boolean

connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    after_response:
        if @variables.Refund_Done:
            set @variables.Refund_Failed = False
        else:
            set @variables.Refund_Failed = True
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node.after_response).toBeDefined();
    const actions = node.after_response as Record<string, unknown>[];

    // Should set the runtime-condition variable from the @variables.Refund_Done expression
    const condUpdate = actions.find(
      a =>
        a.target === STATE_UPDATE_ACTION &&
        Array.isArray(a.state_updates) &&
        (a.state_updates as Record<string, string>[]).some(
          su => RUNTIME_CONDITION_VARIABLE in su
        )
    );
    expect(condUpdate).toBeDefined();

    // Should have one Refund_Failed update gated by positive runtime condition
    // and one gated by the negation.
    const refundFailedUpdates = actions.filter(
      a =>
        a.target === STATE_UPDATE_ACTION &&
        Array.isArray(a.state_updates) &&
        (a.state_updates as Record<string, string>[]).some(
          su => 'Refund_Failed' in su
        )
    );
    expect(refundFailedUpdates.length).toBe(2);
    const enabledClauses = refundFailedUpdates.map(a => a.enabled as string);
    expect(
      enabledClauses.some(e =>
        e?.includes(`state.${RUNTIME_CONDITION_VARIABLE}`)
      )
    ).toBe(true);
    expect(
      enabledClauses.some(e =>
        e?.includes(`not (state.${RUNTIME_CONDITION_VARIABLE})`)
      )
    ).toBe(true);
  });

  it('should compile after_response with a mix of set and transition', () => {
    const source = `
${baseConfig}
variables:
    Refund_Done: mutable boolean

topic Wrap_Up:
    description: "Wrap up"
    reasoning:
        instructions: ->
            | Wrap up

connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    after_response:
        set @variables.Refund_Done = True
        transition to @topic.Wrap_Up
`;
    const { output } = compile(parseSource(source));
    const node = findNode(output, 'Order_Agent') as Record<string, unknown>;

    expect(node.after_response).toBeDefined();
    const actions = node.after_response as Record<string, unknown>[];

    expect(
      actions.some(
        a =>
          a.target === STATE_UPDATE_ACTION &&
          Array.isArray(a.state_updates) &&
          (a.state_updates as Record<string, string>[]).some(
            su => 'Refund_Done' in su
          )
      )
    ).toBe(true);
    expect(
      actions.some(a => a.type === 'handoff' && a.target === 'Wrap_Up')
    ).toBe(true);
  });

  it('should emit a diagnostic for transition to @connected_subagent.X in after_response', () => {
    const source = `
${baseConfig}
connected_subagent Order_Agent:
    target: "agent://Order_Agent"
    label: "Order Agent"
    description: "Handles orders"
    after_response:
        transition to @connected_subagent.Other_Agent

connected_subagent Other_Agent:
    target: "agent://Other_Agent"
    label: "Other Agent"
    description: "Other connected agent"
`;
    const { diagnostics } = compile(parseSource(source));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Warning
    );
    // The compile-utils warnIfConnectedAgentTransition path issues a warning
    // when a transition statement targets a connected subagent.
    expect(
      errors.some(
        d =>
          typeof d.message === 'string' &&
          d.message.toLowerCase().includes('connected agent')
      )
    ).toBe(true);
  });
});
