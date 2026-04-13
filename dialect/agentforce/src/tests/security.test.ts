/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { SequenceNode, isNamedMap } from '@agentscript/language';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
} from './test-utils.js';

// ============================================================================
// Security block parsing (nested inside topic)
// ============================================================================

describe('security block', () => {
  const fullSecuritySource = `
topic SecureTopic:
    security:
        sharing_policy:
            use_default_sharing_entities: True
            custom_sharing_entities:
              - "entity_a"
              - "entity_b"
`.trimStart();

  it('parses a full security block within a topic', () => {
    const ast = parseDocument(fullSecuritySource);
    const topic = ast.topic!;
    expect(isNamedMap(topic)).toBe(true);
    expect(topic.has('SecureTopic')).toBe(true);

    const topicEntry = topic.get('SecureTopic')!;
    const security = topicEntry.security!;
    expect(security).toBeDefined();
    expect(security.__kind).toBe('SecurityBlock');

    const sharingPolicy = security.sharing_policy!;
    expect(sharingPolicy).toBeDefined();
    expect(sharingPolicy.__kind).toBe('SharingPolicyBlock');

    const useDefault = sharingPolicy.use_default_sharing_entities!;
    expect(useDefault.__kind).toBe('BooleanValue');
    expect(useDefault.value).toBe(true);
  });

  it('parses custom_sharing_entities as an ExpressionSequence', () => {
    const ast = parseDocument(fullSecuritySource);
    const topic = ast.topic!;
    const topicEntry = topic.get('SecureTopic')!;
    const security = topicEntry.security!;
    const sharingPolicy = security.sharing_policy!;

    const entities = sharingPolicy.custom_sharing_entities as SequenceNode;
    expect(entities.__kind).toBe('Sequence');
    expect(entities.items).toHaveLength(2);

    expect(entities.items[0].__kind).toBe('StringLiteral');
    expect(
      (entities.items[0] as unknown as Record<string, unknown>).value
    ).toBe('entity_a');

    expect(entities.items[1].__kind).toBe('StringLiteral');
    expect(
      (entities.items[1] as unknown as Record<string, unknown>).value
    ).toBe('entity_b');
  });

  it('produces no diagnostics for valid security block', () => {
    const { diagnostics } = parseWithDiagnostics(fullSecuritySource);
    const errors = diagnostics.filter(
      d =>
        d.code !== 'unknown-block' &&
        d.code !== 'syntax-error' &&
        d.code !== 'deprecated-field'
    );
    expect(errors).toHaveLength(0);
  });

  it('emits and re-parses a security block (roundtrip)', () => {
    const ast = parseDocument(fullSecuritySource);
    const emitted = emitDocument(ast);

    const ast2 = parseDocument(emitted);
    const topic2 = ast2.topic!;
    expect(topic2.has('SecureTopic')).toBe(true);

    const topicEntry2 = topic2.get('SecureTopic')!;
    const security2 = topicEntry2.security!;
    expect(security2.__kind).toBe('SecurityBlock');

    const sharingPolicy2 = security2.sharing_policy!;
    expect(sharingPolicy2.__kind).toBe('SharingPolicyBlock');

    const useDefault2 = sharingPolicy2.use_default_sharing_entities!;
    expect(useDefault2.value).toBe(true);

    const entities2 = sharingPolicy2.custom_sharing_entities as SequenceNode;
    expect(entities2.items).toHaveLength(2);
    expect(entities2.items[0].__kind).toBe('StringLiteral');
    expect(entities2.items[1].__kind).toBe('StringLiteral');
  });
});

describe('minimal security block', () => {
  it('parses a security block with only use_default_sharing_entities', () => {
    const source = `
topic MinTopic:
    security:
        sharing_policy:
            use_default_sharing_entities: False
`;
    const ast = parseDocument(source);
    const topic = ast.topic!;
    const topicEntry = topic.get('MinTopic')!;
    const security = topicEntry.security!;
    const sharingPolicy = security.sharing_policy!;

    const useDefault = sharingPolicy.use_default_sharing_entities!;
    expect(useDefault.__kind).toBe('BooleanValue');
    expect(useDefault.value).toBe(false);
  });

  it('parses an empty security block', () => {
    const source = `
topic EmptySecTopic:
    security:
        sharing_policy:
`;
    const ast = parseDocument(source);
    const topic = ast.topic!;
    const topicEntry = topic.get('EmptySecTopic')!;
    const security = topicEntry.security!;
    expect(security).toBeDefined();
    expect(security.__kind).toBe('SecurityBlock');
  });
});

