/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { compile } from '../src/compile.js';
import type { CompileResult } from '../src/compile.js';
import {
  parseSource,
  readFixtureSource,
  readExpectedYaml,
} from './test-utils.js';

/**
 * Helper: compile a fixture .agent file and compare output to expected .yaml.
 * Compares parsed objects (structural equality) rather than raw strings.
 */
function compileAndCompare(
  agentFixture: string,
  expectedYamlFixture: string
): void {
  const source = readFixtureSource(agentFixture);
  const ast = parseSource(source);
  const result = compile(ast);

  const expectedYaml = readExpectedYaml(expectedYamlFixture);
  const expected = yamlParse(expectedYaml);

  // Round-trip through YAML to normalize the output
  const actual = yamlParse(yamlStringify(result.output));

  expect(actual).toEqual(expected);
}

/**
 * Helper: compile a fixture and return the result for structural checks.
 */
function compileFixture(agentFixture: string): CompileResult {
  const source = readFixtureSource(agentFixture);
  const ast = parseSource(source);
  return compile(ast);
}

// ---------------------------------------------------------------------------
// Basic compilation tests
// ---------------------------------------------------------------------------

describe('compile()', () => {
  it('should produce a valid CompileResult', () => {
    const source = `
config:
    agent_name: "TestBot"
    default_agent_user: "test@test.com"

start_agent main:
    description: "Test topic"
    reasoning:
        instructions: "Do things"
`;
    const ast = parseSource(source);
    const result = compile(ast);

    expect(result.output).toBeDefined();
    expect(result.output.schema_version).toBe('2.0');
    expect(result.diagnostics).toBeDefined();
    expect(result.ranges).toBeDefined();
  });

  it('should set schema_version to 2.0', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "main topic"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(output.schema_version).toBe('2.0');
  });

  it('should extract developer_name from agent_name', () => {
    const source = `
config:
    agent_name: "MyCustomBot"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(output.global_configuration.developer_name).toBe('MyCustomBot');
  });

  it('should derive label from developer_name', () => {
    const source = `
config:
    agent_name: "HelloWorldBot"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(output.global_configuration.label).toBe('Hello World Bot');
  });

  it('should set default planner_type', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(output.agent_version.planner_type).toBe(
      'Atlas__ConcurrentMultiAgentOrchestration'
    );
  });

  it('should always include AgentScriptInternal_next_topic state variable', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const nextTopicVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'AgentScriptInternal_next_topic'
    );
    expect(nextTopicVar).toBeDefined();
    expect(nextTopicVar!.data_type).toBe('string');
    expect(nextTopicVar!.default).toBe('"__EMPTY__"');
  });

  it('should set initial_node from start_agent block name', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent my_entry_point:
    description: "entry"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(output.agent_version.initial_node).toBe('my_entry_point');
  });

  it('should compile modality parameters with default_locale', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_US"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(
      output.agent_version.modality_parameters.language?.default_locale
    ).toBe('en_US');
  });

  it('should produce a diagnostic error for invalid locale', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_US"
    additional_locales: "fr_ES"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { diagnostics } = compile(ast);
    const localeError = diagnostics.find(d => d.code === 'schema-validation');
    expect(localeError).toBeDefined();
    expect(localeError?.message).toContain('fr_ES');
  });

  it('should not produce schema-validation errors for valid locales', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_US"
    additional_locales: "fr"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { diagnostics } = compile(ast);
    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  it('should compile nodes from topic blocks', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "The main topic"

topic secondary:
    description: "A secondary topic"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    expect(output.agent_version.nodes.length).toBe(2);
    const names = output.agent_version.nodes.map(n => n.developer_name);
    expect(names).toContain('main');
    expect(names).toContain('secondary');
  });

  it('should compile mutable variables as state variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    my_var: mutable string = "hello"
        description: "a variable"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const myVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'my_var'
    );
    expect(myVar).toBeDefined();
    expect(myVar!.data_type).toBe('string');
  });

  it('should include config debug/max_tokens/temperature in additional_parameters', () => {
    const source = `
config:
    agent_name: "TestBot"
    debug: True
    max_tokens: 512
    temperature: 0.35

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;

    expect(params).toBeDefined();
    expect(params?.debug).toBe(true);
    expect(params?.max_tokens).toBe(512);
    expect(params?.temperature).toBe(0.35);
  });

  it('should map variable visibility to state variable visibility', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    customer_visible: mutable string = "hello"
        visibility: "public"
    private_state: mutable string = "secret"
        visibility: "private"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const publicVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'customer_visible'
    );
    const privateVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'private_state'
    );

    expect(publicVar?.visibility).toBe('External');
    expect(privateVar?.visibility).toBe('Internal');
  });

  it('should include input schema when specified on an action input', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
    actions:
        Validate_Input:
            description: "Validate input payload"
            target: "flow://ValidateInput"
            inputs:
                payload: string
                    schema: "schema://payload_v1"
    reasoning:
        instructions: "Do it"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    const action = node?.action_definitions?.find(
      a => a.developer_name === 'Validate_Input'
    ) as Record<string, unknown> | undefined;
    const inputs = action?.input_type as
      | Array<Record<string, unknown>>
      | undefined;
    const payload = inputs?.find(i => i.developer_name === 'payload');

    expect(payload?.schema).toBe('schema://payload_v1');
  });

  it('should include topic source on compiled node', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
    source: "flow://TopicSource"
    reasoning:
        instructions: "Do it"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    ) as Record<string, unknown> | undefined;

    expect(node?.source).toBe('flow://TopicSource');
  });

  it('should compile telephony connection into a telephony surface', () => {
    const source = `
config:
    agent_name: "TestBot"

connection telephony:
    escalation_message: "Transferring to phone support"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://phone_route"
    adaptive_response_allowed: True

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output, diagnostics } = compile(ast);
    expect(diagnostics).toHaveLength(0);

    const surfaces = output.agent_version.surfaces ?? [];
    const telephonySurface = surfaces.find(s => s.surface_type === 'telephony');

    expect(telephonySurface).toBeDefined();
    expect(telephonySurface?.adaptive_response_allowed).toBe(true);
    expect(telephonySurface?.outbound_route_configs).toEqual([
      {
        escalation_message: 'Transferring to phone support',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'flow://phone_route',
      },
    ]);
  });

  it('should compile both messaging and telephony connections as separate surfaces', () => {
    const source = `
config:
    agent_name: "TestBot"

connection messaging:
    escalation_message: "Connecting to chat"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://chat_route"
    adaptive_response_allowed: True

connection telephony:
    escalation_message: "Connecting to phone"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://phone_route"
    adaptive_response_allowed: False

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output, diagnostics } = compile(ast);
    expect(diagnostics).toHaveLength(0);

    const surfaces = output.agent_version.surfaces ?? [];
    expect(surfaces.map(s => s.surface_type)).toEqual(
      expect.arrayContaining(['messaging', 'telephony'])
    );

    const messagingSurface = surfaces.find(s => s.surface_type === 'messaging');
    const telephonySurface = surfaces.find(s => s.surface_type === 'telephony');

    expect(
      messagingSurface?.outbound_route_configs?.[0]?.outbound_route_name
    ).toBe('flow://chat_route');
    expect(
      telephonySurface?.outbound_route_configs?.[0]?.outbound_route_name
    ).toBe('flow://phone_route');
    expect(telephonySurface?.adaptive_response_allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Parity: exact match tests (for fixtures with matching schema format)
// ---------------------------------------------------------------------------

describe('parity: hello_world', () => {
  it('should match expected output', () => {
    compileAndCompare('hello_world.agent', 'hello_world_dsl.yaml');
  });
});

// ---------------------------------------------------------------------------
// Structural compilation tests (complex fixtures)
// These verify the compiler handles complex inputs and produces valid output.
// ---------------------------------------------------------------------------

describe('fixture: weather', () => {
  const result = compileFixture('weather.agent');
  const { output } = result;

  it('should compile and produce valid output', () => {
    expect(output.schema_version).toBe('2.0');
    expect(output.agent_version.nodes.length).toBeGreaterThan(0);
  });

  it('should have correct global configuration', () => {
    expect(output.global_configuration.developer_name).toBe(
      'WeatherPro_Assistant'
    );
  });

  it('should have correct node names', () => {
    const nodeNames = output.agent_version.nodes.map(n => n.developer_name);
    expect(nodeNames).toContain('weather_service_router');
    expect(nodeNames).toContain('current_weather_service');
    expect(nodeNames).toContain('severe_weather_alerts');
  });

  it('should have correct initial node', () => {
    expect(output.agent_version.initial_node).toBe('weather_service_router');
  });

  it('should compile state variables including internal variables', () => {
    const varNames = output.agent_version.state_variables.map(
      v => v.developer_name
    );
    expect(varNames).toContain('AgentScriptInternal_next_topic');
  });

  it('should compile tools for current_weather_service', () => {
    const weatherNode = output.agent_version.nodes.find(
      n => n.developer_name === 'current_weather_service'
    );
    expect(weatherNode).toBeDefined();
    expect(weatherNode!.tools.length).toBeGreaterThan(0);
    const toolNames = weatherNode!.tools.map(t => t.name);
    expect(toolNames).toContain('Geocode_Location');
  });
});

describe('fixture: router_node_template', () => {
  const result = compileFixture('router_node_template.agent');
  const { output } = result;

  it('should compile and produce valid output', () => {
    expect(output.schema_version).toBe('2.0');
    expect(output.agent_version.nodes.length).toBeGreaterThan(0);
  });

  it('should have correct node names', () => {
    const nodeNames = output.agent_version.nodes.map(n => n.developer_name);
    expect(nodeNames).toContain('topic_selector');
  });

  it('should compile system messages', () => {
    expect(output.agent_version.system_messages.length).toBeGreaterThan(0);
    const types = output.agent_version.system_messages.map(m => m.message_type);
    expect(types).toContain('Welcome');
    expect(types).toContain('Error');
  });
});

describe('fixture: deep_supervision', () => {
  const result = compileFixture('deep_supervision.agent');
  const { output } = result;

  it('should compile and produce valid output', () => {
    expect(output.schema_version).toBe('2.0');
    expect(output.agent_version.nodes.length).toBeGreaterThan(0);
  });

  it('should have correct node names', () => {
    const nodeNames = output.agent_version.nodes.map(n => n.developer_name);
    expect(nodeNames).toContain('A1');
    expect(nodeNames).toContain('A2');
    expect(nodeNames).toContain('B1');
  });

  it('should compile node descriptions', () => {
    const a1 = output.agent_version.nodes.find(n => n.developer_name === 'A1');
    expect(a1).toBeDefined();
    expect(a1!.description).toBe(
      'Asks the user if they want to know about something?'
    );
  });

  it('should compile transition tools', () => {
    const a1 = output.agent_version.nodes.find(n => n.developer_name === 'A1');
    expect(a1).toBeDefined();
    expect(a1!.tools.length).toBeGreaterThan(0);
  });
});

describe('fixture: matrix', () => {
  const result = compileFixture('matrix.agent');
  const { output } = result;

  it('should compile and produce valid output', () => {
    expect(output.schema_version).toBe('2.0');
    expect(output.agent_version.nodes.length).toBeGreaterThan(0);
  });

  it('should have correct initial node', () => {
    expect(output.agent_version.initial_node).toBe('selector');
  });

  it('should have multiple nodes', () => {
    expect(output.agent_version.nodes.length).toBeGreaterThan(1);
  });

  it('should compile system messages', () => {
    expect(output.agent_version.system_messages.length).toBeGreaterThan(0);
  });
});

describe('fixture: multi-line-descriptions', () => {
  const result = compileFixture('multi-line-descriptions.agent');
  const { output } = result;

  it('should compile and produce valid output', () => {
    expect(output.schema_version).toBe('2.0');
    expect(output.agent_version.nodes.length).toBeGreaterThan(0);
  });

  it('should have multi-line descriptions on nodes', () => {
    const nodes = output.agent_version.nodes;
    expect(nodes.length).toBeGreaterThan(0);
    const hasLongDesc = nodes.some(
      n => n.description.includes('\n') || n.description.length > 50
    );
    expect(hasLongDesc).toBe(true);
  });
});

describe('context validation', () => {
  it('should include valid context in output', () => {
    const source = `
config:
    agent_name: "TestBot"

context:
    memory:
        enabled: True

start_agent main:
    description: "Test"
`;
    const ast = parseSource(source);
    const result = compile(ast);
    const outputRecord = result.output as unknown as Record<string, unknown>;
    const agentVersion = outputRecord.agent_version as Record<string, unknown>;
    const context = agentVersion.context as Record<string, unknown>;
    const memory = context.memory as Record<string, unknown>;

    expect(result.diagnostics).toHaveLength(0);
    expect(outputRecord.context).toBeUndefined();
    expect(context).toBeDefined();
    expect(memory).toBeDefined();
    expect(memory.enabled).toBe(true);
  });

  it('should not include context with missing required fields', () => {
    const source = `
config:
    agent_name: "TestBot"

context:
    memory: {}

start_agent main:
    description: "Test"
`;
    const ast = parseSource(source);
    const result = compile(ast);
    const outputRecord = result.output as unknown as Record<string, unknown>;
    const agentVersion = outputRecord.agent_version as Record<string, unknown>;

    // Should have validation error about missing enabled field
    const contextErrors = result.diagnostics.filter(
      d => d.message.includes('Context memory') || d.message.includes('enabled')
    );
    expect(contextErrors.length).toBeGreaterThan(0);

    // Context should NOT be in output because validation failed
    expect(outputRecord.context).toBeUndefined();
    expect(agentVersion.context).toBeUndefined();
  });
});
