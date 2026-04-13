/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BooleanValue,
  StringValue,
  FieldBuilder,
  isNamedMap,
} from '@agentscript/language';
import type { NamedBlockFactory, Schema } from '@agentscript/language';
import { describe, test, it, expect } from 'vitest';
import { ConnectionBlock } from '../schema.js';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
} from './test-utils.js';

const factory = ConnectionBlock as unknown as NamedBlockFactory<Schema>;
const SCHEMA_FIELDS = [
  'adaptive_response_allowed',
  'escalation_message',
  'instructions',
  'outbound_route_type',
  'outbound_route_name',
  'response_actions',
];

describe('ConnectionBlock schema', () => {
  test('has correct static kind', () => {
    expect(factory.kind).toBe('ConnectionBlock');
  });

  test('is a named block', () => {
    expect(factory.isNamed).toBe(true);
  });

  test('schema contains all expected fields', () => {
    const schemaKeys = Object.keys(factory.schema!);

    for (const field of SCHEMA_FIELDS) {
      expect(schemaKeys, `missing field: ${field}`).toContain(field);
    }
  });

  test('scalar fields have correct underlying types', () => {
    const schema = factory.schema as Record<string, FieldBuilder>;

    expect(schema.adaptive_response_allowed).toBeInstanceOf(FieldBuilder);
    expect(schema.adaptive_response_allowed.__fieldKind).toBe(
      BooleanValue.__fieldKind
    );
    expect(schema.escalation_message).toBeInstanceOf(FieldBuilder);
    expect(schema.escalation_message.__fieldKind).toBe(StringValue.__fieldKind);
    expect(schema.instructions).toBeInstanceOf(FieldBuilder);
    expect(schema.instructions.__fieldKind).toBe(StringValue.__fieldKind);
    expect(schema.outbound_route_type).toBeInstanceOf(FieldBuilder);
    expect(schema.outbound_route_type.__fieldKind).toBe(
      StringValue.__fieldKind
    );
    expect(schema.outbound_route_name).toBeInstanceOf(FieldBuilder);
    expect(schema.outbound_route_name.__fieldKind).toBe(
      StringValue.__fieldKind
    );
  });

  test('response_actions is a collection block field', () => {
    const responseActions = factory.schema
      .response_actions as unknown as Record<string, unknown>;
    expect(responseActions.__isCollection).toBe(true);
  });
});

function getConnection(source: string, name: string): Record<string, unknown> {
  const ast = parseDocument(source);
  const connection = ast.connection!;
  expect(isNamedMap(connection)).toBe(true);
  expect(connection.has(name)).toBe(true);
  return connection.get(name) as unknown as Record<string, unknown>;
}

function getLiteralValue(
  block: Record<string, unknown>,
  field: string
): unknown {
  return (block[field] as Record<string, unknown>).value;
}

// ============================================================================
// Telephony connection block parsing
// ============================================================================

describe('telephony connection block', () => {
  const telephonySource = `
connection telephony:
    escalation_message: "Transfer to phone support"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://phone_route"
    adaptive_response_allowed: True
`.trimStart();

  it('parses a telephony connection block', () => {
    const telephony = getConnection(telephonySource, 'telephony');
    expect(telephony.__kind).toBe('ConnectionBlock');
    expect(getLiteralValue(telephony, 'escalation_message')).toBe(
      'Transfer to phone support'
    );
    expect(getLiteralValue(telephony, 'outbound_route_type')).toBe(
      'OmniChannelFlow'
    );
    expect(getLiteralValue(telephony, 'outbound_route_name')).toBe(
      'flow://phone_route'
    );
    expect(getLiteralValue(telephony, 'adaptive_response_allowed')).toBe(true);
  });

  it('produces no diagnostics for valid telephony connection', () => {
    const { diagnostics } = parseWithDiagnostics(telephonySource);
    expect(diagnostics).toHaveLength(0);
  });

  it('emits and re-parses a telephony connection (roundtrip)', () => {
    const ast = parseDocument(telephonySource);
    const emitted = emitDocument(ast);

    const telephony = getConnection(emitted, 'telephony');
    expect(getLiteralValue(telephony, 'outbound_route_name')).toBe(
      'flow://phone_route'
    );
    expect(getLiteralValue(telephony, 'adaptive_response_allowed')).toBe(true);
  });
});

// ============================================================================
// Multiple connections: messaging + telephony
// ============================================================================

describe('multiple connection types', () => {
  const multiConnectionSource = `
connection messaging:
    escalation_message: "Connecting to chat"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://chat_route"
    adaptive_response_allowed: True

connection telephony:
    escalation_message: "Connecting to phone"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://phone_route"
    adaptive_response_allowed: False
`.trimStart();

  it('parses both messaging and telephony connections', () => {
    const messaging = getConnection(multiConnectionSource, 'messaging');
    expect(messaging.__kind).toBe('ConnectionBlock');
    expect(getLiteralValue(messaging, 'escalation_message')).toBe(
      'Connecting to chat'
    );

    const telephony = getConnection(multiConnectionSource, 'telephony');
    expect(telephony.__kind).toBe('ConnectionBlock');
    expect(getLiteralValue(telephony, 'escalation_message')).toBe(
      'Connecting to phone'
    );
  });

  it('produces no diagnostics for multiple connections', () => {
    const { diagnostics } = parseWithDiagnostics(multiConnectionSource);
    expect(diagnostics).toHaveLength(0);
  });

  it('roundtrips both messaging and telephony connections', () => {
    const ast = parseDocument(multiConnectionSource);
    const emitted = emitDocument(ast);

    const messaging = getConnection(emitted, 'messaging');
    const telephony = getConnection(emitted, 'telephony');

    expect(getLiteralValue(messaging, 'outbound_route_name')).toBe(
      'flow://chat_route'
    );
    expect(getLiteralValue(telephony, 'outbound_route_name')).toBe(
      'flow://phone_route'
    );
    expect(getLiteralValue(telephony, 'adaptive_response_allowed')).toBe(false);
  });
});

// ============================================================================
// Minimal telephony connection
// ============================================================================

describe('minimal telephony connection', () => {
  it('parses telephony connection with minimal fields', () => {
    const source = `
connection telephony:
    escalation_message: "Transferring to phone support"
`.trimStart();

    const telephony = getConnection(source, 'telephony');
    expect(getLiteralValue(telephony, 'escalation_message')).toBe(
      'Transferring to phone support'
    );
  });

  it('parses empty telephony connection (no fields)', () => {
    const source = 'connection telephony:\n';
    const { diagnostics } = parseWithDiagnostics(source);
    expect(diagnostics).toHaveLength(0);

    const telephony = getConnection(source, 'telephony');
    expect(telephony.__kind).toBe('ConnectionBlock');
  });
});
