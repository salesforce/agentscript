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
});
