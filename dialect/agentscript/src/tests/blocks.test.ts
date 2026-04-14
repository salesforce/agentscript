import { describe, expect, test } from 'vitest';
import {
  Block,
  NamedBlock,
  NamedMap,
  SequenceNode,
  StringValue,
  BooleanValue,
  StringLiteral,
  TemplateExpression,
  TemplateText,
  isNamedMap,
} from '@agentscript/language';
import { SubagentBlock, StartAgentBlock } from '../schema.js';

const ctx = { indent: 0 };

// Block factory emit

test('Block emits simple string field', () => {
  const TestBlock = Block('TestBlock', {
    name: StringValue,
  });
  const instance = new TestBlock({
    name: new StringLiteral('hello'),
  });
  expect(instance.__emit(ctx)).toBe('name: "hello"');
});

test('Block emits multiple fields', () => {
  const TestBlock = Block('TestBlock', {
    title: StringValue,
    description: StringValue,
  });
  const instance = new TestBlock({
    title: new StringLiteral('My Title'),
    description: new StringLiteral('A description'),
  });
  expect(instance.__emit(ctx)).toBe(
    'title: "My Title"\ndescription: "A description"'
  );
});

test('Block emits with indentation', () => {
  const TestBlock = Block('TestBlock', {
    name: StringValue,
  });
  const instance = new TestBlock({
    name: new StringLiteral('indented'),
  });
  expect(instance.__emit({ indent: 1 })).toBe('    name: "indented"');
});

test('Block omits undefined fields', () => {
  const TestBlock = Block('TestBlock', {
    required: StringValue,
    optional: StringValue,
  });
  const instance = new TestBlock({
    required: new StringLiteral('present'),
  });
  expect(instance.__emit(ctx)).toBe('required: "present"');
});

test('Block emits template value', () => {
  const TestBlock = Block('TestBlock', {
    content: StringValue,
  });
  const instance = new TestBlock({
    content: new TemplateExpression([new TemplateText('Hello world')]),
  });
  expect(instance.__emit(ctx)).toBe('content: |Hello world');
});

test('Block emits boolean value', () => {
  const TestBlock = Block('TestBlock', {
    enabled: BooleanValue,
  });
  const instance = new TestBlock({
    enabled: new BooleanValue(true),
  });
  expect(instance.__emit(ctx)).toBe('enabled: True');
});

// Nested Block emit

test('Block emits nested block', () => {
  const InnerBlock = Block('InnerBlock', {
    value: StringValue,
  });
  const OuterBlock = Block('OuterBlock', {
    inner: InnerBlock,
  });

  const innerInstance = new InnerBlock({
    value: new StringLiteral('nested'),
  });
  const outerInstance = new OuterBlock({
    inner: innerInstance,
  });

  expect(outerInstance.__emit(ctx)).toBe('inner:\n    value: "nested"');
});

// NamedMap emit

test('NamedMap emits entries', () => {
  const map = new NamedMap<{ __emit: (ctx: { indent: number }) => string }>(
    'TestMap'
  );

  const entry1 = {
    __emit: (ctx: { indent: number }) =>
      `${'  '.repeat(ctx.indent)}entry1 content`,
  };
  const entry2 = {
    __emit: (ctx: { indent: number }) =>
      `${'  '.repeat(ctx.indent)}entry2 content`,
  };

  map.set('one', entry1);
  map.set('two', entry2);

  expect(map.__emit(ctx)).toBe('entry1 content\nentry2 content');
});

test('NamedMap emits empty as empty string', () => {
  const map = new NamedMap('TestMap');
  expect(map.__emit(ctx)).toBe('');
});

test('NamedMap is not a Map instance but passes isNamedMap', () => {
  const map = new NamedMap('TestMap');
  expect(map instanceof Map).toBe(false);
  expect(isNamedMap(map)).toBe(true);
  expect(isNamedMap(new Map())).toBe(false);
  expect(isNamedMap(null)).toBe(false);
  expect(isNamedMap({ get: () => {} })).toBe(false);
});

test('NamedMap supports Map-like iteration', () => {
  const map = new NamedMap<string>('TestMap');
  map.set('a', 'val_a');
  map.set('b', 'val_b');

  // entries()
  expect([...map.entries()]).toEqual([
    ['a', 'val_a'],
    ['b', 'val_b'],
  ]);

  // keys() and values()
  expect([...map.keys()]).toEqual(['a', 'b']);
  expect([...map.values()]).toEqual(['val_a', 'val_b']);

  // for..of (Symbol.iterator)
  const collected: [string, string][] = [];
  for (const entry of map) {
    collected.push(entry);
  }
  expect(collected).toEqual([
    ['a', 'val_a'],
    ['b', 'val_b'],
  ]);

  // forEach
  const keys: string[] = [];
  map.forEach((_v, k) => keys.push(k));
  expect(keys).toEqual(['a', 'b']);

  // size
  expect(map.size).toBe(2);
});

test('NamedMap toJSON returns object', () => {
  const map = new NamedMap<string>('TestMap');
  map.set('key1', 'value1');
  map.set('key2', 'value2');

  expect(map.toJSON()).toEqual({
    key1: 'value1',
    key2: 'value2',
  });
});

// Block __kind

test('Block has correct __kind', () => {
  const TestBlock = Block('MyBlockType', {
    field: StringValue,
  });
  const instance = new TestBlock({
    field: new StringLiteral('test'),
  });
  expect(instance.__kind).toBe('MyBlockType');
});

