/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';
import { LIVE_EXPERIMENTAL_WARNING } from '../lint/passes/live-experimental.js';

function warningDiagnostics(source: string) {
  const ast = parseDocument(source);
  const { diagnostics } = new LintEngine({ passes: defaultRules() }).run(
    ast,
    testSchemaCtx
  );
  return diagnostics.filter(d => d.code === 'live-experimental');
}

describe('live experimental warning', () => {
  it('warns when a live block is present', () => {
    const diagnostics = warningDiagnostics(`
live:
    enabled: True
    params:
        provider: "openai"
        model: "gpt-live"
`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diagnostics[0].message).toBe(LIVE_EXPERIMENTAL_WARNING);
    expect(diagnostics[0].range.start.line).toBe(1);
    expect(diagnostics[0].range.end.line).toBe(1);
  });

  it('does not warn when no live block is present', () => {
    const diagnostics = warningDiagnostics(`
topic main:
    description: "Main"
`);
    expect(diagnostics).toHaveLength(0);
  });
});
