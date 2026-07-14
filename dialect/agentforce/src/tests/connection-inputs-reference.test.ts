/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests that the base undefinedReferencePass correctly validates @inputs references
 * in connection.reasoning.instructions.
 *
 * Note: This validation is handled by the generic undefinedReferencePass from
 * @agentscript/language, which validates all @namespace.property references across
 * the entire AST (including @variables, @actions, @inputs, etc).
 */
import { describe, it, expect } from 'vitest';
import { LintEngine, collectDiagnostics } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';
import type { Diagnostic } from '@agentscript/types';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

describe('connection @inputs reference validation', () => {
  it('should allow valid @inputs reference in reasoning.instructions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    inputs:
        user_name: string
            description: "The user's name"

    reasoning:
        instructions: |
            | Use the user's name: {!@inputs.user_name}

start_agent main:
    description: "test"
`.trimStart();

    const diagnostics = runLint(source);
    const undefinedErrors = diagnostics.filter(
      d => d.code === 'undefined-reference' && d.message.includes('@inputs')
    );
    expect(undefinedErrors).toHaveLength(0);
  });

  it('should error on undefined @inputs reference in reasoning.instructions', () => {
    const source = `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    inputs:
        user_name: string
            description: "The user's name"

    reasoning:
        instructions: |
            | Use undefined field: {!@inputs.undefined_field}

start_agent main:
    description: "test"
`.trimStart();

    const diagnostics = runLint(source);
    const undefinedErrors = diagnostics.filter(
      d =>
        d.code === 'undefined-reference' &&
        d.message.includes('undefined_field')
    );
    expect(undefinedErrors.length).toBeGreaterThan(0);
    expect(undefinedErrors[0].message).toContain('inputs');
  });
});
