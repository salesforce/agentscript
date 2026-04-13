/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * System message compilation tests — ported from Python:
 * - test_compile_system_messages.py
 *
 * Tests welcome/error message compilation, variable substitution,
 * and formatting preservation.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('system messages', () => {
  // Python: test_compile_system_messages.test_compile_plain_string
  it('should compile plain string welcome message', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "Welcome to our service!"
        error: "An error occurred."

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toBe('Welcome to our service!');
  });

  // Python: test_compile_system_messages.test_compile_plain_string (error part)
  it('should compile plain string error message', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "Welcome"
        error: "An error occurred."

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const errorMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Error'
    );
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.message).toBe('An error occurred.');
  });

  it('should include system messages when explicitly set to empty string', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"

system:
    instructions: "System"
    messages:
        welcome: ""
        error: ""

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const messages = output.agent_version.system_messages ?? [];

    expect(messages.length).toBe(2);

    const welcome = messages.find(m => m.message_type === 'Welcome');
    expect(welcome).toBeDefined();
    expect(welcome!.message).toBe('');

    const error = messages.find(m => m.message_type === 'Error');
    expect(error).toBeDefined();
    expect(error!.message).toBe('');
  });

  // Python: test_compile_system_messages.test_compile_template_no_variables
  it('should compile multiline template without variables', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: |
            Hello!
            Welcome to our service.
        error: "Error"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toContain('Hello!');
    expect(welcomeMsg!.message).toContain('\n');
  });

  // Python: test_compile_system_messages.test_compile_template_with_variables
  it('should compile template with variable substitutions', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: |
            Hello {!@variables.firstName} {!@variables.lastName}!
            Welcome!
        error: "Error"

variables:
    firstName: linked string
        source: @session.FirstName
        description: "First Name"
    lastName: linked string
        source: @session.LastName
        description: "Last Name"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    expect(welcomeMsg).toBeDefined();
    // Context variables in system messages should use {!$Context.varName} format
    expect(welcomeMsg!.message).toContain('{!$Context.firstName}');
    expect(welcomeMsg!.message).toContain('{!$Context.lastName}');
    // Should NOT contain the old format
    expect(welcomeMsg!.message).not.toContain('{{firstName}}');
  });

  // Python: test_compile_system_messages.test_compile_preserves_formatting
  it('should preserve newlines and formatting in messages', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: |
            Welcome!

            This is line 2.

            This is line 3.
        error: |
            Error occurred.

            Details:
            - Issue 1
            - Issue 2

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));

    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    const errorMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Error'
    );

    expect(welcomeMsg).toBeDefined();
    expect(errorMsg).toBeDefined();

    // Welcome message should contain multiple lines
    const welcomeLines = welcomeMsg!.message.split('\n');
    expect(welcomeLines.length).toBeGreaterThanOrEqual(5);
    expect(welcomeMsg!.message).toContain('Welcome!');

    // Error message should contain list items
    const errorLines = errorMsg!.message.split('\n');
    expect(errorLines.length).toBeGreaterThanOrEqual(5);
    expect(errorMsg!.message).toContain('- Issue 1');
    expect(errorMsg!.message).toContain('- Issue 2');
  });

  // Python: test__system_messages.TestCompileSystemMessages.test_compile_system_messages_empty_messages
  it('should compile empty system message strings', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: ""
        error: ""

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    const errorMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Error'
    );

    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toBe('');
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.message).toBe('');
  });

  // Python: test__system_messages.TestCompileSystemMessages.test_compile_system_messages_none_system_block
  it('should compile without errors when system block is missing', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output, diagnostics } = compile(parseSource(source));

    // No system block means no system messages, but no errors either
    const systemMsgErrors = diagnostics.filter(d =>
      d.message.toLowerCase().includes('system')
    );
    expect(systemMsgErrors).toEqual([]);
    // system_messages should be empty or undefined
    expect(output.agent_version.system_messages.length).toBe(0);
  });

  // Python: test__system_messages.TestCompileSystemMessages.test_compile_system_messages_with_instructions_ignored
  it('should not let system instructions affect message compilation', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    instructions: ->
        | You are a helpful AI assistant.
    messages:
        welcome: "Welcome! I'm your AI assistant."
        error: "Oops! Something went wrong."

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    const errorMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Error'
    );

    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toBe("Welcome! I'm your AI assistant.");
    expect(errorMsg).toBeDefined();
    expect(errorMsg!.message).toBe('Oops! Something went wrong.');
  });

  // Python: test__system_messages.TestCompileSystemMessages.test_compile_system_messages_long_content
  it('should preserve long system messages intact', () => {
    const longWelcome =
      'Welcome to our comprehensive customer service platform! ' +
      "We're delighted to have you here. Our AI assistant is equipped " +
      'with advanced capabilities to help you with a wide range of ' +
      'questions and tasks.';

    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "${longWelcome}"
        error: "Error"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );

    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toBe(longWelcome);
    expect(welcomeMsg!.message.length).toBeGreaterThan(100);
  });

  // Python: test__system_messages.TestCompileSystemMessages.test_compile_system_messages_unicode_content
  it('should preserve unicode characters in system messages', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "Bienvenido! Bienvenue! Willkommen!"
        error: "Error occurred"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );

    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toContain('Bienvenido');
    expect(welcomeMsg!.message).toContain('Bienvenue');
    expect(welcomeMsg!.message).toContain('Willkommen');
  });

  // Python: test__system_messages.TestCompileSystemMessages.test_compile_system_messages_both_types
  it('should compile both welcome and error messages together', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: "Welcome to our service! How can I help you today?"
        error: "Sorry, something went wrong. Please try again."

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );
    const errorMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Error'
    );

    expect(welcomeMsg).toBeDefined();
    expect(errorMsg).toBeDefined();
    expect(welcomeMsg!.message).toBe(
      'Welcome to our service! How can I help you today?'
    );
    expect(errorMsg!.message).toBe(
      'Sorry, something went wrong. Please try again.'
    );
  });

  // Python: test__system_messages.TestDynamicSystemMessages.test_compile_system_messages_with_multiple_variables
  it('should compile message with multiple context variables', () => {
    const source = `
config:
    agent_name: "TestBot"

system:
    messages:
        welcome: |
            Hello {!@variables.customer_name}! Welcome to {!@variables.company_name}.
        error: "Error"

variables:
    customer_name: linked string
        source: @session.CustomerName
        description: "Customer name"
    company_name: linked string
        source: @session.CompanyName
        description: "Company name"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Help
`;
    const { output } = compile(parseSource(source));
    const welcomeMsg = output.agent_version.system_messages.find(
      m => m.message_type === 'Welcome'
    );

    expect(welcomeMsg).toBeDefined();
    expect(welcomeMsg!.message).toContain('{!$Context.customer_name}');
    expect(welcomeMsg!.message).toContain('{!$Context.company_name}');
  });
});
