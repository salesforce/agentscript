import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '@agentscript/language';
import { DIALECT_VERSION } from '../pkg-meta.js';
import { parseAndLintSource } from './test-utils.js';

// Derive the expected version parts from the dialect's available version so the
// tests don't hardcode a brittle literal (mirrors dialect-resolution.test.ts).
const [majorStr, minorStr] = DIALECT_VERSION.split('.');
const major = Number(majorStr);
const minor = Number(minorStr ?? 0);

function versionDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.code === 'invalid-version');
}

// Minimal body so the source parses; the @dialect annotation is the focus.
const BODY = `
echo done:
  kind: "a2a:response"
  message: "ok"
`;

describe('invalid-version rule', () => {
  it('does not report when major matches and no minor specified', () => {
    const source = `# @dialect: agentfabric=${major}\n${BODY}`;
    const result = parseAndLintSource(source);
    expect(versionDiagnostics(result.diagnostics)).toHaveLength(0);
  });

  it('does not report when major.minor matches exactly', () => {
    const source = `# @dialect: agentfabric=${major}.${minor}\n${BODY}`;
    const result = parseAndLintSource(source);
    expect(versionDiagnostics(result.diagnostics)).toHaveLength(0);
  });

  it('does not report when requested minor is below available', () => {
    if (minor === 0) return; // Can't request a minor below 0
    const source = `# @dialect: agentfabric=${major}.${minor - 1}\n${BODY}`;
    const result = parseAndLintSource(source);
    expect(versionDiagnostics(result.diagnostics)).toHaveLength(0);
  });

  it('reports an error for incompatible major version', () => {
    const source = `# @dialect: agentfabric=${major + 1}\n${BODY}`;
    const result = parseAndLintSource(source);
    const found = versionDiagnostics(result.diagnostics);
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe(1); // Error
    expect(found[0].message).toContain('Incompatible major version');
    expect(found[0].source).toBe('agentfabric-lint');
  });

  it('exposes suggestedVersions for an incompatible major version', () => {
    const source = `# @dialect: agentfabric=${major + 1}\n${BODY}`;
    const result = parseAndLintSource(source);
    const found = versionDiagnostics(result.diagnostics);
    expect(found).toHaveLength(1);
    const expected =
      String(major) === `${major}.${minor}`
        ? [String(major)]
        : [String(major), `${major}.${minor}`];
    expect(found[0].data?.suggestedVersions).toEqual(expected);
  });

  it('reports an ERROR (severity 1) when minimum minor version is not met', () => {
    const source = `# @dialect: agentfabric=${major}.${minor + 999}\n${BODY}`;
    const result = parseAndLintSource(source);
    const found = versionDiagnostics(result.diagnostics);
    expect(found).toHaveLength(1);
    // Crux of the agentfabric port: minor-minimum is severity 1, NOT 2.
    expect(found[0].severity).toBe(1);
    expect(found[0].message).toContain('Minimum minor version not met');
    expect(found[0].source).toBe('agentfabric-lint');
    const expected =
      String(major) === `${major}.${minor}`
        ? [String(major)]
        : [String(major), `${major}.${minor}`];
    expect(found[0].data?.suggestedVersions).toEqual(expected);
  });

  it('does not report when there is no @dialect annotation', () => {
    const result = parseAndLintSource(BODY);
    expect(versionDiagnostics(result.diagnostics)).toHaveLength(0);
  });

  it('does not report when the annotation names a different dialect', () => {
    const source = `# @dialect: agentscript=${major + 1}\n${BODY}`;
    const result = parseAndLintSource(source);
    expect(versionDiagnostics(result.diagnostics)).toHaveLength(0);
  });
});
