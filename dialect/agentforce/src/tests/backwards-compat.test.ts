/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Backwards compatibility tests for the Agentforce dialect.
 *
 * The Agentforce dialect supports BOTH old and new naming conventions:
 *   - Root block: `topic` (old), `subagent` (new), `start_agent` (alias for both)
 *   - Action definitions: `actions:`
 *   - Reasoning actions: `actions:`
 *
 * These tests verify that old names, new names, and mixed usage all work.
 */

import { describe, it, expect } from 'vitest';
import { LintEngine, collectDiagnostics } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import {
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
} from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function createLintEngine() {
  return new LintEngine({ passes: defaultRules() });
}

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = createLintEngine();
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

// ============================================================================
// Parsing: old names, new names, and mixed
// ============================================================================

describe('backwards compatibility: parsing', () => {
  it('parses a document using only old names (topic + actions)', () => {
    const source = `
topic main:
  description: "Main topic"
  actions:
    fetch_data:
      description: "Fetch data"
      target: "flow://Fetch_Data"
      inputs:
        query: string
      outputs:
        result: string
  reasoning:
    instructions: ->
      | Help the user.
    actions:
      do_fetch: @actions.fetch_data
        with query=...
        set @variables.status=@outputs.result
`;
    const ast = parseDocument(source);
    expect(ast.topic).toBeDefined();
    const topics = ast.topic!;
    expect(topics.has('main')).toBe(true);

    const main = topics.get('main')!;
    expect(main.actions).toBeDefined();
    expect(main.reasoning).toBeDefined();

    const actions = main.actions!;
    expect(actions.has('fetch_data')).toBe(true);

    const reasoning = main.reasoning!;
    expect(reasoning.actions).toBeDefined();
    const raActions = reasoning.actions!;
    expect(raActions.has('do_fetch')).toBe(true);
  });

  it('parses a document using subagent with actions', () => {
    const source = `
subagent main:
  description: "Main subagent"
  actions:
    fetch_data:
      description: "Fetch data"
      target: "flow://Fetch_Data"
      inputs:
        query: string
      outputs:
        result: string
  reasoning:
    instructions: ->
      | Help the user.
    actions:
      do_fetch: @actions.fetch_data
        with query=...
        set @variables.status=@outputs.result
`;
    const ast = parseDocument(source);
    // 'subagent' is aliased to 'topic' but stored under its own key
    expect(ast.subagent).toBeDefined();
    const subagents = ast.subagent!;
    expect(subagents.has('main')).toBe(true);

    const main = subagents.get('main')!;
    expect(main.actions).toBeDefined();
    expect(main.reasoning).toBeDefined();

    const actionDefs = main.actions!;
    expect(actionDefs.has('fetch_data')).toBe(true);

    const reasoning = main.reasoning!;
    expect(reasoning.actions).toBeDefined();
    const raActions = reasoning.actions!;
    expect(raActions.has('do_fetch')).toBe(true);
  });

  it('topic and subagent co-exist with their own field names', () => {
    const source = `
topic orders:
  description: "Order management"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Lookup"
  reasoning:
    instructions: ->
      | Help with orders.
    actions:
      do_lookup: @actions.lookup
        with order_id=...

subagent returns:
  description: "Return management"
  actions:
    process_return:
      description: "Process return"
      target: "flow://Return"
  reasoning:
    instructions: ->
      | Help with returns.
    actions:
      do_return: @actions.process_return
        with item=...
`;
    const ast = parseDocument(source);

    // 'orders' stored under 'topic' key with actions
    expect(ast.topic).toBeDefined();
    expect(ast.topic!.has('orders')).toBe(true);
    const orders = ast.topic!.get('orders')!;
    expect(orders.actions).toBeDefined();
    expect(orders.actions!.has('lookup')).toBe(true);
    expect(orders.reasoning!.actions).toBeDefined();

    // 'returns' stored under 'subagent' key with actions
    expect(ast.subagent).toBeDefined();
    expect(ast.subagent!.has('returns')).toBe(true);
    const returns = ast.subagent!.get('returns')!;
    expect(returns.actions).toBeDefined();
    expect(returns.actions!.has('process_return')).toBe(true);
    expect(returns.reasoning!.actions).toBeDefined();
  });

  it('parses start_agent with old names', () => {
    const source = `
start_agent router:
  description: "Router"
  actions:
    search:
      description: "Search"
      target: "flow://Search"
  reasoning:
    instructions: ->
      | Route.
    actions:
      go_main: @utils.transition to @topic.main
        description: "Go to main"

topic main:
  description: "Main"
  reasoning:
    instructions: ->
      | Help.
`;
    const ast = parseDocument(source);
    // start_agent is singular in AF schema — it's a named map with one entry
    expect(ast.start_agent).toBeDefined();
    const startAgent = ast.start_agent!;
    expect(startAgent.has('router')).toBe(true);
    const router = startAgent.get('router')!;
    expect(router.actions).toBeDefined();
    expect(router.reasoning).toBeDefined();
    expect(router.reasoning!.actions).toBeDefined();
  });
});

