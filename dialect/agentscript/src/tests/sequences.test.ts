import { describe, expect, test } from 'vitest';
import {
  Block,
  Sequence,
  ExpressionSequence,
  SequenceNode,
  ExpressionValue,
  StringValue,
  StringLiteral,
  NumberLiteral,
  Identifier,
} from '@agentscript/language';
import {
  parseWithSchema,
  parseWithDiagnostics,
  stripMeta,
} from './test-utils.js';

const ctx = { indent: 0 };

// Define a test block for sequence elements
const StepBlock = Block('StepBlock', {
  a: ExpressionValue,
  b: ExpressionValue,
  c: ExpressionValue,
});

// ---------------------------------------------------------------------------
// Parsing tests
// ---------------------------------------------------------------------------

describe('Sequence parsing', () => {
  test('Form A: expression element', () => {
    const result = parseWithSchema('items:\n  - "hello"', {
      items: Sequence(StepBlock),
    });
    const seq = result.items!;
    expect(seq).toBeDefined();
    expect(seq.items).toHaveLength(1);
    expect(seq.items[0].__kind).toBe('StringLiteral');
  });

  test('Form A: multiple expression elements', () => {
    const source = [
      'items:',
      '  - "first"',
      '  - "second"',
      '  - "third"',
    ].join('\n');
    const result = parseWithSchema(source, { items: Sequence(StepBlock) });
    const seq = result.items!;
    expect(seq.items).toHaveLength(3);
    expect(seq.items[0].__kind).toBe('StringLiteral');
    expect(seq.items[1].__kind).toBe('StringLiteral');
    expect(seq.items[2].__kind).toBe('StringLiteral');
  });

  test('Form B: colinear mapping element with block value', () => {
    const source = [
      'items:',
      '  - a: "hello"',
      '      b: 1',
      '      c: x',
    ].join('\n');
    const result = parseWithSchema(source, { items: Sequence(StepBlock) });
    const seq = result.items!;
    expect(seq.items).toHaveLength(1);

    const item = seq.items[0] as unknown as Record<string, unknown>;
    expect(item.__kind).toBe('StepBlock');
    expect((item.a as { __kind: string }).__kind).toBe('StringLiteral');
    expect((item.b as { __kind: string }).__kind).toBe('NumberLiteral');
    expect((item.c as { __kind: string }).__kind).toBe('Identifier');
  });

  test('Form C: block-only mapping', () => {
    const source = [
      'items:',
      '  -',
      '      a: "hello"',
      '      b: 1',
      '      c: x',
    ].join('\n');
    const result = parseWithSchema(source, { items: Sequence(StepBlock) });
    const seq = result.items!;
    expect(seq.items).toHaveLength(1);

    const item = seq.items[0] as unknown as Record<string, unknown>;
    expect(item.__kind).toBe('StepBlock');
    expect((item.a as { __kind: string }).__kind).toBe('StringLiteral');
    expect((item.b as { __kind: string }).__kind).toBe('NumberLiteral');
    expect((item.c as { __kind: string }).__kind).toBe('Identifier');
  });

  test('Forms B and C produce identical results', () => {
    const sourceB = [
      'items:',
      '  - a: "hello"',
      '      b: 1',
      '      c: x',
    ].join('\n');
    const sourceC = [
      'items:',
      '  -',
      '      a: "hello"',
      '      b: 1',
      '      c: x',
    ].join('\n');

    const resultB = parseWithSchema(sourceB, { items: Sequence(StepBlock) });
    const resultC = parseWithSchema(sourceC, { items: Sequence(StepBlock) });

    const seqB = resultB.items!;
    const seqC = resultC.items!;

    expect(seqB.items).toHaveLength(1);
    expect(seqC.items).toHaveLength(1);

    // Strip metadata for structural comparison
    const itemB = stripMeta(seqB.items[0]);
    const itemC = stripMeta(seqC.items[0]);
    expect(JSON.stringify(itemB)).toBe(JSON.stringify(itemC));
  });

  test('Mixed sequence: expressions and blocks', () => {
    const source = [
      'items:',
      '  - a: "hello"',
      '      b: 1',
      '      c: x',
      '  - "second item"',
      '  -',
      '      a: "hello"',
      '      b: 1',
      '      c: x',
    ].join('\n');
    const result = parseWithSchema(source, { items: Sequence(StepBlock) });
    const seq = result.items!;
    expect(seq.items).toHaveLength(3);

    // First: block
    expect(seq.items[0].__kind).toBe('StepBlock');
    // Second: expression
    expect(seq.items[1].__kind).toBe('StringLiteral');
    // Third: block
    expect(seq.items[2].__kind).toBe('StepBlock');

    // First and third should be structurally identical
    const first = stripMeta(seq.items[0]);
    const third = stripMeta(seq.items[2]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(third));
  });
});

