/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for cross-step diagnostic de-duplication.
 */

import { describe, test, expect } from 'vitest';
import { dedupeDiagnostics } from './dedupe-diagnostics.js';
import { DiagnosticSeverity } from './core/diagnostics.js';
import type { Diagnostic } from './core/diagnostics.js';

function diag(
  overrides: Partial<Diagnostic> & Pick<Diagnostic, 'message'>
): Diagnostic {
  return {
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 5 },
    },
    severity: DiagnosticSeverity.Error,
    ...overrides,
  };
}

describe('dedupeDiagnostics', () => {
  test('collapses exact message + range + severity duplicates', () => {
    const d1 = diag({ message: 'bad mode', source: 'agentscript-schema' });
    const d2 = diag({ message: 'bad mode', source: 'compiler' });

    const result = dedupeDiagnostics([d1, d2]);

    expect(result).toHaveLength(1);
    // Earliest step (lint) wins the tie, so its source survives.
    expect(result[0].source).toBe('agentscript-schema');
  });

  test('highest severity wins for same message + range', () => {
    const warning = diag({
      message: 'bad mode',
      severity: DiagnosticSeverity.Warning,
      source: 'agentscript-lint',
    });
    const error = diag({
      message: 'bad mode',
      severity: DiagnosticSeverity.Error,
      source: 'compiler',
    });

    const result = dedupeDiagnostics([warning, error]);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(DiagnosticSeverity.Error);
    expect(result[0].source).toBe('compiler');
  });

  test('earlier step wins when the higher severity comes first', () => {
    const error = diag({
      message: 'bad mode',
      severity: DiagnosticSeverity.Error,
      source: 'parser',
    });
    const warning = diag({
      message: 'bad mode',
      severity: DiagnosticSeverity.Warning,
      source: 'compiler',
    });

    const result = dedupeDiagnostics([error, warning]);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(DiagnosticSeverity.Error);
    expect(result[0].source).toBe('parser');
  });

  test('does not collapse when messages differ', () => {
    const d1 = diag({ message: 'bad mode' });
    const d2 = diag({ message: 'other problem' });

    expect(dedupeDiagnostics([d1, d2])).toHaveLength(2);
  });

  test('does not collapse when ranges differ', () => {
    const d1 = diag({ message: 'bad mode' });
    const d2 = diag({
      message: 'bad mode',
      range: {
        start: { line: 9, character: 0 },
        end: { line: 9, character: 5 },
      },
    });

    expect(dedupeDiagnostics([d1, d2])).toHaveLength(2);
  });

  test('ignores code when comparing identity', () => {
    const d1 = diag({ message: 'bad mode', code: 'invalid-billing-mode' });
    const d2 = diag({ message: 'bad mode', code: 'schema-enum' });

    expect(dedupeDiagnostics([d1, d2])).toHaveLength(1);
  });

  test('preserves distinct diagnostics and first-seen order', () => {
    const a = diag({
      message: 'a',
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    });
    const b = diag({
      message: 'b',
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1 },
      },
    });

    const result = dedupeDiagnostics([a, b, a]);

    expect(result).toEqual([a, b]);
  });

  test('returns empty array unchanged', () => {
    expect(dedupeDiagnostics([])).toEqual([]);
  });
});
