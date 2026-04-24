/**
 * Context variable compilation tests — ported from Python:
 * - test_compile_expressions.py (variable namespace tests)
 *
 * Tests linked variables → context variables, source field mapping,
 * and variable namespace resolution.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { CompilerContext } from '../src/compiler-context.js';

describe('context variables: linked variable compilation', () => {
  it('should compile linked string variable to context variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    user_id: linked string
        source: @session.UserId
        description: "User ID"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const userIdVar = contextVars.find(v => v.developer_name === 'user_id');
    expect(userIdVar).toBeDefined();
    expect(userIdVar!.data_type).toBe('string');
    expect(userIdVar!.field_mapping).toBe('session.UserId');
  });

  it('should compile multiple linked variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    user_id: linked string
        source: @session.UserId
        description: "User ID"
    session_id: linked string
        source: @session.SessionId
        description: "Session ID"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    expect(contextVars.length).toBe(2);

    const userIdVar = contextVars.find(v => v.developer_name === 'user_id');
    expect(userIdVar).toBeDefined();

    const sessionVar = contextVars.find(v => v.developer_name === 'session_id');
    expect(sessionVar).toBeDefined();
  });

  it('should not include mutable variables in context_variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    counter: mutable number = 0
        description: "A counter"
    user_id: linked string
        source: @session.UserId
        description: "User ID"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    // Only the linked variable should be in context_variables
    expect(contextVars.length).toBe(1);
    expect(contextVars[0].developer_name).toBe('user_id');

    // The mutable variable should be in state_variables
    const stateVars = output.agent_version.state_variables;
    const counterVar = stateVars.find(v => v.developer_name === 'counter');
    expect(counterVar).toBeDefined();
  });

  it('should include label and description on context variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    account_id: linked string
        source: @Case.AccountId
        label: "Account Identifier"
        description: "The account ID from the case"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const accountVar = contextVars.find(v => v.developer_name === 'account_id');
    expect(accountVar).toBeDefined();
    expect(accountVar!.description).toBe('The account ID from the case');
  });

  it('should compile linked number variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    order_total: linked number
        source: @Order.Total
        description: "Order total"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const orderVar = contextVars.find(v => v.developer_name === 'order_total');
    expect(orderVar).toBeDefined();
    expect(orderVar!.data_type).toBe('number');
  });

  // Python: test_context_variables.TestCompileContextVariable.test_compile_boolean_context_variable
  it('should compile linked boolean variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    is_active: linked boolean
        source: @session.isActive
        description: "Active status flag"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const activeVar = contextVars.find(v => v.developer_name === 'is_active');
    expect(activeVar).toBeDefined();
    expect(activeVar!.data_type).toBe('boolean');
    expect(activeVar!.field_mapping).toBe('session.isActive');
  });

  // Python: test_context_variables.TestCompileContextVariable.test_compile_date_context_variable
  it('should compile linked date variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    start_date: linked date
        source: @request.startDate
        description: "Start date"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const dateVar = contextVars.find(v => v.developer_name === 'start_date');
    expect(dateVar).toBeDefined();
    expect(dateVar!.data_type).toBe('date');
    expect(dateVar!.field_mapping).toBe('request.startDate');
  });

  // Python: test_context_variables.TestCompileContextVariable.test_compile_currency_context_variable
  it('should compile linked currency variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    price: linked currency
        source: @request.price
        description: "Item price"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const priceVar = contextVars.find(v => v.developer_name === 'price');
    expect(priceVar).toBeDefined();
    expect(priceVar!.data_type).toBe('currency');
    expect(priceVar!.field_mapping).toBe('request.price');
  });

  // Python: test_context_variables.TestCompileContextVariable.test_compile_id_context_variable
  it('should compile linked id variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    user_id: linked id
        source: @session.userId
        description: "User identifier"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const idVar = contextVars.find(v => v.developer_name === 'user_id');
    expect(idVar).toBeDefined();
    expect(idVar!.data_type).toBe('id');
    expect(idVar!.field_mapping).toBe('session.userId');
  });

  // Python: test_context_variables.TestCompileContextVariable.test_compile_context_variable_with_no_description
  it('should compile context variable with no description', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    session_id: linked string
        source: @session.sessionID

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const sessionVar = contextVars.find(v => v.developer_name === 'session_id');
    expect(sessionVar).toBeDefined();
    expect(sessionVar!.data_type).toBe('string');
    // Should still have a description (auto-generated from the developer_name)
    expect(sessionVar!.description).toBeDefined();
    expect(typeof sessionVar!.description).toBe('string');
    expect(sessionVar!.description!.length).toBeGreaterThan(0);
  });

  // Python: test_context_variables.TestCompileContextVariable.test_context_variable_name_with__c_suffix_passes
  it('should compile custom field with __c suffix in developer_name', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    WelcomeMessage__c: linked string
        source: @MessagingSession.WelcomeMessage__c
        label: "Welcome Message"
        description: "Custom field welcome message"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const customVar = contextVars.find(
      v => v.developer_name === 'WelcomeMessage__c'
    );
    expect(customVar).toBeDefined();
    expect(customVar!.data_type).toBe('string');
    expect(customVar!.field_mapping).toBe('MessagingSession.WelcomeMessage__c');
    expect(customVar!.description).toBe('Custom field welcome message');
  });

  it('should compile linked variable with VoiceCall source', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    voice_call_id: linked string
        source: @VoiceCall.Id
        description: "This variable may also be referred to as Voice Call Id"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    const voiceCallVar = contextVars.find(
      v => v.developer_name === 'voice_call_id'
    );
    expect(voiceCallVar).toBeDefined();
    expect(voiceCallVar!.data_type).toBe('string');
    expect(voiceCallVar!.field_mapping).toBe('VoiceCall.Id');
    expect(voiceCallVar!.description).toBe(
      'This variable may also be referred to as Voice Call Id'
    );
  });
});

describe('context variables: unsupported type diagnostics', () => {
  // Python: test_context_variables.TestCompileContextVariable.test_compile_context_variable_rejects_object_type
  it('should produce a diagnostic error for object type context variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    object_var: linked object
        source: @request.objectVar
        description: "An object variable"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compile(parseSource(source));

    const typeError = diagnostics.find(d =>
      d.message.includes('Unsupported context variable type')
    );
    expect(typeError).toBeDefined();
    expect(typeError!.message).toContain('object_var');
  });

  // Python: test_context_variables.TestCompileContextVariables.test_compile_empty_variables_definition
  it('should produce no context variables for empty variables definition', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`;
    const { output } = compile(parseSource(source));
    const contextVars = output.global_configuration.context_variables;

    expect(contextVars).toEqual([]);
  });
});

// TODO: Consider adding Pydantic-style name validation to the TS compiler.
// Python enforces: no leading underscore, no trailing underscore, no consecutive
// underscores (except __c suffix for Salesforce custom fields). The TS compiler
// currently does not validate variable names. See Python tests:
//   - test_context_variable_name_with_double_underscores_in_middle_logs_error
//   - test_context_variable_name_starting_with_underscore_logs_error
//   - test_context_variable_name_ending_with_underscore_logs_error
//   - test_variable_name_with_double_underscores_logs_error (state vars)
//   - test_variable_name_starting_with_underscore_logs_error (state vars)
//   - test_variable_name_ending_with_underscore_logs_error (state vars)

describe.skip('context variables: name validation', () => {
  // Python: test_context_variables.test_context_variable_name_with_double_underscores_in_middle_logs_error
  it('should produce diagnostic for context variable with consecutive underscores', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    Account__Number: linked string
        source: @session.AccountNumber
        description: "Account number"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compile(parseSource(source));

    const nameError = diagnostics.find(
      d =>
        d.message.toLowerCase().includes('underscore') ||
        d.message.includes('__')
    );
    expect(nameError).toBeDefined();
  });

  // Python: test_context_variables.test_context_variable_name_starting_with_underscore_logs_error
  it('should produce diagnostic for context variable starting with underscore', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    _invalid_name: linked string
        source: @session.Invalid
        description: "Invalid name"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compile(parseSource(source));

    const nameError = diagnostics.find(
      d =>
        d.message.toLowerCase().includes('start') &&
        d.message.toLowerCase().includes('underscore')
    );
    expect(nameError).toBeDefined();
  });

  // Python: test_context_variables.test_context_variable_name_ending_with_underscore_logs_error
  it('should produce diagnostic for context variable ending with underscore', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    invalid_name_: linked string
        source: @session.Invalid
        description: "Invalid name"

start_agent main:
    description: "desc"
`;
    const { diagnostics } = compile(parseSource(source));

    const nameError = diagnostics.find(
      d =>
        d.message.toLowerCase().includes('end') &&
        d.message.toLowerCase().includes('underscore')
    );
    expect(nameError).toBeDefined();
  });
});

describe('context variables: variable namespace resolution', () => {
  // Python: test_compile_expressions.test_returns_context_when_variable_found_in_context_variables
  it('should resolve linked variable to context namespace', () => {
    const ctx = new CompilerContext();
    ctx.linkedVariableNames.add('user_id');
    expect(ctx.getVariableNamespace('user_id')).toBe('context');
  });

  // Python: test_compile_expressions.test_returns_state_when_variable_found_in_state_variables
  it('should resolve mutable variable to state namespace', () => {
    const ctx = new CompilerContext();
    ctx.mutableVariableNames.add('counter');
    expect(ctx.getVariableNamespace('counter')).toBe('state');
  });

  // Python: test_compile_expressions.test_returns_error_placeholder_when_variable_not_found
  it('should return undefined for unknown variable', () => {
    const ctx = new CompilerContext();
    expect(ctx.getVariableNamespace('unknown_var')).toBeUndefined();
  });

  // Python: test_compile_expressions.test_handles_none_variable_lists
  it('should return undefined when no variables are defined', () => {
    const ctx = new CompilerContext();
    expect(ctx.getVariableNamespace('any_var')).toBeUndefined();
  });
});

describe('context variables: variable expression compilation', () => {
  // Python: test_compile_prompts_and_expressions.test_compile_expression_cases[replaces_context_variables]
  it('should compile linked @variables.x as variables.x in expressions', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    user_status: linked string
        source: @session.Status
        description: "Status"
    counter: mutable number = 0

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | test
        actions:
            my_transition: @utils.transition to @topic.dest
                available when @variables.user_status == "active"

topic dest:
    description: "dest"
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    const tool = node.tools[0];
    // Linked variable should compile to variables.user_status
    expect(tool.enabled).toContain('variables.user_status');
  });

  // Python: test_compile_prompts_and_expressions.test_compile_expression_cases[replaces_state_variables]
  it('should compile mutable @variables.x as state.x in expressions', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    counter: mutable number = 0

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | test
        actions:
            my_transition: @utils.transition to @topic.dest
                available when @variables.counter > 5

topic dest:
    description: "dest"
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    const tool = node.tools[0];
    // Mutable variable should compile to state.counter
    expect(tool.enabled).toContain('state.counter');
  });
});
