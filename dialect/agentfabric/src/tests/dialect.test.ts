import { describe, it, expect } from 'vitest';
import { parseDocument } from './test-utils.js';

describe('AgentFabric Dialect — Schema Parsing', () => {
  it('parses a minimal config block', () => {
    const source = `
config:
  agent_name: "test-agent"
  label: "Test Agent"
  description: "A test agent"
`;
    const doc = parseDocument(source);
    expect(doc.config).toBeDefined();
  });

  it('parses LLM entries', () => {
    const source = `
llm:
  my_llm:
    target: "llm://my_connection"
    kind: "OpenAI"
    model: "gpt-4"
`;
    const doc = parseDocument(source);
    expect(doc.llm).toBeDefined();
  });

  it('parses Gemini LLM entry with variant-only fields', () => {
    const source = `
llm:
  g:
    target: "llm://gem"
    kind: "Gemini"
    model: "gemini-2.0-flash"
    thinking_level: "HIGH"
`;
    const doc = parseDocument(source);
    expect(doc.llm).toBeDefined();
  });

  it('parses actions block', () => {
    const source = `
actions:
  my_tool:
    target: "mcp://some_connection"
    kind: "mcp:tool"
    tool_name: "do-something"
`;
    const doc = parseDocument(source);
    expect(doc.actions).toBeDefined();
  });

  it('parses actions http_headers map', () => {
    const source = `
actions:
  my_tool:
    target: "mcp://some_connection"
    kind: "mcp:tool"
    tool_name: "do-something"
    http_headers:
      X-Api-Key: "secret"
      x-request-id: "abc-123"
`;
    const doc = parseDocument(source);
    expect(doc.actions).toBeDefined();
  });

  it('parses trigger block', () => {
    const source = `
trigger myTrigger:
  kind: "a2a"
  target: "brokers://my-agent/a2a"
  on_message: -> transition to @orchestrator.main
`;
    const doc = parseDocument(source);
    expect(doc.trigger).toBeDefined();
  });

  it('parses orchestrator block', () => {
    const source = `
orchestrator main:
  description: "Main orchestration"
  reasoning:
    instructions: -> Do the thing
  on_exit: -> transition to @echo.response
`;
    const doc = parseDocument(source);
    expect(doc.orchestrator).toBeDefined();
  });

  it('parses generator block', () => {
    const source = `
generator summary:
  prompt: -> Summarize everything
  outputs:
    properties:
      text:
        type: "string"
  on_exit: -> transition to @echo.response
`;
    const doc = parseDocument(source);
    expect(doc.generator).toBeDefined();
  });

  it('parses executor block', () => {
    const source = `
executor doStuff:
  do: ->
    run @actions.my_tool
  on_exit: -> transition to @echo.response
`;
    const doc = parseDocument(source);
    expect(doc.executor).toBeDefined();
  });

  it('parses router block', () => {
    const source = `
router route:
  routes:
    - target: @orchestrator.pathA
      when: @orchestrator.main.output.type == "A"
      label: "A"
  otherwise:
    target: @echo.fallback
`;
    const doc = parseDocument(source);
    expect(doc.router).toBeDefined();
  });

  it('parses echo block', () => {
    const source = `
echo response:
  kind: "a2a:response"
  message: "Done!"
`;
    const doc = parseDocument(source);
    expect(doc.echo).toBeDefined();
  });

  it('parses a full agent with all blocks', () => {
    const source = `
# @dialect: AGENTFABRIC=1.0-BETA

system:
  instructions: "You are a test agent"

config:
  agent_name: "full-test"
  label: "Full Test Agent"

llm:
  test_llm:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4"

actions:
  search:
    target: "mcp://search_mcp"
    kind: "mcp:tool"
    tool_name: "search"

trigger mainTrigger:
  kind: "a2a"
  target: "brokers://full-test/a2a"
  on_message: -> transition to @orchestrator.main

orchestrator main:
  description: "Main orchestration node"
  llm: @llm.test_llm
  reasoning:
    instructions: -> Handle the request
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "All done"
`;
    const doc = parseDocument(source);
    expect(doc.config).toBeDefined();
    expect(doc.llm).toBeDefined();
    expect(doc.actions).toBeDefined();
    expect(doc.trigger).toBeDefined();
    expect(doc.orchestrator).toBeDefined();
    expect(doc.echo).toBeDefined();
  });
});
