/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the linting infrastructure and built-in analyzers/rules.
 */

import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  parseWithSchema,
  testSchemaCtx,
  toAstRoot,
} from './test-utils.js';
import {
  createSchemaContext,
  LintEngine,
  PassStore,
  collectDiagnostics,
  DependencyResolutionError,
  storeKey,
  defineRule,
  each,
  symbolTableAnalyzer,
  symbolTableKey,
  Block,
  NamedBlock,
  CollectionBlock,
  NamedCollectionBlock,
  NamedMap,
  StringValue,
  NumberValue,
  BooleanValue,
  Sequence,
  requiredFieldPass,
  constraintValidationPass,
  expressionValidationPass,
  BUILTIN_FUNCTIONS,
} from '@agentscript/language';
import type { LintPass, AstRoot, FieldType } from '@agentscript/language';
import { DiagnosticSeverity, DiagnosticTag } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { createLintEngine } from '../lint/index.js';
import {
  typeMapAnalyzer,
  typeMapKey,
  reasoningActionsAnalyzer,
  reasoningActionsKey,
} from '../lint/passes/index.js';

/** Minimal AstRoot stub for infrastructure tests that don't need a real AST. */
const EMPTY_AST = {} as AstRoot;

/** Minimal SchemaContext for infrastructure tests that don't need a real schema. */
const EMPTY_SCHEMA_CTX = createSchemaContext({ schema: {}, aliases: {} });

// ============================================================================
// LintEngine infrastructure tests
// ============================================================================

