/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Agent version compilation tests — ported from Python test_agent_version.py.
 *
 * Tests the overall structure of the compiled agent_version output including:
 * - Required fields (nodes, state_variables, initial_node, planner_type)
 * - Config block requirements
 * - start_agent block behavior and initial_node
 * - System messages in additional_parameters
 * - State variables (built-in and user-defined)
 * - Language/modality parameter compilation
 * - Locale validation (valid and invalid)
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import type { CompileResult } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import {
  ALWAYS_PRESENT_STATE_VARIABLES,
  INSTRUCTION_STATE_VARIABLE,
  CONDITION_STATE_VARIABLE,
  DEFAULT_PLANNER_TYPE,
} from '../src/constants.js';

/** Helper: parse source and compile, returning the full CompileResult. */
function compileSource(source: string): CompileResult {
  const ast = parseSource(source);
  return compile(ast);
}

// ---------------------------------------------------------------------------
// Complete valid agent version
// ---------------------------------------------------------------------------

describe('agent version: complete valid structure', () => {
  // Python: test_complete_valid_agent_version
  it('should produce an agent_version with all required fields', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"
    additional_locales: "es_MX, fr"

variables:
    test_var: mutable string = "default_value"

system:
    instructions: ->
        | System instructions

start_agent main:
    description: "Main handler"
    reasoning:
        instructions: ->
            | Handle request

topic secondary:
    description: "Secondary handler"
    reasoning:
        instructions: ->
            | Secondary logic
`;
    const { output, diagnostics } = compileSource(source);
    const av = output.agent_version;

    // Required fields present
    expect(av.planner_type).toBe(DEFAULT_PLANNER_TYPE);
    expect(av.initial_node).toBeDefined();
    expect(av.nodes).toBeDefined();
    expect(av.state_variables).toBeDefined();
    expect(Array.isArray(av.nodes)).toBe(true);
    expect(Array.isArray(av.state_variables)).toBe(true);

    // Nodes compiled from both start_agent and topic blocks
    expect(av.nodes.length).toBe(2);
    const nodeNames = av.nodes.map(n => n.developer_name);
    expect(nodeNames).toContain('main');
    expect(nodeNames).toContain('secondary');

    // Language configuration present
    expect(av.modality_parameters.language).toBeDefined();
    expect(av.modality_parameters.language?.default_locale).toBe('en_US');

    // State variables include built-in + user-defined
    const varNames = av.state_variables?.map(v => v.developer_name) ?? [];
    expect(varNames).toContain('AgentScriptInternal_next_topic');
    expect(varNames).toContain('AgentScriptInternal_agent_instructions');
    expect(varNames).toContain('AgentScriptInternal_condition');
    expect(varNames).toContain('test_var');

    // No schema-validation diagnostics for valid input
    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  it('should set planner_type to Atlas__ConcurrentMultiAgentOrchestration', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    expect(output.agent_version.planner_type).toBe(
      'Atlas__ConcurrentMultiAgentOrchestration'
    );
  });

  it('should always include additional_parameters with reset_to_initial_node', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.reset_to_initial_node).toBe(true);
  });

  it('should allow reset_to_initial_node to be overridden to false', () => {
    const source = `
config:
    agent_name: "TestBot"
    additional_parameter__reset_to_initial_node: False

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params).toBeDefined();
    expect(params?.reset_to_initial_node).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Missing config block
// ---------------------------------------------------------------------------

describe('agent version: missing config block', () => {
  // Python: test_missing_config_block_raises_exception
  // In TS, missing config produces diagnostics rather than exceptions
  it('should produce diagnostics when config block is absent', () => {
    const source = `
start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Handle request
`;
    const { diagnostics } = compileSource(source);
    // Without config, we expect at least a diagnostic about the missing name
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// start_agent block → initial_node
// ---------------------------------------------------------------------------

describe('agent version: start_agent sets initial_node', () => {
  // Python: test_start_agent_block_sets_initial_node
  it('should set initial_node to the start_agent block name', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent my_handler:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Start instructions
`;
    const { output } = compileSource(source);
    expect(output.agent_version.initial_node).toBe('my_handler');
  });

  it('should set initial_node when start_agent coexists with topic blocks', () => {
    const source = `
config:
    agent_name: "TestBot"

topic regular_topic:
    description: "A regular topic"
    reasoning:
        instructions: ->
            | Regular instructions

start_agent start_handler:
    description: "Entry handler"
    reasoning:
        instructions: ->
            | Start instructions
`;
    const { output } = compileSource(source);
    expect(output.agent_version.initial_node).toBe('start_handler');

    // Both blocks compiled as nodes
    const nodeNames = output.agent_version.nodes.map(n => n.developer_name);
    expect(nodeNames).toContain('regular_topic');
    expect(nodeNames).toContain('start_handler');
  });

  // Python: test_start_agent_without_name_defaults_to_start_agent
  it('should default initial_node to "start_agent" when no start_agent block exists', () => {
    const source = `
config:
    agent_name: "TestBot"

topic only_topic:
    description: "Only a topic block"
    reasoning:
        instructions: ->
            | Some instructions
`;
    const { output, diagnostics } = compileSource(source);
    // When no start_agent block, initial_node defaults to 'start_agent'
    expect(output.agent_version.initial_node).toBe('start_agent');
    // And a diagnostic about missing start_agent
    const startAgentError = diagnostics.find(d =>
      d.message.includes('start_agent')
    );
    expect(startAgentError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// System messages → additional_parameters
// ---------------------------------------------------------------------------

describe('agent version: system messages in additional_parameters', () => {
  // Python: test_system_messages_injected_into_additional_parameters
  it('should inject system_messages as JSON string into additional_parameters', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    instructions: ->
        | System instructions
    messages:
        welcome: "Welcome! I'm your assistant."
        error: "Sorry, something went wrong."

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Topic instructions
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;

    expect(params).toBeDefined();
    expect(params?.system_messages).toBeDefined();
    expect(typeof params?.system_messages).toBe('string');

    const parsed = JSON.parse(params?.system_messages as string) as Array<{
      message: string;
      messageType: string;
    }>;
    expect(parsed).toHaveLength(2);
    expect(parsed[0].message).toBe("Welcome! I'm your assistant.");
    expect(parsed[0].messageType).toBe('Welcome');
    expect(parsed[1].message).toBe('Sorry, something went wrong.');
    expect(parsed[1].messageType).toBe('Error');
  });

  it('should not include system_messages when no messages block exists', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Instructions
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;

    // additional_parameters present (reset_to_initial_node) but no system_messages
    expect(params?.reset_to_initial_node).toBe(true);
    expect(params?.system_messages).toBeUndefined();
  });

  it('should include system_messages alongside reset_to_initial_node', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "Hello"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const params = output.agent_version.additional_parameters as
      | Record<string, unknown>
      | undefined;

    expect(params?.reset_to_initial_node).toBe(true);
    expect(params?.system_messages).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Empty variables → only built-in state variables
// ---------------------------------------------------------------------------

describe('agent version: state variables', () => {
  // Python: test_empty_variables_creates_empty_state_variables
  it('should include only built-in state variables when no variables are defined', () => {
    const source = `
config:
    agent_name: "NoVarsAgent"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const vars = output.agent_version.state_variables ?? [];

    // Should have the always-present variables plus instruction + condition
    const builtInNames = [
      ...ALWAYS_PRESENT_STATE_VARIABLES.map(v => v.developer_name),
      INSTRUCTION_STATE_VARIABLE.developer_name,
      CONDITION_STATE_VARIABLE.developer_name,
    ];

    for (const name of builtInNames) {
      expect(vars.find(v => v.developer_name === name)).toBeDefined();
    }

    // No user-defined variables
    const userVars = vars.filter(v => !builtInNames.includes(v.developer_name));
    expect(userVars).toHaveLength(0);
  });

  // Python: test_variables_with_different_types
  it('should compile string variables with correct data_type and default', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    string_var: mutable string = "test"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const sv = output.agent_version.state_variables?.find(
      v => v.developer_name === 'string_var'
    );
    expect(sv).toBeDefined();
    expect(sv?.data_type).toBe('string');
    expect(sv?.is_list).toBe(false);
    expect(sv?.default).toBe("'test'");
    expect(sv?.visibility).toBe('Internal');
  });

  it('should compile number variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    number_var: mutable number = 42

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const sv = output.agent_version.state_variables?.find(
      v => v.developer_name === 'number_var'
    );
    expect(sv).toBeDefined();
    expect(sv?.data_type).toBe('number');
    expect(sv?.is_list).toBe(false);
    expect(sv?.default).toBe(42);
  });

  it('should compile boolean variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    boolean_var: mutable boolean = True

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const sv = output.agent_version.state_variables?.find(
      v => v.developer_name === 'boolean_var'
    );
    expect(sv).toBeDefined();
    expect(sv?.data_type).toBe('boolean');
    expect(sv?.is_list).toBe(false);
    expect(sv?.default).toBe(true);
  });

  it('should compile multiple variables of different types together', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    str_var: mutable string = "hello"
    num_var: mutable number = 99
    bool_var: mutable boolean = False

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const vars = output.agent_version.state_variables ?? [];

    const strVar = vars.find(v => v.developer_name === 'str_var');
    const numVar = vars.find(v => v.developer_name === 'num_var');
    const boolVar = vars.find(v => v.developer_name === 'bool_var');

    expect(strVar?.data_type).toBe('string');
    expect(numVar?.data_type).toBe('number');
    expect(boolVar?.data_type).toBe('boolean');

    expect(strVar?.default).toBe("'hello'");
    expect(numVar?.default).toBe(99);
    expect(boolVar?.default).toBe(false);
  });

  it('should generate label from developer_name for state variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    my_custom_var: mutable string = "val"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const sv = output.agent_version.state_variables?.find(
      v => v.developer_name === 'my_custom_var'
    );
    expect(sv).toBeDefined();
    // The label should be derived from the developer_name via normalizeDeveloperName
    expect(sv?.label).toBeDefined();
    expect(typeof sv?.label).toBe('string');
    expect(sv?.label?.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Language block compilation
// ---------------------------------------------------------------------------

describe('agent version: language block', () => {
  // Python: test_language_block_with_all_fields
  it('should compile language block with all fields (default_locale + additional_locales)', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_US"
    additional_locales: "en_GB, de, fr"

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    const lang = output.agent_version.modality_parameters.language;

    expect(lang).toBeDefined();
    expect(lang?.default_locale).toBe('en_US');
    expect(lang?.additional_locales).toEqual(
      expect.arrayContaining(['en_GB', 'de', 'fr'])
    );

    // No schema-validation errors
    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  // Python: test_language_block_minimal
  it('should compile language block with only default_locale', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "fr"

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    const lang = output.agent_version.modality_parameters.language;

    expect(lang).toBeDefined();
    expect(lang?.default_locale).toBe('fr');
    expect(lang?.additional_locales).toEqual([]);

    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  // Python: test_modality_parameters_language_config_optional
  it('should have empty modality_parameters when no language block exists', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    // When no language block, modality_parameters is empty object (language is null)
    expect(output.agent_version.modality_parameters).toBeDefined();
    expect(output.agent_version.modality_parameters.language).toBeUndefined();
  });

  it('should compile all_additional_locales flag', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "ja"
    additional_locales: "en_US, en_GB"
    all_additional_locales: True

start_agent main:
    description: "desc"
`;
    const { output, diagnostics } = compileSource(source);
    const lang = output.agent_version.modality_parameters.language;

    expect(lang).toBeDefined();
    expect(lang?.default_locale).toBe('ja');
    expect(lang?.all_additional_locales).toBe(true);

    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Language block locale validation (invalid locales)
// ---------------------------------------------------------------------------

describe('agent version: locale validation', () => {
  // Python: test_language_block_invalid_default_locale
  it('should produce a schema-validation diagnostic for invalid default_locale', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "fr_FR"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const localeError = diagnostics.find(
      d => d.code === 'schema-validation' && d.message.includes('fr_FR')
    );
    expect(localeError).toBeDefined();
  });

  // Python: test_language_block_invalid_additional_locale
  it('should produce a schema-validation diagnostic for invalid additional_locale', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_US"
    additional_locales: "JP_jp"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const localeError = diagnostics.find(
      d => d.code === 'schema-validation' && d.message.includes('JP_jp')
    );
    expect(localeError).toBeDefined();
  });

  // Python: test_language_block_multiple_invalid_locales
  it('should report multiple invalid locales in diagnostics', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "en_UK"
    additional_locales: "fr_FR, es_ES"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );

    // Should have at least one error for each invalid locale
    // en_UK is invalid, fr_FR is invalid, es_ES is invalid
    expect(schemaErrors.length).toBeGreaterThanOrEqual(1);

    // At least the invalid default_locale should be flagged
    const defaultLocaleError = schemaErrors.find(d =>
      d.message.includes('en_UK')
    );
    expect(defaultLocaleError).toBeDefined();
  });

  // Python: test_language_block_all_valid_locales
  it('should not produce schema-validation errors for all valid locales', () => {
    const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "ja"
    additional_locales: "en_US, en_GB, fr, de, es, zh_CN, ko, pt_BR"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compileSource(source);
    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });

  it('should accept all individual valid locale codes', () => {
    // A representative sample of valid locales (STANDARD + END_USER types)
    const validLocales = [
      'en_US',
      'en_GB',
      'fr',
      'it',
      'de',
      'es',
      'es_MX',
      'ja',
      'zh_CN',
      'zh_TW',
      'ko',
      'pt_PT',
      'pt_BR',
      'ar',
      'tr',
      'pl',
      'ro',
    ];

    for (const locale of validLocales) {
      const source = `
config:
    agent_name: "TestBot"

language:
    default_locale: "${locale}"

start_agent main:
    description: "desc"
`;
      const { diagnostics } = compileSource(source);
      const schemaErrors = diagnostics.filter(
        d => d.code === 'schema-validation'
      );
      expect(
        schemaErrors,
        `Expected no schema-validation errors for locale "${locale}", got: ${JSON.stringify(schemaErrors)}`
      ).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Company and role
// ---------------------------------------------------------------------------

describe('agent version: company and role', () => {
  it('should include company and role when specified in config', () => {
    const source = `
config:
    agent_name: "TestBot"
    company: "Acme Corp"
    role: "Customer Service Agent"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const av = output.agent_version;
    expect(av.company).toBe('Acme Corp');
    expect(av.role).toBe('Customer Service Agent');
  });

  it('should omit company and role when not specified in config', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const av = output.agent_version;
    // company and role are not set when absent in config
    expect(av.company).toBeUndefined();
    expect(av.role).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

describe('agent version: surfaces', () => {
  it('should have empty surfaces when no connection blocks exist', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const surfaces = output.agent_version.surfaces ?? [];
    expect(surfaces).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Nodes compilation within agent_version
// ---------------------------------------------------------------------------

describe('agent version: nodes', () => {
  it('should compile start_agent blocks into nodes', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent entry:
    description: "The entry point"
    reasoning:
        instructions: ->
            | Entry instructions
`;
    const { output } = compileSource(source);
    const nodes = output.agent_version.nodes;
    expect(nodes.length).toBe(1);
    expect(nodes[0].developer_name).toBe('entry');
  });

  it('should compile both start_agent and topic blocks as nodes', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent entry:
    description: "Entry point"
    reasoning:
        instructions: "Start"

topic helper:
    description: "Helper topic"
    reasoning:
        instructions: "Help"

topic other:
    description: "Other topic"
    reasoning:
        instructions: "Other"
`;
    const { output } = compileSource(source);
    const nodes = output.agent_version.nodes;
    expect(nodes.length).toBe(3);
    const names = nodes.map(n => n.developer_name);
    expect(names).toContain('entry');
    expect(names).toContain('helper');
    expect(names).toContain('other');
  });

  it('should have empty nodes array when no topic or start_agent blocks exist', () => {
    const source = `
config:
    agent_name: "TestBot"
`;
    const { output } = compileSource(source);
    expect(output.agent_version.nodes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// System messages in agent_version.system_messages
// ---------------------------------------------------------------------------

describe('agent version: system_messages field', () => {
  it('should populate system_messages with welcome and error messages', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "Hello there!"
        error: "Oops, error."

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    const msgs = output.agent_version.system_messages;
    expect(msgs.length).toBe(2);

    const welcome = msgs.find(m => m.message_type === 'Welcome');
    const error = msgs.find(m => m.message_type === 'Error');

    expect(welcome?.message).toBe('Hello there!');
    expect(error?.message).toBe('Oops, error.');
  });

  it('should have empty system_messages when no system block exists', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compileSource(source);
    expect(output.agent_version.system_messages).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Full integration: config + language + variables + system + topics
// ---------------------------------------------------------------------------

describe('agent version: full integration', () => {
  it('should compile a complete agent script with all block types', () => {
    const source = `
config:
    agent_name: "FullAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "admin@example.com"
    company: "TestCo"
    role: "Support Agent"

language:
    default_locale: "en_US"
    additional_locales: "es_MX, fr"

variables:
    customer_name: mutable string = "Unknown"
    retry_count: mutable number = 0
    is_authenticated: mutable boolean = False

system:
    instructions: ->
        | You are a helpful support agent for TestCo.
    messages:
        welcome: "Welcome to TestCo support!"
        error: "We encountered an issue. Please try again."

start_agent greeting:
    description: "Greet the customer"
    reasoning:
        instructions: ->
            | Welcome the customer and ask how you can help.

topic troubleshoot:
    description: "Troubleshoot customer issues"
    reasoning:
        instructions: ->
            | Walk through diagnostic steps.
`;
    const { output, diagnostics } = compileSource(source);
    const av = output.agent_version;

    // Planner type
    expect(av.planner_type).toBe(DEFAULT_PLANNER_TYPE);

    // Initial node
    expect(av.initial_node).toBe('greeting');

    // Nodes
    expect(av.nodes.length).toBe(2);
    const nodeNames = av.nodes.map(n => n.developer_name);
    expect(nodeNames).toContain('greeting');
    expect(nodeNames).toContain('troubleshoot');

    // State variables: built-in + 3 user-defined
    const varNames = av.state_variables?.map(v => v.developer_name) ?? [];
    expect(varNames).toContain('customer_name');
    expect(varNames).toContain('retry_count');
    expect(varNames).toContain('is_authenticated');
    expect(varNames).toContain('AgentScriptInternal_next_topic');

    // Language
    expect(av.modality_parameters.language?.default_locale).toBe('en_US');
    expect(av.modality_parameters.language?.additional_locales).toEqual(
      expect.arrayContaining(['es_MX', 'fr'])
    );

    // System messages
    expect(av.system_messages.length).toBe(2);

    // Additional parameters
    const params = av.additional_parameters as
      | Record<string, unknown>
      | undefined;
    expect(params?.reset_to_initial_node).toBe(true);
    expect(params?.system_messages).toBeDefined();

    // Company and role
    expect(av.company).toBe('TestCo');
    expect(av.role).toBe('Support Agent');

    // No schema-validation errors
    const schemaErrors = diagnostics.filter(
      d => d.code === 'schema-validation'
    );
    expect(schemaErrors).toHaveLength(0);
  });
});
