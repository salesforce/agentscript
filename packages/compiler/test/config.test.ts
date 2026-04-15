/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Config compilation tests — ported from Python test_additional_parameters.py
 * and test_compile.py config assertions.
 *
 * Tests additional parameters extraction, agent name/label derivation,
 * and agent type mapping.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('config: agent configuration', () => {
  // Python: test_compile.test_basic_script — config assertions
  it('should extract developer_name from config', () => {
    const source = `
config:
    developer_name: "Test_Agent_v1"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

start_agent simple:
    description: "Simple topic"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.developer_name).toBe('Test_Agent_v1');
  });

  // Python: test_compile.test_basic_script — label derivation
  it('should derive label from developer_name', () => {
    const source = `
config:
    developer_name: "Test_Agent_v1"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

start_agent simple:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    // developer_name "Test_Agent_v1" → label "Test Agent V 1" (snake_case → Title Case)
    expect(output.global_configuration.label).toBe('Test Agent V 1');
  });

  // Python: test_compile.test_basic_script — description defaults to label
  it('should default description to label when not provided', () => {
    const source = `
config:
    developer_name: "Test_Agent_v1"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

start_agent simple:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.description).toBe(
      output.global_configuration.label
    );
  });

  // Python: test_compile.test_basic_script — agent type mapping
  it('should map AgentforceServiceAgent to EinsteinServiceAgent', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.agent_type).toBe('EinsteinServiceAgent');
  });

  // Python: test_compile.test_basic_script — default_agent_user
  it('should include default_agent_user when provided', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test_user"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.default_agent_user).toBe('test_user');
  });

  // Python: test_compile.test_basic_script — schema version
  it('should set schema_version to 2.0', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.schema_version).toBe('2.0');
  });

  // Python: test_compile.test_basic_script — initial_node from start_agent
  it('should set initial_node from start_agent block name', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.initial_node).toBe('main');
  });

  // agent_template compilation
  it('should compile agent_template from config', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_template: "my_template"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.template_name).toBe('my_template');
  });
});

describe('config: additional parameters', () => {
  // NOTE: Differs from Python compiler — TS always defaults reset_to_initial_node: true
  it('should default reset_to_initial_node to true when config has no extras', () => {
    const source = `
config:
    agent_name: "TestAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.additional_parameters).toEqual({
      reset_to_initial_node: true,
    });
  });

  // Python: test_additional_parameters.test_keeps_disable_groundedness_name_unchanged
  it('should extract DISABLE_GROUNDEDNESS from config', () => {
    const source = `
config:
    agent_name: "TestAgent"
    additional_parameter__DISABLE_GROUNDEDNESS: True

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.DISABLE_GROUNDEDNESS).toBe(true);
  });

  // Python: test_additional_parameters.test_keeps_other_parameter_names_unchanged
  it('should extract reset_to_initial_node from config', () => {
    const source = `
config:
    agent_name: "TestAgent"
    additional_parameter__reset_to_initial_node: True

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.reset_to_initial_node).toBe(true);
  });

  // Python: test_additional_parameters.test_handles_different_value_types (adapted)
  it('should extract debug, max_tokens, temperature from config', () => {
    const source = `
config:
    agent_name: "TestAgent"
    debug: True
    max_tokens: 512
    temperature: 0.35

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.debug).toBe(true);
    expect(params?.max_tokens).toBe(512);
    expect(params?.temperature).toBe(0.35);
  });

  // Python: test_additional_parameters.test_extracts_multiple_parameters_consistently (adapted)
  it('should extract multiple additional parameters together', () => {
    const source = `
config:
    agent_name: "TestAgent"
    additional_parameter__DISABLE_GROUNDEDNESS: True
    additional_parameter__reset_to_initial_node: True
    debug: True

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.DISABLE_GROUNDEDNESS).toBe(true);
    expect(params?.reset_to_initial_node).toBe(true);
    expect(params?.debug).toBe(true);
  });

  // Python: test_additional_parameters.test_ignores_non_additional_parameter_keys (adapted)
  it('should not include regular config keys in additional_parameters', () => {
    const source = `
config:
    agent_name: "TestAgent"
    default_agent_user: "test_user"
    debug: True

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    // Should have debug but not agent_name or default_agent_user
    expect(params?.debug).toBe(true);
    expect(params).not.toHaveProperty('agent_name');
    expect(params).not.toHaveProperty('default_agent_user');
  });

  it('should extract arbitrary additional_parameter__* fields', () => {
    const source = `
config:
    agent_name: "TestAgent"
    additional_parameter__custom_flag: True
    additional_parameter__my_string: "hello"
    additional_parameter__my_number: 42

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.custom_flag).toBe(true);
    expect(params?.my_string).toBe('hello');
    expect(params?.my_number).toBe(42);
  });
});

describe('config: language configuration', () => {
  // Python: test_compile.test_basic_script — language config
  it('should compile default_locale from language block', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_US"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(
      output.agent_version.modality_parameters.language?.default_locale
    ).toBe('en_US');
  });
});

describe('config: planner type', () => {
  // Python: implicit default — planner type
  it('should set default planner_type to Atlas concurrent orchestration', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.planner_type).toBe(
      'Atlas__ConcurrentMultiAgentOrchestration'
    );
  });
});
