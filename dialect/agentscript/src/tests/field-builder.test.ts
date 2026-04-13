/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import {
  FieldBuilder,
  addBuilderMethods,
  StringValue,
  NumberValue,
  BooleanValue,
  Block,
  NamedBlock,
  TypedMap,
  StringLiteral,
  Sequence,
  ExpressionSequence,
} from '@agentscript/language';

// ============================================================================
// FieldBuilder as data holder (no chainable methods on prototype)
// ============================================================================

describe('FieldBuilder', () => {
  test('constructor initializes metadata from base type', () => {
    const builder = new FieldBuilder(StringValue, { description: 'test' });
    expect(builder.__metadata.description).toBe('test');
  });

  test('delegates emit to base type', () => {
    const builder = StringValue.describe('test');
    const result = builder.emit(new StringLiteral('hello'), { indent: 0 });
    expect(result).toBe('"hello"');
  });

  test('instanceof check works on enhanced builders', () => {
    const field = StringValue.describe('test');
    expect(field).toBeInstanceOf(FieldBuilder);
  });
});

// ============================================================================
// Builder methods on primitives
// ============================================================================

describe('Primitive builder methods', () => {
  test('StringValue.describe() returns FieldBuilder', () => {
    const field = StringValue.describe('A string field');
    expect(field).toBeInstanceOf(FieldBuilder);
    expect(field.__metadata.description).toBe('A string field');
  });

  test('BooleanValue.deprecated() with message and opts', () => {
    const field = BooleanValue.deprecated('Use X', {
      since: '1.0.0',
      removeIn: '2.0.0',
    });
    expect(field).toBeInstanceOf(FieldBuilder);
    expect(field.__metadata.deprecated).toEqual({
      message: 'Use X',
      since: '1.0.0',
      removeIn: '2.0.0',
    });
  });

  test('deprecated() without message', () => {
    const field = StringValue.deprecated();
    expect(field.__metadata.deprecated).toEqual({ message: undefined });
  });

  test('experimental() sets flag', () => {
    const field = StringValue.experimental();
    expect(field.__metadata.experimental).toBe(true);
  });

  test('required() sets flag', () => {
    const field = StringValue.required();
    expect(field.__metadata.required).toBe(true);
  });

  test('chaining multiple methods', () => {
    const field = StringValue.describe('Agent label')
      .minVersion('0.5.0')
      .example('my-agent');
    expect(field.__metadata.description).toBe('Agent label');
    expect(field.__metadata.minVersion).toBe('0.5.0');
    expect(field.__metadata.example).toBe('my-agent');
  });

  test('required() chains with describe()', () => {
    const field = StringValue.describe('A required field').required();
    expect(field.__metadata.description).toBe('A required field');
    expect(field.__metadata.required).toBe(true);
  });

  test('each call creates a new FieldBuilder (no mutation)', () => {
    const a = StringValue.describe('A');
    const b = StringValue.describe('B');
    expect(a.__metadata.description).toBe('A');
    expect(b.__metadata.description).toBe('B');
  });
});

// ============================================================================
// Builder methods on Block/NamedBlock/TypedMap factories
// ============================================================================

describe('Block factory builder methods', () => {
  test('Block().describe() returns the factory itself', () => {
    const TestBlock = Block('TestBlock', {
      name: StringValue,
    });
    const described = TestBlock.describe('A test block');
    expect(described).toBe(TestBlock);
    expect(described.__metadata!.description).toBe('A test block');
  });

  test('NamedBlock().describe() returns the factory itself', () => {
    const TestNamed = NamedBlock('TestNamed', {
      label: StringValue,
    });
    const described = TestNamed.describe('A named block');
    expect(described).toBe(TestNamed);
    expect(described.__metadata!.description).toBe('A named block');
  });

  test('TypedMap().describe() returns the factory itself', () => {
    const PropsBlock = Block('PropsBlock', {
      label: StringValue,
    });
    const TestMap = TypedMap('TestMap', PropsBlock, {});
    const described = TestMap.describe('A typed map');
    expect(described).toBe(TestMap);
    expect(described.__metadata!.description).toBe('A typed map');
  });
});

// ============================================================================
// FieldBuilder used in schemas (integration)
// ============================================================================

