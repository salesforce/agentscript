/**
 * Tests for programmatic construction and emit of blocks, named blocks,
 * collections, typed maps, sequences, and full document-level structures.
 *
 * These tests verify that every layer of the schema/dialect API can be
 * constructed without parsing and emits correct AgentScript source.
 */
import { describe, test, expect } from 'vitest';
import {
  parseComponent,
  emitComponent,
  mutateComponent,
  parse,
  // Block factories from agentforce dialect
  KnowledgeBlock,
  AFActionsBlock,
  PronunciationDictEntryBlock,
  InboundKeywordsBlock,
  // AST nodes
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  AtIdentifier,
  MemberExpression,
  SequenceNode,
  // Statements
  WithClause,
  SetClause,
  RunStatement,
  IfStatement,
  ComparisonExpression,
  BinaryExpression,
  // Block internals
  Block,
  NamedBlock,
  CollectionBlock,
  StringValue,
  BooleanValue,
  NumberValue,
  ProcedureValue,
  ExpressionValue,
  ExpressionSequence,
} from '@agentscript/agentforce';
import type { BlockCore, Parsed } from '@agentscript/agentforce';

function assertDefined<T>(val: T | undefined | null): asserts val is T {
  expect(val).toBeDefined();
}

/**
 * Cast a programmatically constructed block for use with `.set()` / `.addEntry()`.
 *
 * CollectionBlock types expect `Parsed<... & BlockCore>` (requires `__cst`),
 * but programmatic blocks don't have CST metadata. The runtime `.set()` works
 * fine — this helper bridges the type gap.
 */
function asParsed<T extends BlockCore>(block: T): Parsed<T> {
  return block as Parsed<T>;
}

const ctx = { indent: 0 };

