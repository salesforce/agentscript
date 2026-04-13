/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useMemo } from 'react';
import type { Diagnostic, Range } from '@agentscript/types';

/**
 * Return diagnostics whose range overlaps the given range.
 */
function getDiagnosticsForRange(
  diagnostics: Diagnostic[],
  range: Range | undefined
): Diagnostic[] {
  if (!range) return [];
  return diagnostics.filter(
    d =>
      d.range.start.line >= range.start.line &&
      d.range.end.line <= range.end.line
  );
}

/**
 * Hook that filters the global diagnostic list to those relevant
 * to a specific AST node (by its __cst range).
 */
export function useFieldDiagnostics(
  diagnostics: Diagnostic[],
  range: Range | undefined
): Diagnostic[] {
  return useMemo(
    () => getDiagnosticsForRange(diagnostics, range),
    [diagnostics, range]
  );
}
