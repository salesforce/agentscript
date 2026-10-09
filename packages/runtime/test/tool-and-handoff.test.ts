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

variables:
    is_verified: mutable boolean = False
        description: "Whether the user is verified"
    email: mutable string = ""
        description: "Customer email"

start_agent intake:
    description: "Collect email and verify identity"

    actions:
        Verify_User:
            description: "Verify the user by email"
            inputs:
                email: string
                    description: "Email"
                    is_required: True
            outputs:
                verified: boolean
                    description: "Verified"
            target: "fn://verify_user"

    reasoning:
        instructions: ->
            | Ask for the email, call {!@actions.verify} with it.
        actions:
            verify: @actions.Verify_User
                with email=@variables.email
                set @variables.is_verified = @outputs.verified

            go_to_help: @utils.transition to @subagent.help
                description: "Transition to help"
                available when @variables.is_verified == True

    after_reasoning:
        if @variables.is_verified:
            transition to @subagent.help

subagent help:
    description: "Actually help the user"
    reasoning:
        instructions: ->
            | Help the user with their question.
`;

describe('Runtime — tool call + handoff', () => {
  it('calls the fn:// tool, applies state_updates, then hands off', async () => {
    const { output, diagnostics } = compileSource(SRC);
    // Ignore the agentforce lint pass that rejects non-Salesforce URI schemes —
    // the runtime itself is dialect-agnostic and accepts any registered scheme.
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('verify_user', args => {
      expect(args.email).toBe('alice@example.com');
      return { verified: true };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Turn in `intake`: LLM calls the verify tool
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'verify',
            arguments: { email: 'alice@example.com' },
          },
        ],
      },
      // Second LLM call in `intake`: no more tools, after_reasoning then
      // triggers the handoff to `help`.
      { text: '' },
      // Final LLM call, now in `help`: produce the user-facing response.
      { text: 'Welcome Alice — how can I help?' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('my email is alice@example.com');

    expect(runtime.state.get('is_verified')).toBe(true);
    expect(result.finalNode).toBe('help');
    expect(result.assistantText).toBe('Welcome Alice — how can I help?');

    expect(llm.calls).toHaveLength(3);
    expect(llm.calls[0].system).toContain('Ask for the email');
    expect(llm.calls[2].system).toContain('Help the user');
  });
});
