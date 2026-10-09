import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const HELLO = `
system:
    instructions: "You are a friendly Salesforce Employee bot."
    messages:
        error: "Sorry, something went wrong."
        welcome: "Hello!"

config:
    agent_name: "HelloWorldBot"
    default_agent_user: "hello@world.com"

language:
    default_locale: "en_US"

start_agent hello_world:
    description: "you do things"

    reasoning:
        instructions: ->
            | respond to whatever the user says! Make sure to speak in iambic pentameter
`;

describe('Runtime — hello_world', () => {
  it('runs one turn with no tool calls and captures assistant text', async () => {
    const { output, diagnostics } = compileSource(HELLO);
    expect(diagnostics.filter(d => d.severity === 1)).toHaveLength(0);

    const llm = new ScriptedLlm([
      { text: 'Upon this morn I greet thee, kind my friend.' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });

    const result = await runtime.turn('Hi there!');

    expect(result.assistantText).toBe(
      'Upon this morn I greet thee, kind my friend.'
    );
    expect(result.finalNode).toBe('hello_world');

    // Verify the system prompt reached the LLM (via the focus_prompt template).
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].system).toContain(
      'You are a friendly Salesforce Employee bot.'
    );
    expect(llm.calls[0].system).toContain('iambic pentameter');
    expect(llm.calls[0].tools).toEqual([]);
  });
});