describe('LintEngine', () => {
  it('runs data passes before validation passes that depend on their data', () => {
    const order: string[] = [];
    const testData = storeKey<{ value: number }>('test-data');

    const analyzer: LintPass = {
      id: testData,
      description: 'Test analyzer',
      init() {},
      finalize(store) {
        order.push('analyzer');
        store.set(testData, { value: 42 });
      },
    };

    const rule: LintPass = {
      id: storeKey('test/rule'),
      description: 'Test rule',
      requires: [testData],
      run(store) {
        order.push('rule');
        const data = store.get(testData);
        expect(data).toEqual({ value: 42 });
      },
    };

    const engine = new LintEngine({ passes: [analyzer, rule] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(order).toEqual(['analyzer', 'rule']);
  });

  it('topologically sorts pass finalize by finalizeAfter', () => {
    const order: string[] = [];
    const keyA = storeKey<string>('test/a');
    const keyB = storeKey<string>('test/b');

    const analyzerB: LintPass = {
      id: keyB,
      description: 'Analyzer B',
      init() {},
      finalize(store) {
        order.push('b');
        store.set(keyB, 'b-data');
      },
    };

    const analyzerA: LintPass = {
      id: keyA,
      description: 'Analyzer A',
      finalizeAfter: [keyB],
      init() {},
      finalize(store) {
        order.push('a');
        store.set(keyA, 'a-data');
      },
    };

    // Add A first — engine should still finalize B before A
    const engine = new LintEngine({ passes: [analyzerA, analyzerB] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(order).toEqual(['b', 'a']);
  });

  it('skips pass run() when required StoreKey is missing', () => {
    const missingKey = storeKey<string>('nonexistent-data');

    const rule: LintPass = {
      id: storeKey('test/rule'),
      description: 'Test rule',
      requires: [missingKey],
      run() {},
    };

    const engine = new LintEngine({ passes: [rule] });
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    // Should produce a skip diagnostic, not throw
    const skipped = diagnostics.filter(d => d.code === 'lint-pass-skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].message).toContain("'nonexistent-data'");
  });

  it('throws DependencyResolutionError on cyclic finalizeAfter', () => {
    const keyA = storeKey<string>('test/a');
    const keyB = storeKey<string>('test/b');

    const analyzerA: LintPass = {
      id: keyA,
      description: 'Analyzer A',
      finalizeAfter: [keyB],
      init() {},
      finalize() {},
    };

    const analyzerB: LintPass = {
      id: keyB,
      description: 'Analyzer B',
      finalizeAfter: [keyA],
      init() {},
      finalize() {},
    };

    const engine = new LintEngine({
      passes: [analyzerA, analyzerB],
    });
    expect(() => engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX)).toThrow(
      DependencyResolutionError
    );
  });

  it('throws on duplicate pass ids', () => {
    const analyzer1: LintPass = {
      id: storeKey('test/same'),
      description: 'Analyzer 1',
      init() {},
      finalize() {},
    };

    const analyzer2: LintPass = {
      id: storeKey('test/same'),
      description: 'Analyzer 2',
      init() {},
      finalize() {},
    };

    expect(() => new LintEngine({ passes: [analyzer1, analyzer2] })).toThrow(
      /Duplicate lint id/
    );
  });

  it('throws on duplicate pass ids (second set)', () => {
    const rule1: LintPass = {
      id: storeKey('test/same'),
      description: 'Rule 1',
      requires: [],
      run() {},
    };

    const rule2: LintPass = {
      id: storeKey('test/same'),
      description: 'Rule 2',
      requires: [],
      run() {},
    };

    expect(() => new LintEngine({ passes: [rule1, rule2] })).toThrow(
      /Duplicate lint id/
    );
  });

  it('throws on duplicate id across two passes', () => {
    const analyzer: LintPass = {
      id: storeKey('test/same'),
      description: 'Analyzer',
      init() {},
      finalize() {},
    };

    const rule: LintPass = {
      id: storeKey('test/same'),
      description: 'Rule',
      requires: [],
      run() {},
    };

    expect(() => new LintEngine({ passes: [analyzer, rule] })).toThrow(
      /Duplicate lint id/
    );
  });

  it('runs with no passes', () => {
    const engine = new LintEngine();
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);
    expect(diagnostics).toEqual([]);
  });

  it('disable() skips a pass during run', () => {
    const order: string[] = [];

    const analyzerA: LintPass = {
      id: storeKey('a'),
      description: 'Analyzer A',
      init() {},
      finalize() {
        order.push('a');
      },
    };

    const analyzerB: LintPass = {
      id: storeKey('b'),
      description: 'Analyzer B',
      init() {},
      finalize() {
        order.push('b');
      },
    };

    const engine = new LintEngine({ passes: [analyzerA, analyzerB] });
    engine.disable('b');
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(order).toEqual(['a']);
  });

  it('enable() re-enables a previously disabled pass', () => {
    const order: string[] = [];

    const analyzer: LintPass = {
      id: storeKey('a'),
      description: 'Analyzer A',
      init() {},
      finalize() {
        order.push('a');
      },
    };

    const engine = new LintEngine({ passes: [analyzer] });
    engine.disable('a');
    engine.enable('a');
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(order).toEqual(['a']);
  });

  it('disable() throws on unknown id', () => {
    const engine = new LintEngine();
    expect(() => engine.disable('nonexistent')).toThrow(
      /Cannot disable unknown lint id/
    );
  });

  it('enable() throws on unknown id', () => {
    const engine = new LintEngine();
    expect(() => engine.enable('nonexistent')).toThrow(
      /Cannot enable unknown lint id/
    );
  });

  it('disabling a pass auto-skips dependent passes', () => {
    const order: string[] = [];
    const depKey = storeKey<string>('dep-data');

    const depAnalyzer: LintPass = {
      id: depKey,
      description: 'Dependency',
      init() {},
      finalize(store) {
        order.push('dep');
        store.set(depKey, 'data');
      },
    };

    const consumer: LintPass = {
      id: storeKey('consumer'),
      description: 'Consumer',
      requires: [depKey],
      run() {
        order.push('consumer');
      },
    };

    const independent: LintPass = {
      id: storeKey('independent'),
      description: 'Independent',
      requires: [],
      run() {
        order.push('independent');
      },
    };

    const engine = new LintEngine({
      passes: [depAnalyzer, consumer, independent],
    });
    engine.disable(depKey);

    // Should not throw — consumer is auto-skipped because its required data is missing
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    // Consumer should have been skipped with a diagnostic
    const skipped = diagnostics.filter(d => d.code === 'lint-pass-skipped');
    expect(skipped).toHaveLength(1);

    // Only the independent rule should have run
    expect(order).toEqual(['independent']);
  });

  it('catches pass finalize errors and produces lint-pass-error diagnostic', () => {
    const badAnalyzer: LintPass = {
      id: storeKey('bad-analyzer'),
      description: 'Throws an error',
      init() {},
      finalize() {
        throw new Error('boom');
      },
    };

    const engine = new LintEngine({ passes: [badAnalyzer] });
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    const errors = diagnostics.filter(d => d.code === 'lint-pass-error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('boom');
  });

  it('catches pass run errors and produces lint-pass-error diagnostic', () => {
    const badRule: LintPass = {
      id: storeKey('bad-rule'),
      description: 'Throws an error',
      requires: [],
      run() {
        throw new Error('kaboom');
      },
    };

    const engine = new LintEngine({ passes: [badRule] });
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    const errors = diagnostics.filter(d => d.code === 'lint-pass-error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('kaboom');
  });

  it('skips pass finalize when its finalizeAfter dep failed', () => {
    const depKey = storeKey<string>('dep-data');

    const depAnalyzer: LintPass = {
      id: depKey,
      description: 'Dependency that fails',
      init() {},
      finalize() {
        throw new Error('dep failed');
      },
    };

    const dependent: LintPass = {
      id: storeKey('dependent'),
      description: 'Depends on dep-data',
      finalizeAfter: [depKey],
      init() {},
      finalize() {},
    };

    const engine = new LintEngine({
      passes: [depAnalyzer, dependent],
    });
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    const errors = diagnostics.filter(d => d.code === 'lint-pass-error');
    expect(errors).toHaveLength(1);

    const skipped = diagnostics.filter(d => d.code === 'lint-pass-skipped');
    expect(skipped).toHaveLength(1);
    expect(skipped[0].message).toContain("'dependent'");
  });

  it('catches init() errors and produces lint-pass-error diagnostic', () => {
    const badAnalyzer: LintPass = {
      id: storeKey('init-thrower'),
      description: 'Throws in init',
      init() {
        throw new Error('init went wrong');
      },
      finalize() {},
    };

    const engine = new LintEngine({ passes: [badAnalyzer] });
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    const errors = diagnostics.filter(d => d.code === 'lint-pass-error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('init went wrong');
  });

  it('skips finalize when init() failed', () => {
    const order: string[] = [];

    const badAnalyzer: LintPass = {
      id: storeKey('bad-init'),
      description: 'Fails in init',
      init() {
        throw new Error('init failed');
      },
      finalize() {
        order.push('bad-finalize');
      },
    };

    const goodAnalyzer: LintPass = {
      id: storeKey('good'),
      description: 'Works fine',
      init() {},
      finalize() {
        order.push('good');
      },
    };

    const engine = new LintEngine({
      passes: [badAnalyzer, goodAnalyzer],
    });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    // bad-init should NOT have its finalize called; good should
    expect(order).toEqual(['good']);
  });

  it('detects 3-way cyclic finalizeAfter dependencies', () => {
    const keyA = storeKey<string>('cycle/a');
    const keyB = storeKey<string>('cycle/b');
    const keyC = storeKey<string>('cycle/c');

    const a: LintPass = {
      id: keyA,
      description: 'A',
      finalizeAfter: [keyC],
      init() {},
      finalize() {},
    };

    const b: LintPass = {
      id: keyB,
      description: 'B',
      finalizeAfter: [keyA],
      init() {},
      finalize() {},
    };

    const c: LintPass = {
      id: keyC,
      description: 'C',
      finalizeAfter: [keyB],
      init() {},
      finalize() {},
    };

    const engine = new LintEngine({ passes: [a, b, c] });
    expect(() => engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX)).toThrow(
      DependencyResolutionError
    );
  });

  it('is idempotent — running twice produces the same result', () => {
    const ast = parseDocument(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.nonexistent
`);

    const engine = createLintEngine();
    const first = engine.run(ast, testSchemaCtx).diagnostics;
    const second = engine.run(ast, testSchemaCtx).diagnostics;

    expect(first.length).toBe(second.length);
    expect(first.map(d => d.message)).toEqual(second.map(d => d.message));
  });
});

// ============================================================================
// PassStore tests
// ============================================================================

describe('PassStore', () => {
  it('stores and retrieves typed values', () => {
    const store = new PassStore();
    const key = storeKey<{ value: number }>('key');
    store.set(key, { value: 42 });
    expect(store.get(key)).toEqual({ value: 42 });
  });

  it('returns undefined for missing keys', () => {
    const store = new PassStore();
    const key = storeKey<string>('missing');
    expect(store.get(key)).toBeUndefined();
  });

  it('reports whether keys exist', () => {
    const store = new PassStore();
    const key = storeKey<string>('key');
    expect(store.has(key)).toBe(false);
    store.set(key, 'value');
    expect(store.has(key)).toBe(true);
  });

  it('throws on overwrite', () => {
    const store = new PassStore();
    const key = storeKey<string>('key');
    store.set(key, 'first');
    expect(() => store.set(key, 'second')).toThrow(/already set/);
  });

  it('update modifies an existing value', () => {
    const store = new PassStore();
    const key = storeKey<number[]>('nums');
    store.set(key, [1, 2]);
    store.update(key, arr => [...arr, 3]);
    expect(store.get(key)).toEqual([1, 2, 3]);
  });

  it('update throws for unset key', () => {
    const store = new PassStore();
    const key = storeKey<string>('missing');
    expect(() => store.update(key, v => v + '!')).toThrow(/not set/);
  });
});

// ============================================================================
// defineRule tests
// ============================================================================

describe('defineRule', () => {
  it('creates a pass with correct id, description, and requires', () => {
    const key = storeKey<string>('test-key');
    const rule = defineRule({
      id: 'test-rule',
      description: 'A test rule',
      deps: { data: key },
      run() {},
    });

    expect(rule.id).toBe('test-rule');
    expect(rule.description).toBe('A test rule');
    expect(rule.requires).toEqual(['test-key']);
  });

  it('resolves static deps from PassStore and passes them to run()', () => {
    const key = storeKey<{ value: number }>('test-data');
    const received: Array<{ value: number }> = [];

    const analyzer: LintPass = {
      id: key,
      description: 'Produces test data',
      init() {},
      finalize(store) {
        store.set(key, { value: 42 });
      },
    };

    const rule = defineRule({
      id: 'consumer',
      description: 'Consumes test data',
      deps: { data: key },
      run({ data }) {
        received.push(data);
      },
    });

    const engine = new LintEngine({ passes: [analyzer, rule] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(received).toEqual([{ value: 42 }]);
  });

  it('resolves multiple static deps', () => {
    const keyA = storeKey<string>('a-data');
    const keyB = storeKey<number>('b-data');

    const analyzerA: LintPass = {
      id: keyA,
      description: 'A',
      init() {},
      finalize(store) {
        store.set(keyA, 'hello');
      },
    };
    const analyzerB: LintPass = {
      id: keyB,
      description: 'B',
      init() {},
      finalize(store) {
        store.set(keyB, 99);
      },
    };

    let receivedA: string | undefined;
    let receivedB: number | undefined;

    const rule = defineRule({
      id: 'multi-dep',
      description: 'Uses two deps',
      deps: { alpha: keyA, beta: keyB },
      run({ alpha, beta }) {
        receivedA = alpha;
        receivedB = beta;
      },
    });

    const engine = new LintEngine({
      passes: [analyzerA, analyzerB, rule],
    });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(receivedA).toBe('hello');
    expect(receivedB).toBe(99);
  });

  it('works with empty deps', () => {
    let ran = false;
    const rule = defineRule({
      id: 'no-deps',
      description: 'No deps',
      deps: {},
      run() {
        ran = true;
      },
    });

    expect(rule.requires).toEqual([]);
    const engine = new LintEngine({ passes: [rule] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);
    expect(ran).toBe(true);
  });

  it('is skipped by engine when a dep is missing', () => {
    const missingKey = storeKey<string>('missing');
    let ran = false;

    const rule = defineRule({
      id: 'needs-missing',
      description: 'Needs missing',
      deps: { data: missingKey },
      run() {
        ran = true;
      },
    });

    const engine = new LintEngine({ passes: [rule] });
    const { diagnostics } = engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(ran).toBe(false);
    const skipped = diagnostics.filter(d => d.code === 'lint-pass-skipped');
    expect(skipped).toHaveLength(1);
  });

  it('each() iterates array and calls run() per item', () => {
    const itemsKey = storeKey<number[]>('items');
    const received: number[] = [];

    const analyzer: LintPass = {
      id: itemsKey,
      description: 'Produces items',
      init() {},
      finalize(store) {
        store.set(itemsKey, [10, 20, 30]);
      },
    };

    const rule = defineRule({
      id: 'per-item',
      description: 'Per item',
      deps: { item: each(itemsKey) },
      run({ item }) {
        received.push(item);
      },
    });

    const engine = new LintEngine({ passes: [analyzer, rule] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(received).toEqual([10, 20, 30]);
  });

  it('each() combined with static deps', () => {
    const itemsKey = storeKey<string[]>('items');
    const configKey = storeKey<{ prefix: string }>('config');
    const received: string[] = [];

    const itemsAnalyzer: LintPass = {
      id: itemsKey,
      description: 'Items',
      init() {},
      finalize(store) {
        store.set(itemsKey, ['a', 'b']);
      },
    };

    const configAnalyzer: LintPass = {
      id: configKey,
      description: 'Config',
      init() {},
      finalize(store) {
        store.set(configKey, { prefix: 'x-' });
      },
    };

    const rule = defineRule({
      id: 'mixed',
      description: 'Mixed deps',
      deps: { config: configKey, item: each(itemsKey) },
      run({ config, item }) {
        received.push(config.prefix + item);
      },
    });

    const engine = new LintEngine({
      passes: [itemsAnalyzer, configAnalyzer, rule],
    });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(received).toEqual(['x-a', 'x-b']);
  });

  it('each() with empty array calls run() zero times', () => {
    const itemsKey = storeKey<string[]>('items');
    let callCount = 0;

    const analyzer: LintPass = {
      id: itemsKey,
      description: 'Empty items',
      init() {},
      finalize(store) {
        store.set(itemsKey, []);
      },
    };

    const rule = defineRule({
      id: 'empty-each',
      description: 'Empty each',
      deps: { item: each(itemsKey) },
      run() {
        callCount++;
      },
    });

    const engine = new LintEngine({ passes: [analyzer, rule] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(callCount).toBe(0);
  });

  it('throws if more than one each() dep is declared', () => {
    const keyA = storeKey<string[]>('a');
    const keyB = storeKey<number[]>('b');

    expect(() =>
      defineRule({
        id: 'bad',
        description: 'Two each deps',
        deps: { a: each(keyA), b: each(keyB) },
        run() {},
      })
    ).toThrow(/only one each\(\) dep allowed/);
  });

  it('each() with selector transforms source before iteration', () => {
    interface NestedData {
      items: Map<string, number>;
    }
    const nestedKey = storeKey<NestedData>('nested');
    const received: Array<{ name: string; value: number }> = [];

    const analyzer: LintPass = {
      id: nestedKey,
      description: 'Produces nested data',
      init() {},
      finalize(store) {
        store.set(nestedKey, {
          items: new Map([
            ['a', 1],
            ['b', 2],
          ]),
        });
      },
    };

    const rule = defineRule({
      id: 'selector-test',
      description: 'Flattens with selector',
      deps: {
        entry: each(nestedKey, data => {
          const result: Array<{ name: string; value: number }> = [];
          for (const [name, value] of data.items) {
            result.push({ name, value });
          }
          return result;
        }),
      },
      run({ entry }) {
        received.push(entry);
      },
    });

    const engine = new LintEngine({ passes: [analyzer, rule] });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(received).toEqual([
      { name: 'a', value: 1 },
      { name: 'b', value: 2 },
    ]);
  });

  it('each() with selector combined with static deps', () => {
    interface NestedData {
      values: Map<string, number>;
    }
    const nestedKey = storeKey<NestedData>('nested');
    const configKey = storeKey<{ prefix: string }>('config');
    const received: string[] = [];

    const nestedAnalyzer: LintPass = {
      id: nestedKey,
      description: 'Nested',
      init() {},
      finalize(store) {
        store.set(nestedKey, {
          values: new Map([
            ['x', 10],
            ['y', 20],
          ]),
        });
      },
    };

    const configAnalyzer: LintPass = {
      id: configKey,
      description: 'Config',
      init() {},
      finalize(store) {
        store.set(configKey, { prefix: 'val-' });
      },
    };

    const rule = defineRule({
      id: 'selector-mixed',
      description: 'Selector + static',
      deps: {
        config: configKey,
        entry: each(nestedKey, data =>
          [...data.values.entries()].map(([name, val]) => ({ name, val }))
        ),
      },
      run({ config, entry }) {
        received.push(config.prefix + entry.name + ':' + entry.val);
      },
    });

    const engine = new LintEngine({
      passes: [nestedAnalyzer, configAnalyzer, rule],
    });
    engine.run(EMPTY_AST, EMPTY_SCHEMA_CTX);

    expect(received).toEqual(['val-x:10', 'val-y:20']);
  });

  it('requires array includes both static and each keys', () => {
    const staticKey = storeKey<string>('static');
    const iterKey = storeKey<number[]>('iter');

    const rule = defineRule({
      id: 'both',
      description: 'Both',
      deps: { s: staticKey, i: each(iterKey) },
      run() {},
    });

    expect(rule.requires).toContain('static');
    expect(rule.requires).toContain('iter');
    expect(rule.requires).toHaveLength(2);
  });
});

// ============================================================================
// collectDiagnostics tests
// ============================================================================

describe('collectDiagnostics', () => {
  it('collects diagnostics from AST nodes', () => {
    const diag: Diagnostic = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
      message: 'test',
      severity: DiagnosticSeverity.Error,
    };

    const ast = {
      __diagnostics: [diag],
      __kind: 'TestBlock',
      child: {
        __diagnostics: [] as Diagnostic[],
        __kind: 'ChildBlock',
      },
    };

    const result = collectDiagnostics(ast);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('test');
  });

  it('collects diagnostics from Map entries', () => {
    const diag: Diagnostic = {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 5 },
      },
      message: 'map entry error',
      severity: DiagnosticSeverity.Warning,
    };

    const map = new NamedMap<unknown>('Items', {
      entries: [
        [
          'entry',
          {
            __diagnostics: [diag],
            __kind: 'EntryBlock',
          },
        ],
      ],
    });

    const ast = {
      __diagnostics: [] as Diagnostic[],
      __kind: 'Root',
      items: map,
    };

    const result = collectDiagnostics(ast);
    expect(result).toHaveLength(1);
    expect(result[0].message).toBe('map entry error');
  });
});

// ============================================================================
// SymbolTable analyzer tests
// ============================================================================

describe('symbolTableAnalyzer', () => {
  it('has correct id', () => {
    expect(symbolTableAnalyzer().id).toBe('symbol-table');
  });

  it('stores DocumentSymbol[] in PassStore via engine', () => {
    const ast = parseDocument(`
system:
  instructions: "Hello"
subagent main:
  label: "Main topic"
`);

    const engine = new LintEngine({ passes: [symbolTableAnalyzer()] });
    const { store } = engine.run(ast, testSchemaCtx);

    const symbols = store.get(symbolTableKey);
    expect(symbols).toBeDefined();
    expect(Array.isArray(symbols)).toBe(true);
  });
});

// ============================================================================
// Reference validation rule tests
// ============================================================================

describe('undefinedReferenceRule', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  it('reports undefined @variables reference', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.nonexistent
`);

    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);
    expect(
      refErrors.some(d => d.message.includes("'nonexistent' is not defined"))
    ).toBe(true);
  });

  it('reports undefined @variables reference with suggestion in data', () => {
    const diagnostics = runLint(`
variables:
  customer_name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.custmer_name
`);

    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);

    const typoError = refErrors.find(d =>
      d.message.includes("'custmer_name' is not defined in variables")
    );
    expect(typoError).toBeDefined();
    expect(typoError!.data?.suggestion).toBe('customer_name');
  });

  it('suggests correct casing for case-mismatched references', () => {
    const diagnostics = runLint(`
variables:
  CustomerName: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.customername
`);

    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);

    const caseError = refErrors.find(d =>
      d.message.includes("'customername' is not defined in variables")
    );
    expect(caseError).toBeDefined();
    expect(caseError!.data?.suggestion).toBe('CustomerName');
  });

  it('passes valid @variables reference', () => {
    const diagnostics = runLint(`
variables:
  customer_name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.customer_name
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in variables')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('reports undefined @topic reference', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      go: @actions.go to @subagent.nonexistent_topic
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in subagent')
    );
    expect(refErrors.length).toBeGreaterThanOrEqual(1);
  });

  it('reports undefined @topic reference with suggestion in data', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      go: @actions.go to @subagent.mainn
subagent greeting:
  label: "Greeting"
  reasoning:
    instructions: ->
      |Say hello
`);

    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);

    const typoError = refErrors.find(d =>
      d.message.includes("'mainn' is not defined in subagent")
    );
    expect(typoError).toBeDefined();
    expect(typoError!.data?.suggestion).toBe('main');
  });

  it('passes valid @topic reference', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Go to greeting
    actions:
      go: @actions.go to @subagent.greeting
subagent greeting:
  label: "Greeting"
  reasoning:
    instructions: ->
      |Say hello
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in subagent')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('passes valid @topic reference to start_agent', () => {
    const diagnostics = runLint(`
start_agent selector:
  label: "Selector"
  reasoning:
    instructions: ->
      |Select a topic
    actions:
      go: @actions.go to @subagent.greeting
subagent greeting:
  label: "Greeting"
  reasoning:
    instructions: ->
      |Say hello
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in subagent')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('allows runtime scopes without error', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    fetch_data:
      description: "Fetch data"
      target: "externalService://api"
      inputs:
        query: string
      outputs:
        result: string
  reasoning:
    instructions: ->
      |Fetch data
    actions:
      fetch: @actions.fetch_data
        set @variables.result=@outputs.result
`);

    // @outputs is a runtime scope — should never produce a reference error
    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@outputs.result'
    );
    expect(outputsErrors).toHaveLength(0);
  });

  it('reports undefined @outputs member via colinear resolution', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    fetch_data:
      description: "Fetch data"
      target: "externalService://api"
      outputs:
        result: string
  reasoning:
    instructions: ->
      |Fetch data
    actions:
      fetch: @actions.fetch_data
        set @variables.x=@outputs.reslt
`);

    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@outputs.reslt'
    );
    expect(outputsErrors).toHaveLength(1);
    expect(outputsErrors[0].data?.suggestion).toBe('result');
    expect(outputsErrors[0].message).toContain("Did you mean 'result'?");
    expect(outputsErrors[0].data?.expected).toEqual(['result']);
  });

  it('resolves @outputs inside nested `run @actions.X` to the run target', () => {
    // Regression: inside a nested `run @actions.inner`, @outputs.* must
    // resolve against `inner`'s outputs, NOT the enclosing action binding
    // (`outer`). Before the fix, resolveColinearCandidates walked past the
    // RunStatement to the outer binding's colinear `.value` and checked
    // @outputs against outer's outputs — so `innerResult` was flagged.
    const diagnostics = runLint(`
variables:
  x: mutable string
subagent main:
  label: "Main"
  actions:
    outer:
      description: "Outer"
      target: "externalService://outer"
      outputs:
        outerResult: string
    inner:
      description: "Inner"
      target: "externalService://inner"
      outputs:
        innerResult: string
  reasoning:
    instructions: ->
      |Do work
    actions:
      outerBinding: @actions.outer
        run @actions.inner
          set @variables.x=@outputs.innerResult
`);

    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@outputs.innerResult'
    );
    expect(outputsErrors).toHaveLength(0);
  });

  it('reports @outputs inside nested run when member belongs to outer, not run target', () => {
    // Symmetric negative: `outerResult` exists on `outer` but not on `inner`.
    // Inside the nested `run @actions.inner`, @outputs must resolve against
    // `inner` — so `outerResult` should be reported as undefined.
    const diagnostics = runLint(`
variables:
  x: mutable string
subagent main:
  label: "Main"
  actions:
    outer:
      description: "Outer"
      target: "externalService://outer"
      outputs:
        outerResult: string
    inner:
      description: "Inner"
      target: "externalService://inner"
      outputs:
        innerResult: string
  reasoning:
    instructions: ->
      |Do work
    actions:
      outerBinding: @actions.outer
        run @actions.inner
          set @variables.x=@outputs.outerResult
`);

    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@outputs.outerResult'
    );
    expect(outputsErrors).toHaveLength(1);
    expect(outputsErrors[0].data?.expected).toEqual(['innerResult']);
  });

  it('resolves @outputs directly under outer binding (outside nested run)', () => {
    // Control: `set @outputs.outerResult` at the outer binding level (not
    // inside a `run`) must still resolve against `outer`'s outputs. This
    // guards against the nested-run fix regressing the plain colinear case.
    const diagnostics = runLint(`
variables:
  x: mutable string
subagent main:
  label: "Main"
  actions:
    outer:
      description: "Outer"
      target: "externalService://outer"
      outputs:
        outerResult: string
    inner:
      description: "Inner"
      target: "externalService://inner"
      outputs:
        innerResult: string
  reasoning:
    instructions: ->
      |Do work
    actions:
      outerBinding: @actions.outer
        set @variables.x=@outputs.outerResult
        run @actions.inner
          set @variables.x=@outputs.innerResult
`);

    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        typeof d.data?.referenceName === 'string' &&
        d.data.referenceName.startsWith('@outputs.')
    );
    expect(outputsErrors).toHaveLength(0);
  });

  it('reports unknown namespace as error', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@bogusNamespace.foo}
`);

    const nsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@bogusNamespace.foo'
    );
    expect(nsErrors).toHaveLength(1);
    expect(nsErrors[0].message).toContain('not a recognized namespace');
    expect(nsErrors[0].data?.expected).toBeDefined();
  });

  it('validates global scope members', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@utils.transiton}
