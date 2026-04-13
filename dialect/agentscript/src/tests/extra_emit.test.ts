/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for round-tripping wrapped component fragments.
 * These tests verify that parse + emitDocument can round-trip these
 * fragments when wrapped in a proper document structure.
 */
import { describe, test, expect } from 'vitest';
import { parseDocument, emitDocument } from './test-utils.js';
import { StringLiteral } from '@agentscript/language';

/** Parse → emit round-trip. */
function roundTrip(source: string): string {
  return emitDocument(parseDocument(source));
}

describe('wrapped component round-trip', () => {
  test('utilsTransitionDeclaration: action target with topic reference', () => {
    // utilsTransitionDeclaration is used as the target of a reasoning action,
    // not as a standalone statement.
    const source = [
      'subagent test:',
      '    description: "test"',
      '    reasoning:',
      '        actions:',
      '            go: @utils.transition to @subagent.destination',
      '                description: "Go there"',
    ].join('\n');
    const emitted = roundTrip(source);
    expect(emitted).toContain('@utils.transition to @subagent.destination');
    expect(emitted).toContain('description: "Go there"');
  });

  test('run statement with set clauses does not crash emitter', () => {
    // Regression: RunStatement.parse() could push null into its body array
    // when a child node type had no parser, causing __emit to crash with
    // "Cannot read properties of null (reading '__emit')".
    const source = [
      'subagent test:',
      '    description: "test"',
      '    after_reasoning:',
      '        run @actions.Load_Data',
      '            with opportunity_id=@variables.opportunity_id',
      '            set @variables.current_stage = @outputs.current_stage',
      '            set @variables.deal_value = @outputs.deal_value',
    ].join('\n');
    const emitted = roundTrip(source);
    expect(emitted).toContain('run @actions.Load_Data');
    expect(emitted).toContain('with opportunity_id=@variables.opportunity_id');
    expect(emitted).toContain(
      'set @variables.current_stage = @outputs.current_stage'
    );
  });
});

describe('StringLiteral emit', () => {
  test('single-line string emits quoted', () => {
    const lit = new StringLiteral('hello world');
    expect(lit.__emit({ indent: 0 })).toBe('"hello world"');
  });

  test('string with newlines emits escape sequences', () => {
    // StringLiteral values with newlines should emit as quoted strings
    // with \n escape sequences, preserving round-trip fidelity.
    const lit = new StringLiteral('line one\nline two\nline three');
    const emitted = lit.__emit({ indent: 0 });
    expect(emitted).toBe('"line one\\nline two\\nline three"');
  });

  test('string with tabs emits escape sequences', () => {
    const lit = new StringLiteral('col1\tcol2');
    expect(lit.__emit({ indent: 0 })).toBe('"col1\\tcol2"');
  });
});