// ============================================================================
// Top-level security block for contactId filtering
// ============================================================================

describe('verified_customer_record_access (top-level security)', () => {
  it('parses security block with use_default_objects: True', () => {
    const source = `
security:
    verified_customer_record_access:
        use_default_objects: True
`.trimStart();

    const ast = parseDocument(source);
    const security = ast.security!;

    expect(security).toBeDefined();
    expect(security.__kind).toBe('SecurityBlock');

    const vcra = security.verified_customer_record_access!;
    expect(vcra).toBeDefined();
    expect(vcra.__kind).toBe('VerifiedCustomerRecordAccessBlock');

    const useDefault = vcra.use_default_objects!;
    expect(useDefault.__kind).toBe('BooleanValue');
    expect(useDefault.value).toBe(true);
  });

  it('parses security block with use_default_objects: False', () => {
    const source = `
security:
    verified_customer_record_access:
        use_default_objects: False
`.trimStart();

    const ast = parseDocument(source);
    const security = ast.security!;
    const vcra = security.verified_customer_record_access!;

    const useDefault = vcra.use_default_objects!;
    expect(useDefault.__kind).toBe('BooleanValue');
    expect(useDefault.value).toBe(false);
  });

  it('parses security block with additional_objects', () => {
    const source = `
security:
    verified_customer_record_access:
        use_default_objects: False
        additional_objects:
          - CustomOrder.ShopperId
          - Account.ContactName
`.trimStart();

    const ast = parseDocument(source);
    const security = ast.security!;
    const vcra = security.verified_customer_record_access!;

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

  it('parses security block with use_default_objects and additional_objects', () => {
    const source = `
security:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomEntity.ContactRef
`.trimStart();

    const ast = parseDocument(source);
    const security = ast.security!;
    const vcra = security.verified_customer_record_access!;

    expect(vcra.use_default_objects!.value).toBe(true);

    const additionalObjects = vcra.additional_objects as SequenceNode;
    expect(additionalObjects.__kind).toBe('Sequence');
    expect(additionalObjects.items).toHaveLength(1);
    expect(additionalObjects.items[0].__kind).toBe('MemberExpression');
  });

  it('parses security block within complete agent definition', () => {
    const source = `
config:
    description: "Customer service agent"

security:
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
    expect(ast.security).toBeDefined();
    expect(ast.system).toBeDefined();
    expect(ast.start_agent).toBeDefined();

    const security = ast.security!;
    const vcra = security.verified_customer_record_access!;

    expect(vcra.use_default_objects!.value).toBe(true);

    const additionalObjects = vcra.additional_objects as SequenceNode;
    expect(additionalObjects.items).toHaveLength(1);
  });

  it('produces no diagnostics for valid security block', () => {
    const source = `
security:
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

  it('emits and re-parses security block (roundtrip)', () => {
    const source = `
security:
    verified_customer_record_access:
        use_default_objects: True
        additional_objects:
          - CustomOrder.ShopperId
`.trimStart();

    const ast = parseDocument(source);
    const emitted = emitDocument(ast);

    const ast2 = parseDocument(emitted);
    const security2 = ast2.security!;

    expect(security2.__kind).toBe('SecurityBlock');

    const vcra2 = security2.verified_customer_record_access!;
    expect(vcra2.__kind).toBe('VerifiedCustomerRecordAccessBlock');
    expect(vcra2.use_default_objects!.value).toBe(true);

    const additionalObjects2 = vcra2.additional_objects as SequenceNode;
    expect(additionalObjects2.items).toHaveLength(1);
    expect(additionalObjects2.items[0].__kind).toBe('MemberExpression');
  });
});
