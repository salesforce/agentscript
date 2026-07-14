/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '@agentscript/language';
import pkg from '../../package.json' with { type: 'json' };
import { parseAndLintSource } from './test-utils.js';

const DIALECT_VERSION = pkg.version;
const [majorStr] = DIALECT_VERSION.split('.');
const major = Number(majorStr);

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
    const source = `# @dialect: agentfabric=${major}.0\n${BODY}`;
    const result = parseAndLintSource(source);
    expect(versionDiagnostics(result.diagnostics)).toHaveLength(0);
  });

  it('does not report when requested minor differs from available', () => {
    const source = `# @dialect: agentfabric=${major}.999\n${BODY}`;
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

  it('exposes suggestedVersions with only the major version', () => {
    const source = `# @dialect: agentfabric=${major + 1}\n${BODY}`;
    const result = parseAndLintSource(source);
    const found = versionDiagnostics(result.diagnostics);
    expect(found).toHaveLength(1);
    expect(found[0].data?.suggestedVersions).toEqual([String(major)]);
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
