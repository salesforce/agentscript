/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Zustand store slice for diagnostics (errors/warnings/info)
 * Stores LSP-compliant diagnostics
 */

import type { Diagnostic as LSPDiagnostic } from '@agentscript/types';

/**
 * Re-export LSP-compliant Diagnostic interface from dialect
 */
export type Diagnostic = LSPDiagnostic;

/**
 * LSP DiagnosticSeverity values
 */
export const DiagnosticSeverity = {
  Error: 1,
  Warning: 2,
  Information: 3,
  Hint: 4,
} as const;

export interface DiagnosticsState {
  diagnostics: Diagnostic[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
}

export interface DiagnosticsActions {
  setDiagnostics: (diagnostics: Diagnostic[]) => void;
  clearDiagnostics: () => void;
}

export type DiagnosticsSlice = DiagnosticsState & DiagnosticsActions;

const initialState: DiagnosticsState = {
  diagnostics: [],
  errorCount: 0,
  warningCount: 0,
  infoCount: 0,
};

/**
 * Count diagnostics by severity
 */
export function countBySeverity(diagnostics: Diagnostic[]): {
  errors: number;
  warnings: number;
  info: number;
} {
  let errors = 0;
  let warnings = 0;
  let info = 0;

  for (const diag of diagnostics) {
    // DiagnosticSeverity: 1=Error, 2=Warning, 3=Information, 4=Hint
    switch (diag.severity) {
      case DiagnosticSeverity.Error:
        errors++;
        break;
      case DiagnosticSeverity.Warning:
        warnings++;
        break;
      case DiagnosticSeverity.Information:
      case DiagnosticSeverity.Hint:
        info++;
        break;
    }
  }

  return { errors, warnings, info };
}

interface AppState {
  diagnostics: DiagnosticsState;
}

type SetFunction = (updater: (state: AppState) => Partial<AppState>) => void;

export const createDiagnosticsSlice = (set: SetFunction) => {
  const state: DiagnosticsState = { ...initialState };

  const actions: DiagnosticsActions = {
    setDiagnostics: (diagnostics: Diagnostic[]) => {
      const counts = countBySeverity(diagnostics);
      set((state: AppState) => ({
        diagnostics: {
          ...state.diagnostics,
          diagnostics,
          errorCount: counts.errors,
          warningCount: counts.warnings,
          infoCount: counts.info,
        },
      }));
    },
    clearDiagnostics: () =>
      set(() => ({
        diagnostics: { ...initialState },
      })),
  };

  return { state, actions };
};
