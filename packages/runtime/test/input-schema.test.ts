import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const SRC = `
system:
    instructions: "You are a support bot."

config:
    agent_name: "SupportBot"
    default_agent_user: "bot@example.com"

start_agent intake:
    description: "Collect customer info"

    actions:
        Get_Customer_Info:
            description: "Retrieves customer information using email address"
            inputs:
                email: string
                    description: "Customer's email address"
                    is_required: True
            target: "fn://get_customer_info"

    reasoning:
        instructions: ->
            | Ask for the email, call {!@actions.lookup} with it.
        actions:
            lookup: @actions.Get_Customer_Info
                with email=...
`;

describe('Runtime — inputSchemaFromParams', () => {
  it('omits the description key entirely when an input has no description', async () => {
    const { output, diagnostics } = compileSource(SRC);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    // Force the email input to have no description, simulating an action
    // definition produced by a path that does not auto-fill descriptions.
    const node = output.agent_version.nodes[0] as unknown as {
      action_definitions?: Array<{
        developer_name: string;
        input_type?: Array<{ developer_name: string; description?: string }>;
      }>;
    };
    const ad = node.action_definitions!.find(
      d => d.developer_name === 'Get_Customer_Info'
    )!;
    const emailParam = ad.input_type!.find(p => p.developer_name === 'email')!;
    delete emailParam.description;

    const fn = new FnAdapter();
    fn.register('get_customer_info', () => ({}));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([{ text: 'hi' }]);
    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('hello');

    expect(llm.calls).toHaveLength(1);
    const tool = llm.calls[0].tools.find(t => t.name === 'lookup')!;
    expect(tool).toBeDefined();
    const props = (tool.inputSchema as { properties: Record<string, object> })
      .properties;
    const emailProp = props.email as Record<string, unknown>;
    expect(emailProp.type).toBe('string');
    expect(Object.prototype.hasOwnProperty.call(emailProp, 'description')).toBe(
      false
    );
  });

  it('keeps the description key when an input has a description', async () => {
    const { output, diagnostics } = compileSource(SRC);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('get_customer_info', () => ({}));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([{ text: 'hi' }]);
    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('hello');

    const tool = llm.calls[0].tools.find(t => t.name === 'lookup')!;
    const props = (tool.inputSchema as { properties: Record<string, object> })
      .properties;
    const emailProp = props.email as Record<string, unknown>;
    expect(emailProp.description).toBe("Customer's email address");
  });
});
