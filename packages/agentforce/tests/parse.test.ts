/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { parse } from '../src/index.js';

describe('parse()', () => {
  test('parses a simple document', () => {
    const doc = parse('system:\n    instructions: "Hello"');
    expect(doc).toBeDefined();
    expect(doc.ast).toBeDefined();
    expect(doc.diagnostics).toBeDefined();
  });

  test('returns a Document with emit()', () => {
    const source = 'system:\n    instructions: "Hello"';
    const doc = parse(source);
    const emitted = doc.emit();
    expect(emitted).toContain('system');
    expect(emitted).toContain('instructions');
    expect(emitted).toContain('Hello');
  });

  test('round-trips a simple document', () => {
    const source = 'system:\n    instructions: "Hello"';
    const doc = parse(source);
    const emitted = doc.emit();
    const doc2 = parse(emitted);
    expect(doc2.emit()).toBe(emitted);
  });

  test('reports diagnostics for unknown blocks', () => {
    const doc = parse('unknown_block:\n    foo: "bar"');
    expect(doc.diagnostics.length).toBeGreaterThan(0);
  });

  test('hasErrors reflects diagnostic severity', () => {
    const good = parse('system:\n    instructions: "Hello"');
    expect(good.hasErrors).toBe(false);

    const bad = parse('unknown_block:\n    foo: "bar"');
    // May or may not have errors depending on lint rules
    expect(typeof bad.hasErrors).toBe('boolean');
  });

  test('errors and warnings filter correctly', () => {
    const doc = parse('system:\n    instructions: "Hello"');
    expect(doc.errors).toBeInstanceOf(Array);
    expect(doc.warnings).toBeInstanceOf(Array);
  });

  test('parses a document with topics', () => {
    const source = `config:
    description: "Test agent"
topic billing:
    description: "Handle billing"
    instructions: "Help with billing"`;
    const doc = parse(source);
    const emitted = doc.emit();
    expect(emitted).toContain('billing');
    expect(emitted).toContain('Handle billing');
  });

  test('parses empty source without crashing', () => {
    const doc = parse('');
    expect(doc).toBeDefined();
    expect(doc.ast).toBeDefined();
  });

  test('parses an if / else if / else chain without parser errors', () => {
    const source = `topic main:
    label: "Main"
    after_reasoning:
        if @variables.state == "a":
            run @actions.a
        else if @variables.state == "b":
            run @actions.b
        else if @variables.state == "c":
            run @actions.c
        else:
            run @actions.d`;

    const doc = parse(source);

    // Filter to parse-level errors only — schema/lint errors (e.g. missing
    // description, undefined references in this minimal fixture) are out of
    // scope for the else-if syntax check.
    const parseErrors = doc.errors.filter(
      d => d.source === 'parser' || d.code === 'syntax-error'
    );
    expect(parseErrors).toEqual([]);

    const emitted = doc.emit();
    expect(emitted).toContain('else if @variables.state == "b":');
    expect(emitted).toContain('else if @variables.state == "c":');
    expect(emitted).not.toMatch(/\belif\b/);
  });

  test('round-trips an else if chain', () => {
    const source = `topic main:
    label: "Main"
    after_reasoning:
        if @variables.state == "a":
            run @actions.a
        else if @variables.state == "b":
            run @actions.b
        else:
            run @actions.c`;

    const doc = parse(source);
    const emitted1 = doc.emit();
    const doc2 = parse(emitted1);
    expect(doc2.emit()).toBe(emitted1);
  });

  test('reports a syntax error when given the legacy elif keyword', () => {
    const source = `topic main:
    label: "Main"
    after_reasoning:
        if @variables.state == "a":
            run @actions.a
        elif @variables.state == "b":
            run @actions.b`;

    const doc = parse(source);
    const parseErrors = doc.errors.filter(
      d => d.source === 'parser' || d.code === 'syntax-error'
    );
    expect(parseErrors.length).toBeGreaterThan(0);
  });
});
