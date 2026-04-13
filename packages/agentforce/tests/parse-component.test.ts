/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { parseComponent } from '../src/index.js';
import { WithClause, Ellipsis, StringLiteral } from '@agentscript/language';

describe('parseComponent()', () => {
  describe('block kinds', () => {
    test('parses a singular block (config)', () => {
      const config = parseComponent('description: "My agent"', 'config');
      expect(config).toBeDefined();
      // Block instances have __kind
      const block = config as Record<string, unknown>;
      expect(block.__kind).toBeDefined();
    });

    test('parses a singular block (system)', () => {
      const system = parseComponent('instructions: "Do stuff"', 'system');
      expect(system).toBeDefined();
    });

    test('parses a named block (topic)', () => {
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"\n    instructions: "Help"',
        'topic'
      );
      expect(topic).toBeDefined();
      // Named blocks have __name
      const block = topic as Record<string, unknown>;
      expect(block.__name).toBe('billing');
    });

    test('parsed block has __emit', () => {
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"\n    instructions: "Help"',
        'topic'
      );
      const block = topic as Record<string, unknown>;
      expect(typeof block.__emit).toBe('function');
    });

    test('parsed block has __diagnostics', () => {
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"\n    instructions: "Help"',
        'topic'
      );
      const block = topic as Record<string, unknown>;
      expect(block.__diagnostics).toBeDefined();
      expect(Array.isArray(block.__diagnostics)).toBe(true);
    });

    test('returns undefined for unknown kind', () => {
      const result = parseComponent(
        'foo:\n    bar: "baz"',
        'nonexistent' as 'config'
      );
      expect(result).toBeUndefined();
    });

    test('parses knowledge block', () => {
      const knowledge = parseComponent('citations_enabled: True', 'knowledge');
      expect(knowledge).toBeDefined();
    });
  });

  describe('collection kinds', () => {
    test('parses actions collection with inputs and outputs (topic action)', () => {
      const source = [
        'log_ambiguity_event:',
        '    description: "Placeholder action to log the current user message and any available ambiguity or confidence metadata when this topic is entered."',
        '    target: "flow://Placeholder_Log_Ambiguity_Event"',
        '    inputs:',
        '        userMessage: string',
        '    outputs:',
        '        outcomeMessage: string',
      ].join('\n');
      const actions = parseComponent(source, 'actions');
      expect(actions).toBeDefined();
      const map = actions as {
        has(k: string): boolean;
        get(k: string): Record<string, unknown> | undefined;
      };
      expect(map.has('log_ambiguity_event')).toBe(true);
      const entry = map.get('log_ambiguity_event');
      expect(entry).toBeDefined();
      expect(entry?.__name).toBe('log_ambiguity_event');
      // target is parsed as a StringLiteral expression object
      expect((entry?.target as Record<string, unknown>)?.value).toBe(
        'flow://Placeholder_Log_Ambiguity_Event'
      );
      // inputs and outputs should be parsed
      expect(entry?.inputs).toBeDefined();
      expect(entry?.outputs).toBeDefined();
    });

    test('parses a single action entry via action kind', () => {
      const source = [
        'log_ambiguity_event:',
        '    description: "Placeholder action to log the current user message and any available ambiguity or confidence metadata when this topic is entered."',
        '    target: "flow://Placeholder_Log_Ambiguity_Event"',
        '    inputs:',
        '        userMessage: string',
        '    outputs:',
        '        outcomeMessage: string',
      ].join('\n');
      const action = parseComponent(source, 'action');
      expect(action).toBeDefined();
      const block = action as unknown as Record<string, unknown>;
      expect(block.__name).toBe('log_ambiguity_event');
      // target is parsed as a StringLiteral expression object
      expect((block.target as Record<string, unknown>)?.value).toBe(
        'flow://Placeholder_Log_Ambiguity_Event'
      );
      expect(block.inputs).toBeDefined();
      expect(block.outputs).toBeDefined();
    });

    test('parses actions collection with multiple entries', () => {
      const actions = parseComponent(
        'Lookup_Order:\n    description: "Retrieve order details"\n    target: "flow://Lookup_Order"\nCheck_Hours:\n    description: "Check business hours"\n    target: "flow://Check_Hours"',
        'actions'
      );
      expect(actions).toBeDefined();
      const block = actions as Record<string, unknown>;
      expect(block.__kind).toBe('Collection<ActionBlock>');
      expect(block.__children).toBeDefined();
      // Should have Map-like API
      expect(typeof (actions as { has: unknown }).has).toBe('function');
      expect(typeof (actions as { get: unknown }).get).toBe('function');
      expect(typeof (actions as { entries: unknown }).entries).toBe('function');
      // Should contain both entries
      const map = actions as {
        has(k: string): boolean;
        get(k: string): unknown;
      };
      expect(map.has('Lookup_Order')).toBe(true);
      expect(map.has('Check_Hours')).toBe(true);
    });

    test('actions collection entries have correct structure', () => {
      const actions = parseComponent(
        'Lookup_Order:\n    description: "Retrieve order details"\n    target: "flow://Lookup_Order"',
        'actions'
      );
      const map = actions as {
        get(k: string): Record<string, unknown> | undefined;
      };
      const entry = map.get('Lookup_Order');
      expect(entry).toBeDefined();
      expect(entry?.__kind).toBeDefined();
      expect(entry?.__name).toBe('Lookup_Order');
    });

    test('parses reasoning_actions collection', () => {
      const actions = parseComponent(
        'lookup_order: @actions.Lookup_Order\n    with order_number=...\n    set @variables.status = @outputs.status',
        'reasoning_actions'
      );
      expect(actions).toBeDefined();
      const block = actions as Record<string, unknown>;
      expect(block.__kind).toBe('Collection<ReasoningActionBlock>');
      const map = actions as { has(k: string): boolean };
      expect(map.has('lookup_order')).toBe(true);
    });

    test('reasoning_actions with ellipsis emits = ...', () => {
      const source =
        'FinalizeReservation: @actions.FinalizeReservation\n    with contactRecord = ...';
      const actions = parseComponent(source, 'reasoning_actions');
      expect(actions).toBeDefined();
      const map = actions as {
        get(k: string): { __emit(ctx: { indent: number }): string } | undefined;
      };
      const entry = map.get('FinalizeReservation');
      expect(entry).toBeDefined();
      const emitted = entry!.__emit({ indent: 0 });
      expect(emitted).toContain('with contactRecord = ...');
    });

    test('programmatically constructed WithClause with Ellipsis emits = ...', () => {
      const clause = new WithClause('contactRecord', new Ellipsis());
      const emitted = clause.__emit({ indent: 0 });
      expect(emitted).toBe('with contactRecord = ...');
    });

    test('programmatically constructed WithClause with StringLiteral emits = "value"', () => {
      const clause = new WithClause(
        'contactRecord',
        new StringLiteral('hello')
      );
      const emitted = clause.__emit({ indent: 0 });
      expect(emitted).toBe('with contactRecord = "hello"');
    });

    test('returns undefined for empty actions source', () => {
      const actions = parseComponent('', 'actions');
      // Should return a collection (possibly empty), not undefined
      expect(actions).toBeDefined();
    });
  });

  describe('statement kind', () => {
    test('parses a run statement', () => {
      const result = parseComponent('run MyAction()', 'statement');
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    test('parses an if statement', () => {
      const result = parseComponent(
        'if x == 1:\n    run MyAction()',
        'statement'
      );
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('expression kind', () => {
    test('parses a string expression', () => {
      const result = parseComponent('"hello world"', 'expression');
      expect(result).toBeDefined();
    });

    test('parses a numeric expression', () => {
      const result = parseComponent('42', 'expression');
      expect(result).toBeDefined();
    });

    test('parses a boolean expression', () => {
      const result = parseComponent('True', 'expression');
      expect(result).toBeDefined();
    });
  });
});
