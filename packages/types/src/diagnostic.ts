/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range } from './position.js';

/**
 * LSP DiagnosticSeverity values. MUST NOT be changed -- LSP clients depend on these exact values.
 * @see https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnosticSeverity
 */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export interface Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  /** kebab-case, e.g., "syntax-error", "undefined-reference" */
  code?: string;
  /** "agentscript" (parser), "agentscript-schema", or "agentscript-lint" */
  source?: string;
  /** LSP DiagnosticTag values (Unnecessary=1, Deprecated=2) */
  tags?: DiagnosticTag[];
  /** Additional structured data for tooling (LSP-compatible) */
  data?: {
    context?: string;
    expected?: string[];
    found?: string;
    [key: string]: unknown;
  };
}
