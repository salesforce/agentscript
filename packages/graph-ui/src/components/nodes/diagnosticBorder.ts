/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { DiagnosticSeverity, type Diagnostic } from '@agentscript/types';

/**
 * Compute the border/ring classes for a graph node based on
 * its selection state and diagnostics.
 */
export function getNodeBorderClass(
  selected: boolean | undefined,
  diagnostics: Diagnostic[] | undefined
): string {
  if (selected) {
    return 'border-blue-400 ring-2 ring-blue-200 shadow-lg shadow-blue-500/10 dark:ring-blue-800 dark:shadow-blue-500/8';
  }
  if (diagnostics && diagnostics.length > 0) {
    const hasError = diagnostics.some(
      d => d.severity === DiagnosticSeverity.Error
    );
    if (hasError) {
      return 'border-red-400 ring-2 ring-red-400/20 dark:border-red-500 dark:ring-red-500/20';
    }
    const hasWarning = diagnostics.some(
      d => d.severity === DiagnosticSeverity.Warning
    );
    if (hasWarning) {
      return 'border-amber-400 ring-2 ring-amber-400/20 dark:border-amber-500 dark:ring-amber-500/20';
    }
  }
  return '';
}
