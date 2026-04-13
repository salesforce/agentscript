/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine, collectDiagnostics } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function createLintEngine() {
  return new LintEngine({ passes: defaultRules() });
}

function runSecurityLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = createLintEngine();
  const { diagnostics } = engine.run(ast, testSchemaCtx);
  return diagnostics;
}

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = createLintEngine();
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

// ============================================================================
// Empty block rule tests (emptyBlockPass)
// ============================================================================

describe('empty block rule', () => {
  it('reports error for empty inputs block', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  actions:
    get_weather:
      description: "Get weather data"
      inputs:
      target: "flow://get_weather"
  reasoning:
    instructions: ->
      |Do it
`);
    const emptyDiags = diagnostics.filter(d => d.code === 'empty-block');
    expect(emptyDiags).toHaveLength(1);
    expect(emptyDiags[0].message).toContain("'inputs'");
    expect(emptyDiags[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports error for empty outputs block', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  actions:
    get_weather:
      description: "Get weather data"
      outputs:
      target: "flow://get_weather"
  reasoning:
    instructions: ->
      |Do it
`);
    const emptyDiags = diagnostics.filter(d => d.code === 'empty-block');
    expect(emptyDiags).toHaveLength(1);
    expect(emptyDiags[0].message).toContain("'outputs'");
  });

  it('does not flag non-empty inputs block', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  actions:
    get_weather:
      description: "Get weather data"
      inputs:
        city: string
      target: "flow://get_weather"
  reasoning:
    instructions: ->
      |Do it
`);
    const emptyDiags = diagnostics.filter(d => d.code === 'empty-block');
    expect(emptyDiags).toHaveLength(0);
  });
});

// ============================================================================
// Action target scheme validation tests
// ============================================================================

describe('action target scheme validation', () => {
  it('allows flow:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Get_Account"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows apex:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "apex://MyApexClass"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows externalService:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "externalService://api"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows generatePromptResponse:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    summarize:
      description: "Summarize household financial details"
      target: "generatePromptResponse://wealthagent__SummarizeHouseholdFinancialDetails"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('reports error for unsupported scheme', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "mcp://server/tool"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('mcp://');
    expect(errors[0].message).toContain('Supported schemes');
  });

  it('reports error for target without URI scheme', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "just_a_name"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('just_a_name');
  });

  it('reports errors for multiple invalid targets', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    action_a:
      description: "A"
      target: "http://example.com"
    action_b:
      description: "B"
      target: "cli://my-command"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(2);
  });

  it('does not report when target is absent', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('checks targets in start_agent blocks', () => {
    const diagnostics = runSecurityLint(`
start_agent selector:
  label: "Selector"
  actions:
    lookup:
      description: "Lookup"
      target: "badscheme://foo"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('badscheme://');
  });

  it('allows quickAction:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    quick_action:
      description: "Execute Quick Action"
      target: "quickAction://SendEmail"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows api:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    call_api:
      description: "Call API"
      target: "api://external/endpoint"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows mcpTool:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    use_mcp_tool:
      description: "Use MCP Tool"
      target: "mcpTool://server/tool"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows retriever:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    search_knowledge:
      description: "Search Knowledge"
      target: "retriever://knowledge_base"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows slack:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    send_slack_message:
      description: "Send Slack Message"
      target: "slack://channel/message"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows apexRest:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    call_apex_rest:
      description: "Call Apex REST"
      target: "apexRest://MyRestResource"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows auraEnabled:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    call_aura_method:
      description: "Call Aura Enabled Method"
      target: "auraEnabled://MyController.myMethod"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows cdpMlPrediction:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    run_prediction:
      description: "Run ML Prediction"
      target: "cdpMlPrediction://CustomerChurnModel"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows createCatalogItemRequest:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    create_catalog_request:
      description: "Create Catalog Request"
      target: "createCatalogItemRequest://StandardItem"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows serviceCatalog:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    access_catalog:
      description: "Access Service Catalog"
      target: "serviceCatalog://CatalogItem123"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows executeIntegrationProcedure:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    execute_procedure:
      description: "Execute Integration Procedure"
      target: "executeIntegrationProcedure://OrderProcessing"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows integrationProcedureAction:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    integration_action:
      description: "Integration Procedure Action"
      target: "integrationProcedureAction://DataTransform"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows expressionSet:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    run_expression:
      description: "Run Expression Set"
      target: "expressionSet://CalculateTax"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows runExpressionSet:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    execute_expression:
      description: "Execute Expression Set"
      target: "runExpressionSet://ValidationRules"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows externalConnector:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    call_connector:
      description: "Call External Connector"
      target: "externalConnector://PaymentGateway"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });

  it('allows namedQuery:// target', () => {
    const diagnostics = runSecurityLint(`
topic main:
  label: "Main"
  actions:
    execute_query:
      description: "Execute Named Query"
      target: "namedQuery://CustomerRecentOrders"
  reasoning:
    instructions: ->
      |Do it
`);

    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Duplicate key and required field tests (existing passes)
// ============================================================================

describe('duplicate key and required field rules', () => {
  it('reports duplicate description and target in action definition', () => {
    const diagnostics = runLint(`
topic main:
  description: "Main"
  actions:
    get_weather:
      description: "First description"
      description: "Duplicate description"
      target: "flow://test"
      target: "flow://duplicate"
  reasoning:
    instructions: ->
      |Do it
`);
    const dupDiags = diagnostics.filter(d => d.code === 'duplicate-key');
    expect(dupDiags.length).toBeGreaterThanOrEqual(2);
    const messages = dupDiags.map(d => d.message);
    expect(messages.some(m => m.includes("'description'"))).toBe(true);
    expect(messages.some(m => m.includes("'target'"))).toBe(true);
  });

  it('reports duplicate welcome and missing required error in messages', () => {
    const diagnostics = runLint(`
system:
  messages:
    welcome: "First welcome"
    welcome: "Second welcome"
`);
    const dupDiags = diagnostics.filter(d => d.code === 'duplicate-key');
    expect(dupDiags.length).toBeGreaterThanOrEqual(1);
    expect(dupDiags[0].message).toContain("'welcome'");

    const reqDiags = diagnostics.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqDiags.length).toBeGreaterThanOrEqual(1);
    expect(reqDiags.some(d => d.message.includes("'error'"))).toBe(true);
  });

  it('reports missing required description on topic', () => {
    const diagnostics = runLint(`
topic test:
  reasoning:
    instructions: ->
      |Do something
`);
    const reqDiags = diagnostics.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqDiags.length).toBeGreaterThanOrEqual(1);
    expect(reqDiags.some(d => d.message.includes("'description'"))).toBe(true);
  });
});

