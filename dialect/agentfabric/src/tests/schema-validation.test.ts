import { describe, it, expect } from 'vitest';
import { parseDocument, toRecord } from './test-utils.js';
import { compile } from '../compiler/compile.js';
import { AgentFabricSchemaInfo } from '../schema.js';

describe('AgentFabric Schema Validation', () => {
  it('exposes request globalScopes and a2a namespacedFunctions on the schema info', () => {
    const gs = AgentFabricSchemaInfo.globalScopes;
    expect(gs).toBeDefined();
    expect(gs?.request?.has('payload')).toBe(true);
    expect(gs?.request?.has('interface')).toBe(true);
    expect(gs?.request?.has('headers')).toBe(true);

    const nf = AgentFabricSchemaInfo.namespacedFunctions;
    expect(nf).toBeDefined();
    expect(nf?.a2a?.has('task')).toBe(true);
    expect(nf?.a2a?.has('message')).toBe(true);
    expect(nf?.a2a?.has('textPart')).toBe(true);
    expect(nf?.a2a?.has('parts')).toBe(true);
  });

  it('compiled output has correct top-level structure', () => {
    const source = `
config:
  agent_name: "schema-test"
  label: "Schema Test"

trigger t:
  kind: "a2a"
  target: "brokers://schema-test/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "OK"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    const spec = result.output.unifiedAgentSpec;

    // UnifiedAgentSpecification required fields
    expect(spec).toHaveProperty('schema-version');
    expect(spec).toHaveProperty('id');
    expect(spec).toHaveProperty('label');
    expect(spec).toHaveProperty('graph');
    expect(spec.graph).toHaveProperty('initial-node');
    expect(spec.graph).toHaveProperty('nodes');
    expect(spec.graph).toHaveProperty('state-variables');
  });

  it('AgentGraph has all required fields', () => {
    const source = `
config:
  agent_name: "graph-test"

trigger t:
  kind: "a2a"
  target: "brokers://graph-test/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "OK"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    expect(result.output).toHaveProperty('unifiedAgentSpec');
    expect(result.output).toHaveProperty('llmProviders');
    expect(result.output).toHaveProperty('invokableClients');
    expect(result.output).toHaveProperty('responseNodeNames');
    expect(result.output).toHaveProperty('trigger');
    expect(result.output).toHaveProperty('outputStructures');
    expect(Array.isArray(result.output.llmProviders)).toBe(true);
    expect(Array.isArray(result.output.invokableClients)).toBe(true);
    expect(Array.isArray(result.output.responseNodeNames)).toBe(true);
    expect(result.output.trigger).toEqual({
      id: 't',
      kind: 'a2a',
      namespace: 'brokers',
      target_id: 'graph-test',
      on_message: { transition_to: '@echo.done' },
    });
    expect(typeof result.output.outputStructures).toBe('object');
  });

  it('agent nodes conform to AgentNode schema', () => {
    const source = `
config:
  agent_name: "node-test"

llm:
  test_llm:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4"

trigger t:
  kind: "a2a"
  target: "brokers://node-test/a2a"
  on_message: -> transition to @orchestrator.main

orchestrator main:
  description: "Test node"
  llm: @llm.test_llm
  reasoning:
    instructions: -> Do the task
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "OK"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    const agentNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'main'
    );
    expect(agentNode).toBeDefined();
    expect(agentNode).toHaveProperty('type', 'agent');
    expect(agentNode).toHaveProperty('llm');
    expect(agentNode).toHaveProperty('system-prompt');
  });

  it('definitions include IdentityAction', () => {
    const source = `
config:
  agent_name: "def-test"

trigger t:
  kind: "a2a"
  target: "brokers://def-test/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "OK"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    const defs = result.output.unifiedAgentSpec.definitions ?? [];
    const identity = defs.find(d => d.name === 'IdentityAction');
    expect(identity).toBeDefined();
    if (identity && 'client' in identity) {
      expect(identity.client).toBe('in-built');
    }
  });
});
