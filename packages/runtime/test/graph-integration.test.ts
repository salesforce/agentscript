import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  type RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * End-to-end graph integration test.
 *
 * Exercises, in a single run:
 *   - `before_reasoning` action that runs a tool and applies state updates
 *   - `{{ state.x }}` template interpolation in the system prompt
 *   - LLM-driven tool call during the reasoning loop
 *   - State updates from a tool's `result.*` output
 *   - `after_reasoning` conditional `transition` that fires based on state
 *   - Intra-turn subagent handoff (topic_selector -> order_details)
 *   - Multi-turn session (state + chat history persist across runtime.turn())
 *   - Event stream captures tool-call, tool-result, state-change, node-enter,
 *     node-exit, llm-text, turn-start, turn-end
 */

const SRC = `
system:
    instructions: "You are an order assistant."

config:
    agent_name: "OrderBot"
    default_agent_user: "bot@example.com"

variables:
    customer_email: mutable string = ""
        description: "Email"
    customer_verified: mutable boolean = False
        description: "Verified"
    order_number: mutable string = ""
        description: "Order number"
    order_status: mutable string = ""
        description: "Status"
    order_ready: mutable boolean = False
        description: "Ready to show"

start_agent topic_selector:
    description: "Greet, collect email, verify"

    actions:
        Verify_Customer:
            description: "Verify customer by email"
            inputs:
                email: string
                    description: "Customer email"
                    is_required: True
            outputs:
                verified: boolean
                    description: "Verified"
            target: "fn://verify_customer"

        Lookup_Order:
            description: "Look up order by number"
            inputs:
                order_number: string
                    description: "Order number"
                    is_required: True
            outputs:
                status: string
                    description: "Status"
            target: "fn://lookup_order"

    before_reasoning:
        if @variables.customer_email != "" and @variables.customer_verified == False:
            run @actions.Verify_Customer
                with email=@variables.customer_email
                set @variables.customer_verified = @outputs.verified

    reasoning:
        instructions: ->
            | Customer: {! @variables.customer_email }, verified={! @variables.customer_verified }
            | Ask for the order number, then call {!@actions.lookup} to fetch status.
        actions:
            lookup: @actions.Lookup_Order
                with order_number=@variables.order_number
                set @variables.order_status = @outputs.status
                set @variables.order_ready = True

            show_details: @utils.transition to @subagent.order_details
                description: "Show details after lookup"
                available when @variables.order_ready == True

    after_reasoning:
        if @variables.order_ready == True:
            transition to @subagent.order_details

subagent order_details:
    description: "Show the order details to the customer"
    reasoning:
        instructions: ->
            | Here is your order:
            | Number: {! @variables.order_number }
            | Status: {! @variables.order_status }
`;