// ============================================================================
// Agentforce schema integration tests
// ============================================================================

describe('agentforce schema integration', () => {
  it('parses knowledge block fields', () => {
    const diagnostics = runLint(`
knowledge:
  citations_url: "https://example.com"
  rag_feature_config_id: "config_123"
  citations_enabled: True
`);

    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);
  });

  it('parses connection block', () => {
    const diagnostics = runLint(`
connection api:
  adaptive_response_allowed: True
`);

    const unknownBlock = diagnostics.filter(d => d.code === 'unknown-block');
    expect(unknownBlock).toHaveLength(0);
  });

  it('parses developer_name in config', () => {
    const diagnostics = runLint(`
config:
  developer_name: "MyAgent"
  agent_label: "My Agent"
`);

    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);
  });

  it('parses require_user_confirmation in actions', () => {
    const diagnostics = runLint(`
topic main:
  label: "Main"
  actions:
    do_thing:
      description: "Does thing"
      require_user_confirmation: True
      target: "flow://api"
  reasoning:
    instructions: ->
      |Do it
`);

    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);
  });

  it('parses is_displayable on variable properties', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
    is_displayable: True
`);

    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);
  });

  it('allows valid source namespaces on variables', () => {
    const diagnostics = runSecurityLint(`
variables:
  session_id: string
    source: @MessagingSession.Id
  contact_id: string
    source: @MessagingEndUser.ContactId
`);

    const nsErrors = diagnostics.filter(
      d => d.code === 'constraint-allowed-namespaces'
    );
    expect(nsErrors).toHaveLength(0);
  });

  it('reports error for invalid source namespace on variables', () => {
    const diagnostics = runSecurityLint(`
variables:
  session_id: string
    source: @session.sessionID
`);

    const nsErrors = diagnostics.filter(
      d => d.code === 'constraint-allowed-namespaces'
    );
    expect(nsErrors).toHaveLength(1);
    expect(nsErrors[0].message).toContain('@session');
    expect(nsErrors[0].message).toContain('@MessagingSession');
    expect(nsErrors[0].message).toContain('@MessagingEndUser');
  });
});

// ============================================================================
// Hyperclassifier constraint validation
// ============================================================================

describe('hyperclassifier constraints', () => {
  const hyperclassifierSource = (reasoningActions: string, extras = '') => `
start_agent router:
  description: "Routes requests"

  model_config:
    model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"

  actions:
    search_kb:
      description: "Search knowledge base"
      inputs:
        query: string
      outputs:
        result: string
      target: "flow://Search_KB"

  ${extras}

  reasoning:
    instructions: ->
      | Route the user to the best topic.
    actions:
${reasoningActions}

topic support:
  description: "Detailed support"
  reasoning:
    instructions: ->
      | Provide support.

topic self_service:
  description: "Self-service options"
  reasoning:
    instructions: ->
      | Guide through self-service.
`;

  it('reports error for non-transition reasoning actions', () => {
    const diagnostics = runSecurityLint(
      hyperclassifierSource(`
      do_search: @actions.search_kb
        with query=...
      go_support: @utils.transition to @topic.support
        description: "Route to support"`)
    );

    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-non-transition'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('@utils.transition');
  });

  it('reports error for each non-transition action', () => {
    const diagnostics = runSecurityLint(
      hyperclassifierSource(`
      do_search: @actions.search_kb
        with query=...
      escalate_human: @utils.escalate
        description: "Escalate"
      go_support: @utils.transition to @topic.support
        description: "Route to support"`)
    );

    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-non-transition'
    );
    expect(errors).toHaveLength(2);
  });

  it('does not report when only transitions are used', () => {
    const diagnostics = runSecurityLint(
      hyperclassifierSource(`
      go_support: @utils.transition to @topic.support
        description: "Route to support"
      go_self_service: @utils.transition to @topic.self_service
        description: "Route to self-service"`)
    );

    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-non-transition'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports error for before_reasoning directives', () => {
    const diagnostics = runSecurityLint(
      hyperclassifierSource(
        `
      go_support: @utils.transition to @topic.support
        description: "Route to support"`,
        `before_reasoning:
    transition to @topic.support`
      )
    );

    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-before-reasoning'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain(
      'before_reasoning directives are not allowed when using model:'
    );
  });

  it('reports error for after_reasoning directives', () => {
    const diagnostics = runSecurityLint(
      hyperclassifierSource(
        `
      go_support: @utils.transition to @topic.support
        description: "Route to support"`,
        `after_reasoning:
    set @variables.counter = 1`
      )
    );

    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-after-reasoning'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain(
      'after_reasoning directives are not allowed when using model:'
    );
  });

  it('does not flag non-hyperclassifier topics', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Regular topic"

  before_reasoning:
    set @variables.counter = 1

  reasoning:
    instructions: ->
      | Help the user.
    actions:
      do_search: @actions.search_kb
        with query=...

  after_reasoning:
    set @variables.counter = @variables.counter + 1

  actions:
    search_kb:
      description: "Search"
      inputs:
        query: string
      outputs:
        result: string
      target: "flow://Search_KB"
`);

    const hcErrors = diagnostics.filter(
      d =>
        d.code === 'hyperclassifier-non-transition' ||
        d.code === 'hyperclassifier-before-reasoning' ||
        d.code === 'hyperclassifier-after-reasoning'
    );
    expect(hcErrors).toHaveLength(0);
  });

  it('works on topic-level hyperclassifier too', () => {
    const diagnostics = runSecurityLint(`
topic router:
  description: "Router topic"

  model_config:
    model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"

  reasoning:
    instructions: ->
      | Route.
    actions:
      do_search: @actions.search_kb
        with query=...
      go_main: @utils.transition to @topic.main
        description: "Go to main"

  actions:
    search_kb:
      description: "Search"
      inputs:
        query: string
      outputs:
        result: string
      target: "flow://Search_KB"

topic main:
  description: "Main topic"
  reasoning:
    instructions: ->
      | Help.
`);

    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-non-transition'
    );
    expect(errors).toHaveLength(1);
  });
});