`);

    const utilsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@utils.transiton'
    );
    expect(utilsErrors).toHaveLength(1);
    expect(utilsErrors[0].data?.suggestion).toBe('transition');
    expect(utilsErrors[0].message).toContain("Did you mean 'transition'?");
    expect(utilsErrors[0].data?.expected).toEqual(
      expect.arrayContaining(['transition', 'setVariables', 'escalate'])
    );
  });

  it('reports @inputs as not a valid reference', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    fetch_data:
      description: "Fetch data"
      target: "externalService://api"
      inputs:
        query: string
      outputs:
        result: string
  reasoning:
    instructions: ->
      |Fetch data
    actions:
      fetch: @actions.fetch_data
        set @variables.x=@inputs.query
`);

    const inputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@inputs.query'
    );
    expect(inputsErrors).toHaveLength(1);
    expect(inputsErrors[0].message).toContain('cannot be used as a reference');
  });

  it('passes valid global scope references', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@utils.transition}
`);

    const utilsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@utils.transition'
    );
    expect(utilsErrors).toHaveLength(0);
  });

  it('passes valid @actions reference in reasoning', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    fetch_data:
      description: "Fetch data"
      target: "externalService://api"
  reasoning:
    instructions: ->
      |Fetch data
    actions:
      fetch: @actions.fetch_data
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('resolves @actions in reasoning instructions to reasoning.actions', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    rate_conversation:
      description: "Rate the conversation"
      target: "flow://rate_conversation"
      inputs:
        rating: number
      outputs:
        success: boolean
  reasoning:
    instructions: ->
      | Use {!@actions.store_rating} and {!@actions.validate_rating}
    actions:
      validate_rating: @actions.rate_conversation
        with rating=@variables.conversation_rating
      store_rating: @actions.rate_conversation
        with rating=@variables.conversation_rating
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in actions')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('returns empty diagnostics for valid document', () => {
    const diagnostics = runLint(`
system:
  instructions: "Hello world"
config:
  description: "test"