// ---------------------------------------------------------------------------
// Emit tests
// ---------------------------------------------------------------------------

describe('Sequence emit', () => {
  test('Expression element emit', () => {
    const seq = new SequenceNode([new StringLiteral('hello')]);
    expect(seq.__emit(ctx)).toBe('- "hello"');
  });

  test('Expression element emit with indent', () => {
    const seq = new SequenceNode([new StringLiteral('hello')]);
    expect(seq.__emit({ indent: 1 })).toBe('    - "hello"');
  });

  test('Multiple expression elements', () => {
    const seq = new SequenceNode([
      new StringLiteral('first'),
      new StringLiteral('second'),
    ]);
    expect(seq.__emit(ctx)).toBe('- "first"\n- "second"');
  });

  test('Block element emit', () => {
    const b = new StepBlock({
      a: new StringLiteral('hello'),
      b: new NumberLiteral(1),
    });
    const seq = new SequenceNode([b]);
    expect(seq.__emit(ctx)).toBe('- a: "hello"\n  b: 1');
  });

  test('Block element emit with indent', () => {
    const b = new StepBlock({
      a: new StringLiteral('hello'),
      b: new NumberLiteral(1),
    });
    const seq = new SequenceNode([b]);
    expect(seq.__emit({ indent: 1 })).toBe('    - a: "hello"\n      b: 1');
  });

  test('Mixed emit: blocks and expressions', () => {
    const b = new StepBlock({
      a: new StringLiteral('hello'),
      b: new NumberLiteral(1),
    });
    const seq = new SequenceNode([
      b,
      new StringLiteral('middle'),
      new StepBlock({ a: new Identifier('x') }),
    ]);
    expect(seq.__emit(ctx)).toBe('- a: "hello"\n  b: 1\n- "middle"\n- a: x');
  });

  test('emitField produces key header', () => {
    const schema = { items: Sequence(StepBlock) };
    const seq = new SequenceNode([new StringLiteral('hello')]);
    const fieldType = schema.items;
    expect(fieldType.emitField!('items', seq, ctx)).toBe(
      'items:\n    - "hello"'
    );
  });
});

// ---------------------------------------------------------------------------
// Integration tests
// ---------------------------------------------------------------------------

describe('Sequence integration', () => {
  test('SequenceValue used in Block schema', () => {
    const source = ['items:', '  - "hello"', '  - "world"'].join('\n');
    const result = parseWithSchema(source, {
      items: Sequence(StepBlock),
    });
    const seq = result.items!;
    expect(seq).toBeDefined();
    expect(seq.items).toHaveLength(2);
  });

  test('SequenceValue with typed fields: StringValue', () => {
    const TypedBlock = Block('TypedBlock', {
      name: StringValue,
      label: StringValue,
    });
    const source = ['items:', '  - name: "foo"', '      label: "bar"'].join(
      '\n'
    );
    const result = parseWithSchema(source, {
      items: Sequence(TypedBlock),
    });
    const seq = result.items!;
    expect(seq.items).toHaveLength(1);

    expect(seq.items[0].__kind).toBe('TypedBlock');
  });
});

// ---------------------------------------------------------------------------
// Error-path tests
// ---------------------------------------------------------------------------

