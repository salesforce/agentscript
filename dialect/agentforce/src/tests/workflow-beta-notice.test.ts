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
import { WORKFLOW_BETA_NOTICE } from '../lint/passes/workflow-beta-notice.js';

function noticeDiagnostics(source: string) {
  const ast = parseDocument(source);
  const { diagnostics } = new LintEngine({ passes: defaultRules() }).run(
    ast,
    testSchemaCtx
  );
  return diagnostics.filter(d => d.code === 'workflow-beta-notice');
}

describe('workflow beta notice', () => {
  it('reports an information diagnostic on each workflow block', () => {
    const diagnostics = noticeDiagnostics(`
workflow lookup:
  description: "Look something up"

workflow refund:
  description: "Issue a refund"
`);
    expect(diagnostics).toHaveLength(2);
    for (const d of diagnostics) {
      expect(d.severity).toBe(DiagnosticSeverity.Information);
      expect(d.message).toBe(WORKFLOW_BETA_NOTICE);
    }
    // The notice is anchored to the single-line `workflow <name>` header.
    expect(diagnostics[0].range.start.line).toBe(1);
    expect(diagnostics[0].range.end.line).toBe(1);
    expect(diagnostics[1].range.start.line).toBe(4);
    expect(diagnostics[1].range.end.line).toBe(4);
  });

  it('does not report when no workflow block is present', () => {
    const diagnostics = noticeDiagnostics(`
topic main:
  description: "Main"
`);
    expect(diagnostics).toHaveLength(0);
  });
});