// NamedBlock basic tests

test('NamedBlock has __name set', () => {
  const TestNamedBlock = NamedBlock('TestNamedBlock', {
    label: StringValue,
  });
  const instance = new TestNamedBlock('my_name', {
    label: new StringLiteral('My Label'),
  });
  expect(instance.__name).toBe('my_name');
  expect(instance.__kind).toBe('TestNamedBlock');
});

// Block diagnostics

test('Block initializes with empty diagnostics', () => {
  const TestBlock = Block('TestBlock', {
    field: StringValue,
  });
  const instance = new TestBlock({
    field: new StringLiteral('test'),
  });
  expect(instance.__diagnostics).toEqual([]);
});

// NamedMap diagnostics

test('NamedMap initializes with empty diagnostics', () => {
  const map = new NamedMap('TestMap');
  expect(map.__diagnostics).toEqual([]);
});

// Block static properties

test('Block class has static kind', () => {
  const TestBlock = Block('StaticKindTest', {
    field: StringValue,
  });
  expect(TestBlock.kind).toBe('StaticKindTest');
});

test('Block class has static schema', () => {
  const schema = { field: StringValue };
  const TestBlock = Block('SchemaTest', schema);
  expect(TestBlock.schema).toStrictEqual(schema);
});

test('Block class has isNamed false', () => {
  const TestBlock = Block('IsNamedTest', {
    field: StringValue,
  });
  expect(TestBlock.isNamed).toBe(false);
});

// Schema-exported block static kinds

test('SubagentBlock has static kind "SubagentBlock"', () => {
  expect(SubagentBlock.kind).toBe('SubagentBlock');
});

test('StartAgentBlock has static kind "StartAgentBlock"', () => {
  expect(StartAgentBlock.kind).toBe('StartAgentBlock');
});

test('StartAgentBlock and SubagentBlock have distinct kinds', () => {
  expect(StartAgentBlock.kind).not.toBe(SubagentBlock.kind);
});

// NamedBlock static properties

test('NamedBlock class has isNamed true', () => {
  const TestNamedBlock = NamedBlock('IsNamedTest', {
    field: StringValue,
  });
  expect(TestNamedBlock.isNamed).toBe(true);
});

// __children as single source of truth

describe('__children single source of truth', () => {
  test('Block field accessor reads from FieldChild', () => {
    const TestBlock = Block('TestBlock', { name: StringValue });
    const instance = new TestBlock({ name: new StringLiteral('hello') });
    const block = instance as unknown as Record<string, unknown>;

    // Property access should work
    expect(block.name).toBeInstanceOf(StringLiteral);
    expect((block.name as StringLiteral).value).toBe('hello');

    // __children should contain the FieldChild
    expect(instance.__children!).toHaveLength(1);
    expect(instance.__children![0].__type).toBe('field');
  });

  test('Block field mutation via property reflects in __children', () => {
    const TestBlock = Block('TestBlock', { name: StringValue });
    const instance = new TestBlock({ name: new StringLiteral('original') });
    const block = instance as unknown as Record<string, unknown>;

    // Mutate via property setter
    block.name = new StringLiteral('updated');

    // FieldChild value should reflect the update
    const fc = instance.__children![0] as { value: unknown };
    expect((fc.value as StringLiteral).value).toBe('updated');

    // Emission should use updated value
    expect(instance.__emit(ctx)).toBe('name: "updated"');
  });

  test('NamedMap.__children populated via set()', () => {
    const map = new NamedMap<{ __emit: () => string }>('TestMap');
    const entry = { __emit: () => 'content' };

    map.set('key1', entry);

    expect(map.__children).toHaveLength(1);
    expect(map.__children[0].__type).toBe('map_entry');
  });

  test('NamedMap.delete() removes from __children', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'val_a');
    map.set('b', 'val_b');
    expect(map.__children).toHaveLength(2);

    map.delete('a');
    expect(map.__children).toHaveLength(1);
    expect(map.has('a')).toBe(false);
  });

  test('NamedMap.clear() empties __children', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'val_a');
    map.set('b', 'val_b');

    map.clear();
    expect(map.__children).toHaveLength(0);
    expect(map.size).toBe(0);
  });

  test('SequenceNode items getter returns correct values', () => {
    const seq = new SequenceNode([
      new StringLiteral('one'),
      new StringLiteral('two'),
    ]);

    expect(seq.items).toHaveLength(2);
    expect((seq.items[0] as StringLiteral).value).toBe('one');
    expect((seq.items[1] as StringLiteral).value).toBe('two');
  });

  test('SequenceNode items setter updates __children', () => {
    const seq = new SequenceNode([new StringLiteral('old')]);

    seq.items = [new StringLiteral('new1'), new StringLiteral('new2')];

    expect(seq.__children).toHaveLength(2);
    expect(seq.items).toHaveLength(2);
    expect((seq.items[0] as StringLiteral).value).toBe('new1');
  });

  test('Block fields visible to Object.entries()', () => {
    const TestBlock = Block('TestBlock', {
      name: StringValue,
      enabled: BooleanValue,
    });
    const instance = new TestBlock({
      name: new StringLiteral('test'),
      enabled: new BooleanValue(true),
    });

    const keys = Object.keys(instance).filter(k => !k.startsWith('__'));
    expect(keys).toContain('name');
    expect(keys).toContain('enabled');
  });
});
