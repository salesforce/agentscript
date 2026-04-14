/**
 * Tests for type adapters
 */

import { describe, test, expect } from 'vitest';
import { toLspRange, toLspDiagnostic } from './types.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('Type Adapters', () => {
  test('toLspRange converts range correctly', () => {
    const range = {
      start: { line: 1, character: 5 },
      end: { line: 1, character: 10 },
    };

    const lspRange = toLspRange(range);

    expect(lspRange.start.line).toBe(1);
    expect(lspRange.start.character).toBe(5);
    expect(lspRange.end.line).toBe(1);
    expect(lspRange.end.character).toBe(10);
  });

  test('toLspDiagnostic converts diagnostic correctly', () => {
    const diag = {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 5 },
      },
      severity: DiagnosticSeverity.Error,
      message: 'Test error',
      code: 'test-error',
      source: 'agentscript',
    };

    const lspDiag = toLspDiagnostic(diag);

    expect(lspDiag.message).toBe('Test error');
    expect(lspDiag.severity).toBe(1); // DiagnosticSeverity.Error
    expect(lspDiag.code).toBe('test-error');
    expect(lspDiag.source).toBe('agentscript');
  });
});
