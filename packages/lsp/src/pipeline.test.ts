/**
 * Tests for document processing pipeline.
 *
 * Dialect resolution tests live in @agentscript/language.
 * These tests focus on processDocument and its LSP diagnostic mapping.
 */

import { describe, test, expect } from 'vitest';
import { processDocument } from './pipeline.js';
import { testConfig } from './test-utils.js';

const dialectVersion = testConfig.dialects[0].version;
const [majorStr, minorStr] = dialectVersion.split('.');
const major = Number(majorStr);
const minor = Number(minorStr ?? 0);

describe('Pipeline', () => {
  test('processDocument returns DocumentState with diagnostics', () => {
    const source = `
system:
  instructions: "Test agent"
`;
    const state = processDocument('test://test.agent', source, testConfig);

    expect(state).toBeDefined();
    expect(state.uri).toBe('test://test.agent');
    expect(state.source).toBe(source);
    expect(state.ast).toBeDefined();
    expect(state.diagnostics).toBeInstanceOf(Array);
  });

  test('processDocument handles invalid input gracefully', () => {
    const source = `{{{invalid: yaml/agentscript`;
    const state = processDocument('test://test.agent', source, testConfig);

    // The parser should still return a valid state
    expect(state).toBeDefined();
    expect(state.uri).toBe('test://test.agent');
    expect(state.diagnostics).toBeInstanceOf(Array);
  });

  test('processDocument with compile hook collects compile diagnostics', () => {
    const source = `
system:
  instructions: "Test agent"
`;
    const configWithCompile = {
      ...testConfig,
      compile: () => ({
        compile: () => ({
          diagnostics: [
            {
              message: 'compile warning',
              severity: 2,
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 1 },
              },
            },
          ],
        }),
      }),
    };
    const state = processDocument(
      'test://test.agent',
      source,
      configWithCompile
    );

    const compileDiag = state.diagnostics.find(
      d => d.message === 'compile warning'
    );
    expect(compileDiag).toBeDefined();
  });

  test('processDocument emits error diagnostic for unknown dialect', () => {
    const source = '# @dialect: foo\nsystem:\n  instructions: "hi"';
    const state = processDocument('test://test.agent', source, testConfig);

    const dialectError = state.diagnostics.find(
      d => d.source === 'language-server' && d.severity === 1
    );
    expect(dialectError).toBeDefined();
    expect(dialectError!.message).toContain('Unknown dialect "foo"');
    expect(dialectError!.message).toContain('agentscript');
    expect(dialectError!.range.start.line).toBe(0);
    expect(dialectError!.code).toBe('unknown-dialect');
    expect(dialectError!.data).toEqual({
      availableNames: expect.arrayContaining(['agentscript']),
    });
  });

  test('no version diagnostic when major-only matches', () => {
    const source = `# @dialect: agentscript=${major}\nsystem:\n  instructions: "hi"`;
    const state = processDocument('test://test.agent', source, testConfig);

    const versionDiag = state.diagnostics.find(
      d => d.code === 'invalid-version'
    );
    expect(versionDiag).toBeUndefined();
  });

  test('processDocument emits error for incompatible major version', () => {
    const source = '# @dialect: agentscript=99\nsystem:\n  instructions: "hi"';
    const state = processDocument('test://test.agent', source, testConfig);

    const versionDiag = state.diagnostics.find(
      d => d.code === 'invalid-version'
    );
    expect(versionDiag).toBeDefined();
    expect(versionDiag!.severity).toBe(1); // Error
    expect(versionDiag!.source).toBe('language-server');
    expect(versionDiag!.message).toContain('Incompatible major version');
    expect(versionDiag!.data).toEqual({
      suggestedVersions: expect.arrayContaining([String(major)]),
    });
    // Range should point to the version portion
    expect(versionDiag!.range.start.line).toBe(0);
    expect(versionDiag!.range.start.character).toBeGreaterThan(0);
  });

  test('processDocument emits warning when minimum minor version not met', () => {
    const source = `# @dialect: agentscript=${major}.999\nsystem:\n  instructions: "hi"`;
    const state = processDocument('test://test.agent', source, testConfig);

    const versionDiag = state.diagnostics.find(
      d => d.code === 'invalid-version'
    );
    expect(versionDiag).toBeDefined();
    expect(versionDiag!.severity).toBe(2); // Warning
    expect(versionDiag!.message).toContain('Minimum minor version not met');
    expect(versionDiag!.data).toEqual({
      suggestedVersions: [String(major), `${major}.${minor}`],
    });
  });
});
