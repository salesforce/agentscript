/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function createLintEngine() {
  return new LintEngine({ passes: defaultRules() });
}

describe('connected_subagent target name validation', () => {
  const baseScript = (targetName: string) => `
config:
  agent_name: "Test"

start_agent Main:
  description: "Main"
  reasoning:
    instructions: -> | Test

connected_subagent Test_Agent:
  target: "agentforce://${targetName}"
  description: "Test agent"
`;

  it('should accept valid target name with letters and numbers', () => {
    const ast = parseDocument(baseScript('Valid_Agent_123'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors).toHaveLength(0);
  });

  it('should accept single letter target name', () => {
    const ast = parseDocument(baseScript('A'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors).toHaveLength(0);
  });

  it('should accept target name with underscores', () => {
    const ast = parseDocument(baseScript('My_Agent_Name'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors).toHaveLength(0);
  });

  it('should reject target name starting with number', () => {
    const ast = parseDocument(baseScript('123_Agent'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('must start with a letter');
  });

  it('should reject target name ending with underscore', () => {
    const ast = parseDocument(baseScript('Agent_'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('cannot end with an underscore');
  });

  it('should reject target name with consecutive underscores', () => {
    const ast = parseDocument(baseScript('Agent__Name'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('consecutive underscores');
  });

  it('should reject target name starting with underscore', () => {
    const ast = parseDocument(baseScript('_Agent'));
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-target-name'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('must start with a letter');
  });
});

describe('connected_subagent scheme validation', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  it('accepts agentforce:// scheme', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Support_Agent

connected_subagent Support_Agent:
  target: "agentforce://Support_Agent"
  label: "Support"
  description: "Support agent"
`);
    const schemeErrors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'connected-agent-unsupported-scheme'
    );
    expect(schemeErrors).toHaveLength(0);
  });

  it('rejects non-agentforce scheme', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.External_Agent

connected_subagent External_Agent:
  target: "third_party://some-service"
  label: "External"
  description: "External agent"
`);
    const schemeErrors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'connected-agent-unsupported-scheme'
    );
    expect(schemeErrors).toHaveLength(1);
    expect(schemeErrors[0].message).toContain('third_party://');
    expect(schemeErrors[0].message).toContain('agentforce://');
  });

  it('rejects mcp:// scheme', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Mcp_Agent

connected_subagent Mcp_Agent:
  target: "mcp://server/tool"
  label: "MCP"
  description: "MCP agent"
`);
    const schemeErrors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'connected-agent-unsupported-scheme'
    );
    expect(schemeErrors).toHaveLength(1);
    expect(schemeErrors[0].message).toContain('mcp://');
  });

  it('reports constraint-pattern for malformed URI', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Bad_Agent

connected_subagent Bad_Agent:
  target: "not-a-uri"
  label: "Bad"
  description: "Bad target"
`);
    const patternErrors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'constraint-pattern'
    );
    expect(patternErrors).toHaveLength(1);
  });
});

describe('connected_subagent reference validation', () => {
  it('should reject {!@connected_subagent.X} in template instructions and suggest correct alias', () => {
    const source = `
config:
  agent_name: "Test"

connected_subagent Support:
  target: "agentforce://Support"
  description: "Support agent"

start_agent Main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route to support: {!@connected_subagent.Support}
    actions:
      call_support: @connected_subagent.Support
        description: "Call support"
`;
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-reference'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Use {!@actions.call_support} instead');
  });

  it('should accept {!@actions.X} reference in template instructions', () => {
    const source = `
config:
  agent_name: "Test"

connected_subagent Support:
  target: "agentforce://Support"
  description: "Support agent"

start_agent Main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route to support: {!@actions.Support}
    actions:
      call_support: @connected_subagent.Support
        description: "Call support"
`;
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-reference'
    );
    expect(errors).toHaveLength(0);
  });

  it('should accept @connected_subagent.X in action definitions', () => {
    const source = `
config:
  agent_name: "Test"

connected_subagent Support:
  target: "agentforce://Support"
  description: "Support agent"

start_agent Main:
  description: "Main"
  reasoning:
    instructions: -> | Route to support
    actions:
      call_support: @connected_subagent.Support
        description: "Call support"
`;
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-reference'
    );
    expect(errors).toHaveLength(0);
  });

  it('should provide generic suggestion when connected subagent is not in any action', () => {
    const source = `
config:
  agent_name: "Test"

connected_subagent Support:
  target: "agentforce://Support"
  description: "Support agent"

start_agent Main:
  description: "Main"
  reasoning:
    instructions: ->
      | Route to support: {!@connected_subagent.Support}
    actions:
      some_other_action: @actions.Lookup_Order
        with order_id = "123"
`;
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const errors = diagnostics.filter(
      (d: Diagnostic) => d.code === 'invalid-connected-subagent-reference'
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain(
      'Use {!@actions.<action_alias>} instead'
    );
  });
});