`);

    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors).toHaveLength(0);
  });

  it('reports undefined reference inside template interpolation {!expr}', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
        |Hello {!@variables.nonexistent} world
    actions:
      check: @actions.check
`);

    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);
    expect(
      refErrors.some(d => d.message.includes("'nonexistent' is not defined"))
    ).toBe(true);
  });

  it('passes valid reference inside template interpolation {!expr}', () => {
    const diagnostics = runLint(`
variables:
  customer_name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
        |Hello {!@variables.customer_name}!
    actions:
      check: @actions.check
`);

    const refErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('not defined in variables')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('global scope name does not shadow document-defined block (namespace collision)', () => {
    // "utils" is a global scope. If a document also defines something named "utils"
    // (which isn't possible via schema — utils is not a schema key), a global scope
    // reference like @utils.transition should still validate against the global scope.
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@utils.transition} and {!@utils.setVariables}
`);

    const utilsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        typeof d.data?.referenceName === 'string' &&
        (d.data.referenceName as string).startsWith('@utils.')
    );
    expect(utilsErrors).toHaveLength(0);
  });

  it('global scope takes priority for non-schema namespaces', () => {
    // @utils is not a schema namespace, so it's resolved entirely via globalScopes.
    // Referencing a valid member should pass; an invalid one should error.
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@utils.transition} and {!@utils.bogus_member}
`);

    const validErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@utils.transition'
    );
    expect(validErrors).toHaveLength(0);

    const invalidErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@utils.bogus_member'
    );
    expect(invalidErrors).toHaveLength(1);
    expect(invalidErrors[0].message).toContain(
      "'bogus_member' is not defined in utils"
    );
  });

  it('nested colinear resolution: only innermost colinear block wins', () => {
    // If a reasoning action references @actions.outer, and outer itself has outputs,
    // @outputs.x should resolve against outer's outputs, not any parent.
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  actions:
    outer:
      description: "Outer action"
      target: "ext://api"
      outputs:
        outer_result: string
  reasoning:
    instructions: ->
      |Do it
    actions:
      call_outer: @actions.outer
        set @variables.x=@outputs.outer_result
`);

    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@outputs.outer_result'
    );
    expect(outputsErrors).toHaveLength(0);
  });

  it('colinear resolution fails gracefully for nonexistent action target', () => {
    // @actions.nonexistent doesn't exist, so @outputs.x can't be resolved.
    // The system should NOT produce an undefined-reference error for @outputs.x
    // because the colinear target itself is already broken — it should skip
    // validation of outputs rather than double-reporting.
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do it
    actions:
      call: @actions.nonexistent
        set @variables.x=@outputs.some_field
`);

    // @actions.nonexistent should be flagged
    const actionErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@actions.nonexistent'
    );
    expect(actionErrors.length).toBeGreaterThanOrEqual(1);

    // @outputs.some_field should NOT be flagged since the colinear target is unresolvable
    const outputsErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@outputs.some_field'
    );
    expect(outputsErrors).toHaveLength(0);
  });

  it('validates system_variables global scope members', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@system_variables.user_input}
`);

    const errors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@system_variables.user_input'
    );
    expect(errors).toHaveLength(0);
  });

  it('reports undefined system_variables member', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Use {!@system_variables.nonexistent}
`);

    const errors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.data?.referenceName === '@system_variables.nonexistent'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain(
      "'nonexistent' is not defined in system_variables"
    );
  });
});

// ============================================================================
// createSchemaContext: global scope namespace collision guard
// ============================================================================

describe('createSchemaContext global scope collision', () => {
  it('throws when a global scope namespace collides with a schema namespace', () => {
    expect(() =>
      createSchemaContext({
        schema: { actions: CollectionBlock(NamedBlock('Action')) } as Record<
          string,
          FieldType
        >,
        aliases: {},
        globalScopes: {
          actions: new Set(['foo']),
        },
      })
    ).toThrow(
      /Global scope namespace 'actions' collides with an existing namespace/
    );
  });

  it('throws when a global scope namespace collides with an alias key', () => {
    expect(() =>
      createSchemaContext({
        schema: { topic: CollectionBlock(NamedBlock('Topic')) } as Record<
          string,
          FieldType
        >,
        aliases: { start_agent: 'subagent' },
        globalScopes: {
          start_agent: new Set(['foo']),
        },
      })
    ).toThrow(
      /Global scope namespace 'start_agent' collides with an existing namespace/
    );
  });

  it('throws when a global scope namespace collides with an alias value', () => {
    expect(() =>
      createSchemaContext({
        schema: {} as Record<string, FieldType>,
        aliases: { alt: 'canonical' },
        globalScopes: {
          canonical: new Set(['foo']),
        },
      })
    ).toThrow(
      /Global scope namespace 'canonical' collides with an existing namespace/
    );
  });
});

// ============================================================================
// createSchemaContext: capability namespace sets
// ============================================================================

describe('createSchemaContext capability namespaces', () => {
  it('collects invocationTarget block into invocationTargetNamespaces', () => {
    const InvokableBlock = NamedBlock(
      'Invokable',
      { label: StringValue },
      { capabilities: ['invocationTarget'] }
    );
    const ctx = createSchemaContext({
      schema: { tools: CollectionBlock(InvokableBlock) } as Record<
        string,
        FieldType
      >,
      aliases: {},
    });
    expect(ctx.invocationTargetNamespaces.has('tools')).toBe(true);
    expect(ctx.transitionTargetNamespaces.has('tools')).toBe(false);
  });

  it('collects invocationTarget+transitionTarget block into both sets', () => {
    const DualBlock = NamedBlock(
      'Dual',
      { label: StringValue },
      { capabilities: ['invocationTarget', 'transitionTarget'] }
    );
    const ctx = createSchemaContext({
      schema: { agents: CollectionBlock(DualBlock) } as Record<
        string,
        FieldType
      >,
      aliases: {},
    });
    expect(ctx.invocationTargetNamespaces.has('agents')).toBe(true);
    expect(ctx.transitionTargetNamespaces.has('agents')).toBe(true);
  });

  it('returns empty sets when no blocks have capabilities', () => {
    const PlainBlock = Block('Plain', { name: StringValue });
    const ctx = createSchemaContext({
      schema: { config: PlainBlock } as Record<string, FieldType>,
      aliases: {},
    });
    expect(ctx.invocationTargetNamespaces.size).toBe(0);
    expect(ctx.transitionTargetNamespaces.size).toBe(0);
  });

  it('collects capabilities from nested scoped blocks by field name', () => {
    const ActionBlock = NamedBlock(
      'Action',
      { target: StringValue },
      { scopeAlias: 'action', capabilities: ['invocationTarget'] }
    );
    const SubagentBlock = NamedBlock(
      'Topic',
      { actions: CollectionBlock(ActionBlock) },
      {
        scopeAlias: 'subagent',
        capabilities: ['invocationTarget', 'transitionTarget'],
      }
    );
    const ctx = createSchemaContext({
      schema: { topic: CollectionBlock(SubagentBlock) } as Record<
        string,
        FieldType
      >,
      aliases: {},
    });
    expect(ctx.invocationTargetNamespaces.has('topic')).toBe(true);
    expect(ctx.transitionTargetNamespaces.has('topic')).toBe(true);
    expect(ctx.invocationTargetNamespaces.has('actions')).toBe(true);
    expect(ctx.transitionTargetNamespaces.has('actions')).toBe(false);
  });

  it('AgentScript schema has expected capability namespaces', () => {
    expect(testSchemaCtx.invocationTargetNamespaces.has('subagent')).toBe(true);
    expect(testSchemaCtx.transitionTargetNamespaces.has('subagent')).toBe(true);
    expect(testSchemaCtx.invocationTargetNamespaces.has('actions')).toBe(true);
    expect(testSchemaCtx.invocationTargetNamespaces.has('config')).toBe(false);
    expect(testSchemaCtx.invocationTargetNamespaces.has('variables')).toBe(
      false
    );
    expect(testSchemaCtx.transitionTargetNamespaces.has('config')).toBe(false);
  });
});

// ============================================================================
// resolvedType constraint on colinear values
// ============================================================================

describe('resolvedType constraint', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  it('accepts @actions reference as valid invocation target', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "test"
  actions:
    Fetch:
      description: "fetch"
      target: "flow://Fetch"
  reasoning:
    instructions: ->
      |do it
    actions:
      fetch: @actions.Fetch
`);
    const errors = diagnostics.filter(
      d => d.code === 'constraint-resolved-type'
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects @config reference as invalid invocation target', () => {
    const diagnostics = runLint(`
config:
  description: "test agent"
start_agent main:
  description: "test"
  reasoning:
    instructions: ->
      |do it
    actions:
      bad: @config.description
`);
    const errors = diagnostics.filter(
      d => d.code === 'constraint-resolved-type'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('config');
    expect(errors[0].message).toContain('not a valid invocation target');
  });

  it('accepts @topic reference as valid invocation target', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "test"
  reasoning:
    instructions: ->
      |do it
    actions:
      go: @subagent.other
subagent other:
  description: "other topic"
  reasoning:
    instructions: ->
      |do other stuff
`);
    const errors = diagnostics.filter(
      d => d.code === 'constraint-resolved-type'
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects @variables reference as invalid invocation target', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
start_agent main:
  description: "test"
  reasoning:
    instructions: ->
      |do it
    actions:
      bad: @variables.name
`);
    const errors = diagnostics.filter(
      d => d.code === 'constraint-resolved-type'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('variables');
    expect(errors[0].message).toContain('not a valid invocation target');
  });

  it('accepts @connected_subagent.X as valid invocation target', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "test"
  reasoning:
    instructions: ->
      |do it
    actions:
      call_support: @connected_subagent.Support_Agent
connected_subagent Support_Agent:
  target: "agentforce://Support_Agent"
  label: "Support"
  description: "Support agent"
`);
    const errors = diagnostics.filter(
      d => d.code === 'constraint-resolved-type'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts @utils.transition (global scope) without false positive', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "test"
  reasoning:
    instructions: ->
      |do it
    actions:
      go: @utils.transition to @subagent.main
        description: "go there"
`);
    const errors = diagnostics.filter(
      d => d.code === 'constraint-resolved-type'
    );
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Unused variable rule tests
// ============================================================================

describe('unusedVariableRule', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  it('reports unused variables', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
  age: mutable number
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(2);
    expect(unused.some(d => d.message.includes("'name'"))).toBe(true);
    expect(unused.some(d => d.message.includes("'age'"))).toBe(true);
  });

  it('does not report variables that are referenced', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.name
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(0);
  });

  it('reports only unused variables when some are referenced', () => {
    const diagnostics = runLint(`
variables:
  name: mutable string
  age: mutable number
  city: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.name
      update: @actions.update
        set @variables.city=@outputs.result
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(1);
    expect(unused[0].message).toContain("'age'");
  });

  it('marks unused variable diagnostics with Unnecessary tag', () => {
    const diagnostics = runLint(`
variables:
  unused_var: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(1);
    expect(unused[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(unused[0].tags).toContain(DiagnosticTag.Unnecessary);
  });

  it('diagnostic range covers the full variable declaration', () => {
    const diagnostics = runLint(`
variables:
  unused_var: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(1);
    const range = unused[0].range;
    // Range should cover the full declaration "unused_var: mutable string"
    expect(range.start.line).toBe(range.end.line);
    expect(range.end.character - range.start.character).toBe(
      'unused_var: mutable string'.length
    );
  });

  it('includes removalRange in diagnostic data for code actions', () => {
    const diagnostics = runLint(`
variables:
  unused_var: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(1);
    expect(unused[0].data).toBeDefined();
    expect(unused[0].data!.removalRange).toBeDefined();

    const removalRange = unused[0].data!.removalRange as {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    // removalRange matches the diagnostic range (both are the full declaration)
    expect(removalRange).toEqual(unused[0].range);
  });

  it('does not report when there are no variables', () => {
    const diagnostics = runLint(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
`);

    const unused = diagnostics.filter(d => d.code === 'unused-variable');
    expect(unused).toHaveLength(0);
  });
});

