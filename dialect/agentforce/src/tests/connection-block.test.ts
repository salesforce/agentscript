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
  LintEngine,
  collectDiagnostics,
} from '@agentscript/language';
import type { NamedBlockFactory, Schema } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { describe, test, it, expect } from 'vitest';
import { ConnectionBlock } from '../schema.js';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  testSchemaCtx,
} from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

const factory = ConnectionBlock as unknown as NamedBlockFactory<Schema>;
const SCHEMA_FIELDS = [
  'label',
  'description',
  'inputs',
  'reasoning',
  'response_formats',
  // Legacy fields
  'adaptive_response_allowed',
  'escalation_message',
  'outbound_route_type',
  'outbound_route_name',
];

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  const { diagnostics: lintDiags } = engine.run(ast, testSchemaCtx);
  const astDiags = collectDiagnostics(ast);
  return [...astDiags, ...lintDiags];
}

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

    // New fields
    expect(schema.label).toBeInstanceOf(FieldBuilder);
    expect(schema.label.__fieldKind).toBe(StringValue.__fieldKind);
    expect(schema.description).toBeInstanceOf(FieldBuilder);
    expect(schema.description.__fieldKind).toBe(StringValue.__fieldKind);

    // Legacy fields
    expect(schema.adaptive_response_allowed).toBeInstanceOf(FieldBuilder);
    expect(schema.adaptive_response_allowed.__fieldKind).toBe(
      BooleanValue.__fieldKind
    );
    expect(schema.escalation_message).toBeInstanceOf(FieldBuilder);
    expect(schema.escalation_message.__fieldKind).toBe(StringValue.__fieldKind);
    expect(schema.outbound_route_type).toBeInstanceOf(FieldBuilder);
    expect(schema.outbound_route_type.__fieldKind).toBe(
      StringValue.__fieldKind
    );
    expect(schema.outbound_route_name).toBeInstanceOf(FieldBuilder);
    expect(schema.outbound_route_name.__fieldKind).toBe(
      StringValue.__fieldKind
    );
  });

  test('response_formats is a collection block field', () => {
    const responseFormats = factory.schema
      .response_formats as unknown as Record<string, unknown>;
    expect(responseFormats.__isCollection).toBe(true);
  });

  test('inputs is defined at connection level', () => {
    const inputs = factory.schema.inputs as unknown as Record<string, unknown>;
    expect(inputs).toBeDefined();
    expect(inputs.__fieldKind).toBe('TypedMap');
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

// ============================================================================
// Connection with inputs
// ============================================================================

describe('connection with inputs', () => {
  const connectionWithInputsSource = `
connection messaging:
    escalation_message: "Houston we have a problem. -- {!@variables.signature}"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://Route_to_ELL_Agent"

    inputs:
        legal_disclosure: string = "this is a disclosure"
            description: "Legal disclosure message"
        signature: string = "ciao"
            description: "Signature text"
`.trimStart();

  it('parses connection block with inputs', () => {
    const messaging = getConnection(connectionWithInputsSource, 'messaging');
    expect(messaging.__kind).toBe('ConnectionBlock');
    expect(getLiteralValue(messaging, 'escalation_message')).toContain(
      'Houston we have a problem'
    );
    expect(getLiteralValue(messaging, 'outbound_route_type')).toBe(
      'OmniChannelFlow'
    );
    expect(getLiteralValue(messaging, 'outbound_route_name')).toBe(
      'flow://Route_to_ELL_Agent'
    );

    const inputs = messaging.inputs;
    expect(isNamedMap(inputs)).toBe(true);
    if (isNamedMap(inputs)) {
      expect(inputs.has('legal_disclosure')).toBe(true);
      expect(inputs.has('signature')).toBe(true);
    }
  });

  it('produces no diagnostics for connection with inputs', () => {
    const { diagnostics } = parseWithDiagnostics(connectionWithInputsSource);
    expect(diagnostics).toHaveLength(0);
  });

  it('roundtrips connection with inputs', () => {
    const ast = parseDocument(connectionWithInputsSource);
    const emitted = emitDocument(ast);

    const messaging = getConnection(emitted, 'messaging');
    expect(getLiteralValue(messaging, 'outbound_route_name')).toBe(
      'flow://Route_to_ELL_Agent'
    );

    const inputs = messaging.inputs;
    expect(isNamedMap(inputs)).toBe(true);
    if (isNamedMap(inputs)) {
      expect(inputs.has('legal_disclosure')).toBe(true);
      expect(inputs.has('signature')).toBe(true);
    }
  });

  it('rejects invalid properties on connection inputs', () => {
    const invalidSource = `
connection messaging:
    inputs:
            legal_disclosure: string = "test"
                description: "Legal disclosure"
                is_required: True
                is_user_input: True
                label: "Label"
                schema: "schema://test"
`.trimStart();

    const diagnostics = runLint(invalidSource);
    expect(diagnostics.length).toBeGreaterThan(0);

    // Check for connection-input-invalid-property errors
    const propertyErrors = diagnostics.filter(
      d => d.code === 'connection-input-invalid-property'
    );
    expect(propertyErrors.length).toBeGreaterThan(0);

    // Should report errors for is_required, is_user_input, label, schema
    const errorMessages = propertyErrors.map(d => d.message).join(' ');
    expect(errorMessages).toContain('is_required');
    expect(errorMessages).toContain('is_user_input');
    expect(errorMessages).toContain('label');
    expect(errorMessages).toContain('schema');
  });

  it('allows only description property on connection inputs', () => {
    const validSource = `
connection messaging:
    inputs:
            legal_disclosure: string = "test"
                description: "Legal disclosure"
`.trimStart();

    const diagnostics = runLint(validSource);
    // Should have no connection-input-invalid-property errors
    const propertyErrors = diagnostics.filter(
      d => d.code === 'connection-input-invalid-property'
    );
    expect(propertyErrors).toHaveLength(0);
  });

  it('allows only string, number, and boolean types for connection inputs', () => {
    const validSource = `
connection messaging:
    inputs:
            name: string = "test"
                description: "A string field"
            age: number = 25
                description: "A number field"
            active: boolean = True
                description: "A boolean field"
`.trimStart();

    const diagnostics = runLint(validSource);
    // Should have no connection-input-invalid-type errors
    const typeErrors = diagnostics.filter(
      d => d.code === 'connection-input-invalid-type'
    );
    expect(typeErrors).toHaveLength(0);
  });

  it('rejects invalid types for connection inputs', () => {
    const invalidSource = `
connection messaging:
    inputs:
            metadata: object
                description: "An object field"
            created: date
                description: "A date field"
            items: list[string]
                description: "A list field"
`.trimStart();

    const diagnostics = runLint(invalidSource);
    expect(diagnostics.length).toBeGreaterThan(0);

    // Check for connection-input-invalid-type errors
    const typeErrors = diagnostics.filter(
      d => d.code === 'connection-input-invalid-type'
    );
    expect(typeErrors.length).toBeGreaterThan(0);

    // Should report errors for object, date, and list types
    const errorMessages = typeErrors.map(d => d.message).join(' ');
    expect(errorMessages).toContain('object');
    expect(errorMessages).toContain('date');
    expect(errorMessages).toContain('list');

    // Verify error messages include supported types dynamically
    expect(errorMessages).toContain('Supported types: string, number, boolean');
  });

  it('error messages include dynamic allowed values', () => {
    const invalidSource = `
connection messaging:
    inputs:
            test: object
                description: "test"
                is_required: True
`.trimStart();

    const diagnostics = runLint(invalidSource);

    // Check type error message
    const typeError = diagnostics.find(
      d => d.code === 'connection-input-invalid-type'
    );
    expect(typeError).toBeDefined();
    expect(typeError?.message).toContain(
      'Supported types: string, number, boolean'
    );

    // Check property error message
    const propError = diagnostics.find(
      d => d.code === 'connection-input-invalid-property'
    );
    expect(propError).toBeDefined();
    expect(propError?.message).toContain('Supported properties: description');
  });

  it('parses connection with boolean input type', () => {
    const source = `
connection messaging:
    escalation_message: "Escalating to agent"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://AgentRoute"

    inputs:
            is_verified_user: boolean = False
                description: "Whether the user has been verified"
            enable_rich_formatting: boolean = True
                description: "Enable rich message formatting"
            conversation_count: number = 0
                description: "Number of previous conversations"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    expect(diagnostics).toHaveLength(0);

    const messaging = getConnection(source, 'messaging');
    const inputs = messaging.inputs;
    expect(isNamedMap(inputs)).toBe(true);

    if (isNamedMap(inputs)) {
      expect(inputs.has('is_verified_user')).toBe(true);
      expect(inputs.has('enable_rich_formatting')).toBe(true);
      expect(inputs.has('conversation_count')).toBe(true);

      const isVerified = inputs.get('is_verified_user') as Record<
        string,
        unknown
      >;
      expect(isVerified).toBeDefined();
      const defaultValue = isVerified.defaultValue as Record<string, unknown>;
      expect(defaultValue.value).toBe(false);

      const enableFormatting = inputs.get('enable_rich_formatting') as Record<
        string,
        unknown
      >;
      const formattingDefault = enableFormatting.defaultValue as Record<
        string,
        unknown
      >;
      expect(formattingDefault.value).toBe(true);
    }
  });
});

// ============================================================================
// Response formats validation
// ============================================================================

describe('response_formats validation', () => {
  it('allows response_format with source only', () => {
    const validSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            source: "SurfaceAction__MessagingChoices"
`.trimStart();

    const diagnostics = runLint(validSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-missing-required-field'
    );
    expect(formatErrors).toHaveLength(0);
  });

  it('allows response_format with target and inputs', () => {
    const validSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            target: "apex://MyApexClass"
            inputs:
                field: string
`.trimStart();

    const diagnostics = runLint(validSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-missing-required-field'
    );
    expect(formatErrors).toHaveLength(0);
  });

  it('allows response_format with target only', () => {
    const validSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            target: "apex://MyApexClass"
`.trimStart();

    const diagnostics = runLint(validSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-missing-required-field'
    );
    expect(formatErrors).toHaveLength(0);
  });

  it('allows response_format with inputs only', () => {
    const validSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            inputs:
                field: string
`.trimStart();

    const diagnostics = runLint(validSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-missing-required-field'
    );
    expect(formatErrors).toHaveLength(0);
  });

  it('errors when response_format has no source, inputs, or target', () => {
    const invalidSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            description: "Some description"
`.trimStart();

    const diagnostics = runLint(invalidSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-missing-required-field'
    );
    expect(formatErrors.length).toBeGreaterThan(0);
    expect(formatErrors[0].message).toContain('my_format');
    expect(formatErrors[0].message).toContain('source');
    expect(formatErrors[0].message).toContain('inputs');
    expect(formatErrors[0].message).toContain('target');
  });

  it('errors for multiple response_formats missing required fields', () => {
    const invalidSource = `
connection messaging:
    response_formats:
        format1:
            label: "Format 1"
        format2:
            label: "Format 2"
        format3:
            label: "Format 3"
            source: "SurfaceAction__Valid"
`.trimStart();

    const diagnostics = runLint(invalidSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-missing-required-field'
    );
    // Should have errors for format1 and format2, but not format3
    expect(formatErrors.length).toBeGreaterThanOrEqual(2);
    const errorMessages = formatErrors.map(d => d.message).join(' ');
    expect(errorMessages).toContain('format1');
    expect(errorMessages).toContain('format2');
    expect(errorMessages).not.toContain('format3');
  });

  it('errors when response_format has both source and inputs (XOR violation)', () => {
    const invalidSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            source: "SurfaceAction__MessagingChoices"
            inputs:
                field: string
`.trimStart();

    const diagnostics = runLint(invalidSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-conflicting-fields'
    );
    expect(formatErrors.length).toBeGreaterThan(0);
    expect(formatErrors[0].message).toContain('my_format');
    expect(formatErrors[0].message).toContain('source');
    expect(formatErrors[0].message).toContain('inputs');
  });

  it('errors when response_format has both source and target (XOR violation)', () => {
    const invalidSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            source: "SurfaceAction__MessagingChoices"
            target: "apex://MyApexClass"
`.trimStart();

    const diagnostics = runLint(invalidSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-conflicting-fields'
    );
    expect(formatErrors.length).toBeGreaterThan(0);
    expect(formatErrors[0].message).toContain('my_format');
    expect(formatErrors[0].message).toContain('source');
    expect(formatErrors[0].message).toContain('target');
  });

  it('errors when response_format has source, inputs, and target (XOR violation)', () => {
    const invalidSource = `
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            source: "SurfaceAction__MessagingChoices"
            target: "apex://MyApexClass"
            inputs:
                field: string
`.trimStart();

    const diagnostics = runLint(invalidSource);
    const formatErrors = diagnostics.filter(
      d => d.code === 'response-format-conflicting-fields'
    );
    expect(formatErrors.length).toBeGreaterThan(0);
    expect(formatErrors[0].message).toContain('my_format');
    expect(formatErrors[0].message).toContain('source');
  });

  it('accepts reasoning.response_actions binding names in @response_actions references', () => {
    const source = `
connection messaging:
    reasoning:
        response_actions:
            penguins: @response_formats.penguins_2

        instructions: ->
            | Use {!@response_actions.penguins} when discussing penguins

    response_formats:
        penguins_2:
            label: "Penguin Format"
            source: "SurfaceAction__Penguins"
`.trimStart();

    const diagnostics = runLint(source);
    const refErrors = diagnostics.filter(d =>
      d.message.includes('is not defined in response_actions')
    );
    expect(refErrors).toHaveLength(0);
  });

  it('suggests reasoning.response_actions aliases when @response_actions reference is invalid', () => {
    const source = `
connection messaging:
    reasoning:
        response_actions:
            my_choice: @response_formats.messaging_choices

        instructions: |
            Use {!@response_actions.my_wrong_choice}

    response_formats:
        messaging_choices:
            label: "Choices"
            source: "SurfaceAction__Choices"
`.trimStart();

    const diagnostics = runLint(source);
    const refError = diagnostics.find(d =>
      d.message.includes("'my_wrong_choice' is not defined in response_actions")
    );
    expect(refError).toBeDefined();
    // Error is generated for invalid reference
    expect(refError?.message).toContain('my_wrong_choice');
  });
});
