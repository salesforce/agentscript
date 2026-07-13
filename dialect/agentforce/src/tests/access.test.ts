/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { SequenceNode, LintEngine } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  testSchemaCtx,
} from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics } = engine.run(ast, testSchemaCtx);
  return diagnostics;
}

// ============================================================================
// Access block is top-level only — not allowed inside topic / subagent / start_agent
// ============================================================================

describe('access block scope', () => {
  it('rejects an access block nested inside a topic', () => {
    const source = `
topic SecureTopic:
    access:
        sharing_policy:
            use_default_sharing_entities: True
`.trimStart();

    const { value, diagnostics } = parseWithDiagnostics(source);
    // The schema does not declare `access` on TopicBlock — the field shouldn't
    // make it into the parsed topic, and a diagnostic should call it out.
    const topicEntry = (
      value.topic as unknown as { get(k: string): Record<string, unknown> }
    ).get('SecureTopic');
    expect(topicEntry?.access).toBeUndefined();
    expect(
      diagnostics.some(d => d.message.toLowerCase().includes('access'))
    ).toBe(true);
  });

  it('rejects an access block nested inside a subagent', () => {
    const source = `
subagent Helper:
    access:
        sharing_policy:
            use_default_sharing_entities: True
`.trimStart();

    const { value, diagnostics } = parseWithDiagnostics(source);
    const subagent = (
      value.subagent as unknown as { get(k: string): Record<string, unknown> }
    ).get('Helper');
    expect(subagent?.access).toBeUndefined();
    expect(
      diagnostics.some(d => d.message.toLowerCase().includes('access'))
    ).toBe(true);
  });

  it('rejects an access block nested inside a start_agent', () => {
    const source = `
start_agent main:
    access:
        sharing_policy:
            use_default_sharing_entities: True
`.trimStart();

    const { value, diagnostics } = parseWithDiagnostics(source);
    const start = (
      value.start_agent as unknown as {
        get(k: string): Record<string, unknown>;
      }
    ).get('main');
    expect(start?.access).toBeUndefined();
    expect(
      diagnostics.some(d => d.message.toLowerCase().includes('access'))
    ).toBe(true);
  });
});

// ============================================================================
// Top-level access block for contactId filtering
// ============================================================================