// ============================================================================
// Lint passes: old names work through type-map and reasoning-actions
// ============================================================================

describe('backwards compatibility: lint passes', () => {
  it('no unknown-field errors for old names (topic + actions)', () => {
    const diagnostics = runLint(`
topic main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Do it.
    actions:
      do_fetch: @actions.fetch
        with q=...
`);
    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);

    const unknownBlock = diagnostics.filter(d => d.code === 'unknown-block');
    expect(unknownBlock).toHaveLength(0);
  });

  it('no unknown-field errors for new names (subagent + actions)', () => {
    const diagnostics = runLint(`
subagent main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Do it.
    actions:
      do_fetch: @actions.fetch
        with q=...
`);
    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);

    const unknownBlock = diagnostics.filter(d => d.code === 'unknown-block');
    expect(unknownBlock).toHaveLength(0);
  });

  it('action target validation works with old names (actions)', () => {
    const diagnostics = runLint(`
topic main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "badscheme://foo"
  reasoning:
    instructions: ->
      | Do it.
`);
    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('action target validation works with new names (actions)', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup"
      target: "badscheme://foo"
  reasoning:
    instructions: ->
      | Do it.
`);
    const errors = diagnostics.filter(d => d.code === 'invalid-action-target');
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('hyperclassifier lint works with old names', () => {
    const diagnostics = runLint(`
start_agent router:
  description: "Routes requests"
  model_config:
    model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
  actions:
    search_kb:
      description: "Search"
      target: "flow://Search_KB"
  reasoning:
    instructions: ->
      | Route.
    actions:
      do_search: @actions.search_kb
        with query=...
      go_support: @utils.transition to @topic.support
        description: "Route to support"

topic support:
  description: "Support"
  reasoning:
    instructions: ->
      | Help.
`);
    const errors = diagnostics.filter(
      d => d.code === 'hyperclassifier-non-transition'
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('no unknown-field errors for mixed old/new names in same document', () => {
    const diagnostics = runLint(`
topic orders:
  description: "Orders"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Lookup"
  reasoning:
    instructions: ->
      | Help.
    actions:
      do_lookup: @actions.lookup

subagent returns:
  description: "Returns"
  actions:
    process:
      description: "Process"
      target: "flow://Return"
  reasoning:
    instructions: ->
      | Help.
    actions:
      do_return: @actions.process
`);
    const unknownField = diagnostics.filter(d => d.code === 'unknown-field');
    expect(unknownField).toHaveLength(0);

    const unknownBlock = diagnostics.filter(d => d.code === 'unknown-block');
    expect(unknownBlock).toHaveLength(0);
  });
});

// ============================================================================
// Round-trip: parse errors are minimal
// ============================================================================

describe('backwards compatibility: parse diagnostics', () => {
  it('old-style document has no syntax errors', () => {
    const { diagnostics } = parseWithDiagnostics(`
topic main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Do it.
    actions:
      do_fetch: @actions.fetch
`);
    const syntaxErrors = diagnostics.filter(d => d.code === 'syntax-error');
    expect(syntaxErrors).toHaveLength(0);
  });

  it('new-style document has no syntax errors', () => {
    const { diagnostics } = parseWithDiagnostics(`
subagent main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Do it.
    actions:
      do_fetch: @actions.fetch
`);
    const syntaxErrors = diagnostics.filter(d => d.code === 'syntax-error');
    expect(syntaxErrors).toHaveLength(0);
  });

  it('co-existing topic and subagent document has no syntax errors', () => {
    const { diagnostics } = parseWithDiagnostics(`
topic orders:
  description: "Orders"
  actions:
    lookup:
      description: "Lookup"
      target: "flow://Lookup"
  reasoning:
    instructions: ->
      | Help.
    actions:
      do_lookup: @actions.lookup

subagent returns:
  description: "Returns"
  actions:
    process:
      description: "Process"
      target: "flow://Return"
  reasoning:
    instructions: ->
      | Help.
    actions:
      do_return: @actions.process
`);
    const syntaxErrors = diagnostics.filter(d => d.code === 'syntax-error');
    expect(syntaxErrors).toHaveLength(0);
  });

  // Skipped: topic deprecation diagnostics are temporarily disabled.
  it.skip('emits deprecated diagnostics for old-style names', () => {
    const { diagnostics } = parseWithDiagnostics(`
topic main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Do it.
    actions:
      do_fetch: @actions.fetch
`);
    const deprecated = diagnostics.filter(d => d.code === 'deprecated-field');
    // Only the 'topic' block keyword itself is deprecated (actions are valid within topic)
    expect(deprecated).toHaveLength(1);
    expect(deprecated[0].message).toContain("'topic'");
  });

  it('emits no deprecated diagnostics for new-style names', () => {
    const { diagnostics } = parseWithDiagnostics(`
subagent main:
  description: "Main"
  actions:
    fetch:
      description: "Fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      | Do it.
    actions:
      do_fetch: @actions.fetch
`);
    const deprecated = diagnostics.filter(d => d.code === 'deprecated-field');
    expect(deprecated).toHaveLength(0);
  });
});