describe('Runtime — graph integration', () => {
  it('processes a multi-subagent graph with hooks, tools, transitions, and multiple turns', async () => {
    const { output, diagnostics } = compileSource(SRC);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    // Sanity: the compiler produced two subagent nodes.
    const version = Array.isArray(output.agent_version)
      ? output.agent_version[0]
      : output.agent_version;
    const nodeNames = version.nodes.map(n => n.developer_name).sort();
    expect(nodeNames).toEqual(['order_details', 'topic_selector']);

    const fn = new FnAdapter();
    let verifyCalledWith: unknown = null;
    let lookupCalledWith: unknown = null;
    fn.register('verify_customer', args => {
      verifyCalledWith = args;
      return { verified: true };
    });
    fn.register('lookup_order', args => {
      lookupCalledWith = args;
      return { status: 'shipped' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    // Turn 1: user supplies email + order number via setVariables (simulated by
    // seeding context before the turn). In a real host, the LLM would call
    // @utils.setVariables. For this test, we seed via runtime.state.set for
    // mutable vars (pretending a prior turn did the capture).
    const llm = new ScriptedLlm([
      // Turn 1, iteration 1 in topic_selector: call the lookup tool.
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'lookup',
            arguments: { order_number: 'ORD-42' },
          },
        ],
      },
      // Turn 1, iteration 2 in topic_selector: no tools; after_reasoning
      // then fires the transition to order_details.
      { text: '' },
      // Turn 1, iteration 1 in order_details: produce the final text.
      { text: 'Your order ORD-42 is shipped.' },
      // Turn 2 in order_details: follow-up response.
      { text: 'Anything else I can help with?' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });

    // Seed state as if a prior turn captured these from the user.
    runtime.state.set('customer_email', 'alice@example.com');
    runtime.state.set('order_number', 'ORD-42');

    // Capture all events
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    // --- Turn 1 ---
    const r1 = await runtime.turn('track my order ORD-42');

    // before_reasoning ran verify_customer and flipped customer_verified.
    expect(verifyCalledWith).toEqual({ email: 'alice@example.com' });
    expect(runtime.state.get('customer_verified')).toBe(true);

    // LLM tool call dispatched through fn adapter.
    expect(lookupCalledWith).toEqual({ order_number: 'ORD-42' });
    expect(runtime.state.get('order_status')).toBe('shipped');
    expect(runtime.state.get('order_ready')).toBe(true);

    // after_reasoning transitioned to order_details; the follow-up LLM step
    // produced the final assistant text.
    expect(r1.finalNode).toBe('order_details');
    expect(r1.assistantText).toBe('Your order ORD-42 is shipped.');

    // Event stream must include the hop: enter topic_selector -> exit to
    // order_details -> enter order_details.
    const nodeTrace = events
      .filter(
        e =>
          e.kind === 'node-enter' ||
          e.kind === 'node-exit' ||
          e.kind === 'turn-start' ||
          e.kind === 'turn-end'
      )
      .map(e =>
        e.kind === 'node-enter'
          ? `enter:${e.node}`
          : e.kind === 'node-exit'
            ? `exit:${e.node}->${e.to ?? '<none>'}`
            : e.kind === 'turn-start'
              ? `turn-start:${e.node}`
              : `turn-end:${e.node}`
      );
    // First turn-start is the initial node; we see an enter for each node visited.
    expect(nodeTrace).toEqual([
      'turn-start:topic_selector',
      'enter:topic_selector',
      'exit:<current>->order_details',
      'enter:order_details',
      'turn-end:order_details',
    ]);

    // State changes fired for the verify + lookup updates.
    const stateChanges = events
      .filter(e => e.kind === 'state-change')
      .map(e => e.name);
    expect(stateChanges).toContain('customer_verified');
    expect(stateChanges).toContain('order_status');
    expect(stateChanges).toContain('order_ready');

    // Tool-call / tool-result pairs.
    const toolCalls = events.filter(e => e.kind === 'tool-call');
    const toolResults = events.filter(e => e.kind === 'tool-result');
    expect(toolCalls.map(e => (e as { name: string }).name)).toEqual([
      'fn://verify_customer',
      'fn://lookup_order',
    ]);
    expect(toolResults).toHaveLength(2);

    // LLM driver saw 3 calls in turn 1: two reasoning iterations in
    // topic_selector (tool call, then no-op) + one in order_details.
    expect(llm.calls).toHaveLength(3);
    expect(llm.calls[0].system).toContain('alice@example.com');
    expect(llm.calls[0].system).toContain('verified=true');
    expect(llm.calls[2].system).not.toContain('Ask for the order number');
    expect(llm.calls[2].system).toContain('Here is your order');

    // --- Turn 2 ---
    const r2 = await runtime.turn('thanks');
    expect(r2.finalNode).toBe('order_details');
    expect(r2.assistantText).toBe('Anything else I can help with?');

    // State persisted across turns.
    expect(runtime.state.get('order_status')).toBe('shipped');
    expect(runtime.state.get('customer_verified')).toBe(true);

    // before_reasoning did NOT re-run verify (guarded by verified==False).
    expect(llm.calls).toHaveLength(4);
  });
});