describe('verified_customer_record_access (top-level access)', () => {
  it('parses access block with use_default_objects: True', () => {
    const source = `
access:
    verified_customer_record_access:
        use_default_objects: True
`.trimStart();

    const ast = parseDocument(source);
    const access = ast.access!;

    expect(access).toBeDefined();
    expect(access.__kind).toBe('AccessBlock');

    const vcra = access.verified_customer_record_access!;
    expect(vcra).toBeDefined();
    expect(vcra.__kind).toBe('VerifiedCustomerRecordAccessBlock');

    const useDefault = vcra.use_default_objects!;
    expect(useDefault.__kind).toBe('BooleanValue');
    expect(useDefault.value).toBe(true);
  });

  it('parses access block with use_default_objects: False', () => {
    const source = `
access:
    verified_customer_record_access:
        use_default_objects: False
`.trimStart();

    const ast = parseDocument(source);
    const access = ast.access!;
    const vcra = access.verified_customer_record_access!;

    const useDefault = vcra.use_default_objects!;
    expect(useDefault.__kind).toBe('BooleanValue');
    expect(useDefault.value).toBe(false);
  });

  it('parses access block with additional_objects', () => {
    const source = `
access:
    verified_customer_record_access:
        use_default_objects: False
        additional_objects:
          - CustomOrder.ShopperId
          - Account.ContactName
`.trimStart();

    const ast = parseDocument(source);
    const access = ast.access!;
    const vcra = access.verified_customer_record_access!;

    const useDefault = vcra.use_default_objects!;
    expect(useDefault.value).toBe(false);

    const additionalObjects = vcra.additional_objects as SequenceNode;
    expect(additionalObjects.__kind).toBe('Sequence');
    expect(additionalObjects.items).toHaveLength(2);

    // First item: CustomOrder.ShopperId
    const firstItem = additionalObjects.items[0];
    expect(firstItem.__kind).toBe('MemberExpression');

    // Second item: Account.ContactName
    const secondItem = additionalObjects.items[1];
    expect(secondItem.__kind).toBe('MemberExpression');
  });

  it('parses access block with use_default_objects and additional_objects', () => {
    const source = `
access:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomEntity.ContactRef
`.trimStart();

    const ast = parseDocument(source);
    const access = ast.access!;
    const vcra = access.verified_customer_record_access!;

    expect(vcra.use_default_objects!.value).toBe(true);

    const additionalObjects = vcra.additional_objects as SequenceNode;
    expect(additionalObjects.__kind).toBe('Sequence');
    expect(additionalObjects.items).toHaveLength(1);
    expect(additionalObjects.items[0].__kind).toBe('MemberExpression');
  });

  it('parses access block within complete agent definition', () => {
    const source = `
config:
    description: "Customer service agent"

access:
    default_agent_user: "support@example.com"
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomOrder.ShopperId

system:
    instructions: "You are a customer service agent."

start_agent ServiceAgent:
    description: "Main service topic"
`.trimStart();

    const ast = parseDocument(source);

    expect(ast.config).toBeDefined();
    expect(ast.access).toBeDefined();
    expect(ast.system).toBeDefined();
    expect(ast.start_agent).toBeDefined();

    const access = ast.access!;
    const vcra = access.verified_customer_record_access!;

    expect(vcra.use_default_objects!.value).toBe(true);

    const additionalObjects = vcra.additional_objects as SequenceNode;
    expect(additionalObjects.items).toHaveLength(1);

    expect(access.default_agent_user!.value).toBe('support@example.com');
  });

  it('produces no diagnostics for valid access block', () => {
    const source = `
access:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomOrder.ShopperId
          - Account.ContactName
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    const errors = diagnostics.filter(
      d => d.code !== 'unknown-block' && d.code !== 'syntax-error'
    );
    expect(errors).toHaveLength(0);
  });

  it('emits and re-parses access block (roundtrip)', () => {
    const source = `
access:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomOrder.ShopperId
`.trimStart();

    const ast = parseDocument(source);
    const emitted = emitDocument(ast);

    const ast2 = parseDocument(emitted);
    const access2 = ast2.access!;

    expect(access2.__kind).toBe('AccessBlock');

    const vcra2 = access2.verified_customer_record_access!;
    expect(vcra2.__kind).toBe('VerifiedCustomerRecordAccessBlock');
    expect(vcra2.use_default_objects!.value).toBe(true);

    const additionalObjects2 = vcra2.additional_objects as SequenceNode;
    expect(additionalObjects2.items).toHaveLength(1);
    expect(additionalObjects2.items[0].__kind).toBe('MemberExpression');
  });
});

// ============================================================================
// default_agent_user backwards-compat: config (deprecated) vs. access
// ============================================================================

describe('default_agent_user placement', () => {
  it('parses default_agent_user in access block', () => {
    const source = `
config:
    developer_name: "agent"

access:
    default_agent_user: "digitalagent@example.com"
`.trimStart();

    const ast = parseDocument(source);
    expect(ast.access!.default_agent_user!.value).toBe(
      'digitalagent@example.com'
    );
  });

  it('emits a deprecation warning for default_agent_user in config block', () => {
    const source = `
config:
    developer_name: "agent"
    default_agent_user: "digitalagent@example.com"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    const deprecations = diagnostics.filter(d => d.code === 'deprecated-field');
    const dau = deprecations.find(d =>
      d.message.includes('default_agent_user')
    );
    expect(dau).toBeDefined();
    expect(dau!.message).toContain(
      'Property default_agent_user has moved from config to access.'
    );
    expect(dau!.message).toContain('Move field to access block.');
  });

  it('emits no deprecation warning when default_agent_user is in access block', () => {
    const source = `
config:
    developer_name: "agent"

access:
    default_agent_user: "digitalagent@example.com"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    const deprecations = diagnostics.filter(
      d =>
        d.code === 'deprecated-field' &&
        d.message.includes('default_agent_user')
    );
    expect(deprecations).toHaveLength(0);
  });

  it('warns that access.default_agent_user wins when both are set', () => {
    const source = `
config:
    developer_name: "agent"
    default_agent_user: "old@example.com"

access:
    default_agent_user: "new@example.com"
`.trimStart();

    const diagnostics = runLint(source);
    const conflicts = diagnostics.filter(
      d => d.code === 'config-default-agent-user-conflict'
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].message).toContain('access.default_agent_user');
  });
});

// ============================================================================
// default_agent_user nullability — `None` only valid for AgentforceEmployeeAgent
// ============================================================================

describe('default_agent_user None handling', () => {
  it('parses default_agent_user: None in access block', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    default_agent_user: None
`.trimStart();

    const ast = parseDocument(source);
    const dau = ast.access!.default_agent_user!;
    expect(dau.__kind).toBe('NoneLiteral');
  });

  it('parses default_agent_user: None in config block', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"
    default_agent_user: None
`.trimStart();

    const ast = parseDocument(source);
    const dau = (ast.config as Record<string, unknown>).default_agent_user as {
      __kind: string;
    };
    expect(dau.__kind).toBe('NoneLiteral');
  });

  it('produces no error for None on AgentforceEmployeeAgent', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    default_agent_user: None
`.trimStart();

    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'config-invalid-default-agent-user-none'
    );
    expect(errors).toHaveLength(0);
  });

  it('errors when None is used with AgentforceServiceAgent', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceServiceAgent"

access:
    default_agent_user: None
`.trimStart();

    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'config-invalid-default-agent-user-none'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('AgentforceEmployeeAgent');
  });

  it('errors when None is used with no agent_type', () => {
    const source = `
config:
    developer_name: "agent"

access:
    default_agent_user: None
`.trimStart();

    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'config-invalid-default-agent-user-none'
    );
    expect(errors).toHaveLength(1);
  });

  it('errors when None is set in legacy config block on a non-employee agent', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: None
`.trimStart();

    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'config-invalid-default-agent-user-none'
    );
    expect(errors).toHaveLength(1);
  });

  it('errors when AgentforceServiceAgent has no default_agent_user (None counts as missing)', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceServiceAgent"

access:
    default_agent_user: None
`.trimStart();

    const diagnostics = runLint(source);
    const missing = diagnostics.filter(
      d => d.code === 'config-missing-default-agent-user'
    );
    expect(missing.length).toBeGreaterThanOrEqual(1);
  });

  it('lints clean when AgentforceEmployeeAgent omits default_agent_user entirely', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"
`.trimStart();

    const diagnostics = runLint(source);
    const dauDiags = diagnostics.filter(
      d =>
        d.code === 'config-missing-default-agent-user' ||
        d.code === 'config-invalid-default-agent-user-none'
    );
    expect(dauDiags).toHaveLength(0);
  });

  it('lints clean when AgentforceEmployeeAgent has neither config nor access blocks setting default_agent_user', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    sharing_policy:
        use_default_sharing_entities: True
`.trimStart();

    const diagnostics = runLint(source);
    const dauDiags = diagnostics.filter(
      d =>
        d.code === 'config-missing-default-agent-user' ||
        d.code === 'config-invalid-default-agent-user-none'
    );
    expect(dauDiags).toHaveLength(0);
  });
});

// ============================================================================
// AgentforceEmployeeAgent restrictions on access sub-blocks
// ============================================================================

describe('AgentforceEmployeeAgent access field restrictions', () => {
  it('errors when sharing_policy is set for AgentforceEmployeeAgent', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    sharing_policy:
        use_default_sharing_entities: True
`.trimStart();

    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'access-sharing-policy-not-allowed'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('AgentforceEmployeeAgent');
  });

  it('errors when verified_customer_record_access is set for AgentforceEmployeeAgent', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    verified_customer_record_access:
        use_default_objects: True
`.trimStart();

    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'access-verified-customer-record-access-not-allowed'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('AgentforceEmployeeAgent');
  });

  it('errors twice when both restricted fields are set', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    sharing_policy:
        use_default_sharing_entities: True
    verified_customer_record_access:
        use_default_objects: True
`.trimStart();

    const diagnostics = runLint(source);
    const restricted = diagnostics.filter(
      d =>
        d.code === 'access-sharing-policy-not-allowed' ||
        d.code === 'access-verified-customer-record-access-not-allowed'
    );
    expect(restricted).toHaveLength(2);
  });

  it('produces no restriction errors for AgentforceEmployeeAgent without those fields', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceEmployeeAgent"

access:
    default_agent_user: "support@example.com"
`.trimStart();

    const diagnostics = runLint(source);
    const restricted = diagnostics.filter(
      d =>
        d.code === 'access-sharing-policy-not-allowed' ||
        d.code === 'access-verified-customer-record-access-not-allowed'
    );
    expect(restricted).toHaveLength(0);
  });

  it('does not error when AgentforceServiceAgent uses these fields', () => {
    const source = `
config:
    developer_name: "agent"
    agent_type: "AgentforceServiceAgent"

access:
    default_agent_user: "support@example.com"
    sharing_policy:
        use_default_sharing_entities: True
    verified_customer_record_access:
        use_default_objects: True
`.trimStart();

    const diagnostics = runLint(source);
    const restricted = diagnostics.filter(
      d =>
        d.code === 'access-sharing-policy-not-allowed' ||
        d.code === 'access-verified-customer-record-access-not-allowed'
    );
    expect(restricted).toHaveLength(0);
  });

  it('does not error when agent_type is unset', () => {
    const source = `
config:
    developer_name: "agent"

access:
    sharing_policy:
        use_default_sharing_entities: True
    verified_customer_record_access:
        use_default_objects: True
`.trimStart();

    const diagnostics = runLint(source);
    const restricted = diagnostics.filter(
      d =>
        d.code === 'access-sharing-policy-not-allowed' ||
        d.code === 'access-verified-customer-record-access-not-allowed'
    );
    expect(restricted).toHaveLength(0);
  });
});