// ============================================================================
// System message variable validation
// ============================================================================

describe('system message variable validation', () => {
  it('flags mutable variable in welcome message', () => {
    const diagnostics = runSecurityLint(`
system:
  messages:
    welcome: |
      Hello {!@variables.user_name}!
    error: "Error"

variables:
  user_name: mutable string
`);

    const errors = diagnostics.filter(
      d => d.code === 'system-message-mutable-variable'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain("'user_name'");
    expect(errors[0].message).toContain('mutable');
    expect(errors[0].message).toContain('linked');
  });

  it('allows linked variable in welcome message', () => {
    const diagnostics = runSecurityLint(`
system:
  messages:
    welcome: |
      Hello {!@variables.user_name}!
    error: "Error"

variables:
  user_name: linked string
    source: @MessagingEndUser.ContactId
    description: "User name"
`);

    const errors = diagnostics.filter(
      d => d.code === 'system-message-mutable-variable'
    );
    expect(errors).toHaveLength(0);
  });

  it('flags mutable but not linked in mixed message', () => {
    const diagnostics = runSecurityLint(`
system:
  messages:
    welcome: |
      Hello {!@variables.first_name}, visits: {!@variables.visit_count}
    error: "Error"

variables:
  first_name: linked string
    source: @MessagingEndUser.ContactId
    description: "First name"
  visit_count: mutable number
`);

    const errors = diagnostics.filter(
      d => d.code === 'system-message-mutable-variable'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'visit_count'");
  });

  it('flags mutable variable in error message', () => {
    const diagnostics = runSecurityLint(`
system:
  messages:
    welcome: "Welcome"
    error: |
      Error for {!@variables.session_ref}

variables:
  session_ref: mutable string
`);

    const errors = diagnostics.filter(
      d => d.code === 'system-message-mutable-variable'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'session_ref'");
    expect(errors[0].message).toContain('error');
  });

  it('does not flag plain string messages', () => {
    const diagnostics = runSecurityLint(`
system:
  messages:
    welcome: "Hello!"
    error: "Oops!"

variables:
  counter: mutable number
`);

    const errors = diagnostics.filter(
      d => d.code === 'system-message-mutable-variable'
    );
    expect(errors).toHaveLength(0);
  });

  it('does not flag when no system block', () => {
    const diagnostics = runSecurityLint(`
variables:
  counter: mutable number
`);

    const errors = diagnostics.filter(
      d => d.code === 'system-message-mutable-variable'
    );
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Variable source validation rules
// ============================================================================

describe('variable source validation rules', () => {
  it('reports error when mutable variable has source property', () => {
    const diagnostics = runSecurityLint(`
variables:
  session_id: mutable string
    source: @MessagingSession.Id
    description: "Session ID"
`);

    const errors = diagnostics.filter(
      d => d.code === 'mutable-variable-cannot-have-source'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain("'session_id'");
    expect(errors[0].message).toContain('cannot have a source');
  });

  it('reports error when linked variable missing source property', () => {
    const diagnostics = runSecurityLint(`
variables:
  user_id: linked string
    description: "User identifier"
`);

    const errors = diagnostics.filter(
      d => d.code === 'linked-variable-missing-source'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain("'user_id'");
    expect(errors[0].message).toContain('must have a source');
  });

  it('allows linked variable with valid source', () => {
    const diagnostics = runSecurityLint(`
variables:
  user_id: linked string
    source: @MessagingEndUser.ContactId
    description: "User contact ID"
`);

    const sourceErrors = diagnostics.filter(
      d =>
        d.code === 'mutable-variable-cannot-have-source' ||
        d.code === 'linked-variable-missing-source'
    );
    expect(sourceErrors).toHaveLength(0);
  });

  it('allows mutable variable without source', () => {
    const diagnostics = runSecurityLint(`
variables:
  counter: mutable number
    description: "Request counter"
`);

    const sourceErrors = diagnostics.filter(
      d =>
        d.code === 'mutable-variable-cannot-have-source' ||
        d.code === 'linked-variable-missing-source'
    );
    expect(sourceErrors).toHaveLength(0);
  });

  it('reports multiple errors for multiple invalid variables', () => {
    const diagnostics = runSecurityLint(`
variables:
  session_id: mutable string
    source: @MessagingSession.Id
    description: "Session"
  user_id: linked string
    description: "User"
  order_count: mutable number
    source: @MessagingEndUser.ContactId
    description: "Count"
`);

    const mutableErrors = diagnostics.filter(
      d => d.code === 'mutable-variable-cannot-have-source'
    );
    const linkedErrors = diagnostics.filter(
      d => d.code === 'linked-variable-missing-source'
    );

    expect(mutableErrors).toHaveLength(2); // session_id and order_count
    expect(linkedErrors).toHaveLength(1); // user_id
  });

  it('combines with existing linked variable validations', () => {
    const diagnostics = runSecurityLint(`
variables:
  items: linked list[string]
    description: "Should fail: linked cannot be list and missing source"
`);

    const cannotBeList = diagnostics.filter(
      d => d.code === 'linked-variable-cannot-be-list'
    );
    const missingSource = diagnostics.filter(
      d => d.code === 'linked-variable-missing-source'
    );

    expect(cannotBeList).toHaveLength(1);
    expect(missingSource).toHaveLength(1);
  });

  it('allows variable without modifier (defaults allowed)', () => {
    const diagnostics = runSecurityLint(`
variables:
  temp_value: string
    description: "Temporary value"
`);

    const sourceErrors = diagnostics.filter(
      d =>
        d.code === 'mutable-variable-cannot-have-source' ||
        d.code === 'linked-variable-missing-source'
    );
    expect(sourceErrors).toHaveLength(0);
  });
});

// ============================================================================
// Connection validation rules (connectionValidationRule)
// ============================================================================

describe('connection validation rules', () => {
  it('flags slack with outbound_route_name', () => {
    const diagnostics = runSecurityLint(`
connection slack:
    outbound_route_name: "Slack_Queue"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-disallowed-field'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('outbound_route_name');
  });

  it('flags slack with outbound_route_type', () => {
    const diagnostics = runSecurityLint(`
connection slack:
    outbound_route_type: "OmniChannelFlow"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-disallowed-field'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('outbound_route_type');
  });

  it('flags slack with escalation_message', () => {
    const diagnostics = runSecurityLint(`
connection slack:
    escalation_message: "Escalating to slack"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-disallowed-field'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('escalation_message');
  });

  it('allows slack with only adaptive_response_allowed', () => {
    const diagnostics = runSecurityLint(`
connection slack:
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-disallowed-field'
    );
    expect(errors).toHaveLength(0);
  });

  it('flags service_email with escalation_message', () => {
    const diagnostics = runSecurityLint(`
connection service_email:
    escalation_message: "Escalating"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-disallowed-field'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('escalation_message');
  });

  it('flags service_email with mismatched routing fields', () => {
    const diagnostics = runSecurityLint(`
connection service_email:
    outbound_route_name: "Route_Email"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-missing-paired-field'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('outbound_route_type');
  });

  it('allows service_email with paired routing fields', () => {
    const diagnostics = runSecurityLint(`
connection service_email:
    outbound_route_name: "Route_Email"
    outbound_route_type: "OmniChannelFlow"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d =>
        d.code === 'connection-disallowed-field' ||
        d.code === 'connection-missing-paired-field'
    );
    expect(errors).toHaveLength(0);
  });

  it('flags messaging with mismatched routing fields', () => {
    const diagnostics = runSecurityLint(`
connection messaging:
    outbound_route_type: "OmniChannelFlow"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d => d.code === 'connection-missing-paired-field'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('outbound_route_name');
  });

  it('allows messaging with paired routing fields', () => {
    const diagnostics = runSecurityLint(`
connection messaging:
    outbound_route_name: "Route_Msg"
    outbound_route_type: "OmniChannelFlow"
    adaptive_response_allowed: True
`);

    const errors = diagnostics.filter(
      d =>
        d.code === 'connection-disallowed-field' ||
        d.code === 'connection-missing-paired-field'
    );
    expect(errors).toHaveLength(0);
  });

  it('allows unknown connection type without validation errors', () => {
    const diagnostics = runSecurityLint(`
connection telephony:
    adaptive_response_allowed: True
    escalation_message: "Escalating"
`);

    const errors = diagnostics.filter(
      d =>
        d.code === 'connection-disallowed-field' ||
        d.code === 'connection-missing-paired-field'
    );
    expect(errors).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // empty keyword for connections
  // Python: TestEmptyKeyword
  // -------------------------------------------------------------------------

  // Python: test_surfaces.test_messaging_with_empty_produces_error
  it('produces diagnostics when messaging uses empty keyword', () => {
    const diagnostics = runSecurityLint(`
connection messaging:
    empty
`);
    const errors = diagnostics.filter(
      d => d.code === 'connection-missing-required-fields'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('messaging');
  });

  // Python: test_surfaces.test_service_email_with_empty_produces_error
  it('produces diagnostics when service_email uses empty keyword', () => {
    const diagnostics = runSecurityLint(`
connection service_email:
    empty
`);
    const errors = diagnostics.filter(
      d => d.code === 'connection-missing-required-fields'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('service_email');
  });

  // Python: test_surfaces.test_custom_connection_with_empty_produces_error
  it('produces diagnostics when custom connection uses empty keyword', () => {
    const diagnostics = runSecurityLint(`
connection custom_channel:
    empty
`);
    const errors = diagnostics.filter(
      d => d.code === 'connection-missing-required-fields'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('custom_channel');
  });

  // Python: test_surfaces.test_slack_empty_with_routing_fields_produces_error
  it('produces diagnostics when empty is followed by all routing fields', () => {
    const diagnostics = runLint(`
connection slack:
    empty
    escalation_message: "This should error"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Should_Error"
    adaptive_response_allowed: True
`);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Python: test_surfaces.test_slack_empty_with_only_escalation_message_produces_error
  it('produces diagnostics when empty is followed by escalation_message', () => {
    const diagnostics = runLint(`
connection slack:
    empty
    escalation_message: "Should error"
`);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Python: test_surfaces.test_slack_empty_with_only_outbound_route_type_produces_error
  it('produces diagnostics when empty is followed by outbound_route_type', () => {
    const diagnostics = runLint(`
connection slack:
    empty
    outbound_route_type: "OmniChannelFlow"
`);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  // Python: test_surfaces.test_slack_empty_with_only_outbound_route_name_produces_error
  it('produces diagnostics when empty is followed by outbound_route_name', () => {
    const diagnostics = runLint(`
connection slack:
    empty
    outbound_route_name: "Queue"
`);
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Connected agent bound input validation
// ============================================================================

describe('connected agent bound inputs', () => {
  it('allows input with simple @variables.X reference to linked var', () => {
    const diagnostics = runSecurityLint(`
variables:
  user_id: linked string
    source: @MessagingEndUser.ContactId
    description: "User ID"

connected_subagent order_lookup:
  label: "Order Lookup"
  description: "Looks up orders"
  inputs:
    customer_id: string = @variables.user_id
`);

    const boundErrors = diagnostics.filter(
      d =>
        d.code === 'bound-input-not-variable' ||
        d.code === 'bound-input-not-linked'
    );
    expect(boundErrors).toHaveLength(0);
  });

  it('reports error for computed expression as default value', () => {
    const diagnostics = runSecurityLint(`
variables:
  user_id: linked string
    source: @MessagingEndUser.ContactId
    description: "User ID"

connected_subagent order_lookup:
  label: "Order Lookup"
  description: "Looks up orders"
  inputs:
    customer_id: string = @variables.user_id + 1
`);

    const errors = diagnostics.filter(
      d => d.code === 'bound-input-not-variable'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('simple variable reference');
  });

  it('reports error when default references a mutable variable', () => {
    const diagnostics = runSecurityLint(`
variables:
  counter: mutable number

connected_subagent order_lookup:
  label: "Order Lookup"
  description: "Looks up orders"
  inputs:
    count: number = @variables.counter
`);

    const errors = diagnostics.filter(d => d.code === 'bound-input-not-linked');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain("'counter'");
    expect(errors[0].message).toContain('mutable');
  });

  it('allows input without a default value', () => {
    const diagnostics = runSecurityLint(`
connected_subagent order_lookup:
  label: "Order Lookup"
  description: "Looks up orders"
  inputs:
    customer_id: string
`);

    const boundErrors = diagnostics.filter(
      d =>
        d.code === 'bound-input-not-variable' ||
        d.code === 'bound-input-not-linked'
    );
    expect(boundErrors).toHaveLength(0);
  });

  it('reports errors for multiple invalid inputs', () => {
    const diagnostics = runSecurityLint(`
variables:
  counter: mutable number
  session_id: linked string
    source: @MessagingSession.Id
    description: "Session"

connected_subagent order_lookup:
  label: "Order Lookup"
  description: "Looks up orders"
  inputs:
    count: number = @variables.counter
    ref: string = @variables.session_id + "_suffix"
`);

    const notLinked = diagnostics.filter(
      d => d.code === 'bound-input-not-linked'
    );
    const notVar = diagnostics.filter(
      d => d.code === 'bound-input-not-variable'
    );
    expect(notLinked).toHaveLength(1);
    expect(notVar).toHaveLength(1);
  });

  it('does not flag connected agents without inputs block', () => {
    const diagnostics = runSecurityLint(`
connected_subagent order_lookup:
  label: "Order Lookup"
  description: "Looks up orders"
`);

    const boundErrors = diagnostics.filter(
      d =>
        d.code === 'bound-input-not-variable' ||
        d.code === 'bound-input-not-linked'
    );
    expect(boundErrors).toHaveLength(0);
  });
});

// ============================================================================
// Connected agent no-transition validation
// ============================================================================

describe('connected agent no-transition', () => {
  it('reports error for @utils.transition to @connected_subagent.X in reasoning', () => {
    const diagnostics = runSecurityLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route the user.
    actions:
      transfer: @utils.transition to @connected_subagent.Support_Agent
        description: "Transfer to support"

connected_subagent Support_Agent:
  label: "Support"
  description: "Handles support"
`);

    const errors = diagnostics.filter(
      d => d.code === 'connected-agent-no-transition'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('not yet supported');
    expect(errors[0].message).toContain('@connected_subagent.Support_Agent');
  });

  it('does not flag @connected_subagent.X as a tool invocation', () => {
    const diagnostics = runSecurityLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route the user.
    actions:
      call_support: @connected_subagent.Support_Agent
        description: "Invoke support agent"

connected_subagent Support_Agent:
  label: "Support"
  description: "Handles support"
`);

    const errors = diagnostics.filter(
      d => d.code === 'connected-agent-no-transition'
    );
    expect(errors).toHaveLength(0);
  });

  it('does not flag @utils.transition to @topic.X', () => {
    const diagnostics = runSecurityLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route the user.
    actions:
      go_billing: @utils.transition to @topic.Billing
        description: "Route to billing"

topic Billing:
  description: "Billing"
  reasoning:
    instructions: ->
      | Help with billing.
`);

    const errors = diagnostics.filter(
      d => d.code === 'connected-agent-no-transition'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports error for transition to @connected_subagent.X in after_reasoning', () => {
    const diagnostics = runSecurityLint(`
start_agent main:
  description: "Main"
  after_reasoning:
    transition to @connected_subagent.Support_Agent
  reasoning:
    instructions: ->
      | Help the user.

connected_subagent Support_Agent:
  label: "Support"
  description: "Handles support"
`);

    const errors = diagnostics.filter(
      d => d.code === 'connected-agent-no-transition'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('not yet supported');
  });

  it('reports multiple errors for multiple connected agent transitions', () => {
    const diagnostics = runSecurityLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route the user.
    actions:
      transfer_a: @utils.transition to @connected_subagent.Agent_A
        description: "Transfer to A"
      transfer_b: @utils.transition to @connected_subagent.Agent_B
        description: "Transfer to B"

connected_subagent Agent_A:
  label: "Agent A"
  description: "First agent"

connected_subagent Agent_B:
  label: "Agent B"
  description: "Second agent"
`);

    const errors = diagnostics.filter(
      d => d.code === 'connected-agent-no-transition'
    );
    expect(errors).toHaveLength(2);
  });
});

// ============================================================================
// Reasoning action references vs topic actions
// ============================================================================

describe('reasoning action references against topic.actions', () => {
  it('reports undefined reference when reasoning.actions references non-existent action', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Lookup"
  reasoning:
    instructions: ->
      | Do it
    actions:
      do_search: @actions.nonexistent_action
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(1);
  });

  it('reports undefined reference when reasoning action key matches @actions.X but no topic action exists', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  reasoning:
    instructions: ->
      | Do it
    actions:
      CloseCase: @actions.CloseCase
          with caseRecord=...
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(1);
  });

  it('reports undefined reference for all self-referencing reasoning actions across topics', () => {
    const diagnostics = runSecurityLint(`
config:
    developer_name: "test_reasoning_malform"
    description: "Test"

topic ServiceCustomerVerification:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            CloseCase: @actions.CloseCase
                with caseRecord=...
            CdpGetConnectorMetadata: @actions.CdpGetConnectorMetadata
                with connectorType=...

topic test:
    description: "Test"
    reasoning:
        instructions: ->
            | test
        actions:
            CloseCase2: @actions.CloseCase2
                with caseRecord=...
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(3);
  });

  it('allows reasoning.actions references to defined topic actions', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Lookup"
  reasoning:
    instructions: ->
      | Do it
    actions:
      do_lookup: @actions.lookup
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('allows self-named reasoning action when topic action with same name exists', () => {
    const diagnostics = runSecurityLint(`
topic main:
  description: "Main"
  actions:
    CloseCase:
      description: "Close a case"
      target: "flow://CloseCase"
  reasoning:
    instructions: ->
      | Do it
    actions:
      CloseCase: @actions.CloseCase
          with caseRecord=...
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('reports undefined reference for subagent reasoning.actions too', () => {
    const diagnostics = runSecurityLint(`
subagent main:
  description: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Lookup"
  reasoning:
    instructions: ->
      | Do it
    actions:
      do_search: @actions.nonexistent_action
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(1);
  });
});

// Test that lint rules work with actions syntax
it('warns with actions:', () => {
  const diagnostics = runSecurityLint(`
subagent Order_Management:
  description: "Help with order inquiries"
  actions:
    Get_Order:
      description: "Retrieve order details"
      inputs:
        order_data: object
          description: "The order query parameters"
      outputs:
        result: object
          description: "The order details"
  reasoning:
    instructions: ->
      |Do it
`);
  const warnings = diagnostics.filter(
    d => d.code === 'object-type-missing-schema'
  );
  expect(warnings.length).toBeGreaterThan(0);
});