describe('programmatic block construction and emit', () => {
  describe('Block() factory — singular blocks', () => {
    test('creates a minimal block and emits fields', () => {
      const MyBlock = Block('MyBlock', {
        description: StringValue.describe('A description'),
      });
      const instance = new MyBlock({
        description: new StringLiteral('Hello world'),
      });
      expect(instance.__kind).toBe('MyBlock');
      const emitted = instance.__emit({ indent: 0 });
      expect(emitted).toBe('description: "Hello world"');
    });

    test('block with multiple field types', () => {
      const TestBlock = Block('TestBlock', {
        name: StringValue,
        count: NumberValue,
        enabled: BooleanValue,
      });
      const instance = new TestBlock({
        name: new StringLiteral('test'),
        count: new NumberLiteral(42),
        enabled: new BooleanLiteral(true),
      });
      const emitted = instance.__emit(ctx);
      expect(emitted).toContain('name: "test"');
      expect(emitted).toContain('count: 42');
      expect(emitted).toContain('enabled: True');
    });

    test('block with missing optional fields emits only set fields', () => {
      const TestBlock = Block('TestBlock', {
        required_field: StringValue,
        optional_field: StringValue,
      });
      const instance = new TestBlock({
        required_field: new StringLiteral('present'),
      });
      const emitted = instance.__emit(ctx);
      expect(emitted).toBe('required_field: "present"');
      expect(emitted).not.toContain('optional_field');
    });

    test('block field can be reassigned and re-emitted', () => {
      const TestBlock = Block('TestBlock', {
        label: StringValue,
      });
      const instance = new TestBlock({
        label: new StringLiteral('original'),
      });
      expect(instance.__emit(ctx)).toBe('label: "original"');

      // Accessors are defined at runtime via Object.defineProperty —
      // TS doesn't know about them, but they exist. Assign via the
      // runtime-dynamic property.
      instance.label = new StringLiteral('updated');
      expect(instance.__emit(ctx)).toBe('label: "updated"');
    });

    test('block with no fields emits empty', () => {
      const EmptyBlock = Block('EmptyBlock');
      const instance = new EmptyBlock({});
      expect(instance.__emit(ctx)).toBe('');
    });

    test('emitComponent wraps singular block with kind header', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      config.description = new StringLiteral('Programmatic');
      const output = emitComponent(config);
      expect(output).toBe('config:\n    description: "Programmatic"');
    });
  });

  describe('NamedBlock() factory — named entry blocks', () => {
    test('creates a named block and emits with name header', () => {
      const MyNamedBlock = NamedBlock('MyNamedBlock', {
        description: StringValue.describe('Description'),
      });
      const instance = new MyNamedBlock('billing', {
        description: new StringLiteral('Handle billing'),
      });
      expect(instance.__kind).toBe('MyNamedBlock');
      expect(instance.__name).toBe('billing');
      const emitted = instance.__emit(ctx);
      expect(emitted).toBe('billing:\n    description: "Handle billing"');
    });

    test('named block emitWithKey adds schema key prefix', () => {
      const MyNamedBlock = NamedBlock('MyNamedBlock', {
        description: StringValue,
      });
      const instance = new MyNamedBlock('main', {
        description: new StringLiteral('Main topic'),
      });
      const emitted = instance.emitWithKey('topic', ctx);
      expect(emitted).toBe('topic main:\n    description: "Main topic"');
    });

    test('named block with colinear value', () => {
      const ColinearBlock = NamedBlock(
        'ColinearBlock',
        {
          description: StringValue,
        },
        { colinear: ExpressionValue }
      );
      const instance = new ColinearBlock('fetch_data', {
        description: new StringLiteral('Fetches data'),
      });
      instance.value = new MemberExpression(
        new AtIdentifier('actions'),
        'FetchData'
      );
      const emitted = instance.__emit(ctx);
      expect(emitted).toBe(
        'fetch_data: @actions.FetchData\n    description: "Fetches data"'
      );
    });

    test('named block with colinear value and statements', () => {
      const ActionEntry = NamedBlock(
        'ActionEntry',
        {},
        { colinear: ExpressionValue, body: ProcedureValue }
      );
      const instance = new ActionEntry('lookup', {});
      instance.value = new MemberExpression(
        new AtIdentifier('actions'),
        'Lookup'
      );
      instance.statements = [
        new WithClause(
          'id',
          new MemberExpression(new AtIdentifier('variables'), 'record_id')
        ),
        new SetClause(
          new MemberExpression(new AtIdentifier('variables'), 'result'),
          new MemberExpression(new AtIdentifier('outputs'), 'data')
        ),
      ];
      const emitted = instance.__emit(ctx);
      expect(emitted).toContain('lookup: @actions.Lookup');
      expect(emitted).toContain('with id = @variables.record_id');
      expect(emitted).toContain('set @variables.result = @outputs.data');
    });

    test('named block with empty fields', () => {
      const MyNamedBlock = NamedBlock('MyNamedBlock', {
        description: StringValue,
      });
      const instance = new MyNamedBlock('empty_topic', {});
      const emitted = instance.__emit(ctx);
      expect(emitted).toBe('empty_topic:');
    });

    test('named block name with special characters gets quoted', () => {
      const MyNamedBlock = NamedBlock('MyNamedBlock', {
        description: StringValue,
      });
      const instance = new MyNamedBlock('my-topic', {
        description: new StringLiteral('Has hyphen'),
      });
      const emitted = instance.__emit(ctx);
      expect(emitted).toContain('"my-topic":');
    });

    test('named block field reassignment via parseComponent', () => {
      const topic = parseComponent(
        'topic test:\n    label: "Original"\n    description: "Desc"',
        'topic'
      );
      assertDefined(topic);
      topic.label = new StringLiteral('Updated');
      const emitted = emitComponent(topic);
      expect(emitted).toContain('label: "Updated"');
      expect(emitted).toContain('description: "Desc"');
    });
  });

  describe('CollectionBlock — named collections', () => {
    test('creates empty collection', () => {
      const EntryBlock = NamedBlock('EntryBlock', {
        description: StringValue,
      });
      const Collection = CollectionBlock(EntryBlock);
      const instance = new Collection();
      expect(instance.__children).toEqual([]);
    });

    test('creates collection with entries', () => {
      const EntryBlock = NamedBlock('EntryBlock', {
        description: StringValue,
      });
      const Collection = CollectionBlock(EntryBlock);
      const entry1 = new EntryBlock('first', {
        description: new StringLiteral('First entry'),
      });
      const entry2 = new EntryBlock('second', {
        description: new StringLiteral('Second entry'),
      });
      const instance = new Collection();
      // .set() types expect Parsed<...> (has __cst), but programmatic blocks
      // lack CST. The runtime NamedMap<BlockCore>.set() accepts BlockCore fine.
      instance.set('first', asParsed(entry1));
      instance.set('second', asParsed(entry2));

      const emitted = instance.__emit({ indent: 0 });
      expect(emitted).toContain('first:');
      expect(emitted).toContain('description: "First entry"');
      expect(emitted).toContain('second:');
      expect(emitted).toContain('description: "Second entry"');
    });

    test('AFActionsBlock programmatic construction', () => {
      const actions = new AFActionsBlock();
      const action = parseComponent(
        'Get_Weather:\n    description: "Get weather"\n    target: "flow://Weather"',
        'action'
      );
      assertDefined(action);
      actions.set('Get_Weather', action);

      const emitted = actions.__emit({ indent: 0 });
      expect(emitted).toContain('Get_Weather:');
      expect(emitted).toContain('description: "Get weather"');
      expect(emitted).toContain('target: "flow://Weather"');
    });
  });

  describe('SequenceNode — dash-prefixed lists', () => {
    test('empty sequence', () => {
      const seq = new SequenceNode();
      expect(seq.__emit(ctx)).toBe('');
    });

    test('sequence with expressions', () => {
      const seq = new SequenceNode([
        new StringLiteral('first'),
        new StringLiteral('second'),
      ]);
      expect(seq.__emit(ctx)).toBe('- "first"\n- "second"');
    });

    test('sequence with numbers', () => {
      const seq = new SequenceNode([
        new NumberLiteral(1),
        new NumberLiteral(2),
        new NumberLiteral(3),
      ]);
      expect(seq.__emit(ctx)).toBe('- 1\n- 2\n- 3');
    });

    test('sequence at indent level', () => {
      const seq = new SequenceNode([new StringLiteral('item')]);
      expect(seq.__emit({ indent: 1 })).toBe('    - "item"');
    });

    test('sequence items can be reassigned', () => {
      const seq = new SequenceNode([new StringLiteral('old')]);
      seq.items = [new StringLiteral('new1'), new StringLiteral('new2')];
      expect(seq.__emit(ctx)).toBe('- "new1"\n- "new2"');
    });

    test('sequence with block entries (PronunciationDictEntryBlock)', () => {
      const entry1 = new PronunciationDictEntryBlock({
        grapheme: new StringLiteral('API'),
        phoneme: new StringLiteral('ey-pee-eye'),
        type: new StringLiteral('IPA'),
      });
      const entry2 = new PronunciationDictEntryBlock({
        grapheme: new StringLiteral('SQL'),
        phoneme: new StringLiteral('sequel'),
        type: new StringLiteral('IPA'),
      });
      const seq = new SequenceNode([entry1, entry2]);
      const emitted = seq.__emit(ctx);
      expect(emitted).toContain('- grapheme: "API"');
      expect(emitted).toContain('  phoneme: "ey-pee-eye"');
      expect(emitted).toContain('- grapheme: "SQL"');
      expect(emitted).toContain('  phoneme: "sequel"');
    });
  });

  describe('dialect-specific blocks', () => {
    test('KnowledgeBlock programmatic construction', () => {
      const knowledge = new KnowledgeBlock({
        citations_url: new StringLiteral('https://help.example.com'),
        rag_feature_config_id: new StringLiteral('my_kb'),
        citations_enabled: new BooleanLiteral(true),
      });
      const emitted = knowledge.__emit({ indent: 1 });
      expect(emitted).toContain('citations_url: "https://help.example.com"');
      expect(emitted).toContain('rag_feature_config_id: "my_kb"');
      expect(emitted).toContain('citations_enabled: True');
    });

    test('ContextBlock with nested memory block', () => {
      const context = parseComponent('memory:\n    enabled: True', 'context');
      assertDefined(context);
      const output = emitComponent(context);
      expect(output).toBe('context:\n    memory:\n        enabled: True');
    });

    test('PronunciationDictEntryBlock construction', () => {
      const entry = new PronunciationDictEntryBlock({
        grapheme: new StringLiteral('hello'),
        phoneme: new StringLiteral('həˈloʊ'),
        type: new StringLiteral('IPA'),
      });
      const emitted = entry.__emit(ctx);
      expect(emitted).toContain('grapheme: "hello"');
      expect(emitted).toContain('phoneme: "həˈloʊ"');
      expect(emitted).toContain('type: "IPA"');
    });

    test('InboundKeywordsBlock with keyword sequence', () => {
      const keywords = new InboundKeywordsBlock({
        keywords: new SequenceNode([
          new StringLiteral('Hello'),
          new StringLiteral('Help'),
          new StringLiteral('Support'),
        ]),
      });
      const emitted = keywords.__emit({ indent: 0 });
      expect(emitted).toContain('keywords:');
      expect(emitted).toContain('- "Hello"');
      expect(emitted).toContain('- "Help"');
      expect(emitted).toContain('- "Support"');
    });

    test('SecurityBlock with nested sharing policy', () => {
      const security = parseComponent(
        'sharing_policy:\n    use_default_sharing_entities: True',
        'security'
      );
      assertDefined(security);
      const output = emitComponent(security);
      expect(output).toContain('security:');
      expect(output).toContain('sharing_policy:');
      expect(output).toContain('use_default_sharing_entities: True');
    });
  });

  describe('nested block composition', () => {
    test('block with sequence field', () => {
      const ListBlock = Block('ListBlock', {
        items: ExpressionSequence().describe('List of items'),
      });
      const instance = new ListBlock({
        items: new SequenceNode([
          new StringLiteral('a'),
          new StringLiteral('b'),
        ]),
      });
      const emitted = instance.__emit(ctx);
      expect(emitted).toBe('items:\n    - "a"\n    - "b"');
    });

    test('block with nested block field', () => {
      const InnerBlock = Block('InnerBlock', {
        value: StringValue,
      });
      const OuterBlock = Block('OuterBlock', {
        inner: InnerBlock,
      });
      const inner = new InnerBlock({ value: new StringLiteral('nested') });
      const outer = new OuterBlock({ inner });
      const emitted = outer.__emit(ctx);
      expect(emitted).toBe('inner:\n    value: "nested"');
    });

    test('named block with collection field', () => {
      const ItemBlock = NamedBlock('ItemBlock', {
        description: StringValue,
      });
      const ItemsCollection = CollectionBlock(ItemBlock);
      const ContainerBlock = NamedBlock('ContainerBlock', {
        items: ItemsCollection,
      });

      const item = new ItemBlock('widget', {
        description: new StringLiteral('A widget'),
      });
      const items = new ItemsCollection();
      items.set('widget', asParsed(item));

      const container = new ContainerBlock('container', { items });
      const emitted = container.__emit(ctx);
      expect(emitted).toContain('container:');
      expect(emitted).toContain('items:');
      expect(emitted).toContain('widget:');
      expect(emitted).toContain('description: "A widget"');
    });
  });

  describe('parse then mutate then emit', () => {
    test('parse config, mutate field, emit', () => {
      const config = parseComponent('description: "Original"', 'config');
      assertDefined(config);
      config.description = new StringLiteral('Mutated');
      const output = emitComponent(config);
      expect(output).toBe('config:\n    description: "Mutated"');
    });

    test('parse topic, add field, emit', () => {
      const topic = parseComponent(
        'topic billing:\n    description: "Billing"',
        'topic'
      );
      assertDefined(topic);
      topic.label = new StringLiteral('Billing Topic');
      const output = emitComponent(topic);
      expect(output).toContain('topic billing:');
      expect(output).toContain('description: "Billing"');
      expect(output).toContain('label: "Billing Topic"');
    });

    test('parse action, mutate target, emit', () => {
      // 'action' overload returns a wide union; mutateComponent provides
      // type-safe field access via helpers.
      const action = parseComponent(
        'Get_Status:\n    description: "Get status"\n    target: "flow://OldFlow"',
        'action'
      );
      assertDefined(action);
      mutateComponent(action, (_block, helpers) => {
        helpers.setField('target', new StringLiteral('flow://NewFlow'));
      });
      const output = emitComponent(action);
      expect(output).toContain('Get_Status:');
      expect(output).toContain('description: "Get status"');
      expect(output).toContain('target: "flow://NewFlow"');
    });
  });

  describe('document-level construction', () => {
    test('parse full document and emit', () => {
      const source = [
        'config:',
        '    description: "My agent"',
        '',
        'system:',
        '    instructions: "Be helpful"',
      ].join('\n');
      const doc = parse(source);
      const output = doc.emit();
      expect(output).toContain('config:');
      expect(output).toContain('description: "My agent"');
      expect(output).toContain('system:');
      expect(output).toContain('instructions: "Be helpful"');
    });

    test('parse document, mutate, emit', () => {
      const source = 'config:\n    description: "Original"';
      const doc = parse(source);
      doc.mutate((_ast, helpers) => {
        helpers.setField(
          'config',
          parseComponent('description: "Updated"', 'config')
        );
      });
      const output = doc.emit();
      expect(output).toContain('description: "Updated"');
    });

    test('document undo/redo', () => {
      const source = 'config:\n    description: "V1"';
      const doc = parse(source);

      doc.mutate((_ast, helpers) => {
        helpers.setField(
          'config',
          parseComponent('description: "V2"', 'config')
        );
      });
      expect(doc.emit()).toContain('description: "V2"');

      doc.undo();
      expect(doc.emit()).toContain('description: "V1"');

      doc.redo();
      expect(doc.emit()).toContain('description: "V2"');
    });
  });

  describe('edge cases at block level', () => {
    test('block extended with .extend() preserves base fields', () => {
      const BaseBlock = Block('BaseBlock', {
        name: StringValue,
      });
      const ExtendedBlock = BaseBlock.extend({
        extra: BooleanValue,
      });
      const instance = new ExtendedBlock({
        name: new StringLiteral('test'),
        extra: new BooleanLiteral(true),
      });
      const emitted = instance.__emit(ctx);
      expect(emitted).toContain('name: "test"');
      expect(emitted).toContain('extra: True');
    });

    test('named block emitWithKey at indent level', () => {
      const MyBlock = NamedBlock('MyBlock', {
        description: StringValue,
      });
      const instance = new MyBlock('inner', {
        description: new StringLiteral('Nested'),
      });
      const emitted = instance.emitWithKey('subagent', { indent: 1 });
      expect(emitted).toBe(
        '    subagent inner:\n        description: "Nested"'
      );
    });

    test('collection with many entries preserves order', () => {
      const EntryBlock = NamedBlock('EntryBlock', {
        description: StringValue,
      });
      const Collection = CollectionBlock(EntryBlock);
      const instance = new Collection();

      for (let i = 0; i < 10; i++) {
        const entry = new EntryBlock(`entry_${i}`, {
          description: new StringLiteral(`Description ${i}`),
        });
        instance.set(`entry_${i}`, asParsed(entry));
      }

      const emitted = instance.__emit(ctx);
      const lines = emitted.split('\n');
      const entryLines = lines.filter((l: string) => l.match(/^entry_\d+:/));
      expect(entryLines.length).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(entryLines[i]).toBe(`entry_${i}:`);
      }
    });

    test('sequence with block entries', () => {
      const entry = new PronunciationDictEntryBlock({
        grapheme: new StringLiteral('test'),
        phoneme: new StringLiteral('test'),
        type: new StringLiteral('IPA'),
      });
      const seq = new SequenceNode([entry]);
      const emitted = seq.__emit(ctx);
      expect(emitted).toContain('- grapheme: "test"');
    });

    test('modality voice block via parseComponent', () => {
      const voice = parseComponent(
        'modality voice:\n    voice_id: "voice123"',
        'modality'
      );
      assertDefined(voice);
      const output = emitComponent(voice);
      expect(output).toContain('modality voice:');
      expect(output).toContain('voice_id: "voice123"');
    });

    test('voice modality with pronunciation_dict sequence', () => {
      const voice = parseComponent(
        'modality voice:\n    voice_id: "test"',
        'modality'
      );
      assertDefined(voice);

      const entry = new PronunciationDictEntryBlock({
        grapheme: new StringLiteral('API'),
        phoneme: new StringLiteral('ay-pee-eye'),
        type: new StringLiteral('IPA'),
      });
      voice.pronunciation_dict = new SequenceNode([entry]);

      const output = emitComponent(voice);
      expect(output).toContain('modality voice:');
      expect(output).toContain('voice_id: "test"');
      expect(output).toContain('pronunciation_dict:');
      expect(output).toContain('- grapheme: "API"');
      expect(output).toContain('phoneme: "ay-pee-eye"');
    });

    test('reasoning_actions round-trip with programmatic with/set', () => {
      const source =
        'FinalizeReservation: @actions.FinalizeReservation\n    with contactRecord = ...';
      const actions = parseComponent(source, 'reasoning_actions');
      expect(actions).toBeDefined();
      const output = emitComponent(actions);
      expect(output).toContain(
        'FinalizeReservation: @actions.FinalizeReservation'
      );
      expect(output).toContain('with contactRecord = ...');
    });
  });

  describe('complex full-stack scenarios', () => {
    test('full agent document programmatic assembly', () => {
      const source = [
        'config:',
        '    description: "Customer Support Agent"',
        '    agent_type: "AgentforceServiceAgent"',
        '',
        'system:',
        '    instructions: "Help customers with their questions"',
        '',
        'topic billing:',
        '    description: "Handle billing inquiries"',
        '    actions:',
        '        Get_Invoice:',
        '            description: "Retrieves invoice"',
        '            target: "flow://GetInvoice"',
      ].join('\n');

      const doc = parse(source);
      const output = doc.emit();

      expect(output).toContain('config:');
      expect(output).toContain('description: "Customer Support Agent"');
      expect(output).toContain('system:');
      expect(output).toContain(
        'instructions: "Help customers with their questions"'
      );
      expect(output).toContain('topic billing:');
      expect(output).toContain('description: "Handle billing inquiries"');
      expect(output).toContain('actions:');
      expect(output).toContain('Get_Invoice:');
      expect(output).toContain('target: "flow://GetInvoice"');
    });

    test('parse → mutate → add topic → emit', () => {
      const source = 'config:\n    description: "Agent"';
      const doc = parse(source);

      const topic = parseComponent(
        'topic support:\n    description: "Customer support"',
        'topic'
      );
      assertDefined(topic);
      doc.mutate((_ast, helpers) => {
        helpers.addEntry('topic', 'support', asParsed(topic));
      });

      const output = doc.emit();
      expect(output).toContain('config:');
      expect(output).toContain('topic support:');
      expect(output).toContain('description: "Customer support"');
    });

    test('document with variables block', () => {
      const source = [
        'variables:',
        '    user_name: string = "Guest"',
        '    counter: number = 0',
      ].join('\n');
      const doc = parse(source);
      const output = doc.emit();
      expect(output).toContain('user_name: string = "Guest"');
      expect(output).toContain('counter: number = 0');
    });

    test('document with knowledge block', () => {
      const source = [
        'knowledge:',
        '    citations_url: "https://help.example.com"',
        '    citations_enabled: True',
      ].join('\n');
      const doc = parse(source);
      const output = doc.emit();
      expect(output).toContain('citations_url: "https://help.example.com"');
      expect(output).toContain('citations_enabled: True');
    });

    test('emitComponent for statement array', () => {
      const stmts = [
        new RunStatement(
          new MemberExpression(new AtIdentifier('actions'), 'Step1'),
          [new WithClause('x', new NumberLiteral(1))]
        ),
        new IfStatement(
          new ComparisonExpression(
            new MemberExpression(new AtIdentifier('outputs'), 'ok'),
            '==',
            new BooleanLiteral(true)
          ),
          [
            new RunStatement(
              new MemberExpression(new AtIdentifier('actions'), 'Step2'),
              []
            ),
          ]
        ),
      ];
      const output = emitComponent(stmts);
      expect(output).toBe(
        [
          'run @actions.Step1',
          '    with x = 1',
          'if @outputs.ok == True:',
          '    run @actions.Step2',
        ].join('\n')
      );
    });

    test('emitComponent for single expression', () => {
      const expr = new BinaryExpression(
        new MemberExpression(new AtIdentifier('variables'), 'count'),
        '+',
        new NumberLiteral(1)
      );
      const output = emitComponent(expr);
      expect(output).toBe('@variables.count + 1');
    });
  });
});