describe('FieldBuilder in schemas', () => {
  test('Block with described fields can still be instantiated', () => {
    const TestBlock = Block('TestBlock', {
      name: StringValue.describe('The name field'),
      enabled: BooleanValue.describe('Whether enabled'),
    });
    // The schema fields are FieldBuilders, but Block should still work
    expect(TestBlock).toBeDefined();
    expect(typeof TestBlock).toBe('function');
  });

  test('described field preserves schema navigation', () => {
    const InnerBlock = Block('InnerBlock', {
      value: StringValue,
    });
    const described = InnerBlock.describe('Inner block');
    // FieldBuilder should delegate .schema to the base type
    expect(described.schema).toBeDefined();
    expect(described.schema).toHaveProperty('value');
  });

  test('described TypedMap forwards __isTypedMap and propertiesSchema', () => {
    const PropsBlock = Block('PropsBlock', {
      label: StringValue.describe('A label'),
    });
    const TestMap = TypedMap('TestMap', PropsBlock, {}).describe('A typed map');

    // FieldBuilder should forward base type properties for schema resolution
    expect(TestMap.__isTypedMap).toBe(true);
    expect(TestMap.propertiesSchema).toBeDefined();
    expect(TestMap.propertiesSchema).toHaveProperty('label');
  });

  test('TypedMap exposes __modifiers and __primitiveTypes', () => {
    const PropsBlock = Block('PropsBlock', {
      label: StringValue,
    });
    const TestMap = TypedMap('TestMap', PropsBlock, {
      modifiers: [
        { keyword: 'mutable', description: 'Mutable variable' },
        { keyword: 'linked', description: 'Linked variable' },
      ],
      primitiveTypes: [
        { keyword: 'string', description: 'Text' },
        { keyword: 'number', description: 'Number' },
      ],
    });
    expect(TestMap.__modifiers).toEqual([
      { keyword: 'mutable', description: 'Mutable variable' },
      { keyword: 'linked', description: 'Linked variable' },
    ]);
    expect(TestMap.__primitiveTypes).toEqual([
      { keyword: 'string', description: 'Text' },
      { keyword: 'number', description: 'Number' },
    ]);
  });

  test('empty TypedMap options defaults to empty arrays', () => {
    const PropsBlock = Block('PropsBlock', {
      label: StringValue,
    });
    const TestMap = TypedMap('TestMap', PropsBlock, {});
    expect(TestMap.__modifiers).toEqual([]);
    expect(TestMap.__primitiveTypes).toEqual([]);
  });

  test('described TypedMap forwards __modifiers and __primitiveTypes', () => {
    const PropsBlock = Block('PropsBlock', {
      label: StringValue,
    });
    const TestMap = TypedMap('TestMap', PropsBlock, {
      modifiers: [{ keyword: 'mutable' }],
      primitiveTypes: [{ keyword: 'string' }],
    }).describe('Test map');
    expect(TestMap.__modifiers).toEqual([{ keyword: 'mutable' }]);
    expect(TestMap.__primitiveTypes).toEqual([{ keyword: 'string' }]);
  });

  test('described NamedBlock forwards isNamed', () => {
    const TestNamed = NamedBlock('TestNamed', {
      label: StringValue,
    }).describe('A named block');
    expect(TestNamed.isNamed).toBe(true);
  });
});

// ============================================================================
// Constraint methods
// ============================================================================

