import { describe, expect, test } from 'vitest';
import {
  Block,
  NamedBlock,
  CollectionBlock,
  StringValue,
  NumberValue,
  BooleanValue,
  collectDiagnostics,
} from '@agentscript/language';
import type { Parsed, BlockCore } from '@agentscript/language';
import { parseWithSchema, parseWithDiagnostics } from './test-utils.js';

// ---------------------------------------------------------------------------
// Schema Definition API
// ---------------------------------------------------------------------------

describe('discriminant schema definition', () => {
  test('Block with .discriminant() and .variant() creates discriminant config', () => {
    const TestBlock = Block('TestBlock', {
      kind: StringValue,
      name: StringValue,
    })
      .discriminant('kind')
      .variant('a', { extra_a: NumberValue })
      .variant('b', { extra_b: BooleanValue });

    expect(TestBlock.discriminantField).toBe('kind');
    expect(typeof TestBlock.resolveSchemaForDiscriminant).toBe('function');
  });

  test('Block.resolveSchemaForDiscriminant returns variant schema', () => {
    const TestBlock = Block('TestBlock', {
      kind: StringValue,
      name: StringValue,
    })
      .discriminant('kind')
      .variant('a', { extra_a: NumberValue })
      .variant('b', { extra_b: BooleanValue });

    const schemaA = TestBlock.resolveSchemaForDiscriminant!('a');
    expect(schemaA).toHaveProperty('kind');
    expect(schemaA).toHaveProperty('name');
    expect(schemaA).toHaveProperty('extra_a');
    expect(schemaA).not.toHaveProperty('extra_b');

    const schemaB = TestBlock.resolveSchemaForDiscriminant!('b');
    expect(schemaB).toHaveProperty('kind');
    expect(schemaB).toHaveProperty('name');
    expect(schemaB).toHaveProperty('extra_b');
    expect(schemaB).not.toHaveProperty('extra_a');
  });

  test('Block.resolveSchemaForDiscriminant returns base schema for unknown variant', () => {
    const TestBlock = Block('TestBlock', {
      kind: StringValue,
      name: StringValue,
    })
      .discriminant('kind')
      .variant('a', { extra_a: NumberValue });

    const schema = TestBlock.resolveSchemaForDiscriminant!('unknown');
    expect(schema).toHaveProperty('kind');
    expect(schema).toHaveProperty('name');
    expect(schema).not.toHaveProperty('extra_a');
  });

  test('NamedBlock with .discriminant() and .variant()', () => {
    const TestEntry = NamedBlock('TestEntry', {
      target: StringValue,
      kind: StringValue,
    })
      .discriminant('kind')
      .variant('mcp', { tool_name: StringValue })
      .variant('a2a', { message_type: StringValue });

    expect(TestEntry.discriminantField).toBe('kind');
    expect(typeof TestEntry.resolveSchemaForDiscriminant).toBe('function');

    const schemaMcp = TestEntry.resolveSchemaForDiscriminant!('mcp');
    expect(schemaMcp).toHaveProperty('target');
    expect(schemaMcp).toHaveProperty('kind');
    expect(schemaMcp).toHaveProperty('tool_name');
    expect(schemaMcp).not.toHaveProperty('message_type');
  });

  test('Block without discriminant has undefined discriminantField', () => {
    const TestBlock = Block('TestBlock', { name: StringValue });
    expect(TestBlock.discriminantField).toBeUndefined();
  });

  test('NamedBlock without discriminant has undefined discriminantField', () => {
    const TestEntry = NamedBlock('TestEntry', { name: StringValue });
    expect(TestEntry.discriminantField).toBeUndefined();
  });

  test('Block discriminant throws if field not in schema', () => {
    expect(() =>
      Block('TestBlock', { name: StringValue })
        .discriminant('missing')
        .variant('a', { extra: NumberValue })
    ).toThrow("discriminant field 'missing' not found in base schema");
  });

  test('NamedBlock discriminant throws if field not in schema', () => {
    expect(() =>
      NamedBlock('TestEntry', { name: StringValue })
        .discriminant('missing')
        .variant('a', { extra: NumberValue })
    ).toThrow("discriminant field 'missing' not found in base schema");
  });

  test('Block with discriminant but no variants yet is allowed (chained API)', () => {
    // .discriminant() without .variant() is valid — variants are added later via chaining
    const partial = Block('TestBlock', {
      kind: StringValue,
      name: StringValue,
    }).discriminant('kind');
    expect(partial.discriminantField).toBe('kind');
  });
});