// ============================================================================
// Integration: createLintEngine
// ============================================================================

describe('createLintEngine', () => {
  it('creates a working engine with defaults', () => {
    const engine = createLintEngine();

    const ast = parseDocument(`
system:
  instructions: "Hello"
`);
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    expect(Array.isArray(diagnostics)).toBe(true);
  });
});

// ============================================================================
// TypeMap analyzer tests
// ============================================================================

describe('typeMapAnalyzer', () => {
  it('has correct id', () => {
    expect(typeMapAnalyzer().id).toBe('type-map');
  });

  it('extracts variable types', () => {
    const ast = parseDocument(`
variables:
  name: mutable string
  age: mutable number
  verified: mutable boolean
`);

    const engine = new LintEngine({ passes: [typeMapAnalyzer()] });
    const { store } = engine.run(ast, testSchemaCtx);

    const typeMap = store.get(typeMapKey);
    expect(typeMap).toBeDefined();
    expect(typeMap!.variables.get('name')).toEqual({
      type: 'string',
      modifier: 'mutable',
    });
    expect(typeMap!.variables.get('age')).toEqual({
      type: 'number',
      modifier: 'mutable',
    });
    expect(typeMap!.variables.get('verified')).toEqual({
      type: 'boolean',
      modifier: 'mutable',
    });
  });

  it('extracts action input/output types', () => {
    const ast = parseDocument(`
subagent main:
  label: "Main"
  actions:
    fetch:
      description: "Fetch"
      inputs:
        query: string
        limit: number
      outputs:
        result: string
        count: number
      target: "flow://fetch"
  reasoning:
    instructions: ->
      |Do it
`);

    const engine = new LintEngine({ passes: [typeMapAnalyzer()] });
    const { store } = engine.run(ast, testSchemaCtx);

    const typeMap = store.get(typeMapKey);
    expect(typeMap).toBeDefined();

    const sig = typeMap!.actions.get('main')?.get('fetch');
    expect(sig).toBeDefined();
    expect(sig!.inputs.get('query')?.type).toBe('string');
    expect(sig!.inputs.get('limit')?.type).toBe('number');
    expect(sig!.outputs.get('result')?.type).toBe('string');
    expect(sig!.outputs.get('count')?.type).toBe('number');
  });

  it('detects default values on inputs', () => {
    const ast = parseDocument(`
subagent main:
  label: "Main"
  actions:
    fetch:
      description: "Fetch"
      inputs:
        query: string
        limit: number = 10
      outputs:
        result: string
      target: "flow://fetch"
  reasoning:
    instructions: ->
      |Do it
`);

    const engine = new LintEngine({ passes: [typeMapAnalyzer()] });
    const { store } = engine.run(ast, testSchemaCtx);

    const typeMap = store.get(typeMapKey);
    const sig = typeMap!.actions.get('main')?.get('fetch');
    expect(sig!.inputs.get('query')?.hasDefault).toBe(false);
    expect(sig!.inputs.get('limit')?.hasDefault).toBe(true);
  });
});

// ============================================================================
// Reasoning actions analyzer tests
// ============================================================================

describe('reasoningActionsAnalyzer', () => {
  it('has correct id', () => {
    expect(reasoningActionsAnalyzer().id).toBe('reasoning-actions');
  });

  it('stores resolved reasoning action entries', () => {
    const ast = parseDocument(`
subagent main:
  label: "Main"
  actions:
    send_code:
      description: "Send code"
      inputs:
        email: string
      outputs:
        verification_code: string
      target: "flow://send"
  reasoning:
    instructions: ->
      |Do it
    actions:
      check: @actions.send_code
        with email="test@test.com"
`);

    // reasoningActionsAnalyzer depends on typeMap, so include both
    const engine = new LintEngine({
      passes: [typeMapAnalyzer(), reasoningActionsAnalyzer()],
    });
    const { store } = engine.run(ast, testSchemaCtx);

    const entries = store.get(reasoningActionsKey);
    expect(entries).toBeDefined();
    expect(entries!.length).toBe(1);
    expect(entries![0].topicName).toBe('main');
    expect(entries![0].refActionName).toBe('send_code');
    expect(entries![0].sig.inputs.has('email')).toBe(true);
    expect(entries![0].sig.outputs.has('verification_code')).toBe(true);
  });

  it('reports error for reasoning action with no target reference', () => {
    const ast = parseDocument(`
subagent main:
  label: "Main"
  actions:
    send_code:
      description: "Send code"
      inputs:
        email: string
      outputs:
        verification_code: string
      target: "flow://send"
  reasoning:
    instructions: ->
      |Do it
    actions:
      Find_Products:
`);

    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);

    const errors = diagnostics.filter(
      d => d.code === 'missing-action-reference'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('missing a target reference');
  });

  it('does not report missing-action-reference for @utils.transition', () => {
    const ast = parseDocument(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do it
    actions:
      go: @utils.transition to @subagent.main
        description: "Go to main"
`);

    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);

    const errors = diagnostics.filter(
      d => d.code === 'missing-action-reference'
    );
    expect(errors).toHaveLength(0);
  });

  it('does not report missing-action-reference for @utils.setVariables', () => {
    const ast = parseDocument(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do it
    actions:
      update: @utils.setVariables
        description: "Update name"
        with name="test"
`);

    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);

    const errors = diagnostics.filter(
      d => d.code === 'missing-action-reference'
    );
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// action-io rule tests
// ============================================================================

describe('actionIoRule', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  const BASE = `
variables:
  member_email: mutable string
  member_number: mutable string
  verification_code: mutable string
  is_valid: mutable boolean
subagent main:
  label: "Main"
  actions:
    send_code:
      description: "Send code"
      inputs:
        email: string
        member_number: string
      outputs:
        verification_code: string
      target: "flow://send"
  reasoning:
    instructions: ->
      |Do it
    actions:
`;

  it('reports unknown input with suggestion', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with emial=@variables.member_email
        with member_number=@variables.member_number
`
    );

    const errors = diagnostics.filter(d => d.code === 'action-unknown-input');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'emial'");
    expect(errors[0].message).toContain('send_code');
    expect(errors[0].data?.suggestion).toBe('email');
  });

  it('reports unknown output with suggestion', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@variables.member_email
        with member_number=@variables.member_number
        set @variables.verification_code=@outputs.verifiction_code
`
    );

    const errors = diagnostics.filter(d => d.code === 'action-unknown-output');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'verifiction_code'");
    expect(errors[0].data?.suggestion).toBe('verification_code');
  });

  it('reports missing required input', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@variables.member_email
`
    );

    const errors = diagnostics.filter(d => d.code === 'action-missing-input');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'member_number'");
    expect(errors[0].message).toContain('send_code');
  });

  it('does not report missing input when it has a default value', () => {
    const source = `
variables:
  query: mutable string
subagent main:
  label: "Main"
  actions:
    search:
      description: "Search"
      inputs:
        query: string
        limit: number = 10
      outputs:
        results: string
      target: "flow://search"
  reasoning:
    instructions: ->
      |Search
    actions:
      do_search: @actions.search
        with query=@variables.query
`;

    const diagnostics = runLint(source);
    const missing = diagnostics.filter(d => d.code === 'action-missing-input');
    expect(missing).toHaveLength(0);
  });

  it('does not report missing input when is_required is False', () => {
    const source = `
variables:
  city: mutable string
subagent main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup weather"
      inputs:
        city: string
          description: "City name"
          is_required: True
        coordinates: object
          description: "Optional coordinates"
          is_required: False
      outputs:
        temp: number
      target: "flow://lookup"
  reasoning:
    instructions: ->
      |Look up weather
    actions:
      do_lookup: @actions.lookup
        with city=@variables.city
        set @variables.temp = @outputs.temp
`;

    const diagnostics = runLint(source);
    const missing = diagnostics.filter(d => d.code === 'action-missing-input');
    expect(missing).toHaveLength(0);
  });

  it('treats inputs without is_required as required by default', () => {
    // Mix of three inputs: explicit is_required: True, explicit is_required:
    // False, and no is_required property at all. Omitting the explicit-True
    // one and the unspecified one should both produce diagnostics; omitting
    // the explicit-False one should not.
    const source = `
variables:
  city: mutable string
subagent main:
  label: "Main"
  actions:
    lookup:
      description: "Lookup weather"
      inputs:
        city: string
          is_required: True
        country: string
        coordinates: object
          is_required: False
      outputs:
        temp: number
      target: "flow://lookup"
  reasoning:
    instructions: ->
      |Look up weather
    actions:
      do_lookup: @actions.lookup
        set @variables.temp = @outputs.temp
`;

    const diagnostics = runLint(source);
    const missing = diagnostics.filter(d => d.code === 'action-missing-input');
    const names = missing.map(d => d.message).sort();
    expect(names).toHaveLength(2);
    expect(names[0]).toContain("'city'");
    expect(names[1]).toContain("'country'");
  });

  it('passes valid inputs and outputs', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@variables.member_email
        with member_number=@variables.member_number
        set @variables.verification_code=@outputs.verification_code
`
    );

    const ioErrors = diagnostics.filter(
      d =>
        d.code === 'action-unknown-input' ||
        d.code === 'action-unknown-output' ||
        d.code === 'action-missing-input'
    );
    expect(ioErrors).toHaveLength(0);
  });

  it('skips non-@actions references', () => {
    const diagnostics = runLint(
      BASE +
        `      go: @utils.transition to @subagent.main
`
    );

    const ioErrors = diagnostics.filter(
      d =>
        d.code === 'action-unknown-input' ||
        d.code === 'action-unknown-output' ||
        d.code === 'action-missing-input'
    );
    expect(ioErrors).toHaveLength(0);
  });
});

// ============================================================================
// connected agent invocation IO validation
// ============================================================================