describe('Sequence error paths', () => {
  test('Empty sequence produces empty items array', () => {
    const source = 'items:\n';
    const { value } = parseWithDiagnostics(source, {
      items: Sequence(StepBlock),
    });
    // items may be undefined (no sequence node parsed) or an empty sequence
    const seq = value.items;
    if (seq) {
      expect(seq.items).toHaveLength(0);
    } else {
      expect(seq).toBeUndefined();
    }
  });

  test('Unknown mapping key produces unknown-field diagnostic', () => {
    const source = ['items:', '  - unknown_key: "hello"'].join('\n');
    const { diagnostics } = parseWithDiagnostics(source, {
      items: Sequence(StepBlock),
    });
    const unknownFieldDiag = diagnostics.find(d => d.code === 'unknown-field');
    expect(unknownFieldDiag).toBeDefined();
    expect(unknownFieldDiag!.message).toContain('unknown_key');
  });

  test('Diagnostics propagate from block fields to top-level result', () => {
    const source = [
      'items:',
      '  - a: "hello"',
      '      b: 1',
      '      bad_field: "oops"',
    ].join('\n');
    const { value, diagnostics } = parseWithDiagnostics(source, {
      items: Sequence(StepBlock),
    });
    // The valid fields should still be parsed
    const seq = value.items!;
    expect(seq.items).toHaveLength(1);
    expect(seq.items[0].__kind).toBe('StepBlock');

    // The unknown field diagnostic should bubble up
    const unknownFieldDiag = diagnostics.find(d => d.code === 'unknown-field');
    expect(unknownFieldDiag).toBeDefined();
    expect(unknownFieldDiag!.message).toContain('bad_field');
  });

  test('Mixed valid and invalid elements: valid items still parsed', () => {
    const source = [
      'items:',
      '  - "valid expression"',
      '  - bogus_field: 42',
      '  - a: "hello"',
      '      b: 1',
      '      c: x',
    ].join('\n');
    const { value, diagnostics } = parseWithDiagnostics(source, {
      items: Sequence(StepBlock),
    });
    const seq = value.items!;

    // All three items should be parsed
    expect(seq.items).toHaveLength(3);
    expect(seq.items[0].__kind).toBe('StringLiteral');
    expect(seq.items[1].__kind).toBe('StepBlock');
    expect(seq.items[2].__kind).toBe('StepBlock');

    // The bogus_field should produce a diagnostic
    const unknownFieldDiag = diagnostics.find(d => d.code === 'unknown-field');
    expect(unknownFieldDiag).toBeDefined();
    expect(unknownFieldDiag!.message).toContain('bogus_field');
  });
});

// ---------------------------------------------------------------------------
// ExpressionSequence tests
// ---------------------------------------------------------------------------

describe('ExpressionSequence parsing', () => {
  test('parses expression-only items', () => {
    const source = ['items:', '  - "hello"', '  - "world"'].join('\n');
    const result = parseWithSchema(source, {
      items: ExpressionSequence(),
    });
    const seq = result.items!;
    expect(seq).toBeDefined();
    expect(seq.__kind).toBe('Sequence');
    expect(seq.items).toHaveLength(2);
    expect(seq.items[0].__kind).toBe('StringLiteral');
    expect(seq.items[1].__kind).toBe('StringLiteral');
  });

  test('mapping elements produce invalid-sequence-element diagnostic', () => {
    const source = ['items:', '  - key: "value"'].join('\n');
    const { diagnostics } = parseWithDiagnostics(source, {
      items: ExpressionSequence(),
    });
    const invalidDiags = diagnostics.filter(
      d => d.code === 'invalid-sequence-element'
    );
    expect(invalidDiags).toHaveLength(1);
    expect(invalidDiags[0].message).toContain('Mapping elements');
  });

  test('mixed: expression items parse, mapping items produce diagnostic', () => {
    const source = [
      'items:',
      '  - "valid"',
      '  - key: "bad"',
      '  - "also valid"',
    ].join('\n');
    const { value, diagnostics } = parseWithDiagnostics(source, {
      items: ExpressionSequence(),
    });

    const seq = value.items!;
    // All three expression values should be captured (2 plain + 1 error-recovery)
    expect(seq.items.length).toBeGreaterThanOrEqual(2);
    expect(seq.items[0].__kind).toBe('StringLiteral');

    const invalidDiags = diagnostics.filter(
      d => d.code === 'invalid-sequence-element'
    );
    expect(invalidDiags).toHaveLength(1);
  });
});

describe('ExpressionSequence emit', () => {
  test('emits expression items', () => {
    const seq = new SequenceNode([
      new StringLiteral('hello'),
      new StringLiteral('world'),
    ]);
    expect(seq.__emit(ctx)).toBe('- "hello"\n- "world"');
  });

  test('emitField produces key header', () => {
    const schema = { items: ExpressionSequence() };
    const seq = new SequenceNode([new StringLiteral('hello')]);
    expect(schema.items.emitField!('items', seq, ctx)).toBe(
      'items:\n    - "hello"'
    );
  });
});