// ---------------------------------------------------------------------------
// Parsing with Block discriminant
// ---------------------------------------------------------------------------

describe('Block discriminant parsing', () => {
  const DiscriminatedBlock = Block('DiscBlock', {
    kind: StringValue,
    shared: StringValue,
  })
    .discriminant('kind')
    .variant('alpha', { alpha_field: StringValue })
    .variant('beta', { beta_field: NumberValue });

  test('parses variant-specific fields based on discriminant value', () => {
    const schema = { config: DiscriminatedBlock };
    const result = parseWithSchema(
      `config:\n  kind: "alpha"\n  shared: "test"\n  alpha_field: "hello"`,
      schema
    );
    const config = result.config as unknown as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config.kind).toBeDefined();
    expect(config.shared).toBeDefined();
    expect(config.alpha_field).toBeDefined();
  });

  test('parses second variant correctly', () => {
    const schema = { config: DiscriminatedBlock };
    const result = parseWithSchema(
      `config:\n  kind: "beta"\n  shared: "test"\n  beta_field: 42`,
      schema
    );
    const config = result.config as unknown as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config.kind).toBeDefined();
    expect(config.beta_field).toBeDefined();
  });

  test('unknown discriminant value produces error diagnostic', () => {
    const schema = { config: DiscriminatedBlock };
    const result = parseWithDiagnostics(
      `config:\n  kind: "unknown"\n  shared: "test"`,
      schema
    );
    const diags = collectDiagnostics(result.value);
    const variantDiag = diags.find(d => d.code === 'unknown-variant');
    expect(variantDiag).toBeDefined();
    expect(variantDiag!.message).toContain("Unknown variant 'unknown'");
    expect(variantDiag!.message).toContain('alpha');
    expect(variantDiag!.message).toContain('beta');
  });

  test('missing discriminant field falls back to base schema', () => {
    const schema = { config: DiscriminatedBlock };
    const result = parseWithDiagnostics(`config:\n  shared: "test"`, schema);
    // Should not produce unknown-variant diagnostic
    const diags = collectDiagnostics(result.value);
    const variantDiag = diags.find(d => d.code === 'unknown-variant');
    expect(variantDiag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Parsing with NamedBlock discriminant (CollectionBlock entries)
// ---------------------------------------------------------------------------

describe('NamedBlock discriminant parsing', () => {
  const ToolDefEntry = NamedBlock('ToolDef', {
    target: StringValue,
    kind: StringValue,
  })
    .discriminant('kind')
    .variant('mcp_tool', { tool_name: StringValue })
    .variant('a2a_send', { message_type: StringValue });

  const ToolDefsBlock = CollectionBlock(ToolDefEntry);

  test('collection entries use discriminant-based schema resolution', () => {
    const schema = { tool_defs: ToolDefsBlock };
    const result = parseWithSchema(
      [
        'tool_defs:',
        '  my_tool:',
        '    kind: "mcp_tool"',
        '    target: "conn://foo"',
        '    tool_name: "send-message"',
      ].join('\n'),
      schema
    );
    const toolDefs = result.tool_defs;
    expect(toolDefs).toBeDefined();
    const myTool = toolDefs?.get('my_tool') as Record<string, unknown>;
    expect(myTool).toBeDefined();
    expect(myTool.kind).toBeDefined();
    expect(myTool.target).toBeDefined();
    expect(myTool.tool_name).toBeDefined();
  });

  test('different entries can use different variants', () => {
    const schema = { tool_defs: ToolDefsBlock };
    const result = parseWithSchema(
      [
        'tool_defs:',
        '  tool_a:',
        '    kind: "mcp_tool"',
        '    target: "conn://a"',
        '    tool_name: "do-stuff"',
        '  tool_b:',
        '    kind: "a2a_send"',
        '    target: "conn://b"',
        '    message_type: "request"',
      ].join('\n'),
      schema
    );
    const toolDefs = result.tool_defs;
    const toolA = toolDefs?.get('tool_a') as Record<string, unknown>;
    const toolB = toolDefs?.get('tool_b') as Record<string, unknown>;

    expect(toolA.tool_name).toBeDefined();
    expect(toolB.message_type).toBeDefined();
  });

  test('unknown discriminant value in collection entry produces diagnostic', () => {
    const schema = { tool_defs: ToolDefsBlock };
    const result = parseWithDiagnostics(
      [
        'tool_defs:',
        '  my_tool:',
        '    kind: "invalid"',
        '    target: "conn://foo"',
      ].join('\n'),
      schema
    );
    const diags = collectDiagnostics(result.value);
    const variantDiag = diags.find(d => d.code === 'unknown-variant');
    expect(variantDiag).toBeDefined();
    expect(variantDiag!.message).toContain("Unknown variant 'invalid'");
  });
});

// ---------------------------------------------------------------------------
// Round-trip (parse → emit)
// ---------------------------------------------------------------------------

describe('discriminant round-trip', () => {
  const DiscriminatedBlock = Block('DiscBlock', {
    kind: StringValue,
    name: StringValue,
  })
    .discriminant('kind')
    .variant('alpha', { alpha_field: StringValue });

  test('Block with discriminant round-trips correctly', () => {
    const schema = { config: DiscriminatedBlock };
    const source = `config:\n  kind: "alpha"\n  name: "test"\n  alpha_field: "hello"`;
    const result = parseWithSchema(source, schema);

    const config = result.config as Parsed<BlockCore>;
    expect(config).toBeDefined();
    const emitted = config.__emit({ indent: 1 });
    expect(emitted).toContain('kind: "alpha"');
    expect(emitted).toContain('name: "test"');
    expect(emitted).toContain('alpha_field: "hello"');
  });
});

// ---------------------------------------------------------------------------
// Discriminant field not in first position
// ---------------------------------------------------------------------------

describe('discriminant field position', () => {
  const DiscriminatedBlock = Block('DiscBlock', {
    name: StringValue,
    kind: StringValue,
  })
    .discriminant('kind')
    .variant('alpha', { alpha_field: StringValue });

  test('discriminant field can appear after other fields', () => {
    const schema = { config: DiscriminatedBlock };
    const result = parseWithSchema(
      `config:\n  name: "test"\n  kind: "alpha"\n  alpha_field: "hello"`,
      schema
    );
    const config = result.config as unknown as Record<string, unknown>;
    expect(config).toBeDefined();
    expect(config.alpha_field).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// omit / pick clear discriminant when discriminant field is removed
// ---------------------------------------------------------------------------

describe('omit/pick with discriminant', () => {
  test('Block.omit of discriminant field clears discriminant config', () => {
    const Base = Block('B', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Stripped = Base.omit('kind');
    expect(Stripped.discriminantField).toBeUndefined();
  });

  test('Block.omit of non-discriminant field preserves discriminant config', () => {
    const Base = Block('B', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Reduced = Base.omit('foo');
    expect(Reduced.discriminantField).toBe('kind');
  });

  test('Block.pick excluding discriminant field clears discriminant config', () => {
    const Base = Block('B', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Picked = Base.pick(['foo']);
    expect(Picked.discriminantField).toBeUndefined();
  });

  test('Block.pick including discriminant field preserves discriminant config', () => {
    const Base = Block('B', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Picked = Base.pick(['kind', 'foo']);
    expect(Picked.discriminantField).toBe('kind');
  });

  test('NamedBlock.omit of discriminant field clears discriminant config', () => {
    const Base = NamedBlock('NB', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Stripped = Base.omit('kind');
    expect(Stripped.discriminantField).toBeUndefined();
  });

  test('NamedBlock.pick excluding discriminant field clears discriminant config', () => {
    const Base = NamedBlock('NB', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Picked = Base.pick(['foo']);
    expect(Picked.discriminantField).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// extend() on a discriminant block
// ---------------------------------------------------------------------------

describe('extend() with discriminant', () => {
  test('Block.extend preserves discriminant field and variants', () => {
    const Base = Block('B', { kind: StringValue, name: StringValue })
      .discriminant('kind')
      .variant('x', { extra_x: NumberValue });

    const Extended = Base.extend({ new_field: BooleanValue });
    expect(Extended.discriminantField).toBe('kind');

    // Variant schema should include the new base field
    const variantSchema = Extended.resolveSchemaForDiscriminant!('x');
    expect(variantSchema).toHaveProperty('kind');
    expect(variantSchema).toHaveProperty('name');
    expect(variantSchema).toHaveProperty('extra_x');
    // extend adds to the base schema, but variants were defined before extend —
    // the new_field is on the base schema; variant 'x' merges base + variant fields
    expect(variantSchema).toHaveProperty('new_field');
  });

  test('Block.extend preserves variant-specific fields during parsing', () => {
    const Base = Block('B', { kind: StringValue })
      .discriminant('kind')
      .variant('alpha', { alpha_only: StringValue });

    const Extended = Base.extend({ added: NumberValue });
    const schema = { config: Extended };
    const result = parseWithSchema(
      `config:\n  kind: "alpha"\n  added: 42\n  alpha_only: "yes"`,
      schema
    );
    const config = result.config as unknown as Record<string, unknown>;
    expect(config.kind).toBeDefined();
    expect(config.added).toBeDefined();
    expect(config.alpha_only).toBeDefined();
  });

  test('NamedBlock.extend preserves discriminant field and variants', () => {
    const Base = NamedBlock('NB', { kind: StringValue, target: StringValue })
      .discriminant('kind')
      .variant('mcp', { tool_name: StringValue });

    const Extended = Base.extend({ priority: NumberValue });
    expect(Extended.discriminantField).toBe('kind');

    const variantSchema = Extended.resolveSchemaForDiscriminant!('mcp');
    expect(variantSchema).toHaveProperty('kind');
    expect(variantSchema).toHaveProperty('target');
    expect(variantSchema).toHaveProperty('tool_name');
    expect(variantSchema).toHaveProperty('priority');
  });

  test('unknown variant after extend still falls back to base schema', () => {
    const Base = Block('B', { kind: StringValue })
      .discriminant('kind')
      .variant('x', { extra: NumberValue });

    const Extended = Base.extend({ added: BooleanValue });
    const schema = Extended.resolveSchemaForDiscriminant!('nonexistent');
    expect(schema).toHaveProperty('kind');
    expect(schema).toHaveProperty('added');
    expect(schema).not.toHaveProperty('extra');
  });
});

// ---------------------------------------------------------------------------
// omit() of the discriminant field — graceful handling
// ---------------------------------------------------------------------------

describe('omit() discriminant field behavior', () => {
  test('Block.omit of discriminant field produces block without variant resolution', () => {
    const Base = Block('B', { kind: StringValue, name: StringValue })
      .discriminant('kind')
      .variant('x', { extra: NumberValue });

    const Stripped = Base.omit('kind');
    expect(Stripped.discriminantField).toBeUndefined();

    // Should still be parseable as a plain block
    const schema = { config: Stripped };
    const result = parseWithSchema(`config:\n  name: "test"`, schema);
    expect((result.config as Record<string, unknown>).name).toBeDefined();
  });

  test('NamedBlock.omit of discriminant field produces block without variant resolution', () => {
    const Base = NamedBlock('NB', { kind: StringValue, foo: NumberValue })
      .discriminant('kind')
      .variant('x', { extra: StringValue });

    const Stripped = Base.omit('kind');
    expect(Stripped.discriminantField).toBeUndefined();

    // Variant-specific fields should not be available
    const schema = { items: CollectionBlock(Stripped) };
    const result = parseWithDiagnostics(
      ['items:', '  entry1:', '    foo: 42'].join('\n'),
      schema
    );
    expect(result.value).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Name-based variant + discriminant on the same NamedBlock
// ---------------------------------------------------------------------------

describe('name-based variant vs discriminant interaction', () => {
  test('discriminant takes priority over name-based resolution in schema-walker', () => {
    // When both name-based variants and discriminant are set,
    // the schema-walker checks discriminant first (see schema-walker.ts:90-94)
    const Entry = NamedBlock('Entry', {
      kind: StringValue,
      base_field: StringValue,
    })
      .discriminant('kind')
      .variant('type_a', { a_field: NumberValue })
      .variant('type_b', { b_field: BooleanValue });

    const Collection = CollectionBlock(Entry);

    // Entry named 'type_a' but with kind: "type_b" — discriminant should win
    const schema = { items: Collection };
    const result = parseWithSchema(
      [
        'items:',
        '  type_a:',
        '    kind: "type_b"',
        '    base_field: "test"',
        '    b_field: true',
      ].join('\n'),
      schema
    );
    const items = result.items;
    const entry = items?.get('type_a') as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry.kind).toBeDefined();
    expect(entry.b_field).toBeDefined();
  });

  test('discriminant value determines schema even when entry name matches a variant', () => {
    const Entry = NamedBlock('Entry', {
      kind: StringValue,
    })
      .discriminant('kind')
      .variant('alpha', { alpha_only: StringValue })
      .variant('beta', { beta_only: NumberValue });

    const Collection = CollectionBlock(Entry);
    const schema = { items: Collection };

    // Entry name 'alpha' but discriminant says 'beta'
    const result = parseWithDiagnostics(
      ['items:', '  alpha:', '    kind: "beta"', '    beta_only: 99'].join(
        '\n'
      ),
      schema
    );
    const items = result.value.items;
    const entry = items?.get('alpha') as Record<string, unknown>;
    expect(entry).toBeDefined();
    expect(entry.beta_only).toBeDefined();

    // Should not produce unknown-variant diagnostic for 'beta'
    const diags = collectDiagnostics(result.value);
    const variantDiag = diags.find(d => d.code === 'unknown-variant');
    expect(variantDiag).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Realistic enum-like discriminant (multiple variants, multi-field schemas)
// ---------------------------------------------------------------------------

describe('enum-like discriminant field', () => {
  test('multi-variant discriminant with realistic service config schema', () => {
    // Production-like pattern: discriminant selects config shape for different service types
    const ConfigBlock = Block('Config', {
      type: StringValue,
      name: StringValue,
    })
      .discriminant('type')
      .variant('database', { connection_string: StringValue })
      .variant('api', { endpoint: StringValue, api_key: StringValue });

    expect(ConfigBlock.discriminantField).toBe('type');

    const schema = { config: ConfigBlock };
    const dbResult = parseWithSchema(
      [
        'config:',
        '  type: "database"',
        '  name: "main-db"',
        '  connection_string: "postgres://localhost/db"',
      ].join('\n'),
      schema
    );
    const dbConfig = dbResult.config as unknown as Record<string, unknown>;
    expect(dbConfig.type).toBeDefined();
    expect(dbConfig.name).toBeDefined();
    expect(dbConfig.connection_string).toBeDefined();
  });

  test('enum-like discriminant produces unknown-variant for invalid values', () => {
    const ConfigBlock = Block('Config', {
      type: StringValue,
    })
      .discriminant('type')
      .variant('a', { a_field: NumberValue })
      .variant('b', { b_field: BooleanValue });

    const schema = { config: ConfigBlock };
    const result = parseWithDiagnostics(`config:\n  type: "c"`, schema);
    const diags = collectDiagnostics(result.value);
    const variantDiag = diags.find(d => d.code === 'unknown-variant');
    expect(variantDiag).toBeDefined();
    expect(variantDiag!.message).toContain("Unknown variant 'c'");
  });

  test('NamedBlock collection with enum-like discriminant for protocol selection', () => {
    const ServiceEntry = NamedBlock('Service', {
      protocol: StringValue,
      host: StringValue,
    })
      .discriminant('protocol')
      .variant('http', { path: StringValue })
      .variant('grpc', { service_name: StringValue, method: StringValue });

    const ServicesBlock = CollectionBlock(ServiceEntry);
    const schema = { services: ServicesBlock };

    const result = parseWithSchema(
      [
        'services:',
        '  web:',
        '    protocol: "http"',
        '    host: "example.com"',
        '    path: "/api/v1"',
        '  backend:',
        '    protocol: "grpc"',
        '    host: "internal.svc"',
        '    service_name: "UserService"',
        '    method: "GetUser"',
      ].join('\n'),
      schema
    );
    const services = result.services;
    const web = services?.get('web') as Record<string, unknown>;
    const backend = services?.get('backend') as Record<string, unknown>;

    expect(web.protocol).toBeDefined();
    expect(web.path).toBeDefined();
    expect(backend.protocol).toBeDefined();
    expect(backend.service_name).toBeDefined();
    expect(backend.method).toBeDefined();
  });
});
