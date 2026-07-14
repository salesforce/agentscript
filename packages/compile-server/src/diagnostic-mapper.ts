/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Diagnostic } from '@agentscript/agentforce';

const DIAGNOSTIC_SOURCE_TO_ERROR_TYPE: Record<string, string> = {
  agentscript: 'SyntaxError',
  'agentscript-schema': 'SemanticError',
  'agentscript-lint': 'CompilationError',
};

export interface LegacyError {
  errorType: string;
  description: string;
  lineStart: number;
  lineEnd: number;
  colStart: number;
  colEnd: number;
}

// Temp mapper to preserve existing shape that the consumer is expecting.
export function mapDiagnosticToError(diagnostic: Diagnostic): LegacyError {
  return {
    errorType:
      DIAGNOSTIC_SOURCE_TO_ERROR_TYPE[diagnostic.source ?? ''] ??
      'CompilationError',
    description: diagnostic.message,
    lineStart: diagnostic.range.start.line,
    lineEnd: diagnostic.range.end.line,
    colStart: diagnostic.range.start.character,
    colEnd: diagnostic.range.end.character,
  };
}
