import { describe, it, expect } from 'vitest';
import { isNamedMap } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { parseDocument, parseWithDiagnostics } from './test-utils.js';

describe('connection syntax with inputs', () => {
  const settingsInputsSource = `
connection messaging:
    inputs:
        # (context) variables defined by surface owners, set by API
        legal_disclosure: string = "this is a disclosure"
            description: "Legal disclosure message"
        signature: string = "ciao"
            description: "Signature text"

    label: "Messaging Connection"
    description: "This connection is used to apply output formatting to responses using Messaging channels."

    escalation_message: "Houston we have a problem"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://300SB00000pKnC5YAK"

    # appends to the global system instructions
    additional_system_instructions: ->
        | Ignore signatures, disclaimers, and quoted history when interpreting email input.
          Use recipient name if provided; otherwise use a generic greeting.
          Focus reasoning only on the newest message in the thread.

    reasoning:
        instructions: ->
            | Connection-level instructions, such as 'do not use any response formats if the response contains alpaca.'
              For the tool messaging_rich_links_special_surprise, use {!@variables.channel_name} as the title
              For the tool custom_formatting_alpaca_v3, if you choose to use it, create two bullet points at most
              Always append "status={!@variables.VerifiedUser}" at the end of the response

        # non-deterministic: available formats for LLM to pick
        response_actions:
            messaging_choices_penguins: @response_formats.messaging_choices_penguins
            messaging_rich_link: @response_formats.messaging_rich_link
            messaging_rich_links_2: @response_formats.messaging_rich_links_special_surprise
            custom_formatting_alpaca: @response_formats.custom_formatting_alpaca_v3

    # defines format metadata
    response_formats:
        # an existing format: no change to the formatting schema, but with changes to instructions
        messaging_choices_penguins:
            description: "description of this format"
            source: "SurfaceAction__MessagingChoices"

        # an existing format: no change (file-based)
        messaging_rich_link:
            source: "SurfaceAction__MessagingRichLink"

        # custom response format: changes to schema, instructions, and target
        messaging_rich_links_special_surprise:
            description: "description of this format"
            target: "apex://MessagingLinksButSpecial"
            inputs:
                field: string

        # another custom response format: changes to schema, instructions, and target
        custom_formatting_alpaca_v3:
            description: "a response format with alpacas"
            target: "apex://SomeApexDevName"
            inputs:
                cardTitle: string
                    is_required: true

        restricted_no_permission_card:
            description: "a response format to show permission denied."
            target: "apex://SomeApexDevName"
            inputs:
                warning: string
`.trimStart();

  it('parses connection with inputs and connection-level routing', () => {
    const ast = parseDocument(settingsInputsSource);
    const connection = ast.connection;
    expect(isNamedMap(connection)).toBe(true);
    expect(connection!.has('messaging')).toBe(true);

    const messaging = connection!.get('messaging') as Record<string, unknown>;
    expect(messaging.__kind).toBe('ConnectionBlock');

    // Check inputs at connection level
    const inputs = messaging.inputs as Map<string, unknown>;
    expect(isNamedMap(inputs)).toBe(true);
    expect(inputs.has('legal_disclosure')).toBe(true);

    // Check routing at connection level
    expect(
      (messaging.escalation_message as Record<string, unknown>).value
    ).toContain('Houston we have a problem');
    expect(
      (messaging.outbound_route_type as Record<string, unknown>).value
    ).toBe('OmniChannelFlow');

    // Check label and description
    expect((messaging.label as Record<string, unknown>).value).toBe(
      'Messaging Connection'
    );
    expect((messaging.description as Record<string, unknown>).value).toContain(
      'output formatting'
    );

    // Check reasoning block
    const reasoning = messaging.reasoning as Record<string, unknown>;
    expect(reasoning).toBeDefined();
    expect(reasoning.__kind).toBe('ConnectionReasoningBlock');

    // Check instructions are nested in reasoning
    expect(reasoning.instructions).toBeDefined();

    // Check response_actions are nested in reasoning
    expect(isNamedMap(reasoning.response_actions)).toBe(true);
    const reasoningFormats = reasoning.response_actions as Map<string, unknown>;
    expect(reasoningFormats.has('messaging_choices_penguins')).toBe(true);
    expect(reasoningFormats.has('messaging_rich_link')).toBe(true);

    // Check response_formats at connection level
    expect(isNamedMap(messaging.response_formats)).toBe(true);
    const responseFormats = messaging.response_formats as Map<string, unknown>;
    expect(responseFormats.has('messaging_choices_penguins')).toBe(true);
    expect(responseFormats.has('messaging_rich_link')).toBe(true);
    expect(responseFormats.has('custom_formatting_alpaca_v3')).toBe(true);
  });

  it('produces diagnostics when routing fields are incorrectly nested under settings', () => {
    const invalidSource = `
connection messaging:
    settings:
        routing:
            escalation_message: "Houston we have a problem"
            outbound_route_type: "OmniChannelFlow"
            outbound_route_name: "flow://Route"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(invalidSource);
    // Should have unknown-field errors since routing is not in ConnectionSettingsBlock schema
    const unknownFieldErrors = diagnostics.filter(
      d => d.code === 'unknown-field'
    );
    expect(unknownFieldErrors.length).toBeGreaterThan(0);
  });

  it('parses inputs correctly at connection level', () => {
    const ast = parseDocument(settingsInputsSource);
    const messaging = ast.connection!.get('messaging') as Record<
      string,
      unknown
    >;
    const inputs = messaging.inputs as Map<string, unknown>;

    expect(isNamedMap(inputs)).toBe(true);
    expect(inputs.has('legal_disclosure')).toBe(true);
    expect(inputs.has('signature')).toBe(true);

    const legalDisclosure = inputs.get('legal_disclosure') as Record<
      string,
      unknown
    >;
    expect(
      (legalDisclosure.defaultValue as Record<string, unknown>).value
    ).toBe('this is a disclosure');
  });

  it('parses response_formats with source and target', () => {
    const ast = parseDocument(settingsInputsSource);
    const messaging = ast.connection!.get('messaging') as Record<
      string,
      unknown
    >;
    const responseFormats = messaging.response_formats as Map<string, unknown>;

    // Format with source
    const messagingRichLink = responseFormats.get(
      'messaging_rich_link'
    ) as Record<string, unknown>;
    expect(messagingRichLink.__kind).toBe('ResponseFormatBlock');
    expect((messagingRichLink.source as Record<string, unknown>).value).toBe(
      'SurfaceAction__MessagingRichLink'
    );

    // Format with target
    const customAlpaca = responseFormats.get(
      'custom_formatting_alpaca_v3'
    ) as Record<string, unknown>;
    expect((customAlpaca.target as Record<string, unknown>).value).toBe(
      'apex://SomeApexDevName'
    );
    expect((customAlpaca.description as Record<string, unknown>).value).toBe(
      'a response format with alpacas'
    );
  });

  it('parses reasoning.response_actions with bindings (nested in reasoning)', () => {
    const ast = parseDocument(settingsInputsSource);
    const messaging = ast.connection!.get('messaging') as Record<
      string,
      unknown
    >;
    const reasoning = messaging.reasoning as Record<string, unknown>;
    const responseFormats = reasoning.response_actions as Map<string, unknown>;

    const penguins = responseFormats.get(
      'messaging_choices_penguins'
    ) as Record<string, unknown>;
    expect(penguins.__kind).toBe('AvailableFormatBlock');
  });
});

describe('connection-level routing fields', () => {
  const routingSource = `
connection messaging:
    escalation_message: "Houston we have a problem"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://Route_to_ELL_Agent"
    adaptive_response_allowed: True
`.trimStart();

  it('parses connection-level routing fields', () => {
    const ast = parseDocument(routingSource);
    const messaging = ast.connection!.get('messaging') as Record<
      string,
      unknown
    >;

    expect(messaging.__kind).toBe('ConnectionBlock');
    expect(
      (messaging.escalation_message as Record<string, unknown>).value
    ).toBe('Houston we have a problem');
    expect(
      (messaging.outbound_route_type as Record<string, unknown>).value
    ).toBe('OmniChannelFlow');
    expect(
      (messaging.adaptive_response_allowed as Record<string, unknown>).value
    ).toBe(true);
  });

  it('produces no diagnostics for connection-level routing', () => {
    const { diagnostics } = parseWithDiagnostics(routingSource);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('@inputs reference resolution', () => {
  const inputsReferenceSource = `
config:
    developer_name: "test"
    default_agent_user: "test@test.com"

connection messaging:
    inputs:
        LegalDisclosure: string = "This is a legal disclosure"
            description: "Legal disclosure text"
        UserName: string = "Customer"
            description: "Name of the user"

    reasoning:
        instructions: |
            Always append {!@inputs.LegalDisclosure} at the end.
            Greet the user as {!@inputs.UserName}.
`.trimStart();

  it('resolves @inputs references without errors', () => {
    const { diagnostics } = parseWithDiagnostics(inputsReferenceSource);

    // Filter to only undefined-reference errors
    const undefinedRefErrors = diagnostics.filter(
      d => d.code === 'undefined-reference' && d.message.includes('@inputs')
    );

    expect(undefinedRefErrors).toHaveLength(0);
  });

  it('produces no critical diagnostics', () => {
    const { diagnostics } = parseWithDiagnostics(inputsReferenceSource);

    // No errors or warnings about undefined references
    const criticalDiags = diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Error ||
        d.severity === DiagnosticSeverity.Warning
    );

    expect(criticalDiags).toHaveLength(0);
  });
});