describe('connected agent invocation IO', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  it('reports unknown input on @connected_subagent.X with clause for connected subagent', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Order_Agent
        with nonexistent_param=@variables.val

connected_subagent Order_Agent:
  target: "agentforce://Order_Agent"
  label: "Order Agent"
  description: "Handles orders"
  inputs:
    order_id: string
`);

    const errors = diagnostics.filter(d => d.code === 'action-unknown-input');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'nonexistent_param'");
    expect(errors[0].message).toContain('Order_Agent');
  });

  it('reports missing required input on @actions.X for connected_subagent.X', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Order_Agent
        description: "Call the agent"

connected_subagent Order_Agent:
  target: "agentforce://Order_Agent"
  label: "Order Agent"
  description: "Handles orders"
  inputs:
    order_id: string
`);

    const errors = diagnostics.filter(d => d.code === 'action-missing-input');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("'order_id'");
    expect(errors[0].message).toContain('Order_Agent');
  });

  it('does not report missing input when definition has default', () => {
    const diagnostics = runLint(`
variables:
  session_id: linked string

start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Order_Agent
        description: "Call the agent"

connected_subagent Order_Agent:
  target: "agentforce://Order_Agent"
  label: "Order Agent"
  description: "Handles orders"
  inputs:
    session_id: string = @variables.session_id
`);

    const errors = diagnostics.filter(d => d.code === 'action-missing-input');
    expect(errors).toHaveLength(0);
  });

  it('allows valid with clause matching connected agent inputs', () => {
    const diagnostics = runLint(`
variables:
  order_id: mutable string

start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Order_Agent
        with order_id=@variables.order_id

connected_subagent Order_Agent:
  target: "agentforce://Order_Agent"
  label: "Order Agent"
  description: "Handles orders"
  inputs:
    order_id: string
`);

    const ioErrors = diagnostics.filter(
      d =>
        d.code === 'action-unknown-input' || d.code === 'action-missing-input'
    );
    expect(ioErrors).toHaveLength(0);
  });

  it('allows LLM-filled inputs with ellipsis', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Order_Agent
        with order_id=...

connected_subagent Order_Agent:
  target: "agentforce://Order_Agent"
  label: "Order Agent"
  description: "Handles orders"
  inputs:
    order_id: string
`);

    const ioErrors = diagnostics.filter(
      d =>
        d.code === 'action-unknown-input' || d.code === 'action-missing-input'
    );
    expect(ioErrors).toHaveLength(0);
  });

  it('connected agent with no inputs passes validation', () => {
    const diagnostics = runLint(`
start_agent main:
  description: "Main"
  reasoning:
    instructions: ->
      |Route
    actions:
      call_agent: @connected_subagent.Simple_Agent
        description: "Call simple agent"

connected_subagent Simple_Agent:
  target: "agentforce://Simple_Agent"
  label: "Simple"
  description: "No inputs"
`);

    const ioErrors = diagnostics.filter(
      d =>
        d.code === 'action-unknown-input' || d.code === 'action-missing-input'
    );
    expect(ioErrors).toHaveLength(0);
  });
});

// ============================================================================
// connected-agent-target pass tests
// ============================================================================

// ============================================================================
// action-type-check rule tests
// ============================================================================

describe('actionTypeCheckRule', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  const BASE = `
variables:
  member_email: mutable string
  member_number: mutable string
  verification_code: mutable string
  is_valid: mutable boolean
subagent main:
  label: "Main"
  actions:
    send_code:
      description: "Send code"
      inputs:
        email: string
        member_number: string
      outputs:
        verification_code: string
        is_verified: boolean
      target: "flow://send"
  reasoning:
    instructions: ->
      |Do it
    actions:
`;

  it('reports type mismatch warning on with clause', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@variables.is_valid
        with member_number=@variables.member_number
`
    );

    const warnings = diagnostics.filter(d => d.code === 'type-mismatch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe(2); // Warning
    expect(warnings[0].message).toContain("input 'email'");
    expect(warnings[0].message).toContain("'string'");
    expect(warnings[0].message).toContain("'boolean'");
  });

  it('reports type mismatch warning on set clause', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@variables.member_email
        with member_number=@variables.member_number
        set @variables.is_valid=@outputs.verification_code
`
    );

    const warnings = diagnostics.filter(d => d.code === 'type-mismatch');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe(2); // Warning
    expect(warnings[0].message).toContain("output 'verification_code'");
    expect(warnings[0].message).toContain("'string'");
    expect(warnings[0].message).toContain("'boolean'");
  });

  it('passes compatible types', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@variables.member_email
        with member_number=@variables.member_number
        set @variables.verification_code=@outputs.verification_code
`
    );

    const errors = diagnostics.filter(d => d.code === 'type-mismatch');
    expect(errors).toHaveLength(0);
  });

  it('passes string literal for string input', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email="test@test.com"
        with member_number="12345"
`
    );

    const errors = diagnostics.filter(d => d.code === 'type-mismatch');
    expect(errors).toHaveLength(0);
  });

  it('skips type check for unresolvable expressions', () => {
    const diagnostics = runLint(
      BASE +
        `      check: @actions.send_code
        with email=@outputs.something
        with member_number=@variables.member_number
`
    );

    // @outputs.something is not resolvable to a type → skip, no type-mismatch
    const errors = diagnostics.filter(d => d.code === 'type-mismatch');
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Diagnostic attachment to AST nodes
// ============================================================================

describe('lint diagnostics on AST nodes', () => {
  it('attaches undefined-reference diagnostics to AST nodes', () => {
    const ast = parseDocument(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.nonexistent
`);

    const engine = createLintEngine();
    engine.run(ast, testSchemaCtx);

    // collectDiagnostics walks __diagnostics on all nodes
    const collected = collectDiagnostics(ast);
    const refErrors = collected.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);
    expect(
      refErrors.some(d => d.message.includes("'nonexistent' is not defined"))
    ).toBe(true);
  });

  it('run() returns both parser and lint diagnostics from AST', () => {
    const ast = parseDocument(`
variables:
  name: mutable string
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      |Do something
    actions:
      check: @actions.check
        with value=@variables.nonexistent
`);

    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);

    // Should include lint diagnostics collected from AST nodes
    const refErrors = diagnostics.filter(d => d.code === 'undefined-reference');
    expect(refErrors.length).toBeGreaterThanOrEqual(1);
  });

  it('attaches action-io diagnostics to AST nodes', () => {
    const ast = parseDocument(`
variables:
  email: mutable string
subagent main:
  label: "Main"
  actions:
    send_code:
      description: "Send code"
      inputs:
        email: string
      outputs:
        code: string
      target: "flow://send"
  reasoning:
    instructions: ->
      |Do it
    actions:
      check: @actions.send_code
        with emial=@variables.email
`);

    const engine = createLintEngine();
    engine.run(ast, testSchemaCtx);

    const collected = collectDiagnostics(ast);
    const ioErrors = collected.filter(d => d.code === 'action-unknown-input');
    expect(ioErrors).toHaveLength(1);
    expect(ioErrors[0].message).toContain("'emial'");
  });
});

// ============================================================================
// Composite key validation (CollectionBlock entries)
// ============================================================================

