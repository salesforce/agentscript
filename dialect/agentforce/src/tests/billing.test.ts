/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { parseAndLint, DiagnosticSeverity } from '@agentscript/language';
import { parseDocument } from './test-utils.js';
import { agentforceDialect } from '../index.js';

// ============================================================================
// billing nested inside config block
//
// `mode` uses the exact agent-dsl `billingMode` enum values (ACTION_BASED /
// OUTCOME_BASED). Validation is a field-level `.enum()` constraint, so it
// surfaces through the lint pipeline as `constraint-enum` — these tests run the
// full parseAndLint pipeline rather than parse-only (which skips lint).
// ============================================================================

function lint(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find((n: { type: string }) => n.type === 'mapping') ??
    root;
  return parseAndLint(mappingNode, agentforceDialect);
}

describe('billing in config block', () => {
  it('parses the billing block structure', () => {
    const source = `
config:
    developer_name: "test_agent"
    billing:
        mode: "OUTCOME_BASED"
`.trimStart();

    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;
    const billing = config.billing as Record<string, unknown>;

    expect(billing).toBeDefined();
    expect(billing.__kind).toBe('BillingConfig');
    expect(billing.mode).toBeDefined();
  });

  it('produces no errors for a valid billing mode (OUTCOME_BASED)', () => {
    const source = `
config:
    developer_name: "test_agent"
    billing:
        mode: "OUTCOME_BASED"
`.trimStart();

    const { diagnostics } = lint(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('produces no errors for a valid billing mode (ACTION_BASED)', () => {
    const source = `
config:
    developer_name: "test_agent"
    billing:
        mode: "ACTION_BASED"
`.trimStart();

    const { diagnostics } = lint(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('flags an invalid billing mode with constraint-enum', () => {
    const source = `
config:
    developer_name: "test_agent"
    billing:
        mode: "outcome_based"
`.trimStart();

    const { diagnostics } = lint(source);
    const enumError = diagnostics.find(d => d.code === 'constraint-enum');

    expect(enumError).toBeDefined();
    expect(enumError?.severity).toBe(DiagnosticSeverity.Error);
    expect(enumError?.message).toContain('ACTION_BASED');
    expect(enumError?.message).toContain('OUTCOME_BASED');
  });
});

// ============================================================================
// billing is only allowed for the Agentforce Service Agent (ASA)
//
// An omitted agent_type defaults to the service-agent type, so billing stays
// allowed when agent_type is absent. Only an explicit non-ASA agent_type is
// rejected, via the `billing-agent-type` diagnostic.
// ============================================================================

describe('billing agent-type restriction', () => {
  it('errors when billing is declared for a non-ASA agent type', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceEmployeeAgent"
    billing:
        mode: "OUTCOME_BASED"
`.trimStart();

    const { diagnostics } = lint(source);
    const errors = diagnostics.filter(d => d.code === 'billing-agent-type');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('AgentforceEmployeeAgent');
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
  });

  it('does not error when billing is declared for AgentforceServiceAgent', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "support@example.com"
    billing:
        mode: "OUTCOME_BASED"
`.trimStart();

    const { diagnostics } = lint(source);
    const errors = diagnostics.filter(d => d.code === 'billing-agent-type');
    expect(errors).toHaveLength(0);
  });

  it('does not error when billing is declared with a padded AgentforceServiceAgent value', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: " AgentforceServiceAgent "
    default_agent_user: "support@example.com"
    billing:
        mode: "OUTCOME_BASED"
`.trimStart();

    const { diagnostics } = lint(source);
    const errors = diagnostics.filter(d => d.code === 'billing-agent-type');
    expect(errors).toHaveLength(0);
  });

  it('does not error when billing is declared with agent_type omitted (defaults to service agent)', () => {
    const source = `
config:
    developer_name: "test_agent"
    billing:
        mode: "OUTCOME_BASED"
`.trimStart();

    const { diagnostics } = lint(source);
    const errors = diagnostics.filter(d => d.code === 'billing-agent-type');
    expect(errors).toHaveLength(0);
  });
});

describe('billing optional', () => {
  it('parses config without a billing block', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
`.trimStart();

    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;

    expect(config).toBeDefined();
    expect(config.billing).toBeUndefined();
  });
});
