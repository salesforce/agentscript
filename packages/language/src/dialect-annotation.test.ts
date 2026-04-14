/**
 * Tests for dialect-annotation parsing.
 */

import { describe, test, expect } from 'vitest';
import { parseDialectAnnotation } from './dialect-annotation.js';

describe('parseDialectAnnotation', () => {
  test('returns null for source with no annotation', () => {
    const source = 'system:\n  instructions: "hi"';
    expect(parseDialectAnnotation(source)).toBeNull();
  });

  test('returns null for empty source', () => {
    expect(parseDialectAnnotation('')).toBeNull();
  });

  test('parses annotation with name only (no version)', () => {
    const source = '# @dialect: agentscript\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('agentscript');
    expect(result!.version).toBeUndefined();
    expect(result!.line).toBe(0);
    expect(result!.versionStart).toBe(-1);
    expect(result!.versionLength).toBe(0);
  });

  test('parses annotation with name and major version', () => {
    const source = '# @dialect: agentscript=2\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('agentscript');
    expect(result!.version).toBe('2');
    expect(result!.line).toBe(0);
    expect(result!.versionStart).toBeGreaterThan(0);
    expect(result!.versionLength).toBe(1);
  });

  test('parses annotation with name and major.minor version', () => {
    const source = '# @dialect: agentscript=2.5\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('agentscript');
    expect(result!.version).toBe('2.5');
    expect(result!.versionLength).toBe(3);
  });

  test('lowercases the dialect name', () => {
    const source = '# @dialect: AGENTSCRIPT=1\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('agentscript');
    // nameLength should reflect original casing length
    expect(result!.nameLength).toBe('AGENTSCRIPT'.length);
  });

  test('handles extra whitespace after #', () => {
    const source = '#   @dialect:   myDialect=3\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('mydialect');
    expect(result!.version).toBe('3');
  });

  test('finds annotation on a non-first line (within first 10)', () => {
    const lines = [
      '# some comment',
      '# another comment',
      '# @dialect: agentscript=1.2',
      'system:',
    ];
    const result = parseDialectAnnotation(lines.join('\n'));

    expect(result).not.toBeNull();
    expect(result!.name).toBe('agentscript');
    expect(result!.version).toBe('1.2');
    expect(result!.line).toBe(2);
  });

  test('ignores annotation beyond line 10', () => {
    const lines = Array(10).fill('# comment');
    lines.push('# @dialect: agentscript=1');
    const result = parseDialectAnnotation(lines.join('\n'));

    expect(result).toBeNull();
  });

  test('nameStart points to the start of the name in the line', () => {
    const source = '# @dialect: foo=1\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    // "# @dialect: " is 13 chars, so foo starts at index 12
    expect(
      source.substring(
        result!.nameStart,
        result!.nameStart + result!.nameLength
      )
    ).toBe('foo');
  });

  test('versionStart points to the version portion after =', () => {
    const source = '# @dialect: foo=42\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    const line = source.split('\n')[0];
    expect(
      line.substring(
        result!.versionStart,
        result!.versionStart + result!.versionLength
      )
    ).toBe('42');
  });

  test('is case insensitive for @dialect keyword', () => {
    const source = '# @Dialect: myDialect\nsystem:';
    const result = parseDialectAnnotation(source);

    expect(result).not.toBeNull();
    expect(result!.name).toBe('mydialect');
  });
});