describe('composite key validation', () => {
  it('reports error for composite key in actions', () => {
    const ast = parseDocument(`
subagent main:
  description: "Main"
  actions:
    Get_Order extra_id:
      description: "Retrieve order details"
      inputs:
        order_id: string
      outputs:
        result: string
`);
    const collected = collectDiagnostics(ast);
    const errors = collected.filter(d => d.code === 'composite-key');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Get_Order extra_id');
  });

  it('reports error for composite key in inputs', () => {
    const ast = parseDocument(`
subagent main:
  description: "Main"
  actions:
    Get_Order:
      description: "Retrieve order details"
      inputs:
        order_data asdf: string
      outputs:
        result: string
`);
    const collected = collectDiagnostics(ast);
    const errors = collected.filter(d => d.code === 'composite-key');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('order_data asdf');
  });

  it('reports error for composite key in outputs', () => {
    const ast = parseDocument(`
subagent main:
  description: "Main"
  actions:
    Get_Order:
      description: "Retrieve order details"
      inputs:
        order_id: string
      outputs:
        result asdf: string
`);
    const collected = collectDiagnostics(ast);
    const errors = collected.filter(d => d.code === 'composite-key');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('result asdf');
  });

  it('does not report error for single-id keys', () => {
    const ast = parseDocument(`
subagent main:
  description: "Main"
  actions:
    Get_Order:
      description: "Retrieve order details"
      inputs:
        order_id: string
      outputs:
        result: string
`);
    const collected = collectDiagnostics(ast);
    const errors = collected.filter(d => d.code === 'composite-key');
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// Required field pass
// ============================================================================

describe('requiredFieldPass', () => {
  it('emits diagnostic for missing required field in a Block', () => {
    const TestBlock = Block('TestBlock', {
      name: StringValue.describe('The name').required(),
      label: StringValue.describe('Optional label'),
    });
    const schema = { test: TestBlock };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Parse a document with only label (no name)
    const ast = parseWithSchema('test:\n  label: "hello"', schema);

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(1);
    expect(reqErrors[0].message).toBe("Missing required field 'name'");
    expect(reqErrors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('does not emit diagnostic when required field is present', () => {
    const TestBlock = Block('TestBlock', {
      name: StringValue.describe('The name').required(),
      label: StringValue.describe('Optional label'),
    });
    const schema = { test: TestBlock };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    const ast = parseWithSchema(
      'test:\n  name: "hello"\n  label: "world"',
      schema
    );

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(0);
  });

  it('does not emit diagnostic for optional (non-required) missing fields', () => {
    const TestBlock = Block('TestBlock', {
      name: StringValue.describe('Optional name'),
      label: StringValue.describe('Optional label'),
    });
    const schema = { test: TestBlock };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Empty block — neither field present, but neither is required
    const ast = parseWithSchema('test:\n  name: "x"', schema);

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(0);
  });

  it('checks required fields inside NamedBlock entries', () => {
    const TestNamed = NamedBlock('TestNamed', {
      target: StringValue.describe('Required target').required(),
      label: StringValue.describe('Optional label'),
    });
    const schema = { items: NamedCollectionBlock(TestNamed) };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Two entries: one with target, one without
    const ast = parseWithSchema(
      `items good_item:\n  target: "flow://x"\nitems bad_item:\n  label: "missing target"`,
      schema
    );

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(1);
    expect(reqErrors[0].message).toBe("Missing required field 'target'");
  });

  it('checks required fields in nested blocks', () => {
    const InnerBlock = Block('InnerBlock', {
      value: StringValue.describe('Required value').required(),
    });
    const OuterBlock = Block('OuterBlock', {
      inner: InnerBlock,
      name: StringValue,
    });
    const schema = { outer: OuterBlock };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Inner block present but missing 'value'
    const ast = parseWithSchema(
      'outer:\n  name: "test"\n  inner:\n    name: "wrong"',
      schema
    );

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(1);
    expect(reqErrors[0].message).toBe("Missing required field 'value'");
  });

  it('reports missing required root-level field', () => {
    const schema = {
      name: StringValue.describe('Required root name').required(),
      label: StringValue.describe('Optional label'),
    };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Only 'label' present, 'name' is missing at root level
    const ast = parseWithSchema('label: "hello"', schema);

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(1);
    expect(reqErrors[0].message).toBe("Missing required field 'name'");
  });

  it('checks required fields inside sequence items', () => {
    const StepBlock = Block('Step', {
      label: StringValue.describe('Required label').required(),
      description: StringValue.describe('Optional description'),
    });
    const schema = {
      test: Block('T', {
        steps: Sequence(StepBlock),
      }),
    };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Second step has no label — should be reported
    const ast = parseWithSchema(
      'test:\n  steps:\n    - label: "one"\n    - description: "missing label"',
      schema
    );

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(1);
    expect(reqErrors[0].message).toBe("Missing required field 'label'");
  });

  it('required metadata survives .extend()', () => {
    const BaseBlock = NamedBlock('BaseBlock', {
      target: StringValue.describe('Required target').required(),
    });
    const ExtendedBlock = BaseBlock.extend({
      extra: BooleanValue.describe('Extra field'),
    });
    const schema = { items: NamedCollectionBlock(ExtendedBlock) };
    const schemaCtx = createSchemaContext({
      schema: schema as Record<string, FieldType>,
      aliases: {},
    });

    // Entry without target
    const ast = parseWithSchema('items test_item:\n  extra: true', schema);

    const engine = new LintEngine({
      passes: [requiredFieldPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);

    const collected = collectDiagnostics(ast);
    const reqErrors = collected.filter(
      d => d.code === 'missing-required-field'
    );
    expect(reqErrors).toHaveLength(1);
    expect(reqErrors[0].message).toBe("Missing required field 'target'");
  });
});

// ============================================================================
// constraintValidationPass
// ============================================================================

describe('constraintValidationPass', () => {
  // Helper to run constraint validation on a custom schema + source
  function runConstraints(source: string, schema: Record<string, FieldType>) {
    const schemaCtx = createSchemaContext({ schema, aliases: {} });
    const ast = parseWithSchema(source, schema);
    const engine = new LintEngine({
      passes: [constraintValidationPass()],
    });
    engine.run(toAstRoot(ast), schemaCtx);
    return collectDiagnostics(ast);
  }

  // ---------- Number constraints ----------

  describe('number constraints', () => {
    it('reports value below minimum', () => {
      const schema = {
        test: Block('T', { priority: NumberValue.min(10) }),
      };
      const diags = runConstraints('test:\n  priority: 5', schema);
      const errors = diags.filter(d => d.code === 'constraint-minimum');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('>= 10');
      expect(errors[0].message).toContain('5');
    });

    it('reports value above maximum', () => {
      const schema = {
        test: Block('T', { priority: NumberValue.max(100) }),
      };
      const diags = runConstraints('test:\n  priority: 200', schema);
      const errors = diags.filter(d => d.code === 'constraint-maximum');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('<= 100');
    });

    it('passes value within range', () => {
      const schema = {
        test: Block('T', { priority: NumberValue.min(0).max(100) }),
      };
      const diags = runConstraints('test:\n  priority: 50', schema);
      const errors = diags.filter(
        d => typeof d.code === 'string' && d.code.startsWith('constraint-')
      );
      expect(errors).toHaveLength(0);
    });

    it('reports exclusiveMinimum violation', () => {
      const schema = {
        test: Block('T', { value: NumberValue.exclusiveMin(0) }),
      };
      const diags = runConstraints('test:\n  value: 0', schema);
      const errors = diags.filter(
        d => d.code === 'constraint-exclusive-minimum'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('> 0');
    });

    it('reports exclusiveMaximum violation', () => {
      const schema = {
        test: Block('T', { value: NumberValue.exclusiveMax(1) }),
      };
      const diags = runConstraints('test:\n  value: 1', schema);
      const errors = diags.filter(
        d => d.code === 'constraint-exclusive-maximum'
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('< 1');
    });

    it('reports multipleOf violation', () => {
      const schema = {
        test: Block('T', { count: NumberValue.multipleOf(5) }),
      };
      const diags = runConstraints('test:\n  count: 7', schema);
      const errors = diags.filter(d => d.code === 'constraint-multiple-of');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('multiple of 5');
    });

    it('passes valid multipleOf', () => {
      const schema = {
        test: Block('T', { count: NumberValue.multipleOf(5) }),
      };
      const diags = runConstraints('test:\n  count: 15', schema);
      const errors = diags.filter(d => d.code === 'constraint-multiple-of');
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- String constraints ----------

  describe('string constraints', () => {
    it('reports string below minLength', () => {
      const schema = {
        test: Block('T', { name: StringValue.minLength(3) }),
      };
      const diags = runConstraints('test:\n  name: "ab"', schema);
      const errors = diags.filter(d => d.code === 'constraint-min-length');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('at least 3');
    });

    it('reports string above maxLength', () => {
      const schema = {
        test: Block('T', { name: StringValue.maxLength(5) }),
      };
      const diags = runConstraints('test:\n  name: "toolong"', schema);
      const errors = diags.filter(d => d.code === 'constraint-max-length');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('at most 5');
    });

    it('reports pattern mismatch', () => {
      const schema = {
        test: Block('T', { code: StringValue.pattern(/^[A-Z]{3}$/) }),
      };
      const diags = runConstraints('test:\n  code: "abc"', schema);
      const errors = diags.filter(d => d.code === 'constraint-pattern');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('^[A-Z]{3}$');
    });

    it('passes valid pattern', () => {
      const schema = {
        test: Block('T', { code: StringValue.pattern(/^[A-Z]{3}$/) }),
      };
      const diags = runConstraints('test:\n  code: "ABC"', schema);
      const errors = diags.filter(d => d.code === 'constraint-pattern');
      expect(errors).toHaveLength(0);
    });

    it('skips string constraints for template expressions', () => {
      const schema = {
        test: Block('T', { name: StringValue.minLength(100) }),
      };
      // Template expressions are dynamic — can't validate at lint time
      const diags = runConstraints('test:\n  name: |hello world', schema);
      const errors = diags.filter(
        d => typeof d.code === 'string' && d.code.startsWith('constraint-')
      );
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- Enum / const ----------

  describe('enum and const constraints', () => {
    it('reports value not in enum', () => {
      const schema = {
        test: Block('T', {
          status: StringValue.enum(['active', 'inactive']),
        }),
      };
      const diags = runConstraints('test:\n  status: "unknown"', schema);
      const errors = diags.filter(d => d.code === 'constraint-enum');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('"active"');
      expect(errors[0].message).toContain('"unknown"');
    });

    it('passes value in enum', () => {
      const schema = {
        test: Block('T', {
          status: StringValue.enum(['active', 'inactive']),
        }),
      };
      const diags = runConstraints('test:\n  status: "active"', schema);
      const errors = diags.filter(d => d.code === 'constraint-enum');
      expect(errors).toHaveLength(0);
    });

    it('reports const violation', () => {
      const schema = {
        test: Block('T', {
          enabled: BooleanValue.const(true),
        }),
      };
      const diags = runConstraints('test:\n  enabled: False', schema);
      const errors = diags.filter(d => d.code === 'constraint-const');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('true');
    });
  });

  // ---------- Sequence constraints ----------

  describe('sequence constraints', () => {
    it('reports too few sequence items', () => {
      const StepBlock = Block('Step', { label: StringValue });
      const schema = {
        test: Block('T', {
          steps: Sequence(StepBlock).minItems(2),
        }),
      };
      const diags = runConstraints(
        'test:\n  steps:\n    - label: "one"',
        schema
      );
      const errors = diags.filter(d => d.code === 'constraint-min-items');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('at least 2');
    });

    it('reports too many sequence items', () => {
      const StepBlock = Block('Step', { label: StringValue });
      const schema = {
        test: Block('T', {
          steps: Sequence(StepBlock).maxItems(1),
        }),
      };
      const diags = runConstraints(
        'test:\n  steps:\n    - label: "one"\n    - label: "two"',
        schema
      );
      const errors = diags.filter(d => d.code === 'constraint-max-items');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('at most 1');
    });

    it('passes valid item count', () => {
      const StepBlock = Block('Step', { label: StringValue });
      const schema = {
        test: Block('T', {
          steps: Sequence(StepBlock).minItems(1).maxItems(3),
        }),
      };
      const diags = runConstraints(
        'test:\n  steps:\n    - label: "one"\n    - label: "two"',
        schema
      );
      const errors = diags.filter(
        d => typeof d.code === 'string' && d.code.startsWith('constraint-')
      );
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- Sequence item constraints ----------

  describe('sequence item constraints', () => {
    it('checks constraints on fields inside sequence items', () => {
      const StepBlock = Block('Step', {
        priority: NumberValue.min(1).max(10),
      });
      const schema = {
        test: Block('T', { steps: Sequence(StepBlock) }),
      };
      const diags = runConstraints(
        'test:\n  steps:\n    - priority: 0',
        schema
      );
      const errors = diags.filter(d => d.code === 'constraint-minimum');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('>= 1');
    });

    it('checks string constraints inside sequence items', () => {
      const ItemBlock = Block('Item', {
        name: StringValue.minLength(3),
      });
      const schema = {
        test: Block('T', { items: Sequence(ItemBlock) }),
      };
      const diags = runConstraints('test:\n  items:\n    - name: "ab"', schema);
      const errors = diags.filter(d => d.code === 'constraint-min-length');
      expect(errors).toHaveLength(1);
    });

    it('passes valid constraints in sequence items', () => {
      const StepBlock = Block('Step', {
        priority: NumberValue.min(1).max(10),
      });
      const schema = {
        test: Block('T', { steps: Sequence(StepBlock) }),
      };
      const diags = runConstraints(
        'test:\n  steps:\n    - priority: 5',
        schema
      );
      const errors = diags.filter(
        d => typeof d.code === 'string' && d.code.startsWith('constraint-')
      );
      expect(errors).toHaveLength(0);
    });
  });

  // ---------- Nested / NamedBlock / Variant ----------

  describe('nested and variant constraints', () => {
    it('checks constraints in nested blocks', () => {
      const InnerBlock = Block('Inner', {
        count: NumberValue.min(10),
      });
      const schema = {
        outer: Block('Outer', { inner: InnerBlock }),
      };
      const diags = runConstraints('outer:\n  inner:\n    count: 3', schema);
      const errors = diags.filter(d => d.code === 'constraint-minimum');
      expect(errors).toHaveLength(1);
    });

    it('checks constraints in NamedBlock entries', () => {
      const schema = {
        item: NamedCollectionBlock(
          NamedBlock('Item', {
            priority: NumberValue.min(1).max(10),
          })
        ),
      };
      const diags = runConstraints('item first:\n  priority: 0', schema);
      const errors = diags.filter(d => d.code === 'constraint-minimum');
      expect(errors).toHaveLength(1);
    });

    it('skips constraint validation for missing fields', () => {
      const schema = {
        test: Block('T', { count: NumberValue.min(0) }),
      };
      // count is not present — should not trigger constraint error
      const diags = runConstraints('test:\n  name: "x"', schema);
      const errors = diags.filter(
        d => typeof d.code === 'string' && d.code.startsWith('constraint-')
      );
      expect(errors).toHaveLength(0);
    });

    it('validates constraints in variant-specific fields', () => {
      const schema = {
        item: NamedCollectionBlock(
          NamedBlock('Item', { base: StringValue }).variant('special', {
            base: StringValue,
            priority: NumberValue.min(1).max(10),
          })
        ),
      };
      const diags = runConstraints(
        'item special:\n  base: "x"\n  priority: 0',
        schema
      );
      const errors = diags.filter(d => d.code === 'constraint-minimum');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('>= 1');
    });

    it('uses base schema for non-variant entries', () => {
      const schema = {
        item: NamedCollectionBlock(
          NamedBlock('Item', { base: StringValue }).variant('special', {
            base: StringValue,
            priority: NumberValue.min(1),
          })
        ),
      };
      // 'other' is not a variant name, so base schema applies (no 'priority' field)
      const diags = runConstraints('item other:\n  base: "x"', schema);
      const errors = diags.filter(
        d => typeof d.code === 'string' && d.code.startsWith('constraint-')
      );
      expect(errors).toHaveLength(0);
    });
  });
});

// ============================================================================
// Unreachable code pass tests
// ============================================================================

describe('unreachableCodePass', () => {
  function lintSource(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  function unreachableWarnings(source: string): Diagnostic[] {
    return lintSource(source).filter(d => d.code === 'unreachable-code');
  }

  it('reports unreachable template after transition as warning with Unnecessary tag', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      transition to @subagent.main
      | This is unreachable
`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(warnings[0].tags).toContain(DiagnosticTag.Unnecessary);
    expect(warnings[0].message).toContain('transition');
  });

  it('reports multiple unreachable statements after transition', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      transition to @subagent.main
      | Unreachable 1
      | Unreachable 2
`);
    expect(warnings).toHaveLength(2);
  });

  it('does not report when transition is last statement', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      | Do something
      transition to @subagent.main
`);
    expect(warnings).toHaveLength(0);
  });

  it('does not report code after if-with-transition but no else', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      if @variables.x == "a":
        transition to @subagent.main
      | Reachable because else branch does not exist
`);
    expect(warnings).toHaveLength(0);
  });

  it('reports unreachable code after exhaustive if/else transitions', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      if @variables.x == "a":
        transition to @subagent.main
      else:
        transition to @subagent.main
      | Unreachable
`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("'if' block");
  });

  it('reports unreachable code inside nested if body', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      if @variables.x == "a":
        transition to @subagent.main
        | Unreachable inside if body
      else:
        | Reachable
`);
    expect(warnings).toHaveLength(1);
  });

  it('does not flag code with no transitions', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      | Line 1
      | Line 2
      | Line 3
`);
    expect(warnings).toHaveLength(0);
  });

  it('does not flag a single template', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      | Just a template
`);
    expect(warnings).toHaveLength(0);
  });

  it('reports unreachable code after exhaustive if/elif/else transitions', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      if @variables.x == "a":
        transition to @subagent.main
      elif @variables.x == "b":
        transition to @subagent.main
      else:
        transition to @subagent.main
      | Unreachable after elif chain
`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("'if' block");
  });

  it('does not flag code after if/elif without else', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      if @variables.x == "a":
        transition to @subagent.main
      elif @variables.x == "b":
        transition to @subagent.main
      | Reachable because there is no else branch
`);
    expect(warnings).toHaveLength(0);
  });

  it('flags back-to-back transitions (second is unreachable)', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      transition to @subagent.main
      transition to @subagent.main
`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('transition');
  });

  it('reports unreachable code inside run body after transition', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      run @actions.fetch
        transition to @subagent.main
        | Unreachable inside run body
`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('transition');
  });

  it('does not flag reachable code inside run body', () => {
    const warnings = unreachableWarnings(`
subagent main:
  label: "Main"
  reasoning:
    instructions: ->
      run @actions.fetch
        with user_id=@variables.id
        set @variables.result=@outputs.data
`);
    expect(warnings).toHaveLength(0);
  });
});

// ============================================================================
// Function call validation tests
// ============================================================================

describe('expressionValidationPass', () => {
  function runLint(source: string): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  function runLintWithOptions(
    source: string,
    options: Parameters<typeof expressionValidationPass>[0]
  ): Diagnostic[] {
    const ast = parseDocument(source);
    const engine = new LintEngine({
      passes: [expressionValidationPass(options)],
      source: 'test',
    });
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    return diagnostics;
  }

  it('accepts valid len() function', () => {
    const diagnostics = runLint(`
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  before_reasoning:
    if len(@variables.items) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(0);
  });

  it('reports length() as unknown function with suggestion', () => {
    const diagnostics = runLint(`
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  before_reasoning:
    if length(@variables.items) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(1);
    expect(funcErrors[0].message).toContain("'length'");
    expect(funcErrors[0].message).toContain('not a recognized function');
    expect(funcErrors[0].message).toContain('len');
    expect(funcErrors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports completely unknown function', () => {
    const diagnostics = runLint(`
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  before_reasoning:
    if foo(@variables.items) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(1);
    expect(funcErrors[0].message).toContain("'foo'");
    expect(funcErrors[0].message).toContain('not a recognized function');
  });

  it('accepts len() in available when clause', () => {
    const diagnostics = runLint(`
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  actions:
    fetch:
      description: "Fetch"
      available when len(@variables.items) > 0
      target: "flow://test"
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(0);
  });

  it('accepts max() and min() functions', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0
  b: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if max(@variables.a, @variables.b) == 0:
      transition to @subagent.main
    if min(@variables.a, @variables.b) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(0);
  });

  it('reports minn() with suggestion for min', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if minn(@variables.a, @variables.a) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(1);
    expect(funcErrors[0].message).toContain("'minn'");
    expect(funcErrors[0].message).toContain("Did you mean 'min'");
  });

  it('reports namespace-function-call when call receiver is not a simple identifier', () => {
    const diagnostics = runLintWithOptions(
      `
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  reasoning:
    instructions: ->
      if @variables.items.append("x") == 0:
        | hello
`,
      { namespacedFunctions: { items: new Set(['append']) } }
    );
    const namespaceCallErrors = diagnostics.filter(
      d => d.code === 'namespace-function-call'
    );
    expect(namespaceCallErrors).toHaveLength(1);
    expect(namespaceCallErrors[0].message).toContain(
      'Namespace function calls are not permitted'
    );
    expect(namespaceCallErrors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports namespace-function-call for @namespace.foo(...) when the receiver is an @-reference', () => {
    const diagnostics = runLintWithOptions(
      `
variables:
  x: mutable string = ""

subagent main:
  description: "test"
  before_reasoning:
    if @not_a_declared_namespace.foo("x") == "":
      transition to @subagent.main
`,
      { namespacedFunctions: { not_a_declared_namespace: new Set(['foo']) } }
    );
    const namespaceCallErrors = diagnostics.filter(
      d => d.code === 'namespace-function-call'
    );
    expect(namespaceCallErrors).toHaveLength(1);
    expect(namespaceCallErrors[0].message).toContain(
      'Namespace function calls are not permitted'
    );
    expect(namespaceCallErrors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports * operator as unsupported', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0
  b: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if @variables.a * @variables.b == 0:
      transition to @subagent.main
`);
    const opErrors = diagnostics.filter(d => d.code === 'unsupported-operator');
    expect(opErrors).toHaveLength(1);
    expect(opErrors[0].message).toContain("'*'");
    expect(opErrors[0].message).toContain('not supported');
    expect(opErrors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('reports / operator as unsupported', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0
  b: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if @variables.a / @variables.b == 0:
      transition to @subagent.main
`);
    const opErrors = diagnostics.filter(d => d.code === 'unsupported-operator');
    expect(opErrors).toHaveLength(1);
    expect(opErrors[0].message).toContain("'/'");
  });

  it('accepts + and - operators', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0
  b: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if @variables.a + @variables.b == 0:
      transition to @subagent.main
    if @variables.a - @variables.b == 0:
      transition to @subagent.main
`);
    const opErrors = diagnostics.filter(d => d.code === 'unsupported-operator');
    expect(opErrors).toHaveLength(0);
  });

  it('validates nested function calls (function as argument)', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0
  b: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if len(max(@variables.a, @variables.b)) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(0);
  });

  it('reports unknown function nested inside valid function', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if len(foo(@variables.a)) == 0:
      transition to @subagent.main
`);
    const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
    expect(funcErrors).toHaveLength(1);
    expect(funcErrors[0].message).toContain("'foo'");
  });

  it('reports * in sub-expression combined with supported operators', () => {
    const diagnostics = runLint(`
variables:
  a: mutable number = 0
  b: mutable number = 0
  c: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if @variables.a + @variables.b * @variables.c == 0:
      transition to @subagent.main
`);
    const opErrors = diagnostics.filter(d => d.code === 'unsupported-operator');
    expect(opErrors).toHaveLength(1);
    expect(opErrors[0].message).toContain("'*'");
  });

  describe('configurable options', () => {
    it('accepts custom function via functions option', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  before_reasoning:
    if customFn(@variables.items) == 0:
      transition to @subagent.main
`,
        { functions: new Set([...BUILTIN_FUNCTIONS, 'customFn']) }
      );
      const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
      expect(funcErrors).toHaveLength(0);
    });

    it('rejects builtins when functions option replaces them entirely', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  before_reasoning:
    if len(@variables.items) == 0:
      transition to @subagent.main
`,
        { functions: new Set(['customOnly']) }
      );
      const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
      expect(funcErrors).toHaveLength(1);
      expect(funcErrors[0].message).toContain("'len'");
    });

    it('allows * operator when supportedOperators includes it', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  a: mutable number = 0
  b: mutable number = 0

subagent main:
  description: "test"
  before_reasoning:
    if @variables.a * @variables.b == 0:
      transition to @subagent.main
`,
        {
          supportedOperators: new Set([
            '+',
            '-',
            '*',
            '==',
            '!=',
            '<',
            '>',
            '<=',
            '>=',
            'and',
            'or',
            'not',
            'in',
            'not in',
          ]),
        }
      );
      const opErrors = diagnostics.filter(
        d => d.code === 'unsupported-operator'
      );
      expect(opErrors).toHaveLength(0);
    });

    it('handles empty functions set (rejects all calls)', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  items: mutable list[string] = []

subagent main:
  description: "test"
  before_reasoning:
    if len(@variables.items) == 0:
      transition to @subagent.main
`,
        { functions: new Set() }
      );
      const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
      expect(funcErrors).toHaveLength(1);
    });

    it('accepts member calls when namespacedFunctions maps namespace to allowed functions', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  x: mutable string = ""

subagent main:
  description: "test"
  before_reasoning:
    if a2a.task("x") == "":
      transition to @subagent.main
`,
        {
          namespacedFunctions: {
            a2a: new Set(['task']),
          },
        }
      );
      const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
      expect(funcErrors).toHaveLength(0);
    });

    it('reports unknown-function when the namespace is not in the allowlist', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  x: mutable string = ""

subagent main:
  description: "test"
  before_reasoning:
    if other.task("x") == "":
      transition to @subagent.main
`,
        {
          namespacedFunctions: {
            a2a: new Set(['task']),
          },
        }
      );
      const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
      expect(funcErrors).toHaveLength(1);
      expect(funcErrors[0].message).toContain("'other'");
    });

    it('reports unknown-function when function is not allowed in the namespace', () => {
      const diagnostics = runLintWithOptions(
        `
variables:
  x: mutable string = ""

subagent main:
  description: "test"
  before_reasoning:
    if a2a.unknown_fn("x") == "":
      transition to @subagent.main
`,
        {
          namespacedFunctions: {
            a2a: new Set(['task', 'message']),
          },
        }
      );
      const funcErrors = diagnostics.filter(d => d.code === 'unknown-function');
      expect(funcErrors).toHaveLength(1);
      expect(funcErrors[0].message).toContain("'unknown_fn'");
      expect(funcErrors[0].message).toContain('a2a');
    });
  });
});
