import { describe, it, expect } from 'vitest';
import {
  TraceMap,
  originalPositionFor,
  eachMapping,
} from '@jridgewell/trace-mapping';
import { compile } from '../src/compile.js';
import { serializeWithSourceMap } from '../src/source-map/source-map-serializer.js';
import { buildCursorMap } from '../src/source-map/range-mappings.js';
import { sourced } from '../src/sourced.js';
import type { Range } from '@agentscript/types';
import { parseSource, readFixtureSource } from './test-utils.js';

// ---------------------------------------------------------------------------
// Sourced<T> unit tests
// ---------------------------------------------------------------------------

describe('Sourced<T>', () => {
  it('should wrap a value with its range', () => {
    const range = {
      start: { line: 5, character: 2 },
      end: { line: 5, character: 10 },
    };
    const s = sourced('hello', range);
    expect(s.value).toBe('hello');
    expect(s.range).toEqual(range);
  });

  it('should unwrap via toJSON()', () => {
    const s = sourced('hello', undefined);
    expect(s.toJSON()).toBe('hello');
    expect(JSON.stringify({ x: s })).toBe('{"x":"hello"}');
  });
});

// ---------------------------------------------------------------------------
// Serializer tests (V3 from range map)
// ---------------------------------------------------------------------------

describe('serializeWithSourceMap', () => {
  it('should produce valid JSON output', () => {
    const ranges = new WeakMap<object, Map<string, Range>>();
    const output = { hello: 'world' };

    const { json } = serializeWithSourceMap(output, ranges, {
      sourcePath: 'test.agent',
      sourceContent: 'test',
    });

    expect(() => JSON.parse(json)).not.toThrow();
    expect(JSON.parse(json).hello).toBe('world');
  });

  it('should produce a V3 source map', () => {
    const ranges = new WeakMap<object, Map<string, Range>>();
    const output = { key: 'val' };

    const { sourceMap } = serializeWithSourceMap(output, ranges, {
      sourcePath: 'test.agent',
      sourceContent: 'source code',
    });

    expect(sourceMap.version).toBe(3);
    expect(sourceMap.sources).toContain('test.agent');
  });

  it('should generate V3 mappings from range map', () => {
    const output = { developer_name: 'TestBot' };
    const ranges = new WeakMap<object, Map<string, Range>>();
    ranges.set(
      output,
      new Map([
        [
          'developer_name',
          {
            start: { line: 2, character: 16 },
            end: { line: 2, character: 25 },
          },
        ],
      ])
    );

    const { sourceMap } = serializeWithSourceMap(output, ranges, {
      sourcePath: 'test.agent',
      sourceContent: 'config:\n    agent_name: "TestBot"',
    });

    expect(sourceMap.mappings).toBeTruthy();

    const tracer = new TraceMap(sourceMap);
    let foundMapping = false;
    eachMapping(tracer, m => {
      if (m.originalLine === 3 && m.originalColumn === 16) {
        foundMapping = true;
      }
    });
    expect(foundMapping).toBe(true);
  });

  it('should include JSON property paths in names array', () => {
    const inner = { name: 'test' };
    const output = { config: inner };
    const ranges = new WeakMap<object, Map<string, Range>>();
    ranges.set(
      inner,
      new Map([
        [
          'name',
          {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 5 },
          },
        ],
      ])
    );

    const { sourceMap } = serializeWithSourceMap(output, ranges, {
      sourcePath: 'test.agent',
      sourceContent: 'name: test',
    });

    expect(sourceMap.names).toContain('config.name');
  });
});

// ---------------------------------------------------------------------------
// Source map round-trip with compile()
// ---------------------------------------------------------------------------

describe('source map round-trip', () => {
  it('should produce valid source map for hello_world fixture', () => {
    const source = readFixtureSource('hello_world.agent');
    const ast = parseSource(source);
    const result = compile(ast);

    const { json, sourceMap } = serializeWithSourceMap(
      result.output,
      result.ranges,
      { sourcePath: 'hello_world.agent', sourceContent: source }
    );

    expect(sourceMap.version).toBe(3);
    expect(sourceMap.sources).toContain('hello_world.agent');

    const parsed = JSON.parse(json);
    expect(parsed.schema_version).toBe('2.0');
    expect(parsed.global_configuration.developer_name).toBe('HelloWorldBot');
    expect(sourceMap.mappings).toBeTruthy();
  });

  it('should produce source map for weather fixture', () => {
    const source = readFixtureSource('weather.agent');
    const ast = parseSource(source);
    const result = compile(ast);

    const { json, sourceMap } = serializeWithSourceMap(
      result.output,
      result.ranges,
      { sourcePath: 'weather.agent', sourceContent: source }
    );

    expect(sourceMap.version).toBe(3);
    expect(() => JSON.parse(json)).not.toThrow();
    expect(sourceMap.mappings!.length).toBeGreaterThan(0);
  });

  it('should resolve developer_name back to source', () => {
    const source = readFixtureSource('hello_world.agent');
    const ast = parseSource(source);
    const result = compile(ast);

    const { json, sourceMap } = serializeWithSourceMap(
      result.output,
      result.ranges,
      { sourcePath: 'hello_world.agent', sourceContent: source }
    );

    const lines = json.split('\n');
    let targetLine = -1;
    let targetCol = -1;
    for (let i = 0; i < lines.length; i++) {
      const idx = lines[i].indexOf('"HelloWorldBot"');
      if (idx !== -1) {
        targetLine = i + 1;
        targetCol = idx;
        break;
      }
    }

    if (targetLine > 0) {
      const tracer = new TraceMap(sourceMap);
      const original = originalPositionFor(tracer, {
        line: targetLine,
        column: targetCol,
      });

      expect(original.source).toBe('hello_world.agent');
      if (original.line !== null) {
        expect(original.line).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// CursorMap tests (from V3)
// ---------------------------------------------------------------------------

describe('buildCursorMap', () => {
  it('should build bidirectional lookup from V3 source map', () => {
    const source = readFixtureSource('hello_world.agent');
    const ast = parseSource(source);
    const result = compile(ast);

    const { json, sourceMap } = serializeWithSourceMap(
      result.output,
      result.ranges,
      { sourcePath: 'hello_world.agent', sourceContent: source }
    );

    const sourceLineCount = source.split('\n').length;
    const genLineCount = json.split('\n').length;
    const cursorMap = buildCursorMap(sourceMap, sourceLineCount, genLineCount);

    let mappedSourceLines = 0;
    for (let i = 0; i < sourceLineCount; i++) {
      if (cursorMap.sourceToGen[i * 2] >= 0) mappedSourceLines++;
    }
    expect(mappedSourceLines).toBeGreaterThan(0);

    let mappedGenLines = 0;
    for (let i = 0; i < genLineCount; i++) {
      if (cursorMap.genToSource[i * 2] >= 0) mappedGenLines++;
    }
    expect(mappedGenLines).toBeGreaterThan(0);
  });
});
