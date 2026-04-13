/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Type adapters between @agentscript/language and LSP protocol types.
 */

import type { Diagnostic as LanguageDiagnostic } from '@agentscript/types';
import type { Diagnostic, Range } from 'vscode-languageserver';
import { DiagnosticSeverity } from 'vscode-languageserver';

/**
 * Convert a 0-based language Range to LSP Range (also 0-based).
 * Both use the same structure, so this is mostly a type assertion.
 */
export function toLspRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/**
 * Convert language Diagnostic to LSP Diagnostic.
 */
export function toLspDiagnostic(diag: LanguageDiagnostic): Diagnostic {
  return {
    range: toLspRange(diag.range),
    severity: diag.severity as DiagnosticSeverity,
    code: diag.code,
    source: diag.source ?? 'agentscript',
    message: diag.message,
    tags: diag.tags,
    data: diag.data,
  };
}