describe('Constraint methods', () => {
  test('NumberValue.min() sets minimum constraint', () => {
    const field = NumberValue.min(0);
    expect(field).toBeInstanceOf(FieldBuilder);
    expect(field.__metadata.constraints?.minimum).toBe(0);
  });

  test('NumberValue.max() sets maximum constraint', () => {
    const field = NumberValue.max(100);
    expect(field.__metadata.constraints?.maximum).toBe(100);
  });

  test('chaining min() and max()', () => {
    const field = NumberValue.min(0).max(100);
    expect(field.__metadata.constraints?.minimum).toBe(0);
    expect(field.__metadata.constraints?.maximum).toBe(100);
  });

  test('exclusiveMin() and exclusiveMax()', () => {
    const field = NumberValue.exclusiveMin(0).exclusiveMax(1);
    expect(field.__metadata.constraints?.exclusiveMinimum).toBe(0);
    expect(field.__metadata.constraints?.exclusiveMaximum).toBe(1);
  });

  test('multipleOf()', () => {
    const field = NumberValue.multipleOf(5);
    expect(field.__metadata.constraints?.multipleOf).toBe(5);
  });

  test('StringValue.minLength() and maxLength()', () => {
    const field = StringValue.minLength(1).maxLength(50);
    expect(field.__metadata.constraints?.minLength).toBe(1);
    expect(field.__metadata.constraints?.maxLength).toBe(50);
  });

  test('pattern() with RegExp stores source string', () => {
    const field = StringValue.pattern(/^[A-Z]+$/);
    expect(field.__metadata.constraints?.pattern).toBe('^[A-Z]+$');
  });

  test('pattern() with string stores as-is', () => {
    const field = StringValue.pattern('^[a-z]+$');
    expect(field.__metadata.constraints?.pattern).toBe('^[a-z]+$');
  });

  test('enum() sets allowed values', () => {
    const field = StringValue.enum(['a', 'b', 'c']);
    expect(field.__metadata.constraints?.enum).toEqual(['a', 'b', 'c']);
  });

  test('const() sets required value', () => {
    const field = BooleanValue.const(true);
    expect(field.__metadata.constraints?.const).toBe(true);
  });

  test('constraints chain with describe() and required()', () => {
    const field = NumberValue.min(0).max(100).describe('Priority').required();
    expect(field.__metadata.constraints?.minimum).toBe(0);
    expect(field.__metadata.constraints?.maximum).toBe(100);
    expect(field.__metadata.description).toBe('Priority');
    expect(field.__metadata.required).toBe(true);
  });

  test('Sequence().minItems() and maxItems()', () => {
    const StepBlock = Block('Step', { label: StringValue });
    const field = Sequence(StepBlock).minItems(1).maxItems(10);
    expect(field.__metadata.constraints?.minItems).toBe(1);
    expect(field.__metadata.constraints?.maxItems).toBe(10);
  });

  test('ExpressionSequence().minItems()', () => {
    const field = ExpressionSequence().minItems(1);
    expect(field.__metadata.constraints?.minItems).toBe(1);
  });

  test('each constraint call creates a new FieldBuilder (immutable)', () => {
    const a = NumberValue.min(0);
    const b = NumberValue.min(10);
    expect(a.__metadata.constraints?.minimum).toBe(0);
    expect(b.__metadata.constraints?.minimum).toBe(10);
  });

  test('chaining from describe() preserves constraint methods', () => {
    // Verifies enhanced builders carry constraint methods through chaining
    const field = NumberValue.describe('test').min(5).max(10);
    expect(field.__metadata.description).toBe('test');
    expect(field.__metadata.constraints?.minimum).toBe(5);
    expect(field.__metadata.constraints?.maximum).toBe(10);
  });

  test('__constraintCategories is set on FieldBuilder when constraints are used', () => {
    const field = NumberValue.min(0);
    expect(field.__constraintCategories).toEqual(['number', 'generic']);
  });

  test('__constraintCategories persists through chaining', () => {
    const field = StringValue.minLength(1).maxLength(50).describe('test');
    expect(field.__constraintCategories).toEqual(['string', 'generic']);
  });

  test('__constraintCategories is set for sequence constraints', () => {
    const StepBlock = Block('Step', { label: StringValue });
    const field = Sequence(StepBlock).minItems(1);
    expect(field.__constraintCategories).toEqual(['sequence']);
  });

  test('constraint methods are not available on types that do not support them', () => {
    // StringValue should NOT have .min() at runtime
    expect(
      (StringValue as unknown as Record<string, unknown>).min
    ).toBeUndefined();
    // NumberValue should NOT have .minLength() at runtime
    expect(
      (NumberValue as unknown as Record<string, unknown>).minLength
    ).toBeUndefined();
    // BooleanValue should NOT have .min() or .minLength() at runtime
    expect(
      (BooleanValue as unknown as Record<string, unknown>).min
    ).toBeUndefined();
    expect(
      (BooleanValue as unknown as Record<string, unknown>).minLength
    ).toBeUndefined();
  });
});

// ============================================================================
// addBuilderMethods utility
// ============================================================================

describe('addBuilderMethods', () => {
  test('adds methods to a plain FieldType', () => {
    const custom: Record<string, unknown> = {
      parse: () => null,
      emit: () => '',
    };
    addBuilderMethods(custom as never);
    expect(typeof (custom as Record<string, unknown>).describe).toBe(
      'function'
    );
    expect(typeof (custom as Record<string, unknown>).deprecated).toBe(
      'function'
    );
  });
});

// ============================================================================
// Input validation on constraint methods
// ============================================================================

