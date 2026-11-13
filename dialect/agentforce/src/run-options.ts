/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  RunOption,
  SetClause,
  StringLiteral,
  lintDiagnostic,
  DiagnosticSeverity,
} from '@agentscript/language';
import type { RunStatement, Expression } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { getBlockRange } from './lint/utils.js';

/** Analyze invocation options shared by Agentforce lint and compilation. */
export function analyzeRunOptions(stmt: RunStatement): {
  executionMode?: Expression;
  diagnostics: Diagnostic[];
} {
  let executionMode: Expression | undefined;
  const diagnostics: Diagnostic[] = [];
  const keys = new Set<string>();
  for (const option of stmt.body) {
    if (!(option instanceof RunOption)) continue;
    const range = getBlockRange(option);
    if (keys.has(option.key)) {
      diagnostics.push(
        lintDiagnostic(
          range,
          `Duplicate run option '${option.key}'.`,
          DiagnosticSeverity.Error,
          'duplicate-run-option'
        )
      );
    }
    keys.add(option.key);
    if (
      option.key !== 'execution_mode' ||
      !(option.value instanceof StringLiteral) ||
      !['blocking', 'fire_and_forget'].includes(option.value.value)
    ) {
      diagnostics.push(
        lintDiagnostic(
          range,
          'Run options support execution_mode: "blocking" or "fire_and_forget".',
          DiagnosticSeverity.Error,
          'invalid-run-option'
        )
      );
      continue;
    }
    executionMode = option.value;
  }
  if (
    executionMode instanceof StringLiteral &&
    executionMode.value === 'fire_and_forget'
  ) {
    for (const child of stmt.body) {
      if (!(child instanceof SetClause)) continue;
      diagnostics.push(
        lintDiagnostic(
          getBlockRange(child),
          'Fire-and-forget runs cannot apply state updates; use blocking execution to consume action outputs.',
          DiagnosticSeverity.Error,
          'non-blocking-state-update'
        )
      );
    }
  }
  return { executionMode, diagnostics };
}
