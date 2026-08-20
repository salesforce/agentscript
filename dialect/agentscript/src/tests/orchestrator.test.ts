/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the `orchestrator` block (aliased `agent`) — the primary,
 * LLM-driven entry point for a goal-based agent.
 */

import { describe, expect, test } from 'vitest';
import { isNamedMap } from '@agentscript/language';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  stripMeta,
  toAstRoot,
  testSchemaCtx,
} from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';
import { createLintEngine } from '../lint/index.js';

describe('orchestrator block', () => {
  test('parses a minimal bare orchestrator block', () => {
    const doc = parseDocument(
      [
        'orchestrator agent:',
        '    reasoning:',
        '        instructions: ->',
        '            | Be helpful.',
      ].join('\n')
    );
    expect(isNamedMap(doc.orchestrator)).toBe(true);
    const orch = doc.orchestrator?.get('agent');
    expect(orch).toBeDefined();
  });

  test('parses reasoning.instructions', () => {
    const result = parseWithDiagnostics(
      [
        'orchestrator agent:',
        '    reasoning:',
        '        instructions: ->',
        '            | You are a goal-based agent.',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
    const orch = result.value.orchestrator?.get('agent');
    expect(
      (orch as { reasoning?: { instructions?: unknown } })?.reasoning
        ?.instructions
    ).toBeDefined();
  });

  test('parses top-level actions block', () => {
    const result = parseWithDiagnostics(
      [
        'orchestrator agent:',
        '    actions:',
        '        lookup_account:',
        '            description: "Look up an account"',
        '            target: "flow://LookupAccount"',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
    const orch = result.value.orchestrator?.get('agent');
    expect((orch as { actions?: unknown })?.actions).toBeDefined();
  });

  test('parses reasoning.actions', () => {
    const result = parseWithDiagnostics(
      [
        'orchestrator agent:',
        '    reasoning:',
        '        instructions: ->',
        '            | Determine intent.',
        '        actions:',
        '            get_info:',
        '                description: "Get information"',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
    const orch = result.value.orchestrator?.get('agent');
    expect(
      (orch as { reasoning?: { actions?: unknown } })?.reasoning?.actions
    ).toBeDefined();
  });

  test('is registered as a singular collection', () => {
    const result = parseWithDiagnostics(
      [
        'orchestrator agent:',
        '    reasoning:',
        '        instructions: ->',
        '            | First.',
        'orchestrator second:',
        '    reasoning:',
        '        instructions: ->',
        '            | Second.',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(isNamedMap(result.value.orchestrator)).toBe(true);
    expect(result.value.orchestrator?.get('agent')).toBeDefined();
    expect(result.value.orchestrator?.get('second')).toBeDefined();
  });

  test('round-trips', () => {
    const source = [
      'orchestrator agent:',
      '    actions:',
      '        lookup_account:',
      '            description: "Look up an account"',
      '            target: "flow://LookupAccount"',
      '    reasoning:',
      '        instructions: ->',
      '            | Determine user intent.',
    ].join('\n');
    const ast1 = parseDocument(source);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });

  test('lint: orchestrator is forbidden outside GoalBasedAgent', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'config:',
          '    agent_type: "StandardAgent"',
          'orchestrator agent:',
          '    reasoning:',
          '        instructions: ->',
          '            | Be helpful.',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'gba-only-orchestrator')).toBe(
      true
    );
  });

  test('lint: orchestrator is forbidden with no config block', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'orchestrator agent:',
          '    reasoning:',
          '        instructions: ->',
          '            | Be helpful.',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'gba-only-orchestrator')).toBe(
      true
    );
  });

  test('lint: subagent is forbidden inside GoalBasedAgent', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'config:',
          '    agent_type: "GoalBasedAgent"',
          'orchestrator agent:',
          '    reasoning:',
          '        instructions: ->',
          '            | Be helpful.',
          'subagent helper:',
          '    description: "A helper"',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'gba-forbidden-subagent')).toBe(
      true
    );
  });

  test('lint: start_agent is forbidden inside GoalBasedAgent', () => {
    const ast = toAstRoot(
      parseDocument(
        [
          'config:',
          '    agent_type: "GoalBasedAgent"',
          'orchestrator agent:',
          '    reasoning:',
          '        instructions: ->',
          '            | Be helpful.',
          'start_agent router:',
          '    description: "A router"',
        ].join('\n')
      )
    );
    const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
    expect(diagnostics.some(d => d.code === 'gba-forbidden-start_agent')).toBe(
      true
    );
  });
});
