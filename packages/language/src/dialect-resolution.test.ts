/**
 * Tests for dialect resolution logic.
 */

import { describe, test, expect } from 'vitest';
import { resolveDialect } from './dialect-resolution.js';
import type { DialectResolutionConfig } from './dialect-resolution.js';
import type { DialectConfig } from './dialect-config.js';

/** Minimal dialect config for testing. */
function makeDialect(name: string, version: string): DialectConfig {
  return {
    name,
    displayName: name,
    description: `${name} dialect`,
    version,
    schemaInfo: { schema: {}, aliases: {} },
    createRules: () => [],
  } as DialectConfig;
}

const testDialect = makeDialect('agentscript', '2.5.3');
const testConfig: DialectResolutionConfig = {
  dialects: [testDialect],
};

const dialectVersion = testDialect.version;
const [majorStr, minorStr] = dialectVersion.split('.');
const major = Number(majorStr);
const minor = Number(minorStr ?? 0);

describe('resolveDialect', () => {
  test('uses default dialect when no annotation', () => {
    const result = resolveDialect('system:\n  instructions: "hi"', testConfig);

    expect(result.dialect.name).toBe('agentscript');
    expect(result.versionDiagnostic).toBeUndefined();
  });

  test('parses dialect annotation', () => {
    const source = '# @dialect: AGENTSCRIPT\nsystem:\n  instructions: "hi"';
    const result = resolveDialect(source, testConfig);

    expect(result.dialect.name).toBe('agentscript');
    expect(result.versionDiagnostic).toBeUndefined();
    expect(result.unknownDialect).toBeUndefined();
  });

  test('returns unknownDialect for unrecognized dialect name', () => {
    const source = '# @dialect: abc=2.2\nsystem:\n  instructions: "hi"';
    const result = resolveDialect(source, testConfig);

    // Falls back to default dialect
    expect(result.dialect.name).toBe('agentscript');
    // Reports the unknown dialect
    expect(result.unknownDialect).toBeDefined();
    expect(result.unknownDialect!.name).toBe('abc');
    expect(result.unknownDialect!.line).toBe(0);
    expect(result.unknownDialect!.nameStart).toBeGreaterThan(0);
    expect(result.unknownDialect!.nameLength).toBe(3);
    expect(result.unknownDialect!.availableNames).toContain('agentscript');
  });

  test('no version diagnostic when major-only matches', () => {
    const source = `# @dialect: agentscript=${major}\nsystem:\n  instructions: "hi"`;
    const result = resolveDialect(source, testConfig);

    expect(result.versionDiagnostic).toBeUndefined();
  });

  test('no version diagnostic when major.minor matches', () => {
    const source = `# @dialect: agentscript=${major}.${minor}\nsystem:\n  instructions: "hi"`;
    const result = resolveDialect(source, testConfig);

    expect(result.versionDiagnostic).toBeUndefined();
  });

  test('no version diagnostic when requested minor is below available', () => {
    if (minor === 0) return; // Can't test below 0
    const source = `# @dialect: agentscript=${major}.${minor - 1}\nsystem:\n  instructions: "hi"`;
    const result = resolveDialect(source, testConfig);

    expect(result.versionDiagnostic).toBeUndefined();
  });

  test('error for incompatible major version', () => {
    const source = '# @dialect: agentscript=99\nsystem:\n  instructions: "hi"';
    const result = resolveDialect(source, testConfig);

    expect(result.versionDiagnostic).toBeDefined();
    expect(result.versionDiagnostic!.severity).toBe(1); // Error
    expect(result.versionDiagnostic!.message).toContain(
      'Incompatible major version'
    );
    expect(result.versionDiagnostic!.suggestedVersions).toContain(
      String(major)
    );
  });

  test('warning when minimum minor version not met', () => {
    const source = `# @dialect: agentscript=${major}.999\nsystem:\n  instructions: "hi"`;
    const result = resolveDialect(source, testConfig);

    expect(result.versionDiagnostic).toBeDefined();
    expect(result.versionDiagnostic!.severity).toBe(2); // Warning
    expect(result.versionDiagnostic!.message).toContain(
      'Minimum minor version not met'
    );
    expect(result.versionDiagnostic!.suggestedVersions).toEqual([
      String(major),
      `${major}.${minor}`,
    ]);
  });

  test('no version diagnostic when version matches exactly', () => {
    const source = `# @dialect: agentscript=${major}.${minor}\nsystem:\n  instructions: "hi"`;
    const result = resolveDialect(source, testConfig);

    expect(result.versionDiagnostic).toBeUndefined();
  });

  test('throws when no dialects configured', () => {
    const emptyConfig: DialectResolutionConfig = { dialects: [] };
    expect(() => resolveDialect('system:', emptyConfig)).toThrow(
      'No dialect available'
    );
  });

  test('uses defaultDialect config option', () => {
    const second = makeDialect('custom', '1.0.0');
    const config: DialectResolutionConfig = {
      dialects: [testDialect, second],
      defaultDialect: 'custom',
    };
    const result = resolveDialect('system:', config);
    expect(result.dialect.name).toBe('custom');
  });
});
