/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import type { AstNodeLike } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { AgentScriptSchema } from '../schema.js';
import { createLintEngine } from '../lint/index.js';
import {
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
  toAstRoot,
} from './test-utils.js';

function lint(source: string) {
  const ast = toAstRoot(parseDocument(source));
  return createLintEngine().run(ast, testSchemaCtx).diagnostics;
}

describe('system instruction conditionals', () => {
  it('parses block-form if/else instructions', () => {
    const result = parseWithDiagnostics(
      `system:
    instructions: ->
        | Default guidance.
        if @system_variables.current_modality == "voice":
            | Keep responses concise.
        else:
            | Provide detailed guidance.
`,
      AgentScriptSchema
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.value.system?.instructions.__kind).toBe('ProcedureValue');
    const instructions = result.value.system?.instructions as AstNodeLike & {
      statements: AstNodeLike[];
    };
    expect(instructions.statements).toHaveLength(2);
    expect(instructions.statements[1].__kind).toBe('IfStatement');
  });

  it.each([
    'run @actions.lookup',
    'set @variables.mode = "voice"',
    'transition to @topic.next',
  ])('rejects side-effecting statement: %s', statement => {
    const diagnostics = lint(`system:
    instructions: ->
        ${statement}
`);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'unsupported-system-instruction-statement',
        severity: DiagnosticSeverity.Error,
      })
    );
  });

  it('scans instruction text nested in conditional branches', () => {
    const diagnostics = lint(`system:
    instructions: ->
        if @system_variables.current_connection == "slack":
            | Use {@system_variables.current_connection} formatting.
`);

    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'instruction-template-syntax',
        severity: DiagnosticSeverity.Information,
      })
    );
  });
});