describe('Constraint input validation', () => {
  test('min() throws on NaN', () => {
    expect(() => NumberValue.min(NaN)).toThrow('finite number');
  });

  test('min() throws on Infinity', () => {
    expect(() => NumberValue.min(Infinity)).toThrow('finite number');
  });

  test('max() throws on -Infinity', () => {
    expect(() => NumberValue.max(-Infinity)).toThrow('finite number');
  });

  test('exclusiveMin() throws on NaN', () => {
    expect(() => NumberValue.exclusiveMin(NaN)).toThrow('finite number');
  });

  test('exclusiveMax() throws on Infinity', () => {
    expect(() => NumberValue.exclusiveMax(Infinity)).toThrow('finite number');
  });

  test('multipleOf() throws on zero', () => {
    expect(() => NumberValue.multipleOf(0)).toThrow('positive number');
  });

  test('multipleOf() throws on negative', () => {
    expect(() => NumberValue.multipleOf(-5)).toThrow('positive number');
  });

  test('minLength() throws on negative', () => {
    expect(() => StringValue.minLength(-1)).toThrow('non-negative integer');
  });

  test('minLength() throws on non-integer', () => {
    expect(() => StringValue.minLength(1.5)).toThrow('non-negative integer');
  });

  test('maxLength() throws on negative', () => {
    expect(() => StringValue.maxLength(-1)).toThrow('non-negative integer');
  });

  test('minItems() throws on negative', () => {
    const StepBlock = Block('Step', { label: StringValue });
    expect(() => Sequence(StepBlock).minItems(-1)).toThrow(
      'non-negative integer'
    );
  });

  test('maxItems() throws on non-integer', () => {
    const StepBlock = Block('Step', { label: StringValue });
    expect(() => Sequence(StepBlock).maxItems(2.5)).toThrow(
      'non-negative integer'
    );
  });

  test('validation works on chained builders too', () => {
    // After chaining, the returned builder should still validate inputs
    const builder = NumberValue.min(0);
    expect(() => builder.max(NaN)).toThrow('finite number');
  });
});

// ============================================================================
// Structural method propagation (extend/omit preserve metadata + constraints)
// ============================================================================

describe('Structural method propagation', () => {
  test('Block.describe().extend() preserves metadata on extended factory', () => {
    const Base = Block('Base', { name: StringValue });
    const described = Base.describe('A base block');
    const extended = described.extend({ age: NumberValue });
    expect(extended.__metadata!.description).toBe('A base block');
    expect(extended.schema).toHaveProperty('name');
    expect(extended.schema).toHaveProperty('age');
  });

  test('Block.describe().omit() preserves metadata', () => {
    const Base = Block('Base', { name: StringValue, age: NumberValue });
    const described = Base.describe('A base block');
    const omitted = described.omit('age');
    expect(omitted.__metadata!.description).toBe('A base block');
    expect(omitted.schema).toHaveProperty('name');
    expect(omitted.schema).not.toHaveProperty('age');
  });

  test('extend() is available on factories from chaining', () => {
    const Base = Block('Base', { name: StringValue });
    const field = Base.describe('test').required();
    const extended = field.extend({ extra: BooleanValue });
    expect(extended.__metadata!.description).toBe('test');
    expect(extended.__metadata!.required).toBe(true);
    expect(extended.schema).toHaveProperty('extra');
  });

  test('resolveSchemaForName survives FieldBuilder wrapping via .describe()', () => {
    const Named = NamedBlock('Named', { label: StringValue });
    const described = Named.describe('test');
    const resolver = described as unknown as {
      resolveSchemaForName?: (n: string) => Record<string, unknown>;
    };
    expect(typeof resolver.resolveSchemaForName).toBe('function');
    expect(resolver.resolveSchemaForName!('anything')).toHaveProperty('label');
  });

  test('resolveSchemaForName resolves variant schemas through FieldBuilder', () => {
    const Named = NamedBlock('Named', { base: StringValue }).variant('v1', {
      base: StringValue,
      extra: NumberValue,
    });
    const described = Named.describe('with variants');
    const resolver = described as unknown as {
      resolveSchemaForName?: (n: string) => Record<string, unknown>;
    };
    expect(typeof resolver.resolveSchemaForName).toBe('function');
    // Non-variant name gets base schema
    expect(resolver.resolveSchemaForName!('other')).not.toHaveProperty('extra');
    // Variant name gets variant schema
    expect(resolver.resolveSchemaForName!('v1')).toHaveProperty('extra');
  });
});
