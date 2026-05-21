/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Surface/connection compilation tests -- ported from Python:
 * - test_surfaces.py (TestCompileSurfaces, TestConnectionTypeValidations, TestEmptyKeyword)
 *
 * Tests the compilation of `connection` blocks into surfaces in the AgentJSON output.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import type { CompileResult } from '../src/compile.js';
import type { Diagnostic } from '../src/diagnostics.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal boilerplate for a valid .agent source with connections. */
function agentSource(connectionBlocks: string): string {
  return `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

${connectionBlocks}

start_agent main:
    description: "desc"
`;
}

/** Build agent source with a specific agent_type. */
function agentSourceWithType(
  agentType: string,
  connectionBlocks: string
): string {
  return `
config:
    agent_name: "TestBot"
    agent_type: "${agentType}"
    default_agent_user: "test@example.com"

${connectionBlocks}

start_agent main:
    description: "desc"
`;
}

/** Compile an .agent source string and return the result. */
function compileSource(source: string): CompileResult {
  const ast = parseSource(source);
  return compile(ast);
}

/** Get surfaces from compiled output. */
function getSurfaces(result: CompileResult) {
  return result.output.agent_version.surfaces ?? [];
}

/** Find a surface by type in compiled output. */
function findSurface(result: CompileResult, surfaceType: string) {
  return getSurfaces(result).find(s => s.surface_type === surfaceType);
}

/** Get diagnostics that are errors. */
function getErrors(result: CompileResult): Diagnostic[] {
  return result.diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
}

/** Get diagnostics that are warnings. */
function getWarnings(result: CompileResult): Diagnostic[] {
  return result.diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Warning
  );
}

/** Check if any diagnostic message matches a pattern (substring). */
function hasDiagnosticMatching(
  diagnostics: Diagnostic[],
  pattern: string
): boolean {
  return diagnostics.some(d =>
    d.message.toLowerCase().includes(pattern.toLowerCase())
  );
}

// ===========================================================================
// TestCompileSurfaces
// ===========================================================================

describe('compile surfaces', () => {
  // Python: test_empty_connections_list
  it('should return empty surfaces when no connections are defined', () => {
    const source = agentSource('');
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces).toEqual([]);
  });

  // Python: test_single_connection_with_all_fields
  it('should compile a single connection with all fields populated', () => {
    const source = agentSource(`
connection telephony:
    escalation_message: "Escalating to voice support"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Voice_Queue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([
      {
        escalation_message: 'Escalating to voice support',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'Voice_Queue',
      },
    ]);
  });

  // Python: test_single_connection_with_default_outbound_route_type
  it('should compile a connection with outbound_route_type passed through as-is', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Escalating to chat support"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Chat_Queue"
    adaptive_response_allowed: False
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(false);
    expect(surface?.outbound_route_configs).toEqual([
      {
        escalation_message: 'Escalating to chat support',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'Chat_Queue',
      },
    ]);
  });

  // Python: test_multiple_connections
  it('should compile multiple connections into separate surfaces', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Escalating to chat"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Chat_Queue"
    adaptive_response_allowed: True

connection telephony:
    escalation_message: "Escalating to phone"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Phone_Queue"
    adaptive_response_allowed: False
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(2);

    const messagingSurface = findSurface(result, 'messaging');
    const telephonySurface = findSurface(result, 'telephony');

    expect(messagingSurface).toBeDefined();
    expect(telephonySurface).toBeDefined();

    expect(messagingSurface?.adaptive_response_allowed).toBe(true);
    expect(
      messagingSurface?.outbound_route_configs?.[0]?.escalation_message
    ).toBe('Escalating to chat');
    expect(
      messagingSurface?.outbound_route_configs?.[0]?.outbound_route_name
    ).toBe('Chat_Queue');

    expect(telephonySurface?.adaptive_response_allowed).toBe(false);
    expect(
      telephonySurface?.outbound_route_configs?.[0]?.escalation_message
    ).toBe('Escalating to phone');
    expect(
      telephonySurface?.outbound_route_configs?.[0]?.outbound_route_name
    ).toBe('Phone_Queue');
  });

  // Python: test_adaptive_response_allowed_false
  it('should respect adaptive_response_allowed set to False', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Escalating to messaging"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Messaging_Queue"
    adaptive_response_allowed: False
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(false);
  });

  it('should compile a voice connection', () => {
    const source = agentSource(`
connection voice:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'voice');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('voice');
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  // Python: test_minimal_connection
  it('should compile a minimal connection with no routing fields', () => {
    const source = agentSource(`
connection telephony:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should compile a connection with only escalation_message (no route config)', () => {
    const source = agentSource(`
connection telephony:
    escalation_message: "Transferring you now"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    // escalation_message without route name/type produces no route config
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should not create outbound route config when only outbound_route_type is provided', () => {
    const source = agentSource(`
connection telephony:
    outbound_route_type: "OmniChannelFlow"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    // Both routeType and routeName are required for an outbound route config
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should create outbound route config with default type when only outbound_route_name is provided', () => {
    const source = agentSource(`
connection telephony:
    outbound_route_name: "Phone_Queue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    // outbound_route_name triggers route config with default OmniChannelFlow type
    expect(surface?.outbound_route_configs).toEqual([
      {
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'Phone_Queue',
      },
    ]);
  });
});

// ===========================================================================
// Connection types: messaging
// ===========================================================================

describe('messaging connection', () => {
  // Python: test_messaging_with_all_fields_passes
  it('should compile messaging with all fields', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Connecting you with an agent"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Agent_Queue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([
      {
        escalation_message: 'Connecting you with an agent',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'Agent_Queue',
      },
    ]);
  });

  // Python: test_messaging_minimal_passes
  it('should compile minimal messaging connection without routing', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should produce a messaging surface type', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface?.surface_type).toBe('messaging');
  });
});

// ===========================================================================
// Connection types: telephony
// ===========================================================================

describe('telephony connection', () => {
  it('should compile telephony connection with all fields', () => {
    const source = agentSource(`
connection telephony:
    escalation_message: "Transferring to phone support"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://phone_route"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('telephony');
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([
      {
        escalation_message: 'Transferring to phone support',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'flow://phone_route',
      },
    ]);
  });

  it('should compile minimal telephony connection', () => {
    const source = agentSource(`
connection telephony:
    adaptive_response_allowed: False
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(false);
    expect(surface?.outbound_route_configs).toEqual([]);
  });
});

// ===========================================================================
// Connection types: service_email
// ===========================================================================

describe('service_email connection', () => {
  // Python: test_service_email_with_escalation_message_produces_error
  it('should produce a warning when service_email has escalation_message', () => {
    const source = agentSource(`
connection service_email:
    escalation_message: "Escalating to email support"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Email_Queue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'service_email');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('service_email');

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'service email')).toBe(true);
    expect(hasDiagnosticMatching(warnings, 'escalation_message')).toBe(true);
  });

  // Python: test_service_email_case_insensitive_validation
  it('should validate service_email case-insensitively via getConnectionType', () => {
    // The parser lowercases the connection name lookup, so "Service_Email"
    // maps to "service_email" as a surface_type.
    const source = agentSource(`
connection service_email:
    escalation_message: "Should warn"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'service_email');
    expect(surface).toBeDefined();

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'escalation_message')).toBe(true);
  });

  // Python: test_service_email_without_escalation_message_passes
  it('should compile service_email without escalation_message with no warnings', () => {
    const source = agentSource(`
connection service_email:
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Email_Queue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'service_email');
    expect(surface).toBeDefined();
    expect(surface?.outbound_route_configs).toEqual([
      {
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'Email_Queue',
      },
    ]);

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'service email')).toBe(false);
  });

  // Python: test_service_email_minimal_no_routing_passes
  it('should compile minimal service_email connection with no routing', () => {
    const source = agentSource(`
connection service_email:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'service_email');
    expect(surface).toBeDefined();
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([]);

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'escalation_message')).toBe(false);
  });
});

// ===========================================================================
// Connection types: slack
// ===========================================================================

describe('slack connection', () => {
  // Python: test_slack_valid_with_employee_agent
  it('should compile slack connection without warning for Employee agent type', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection slack:
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('slack');
    expect(surface?.adaptive_response_allowed).toBe(true);

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'slack')).toBe(false);
  });

  // Python: test_slack_invalid_with_service_agent
  it('should produce a warning for slack connection with ServiceAgent type', () => {
    const source = agentSourceWithType(
      'AgentforceServiceAgent',
      `
connection slack:
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'employee')).toBe(true);
  });

  // Python: test_slack_case_insensitive_validation
  it('should map slack connection type case-insensitively', () => {
    // The grammar defines the connection name as the identifier after "connection"
    // and getConnectionType lowercases it for lookup.
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection slack:
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('slack');
  });

  it('should compile slack connection with Employee agent and no routing fields', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection slack:
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should still produce slack surface even when warning about non-Employee agent', () => {
    const source = agentSourceWithType(
      'AgentforceServiceAgent',
      `
connection slack:
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    // Surface is still created despite the warning
    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('slack');
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.outbound_route_configs).toEqual([]);
  });
});

// ===========================================================================
// Custom connection types
// Connection blocks with names not in the standard list (messaging, service_email,
// slack, telephony, voice) are compiled as custom types with:
// - surface_type: "custom"
// - name: original connection block name (case-preserved)
// ===========================================================================

// TODO (@sophie-guan, @setu-shah): Uncomment when compilation is updated
/*
describe('custom connection types', () => {
  it('should compile custom connection type with surface_type="custom" and name from connection block', () => {
    const source = agentSource(`
connection custom_channel:
    escalation_message: "Escalating to custom support"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    const customSurface = surfaces.find(s => s.surface_type === 'custom');
    expect(customSurface).toBeDefined();
    expect(customSurface?.surface_type).toBe('custom');
    expect(customSurface?.name).toBe('custom_channel');
    expect(customSurface?.adaptive_response_allowed).toBe(true);
  });

  it('should preserve case in name for custom connection types', () => {
    const source = agentSource(`
connection BatManClient:
    label: "Batman Integration"
    description: "Custom Batman API"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    const customSurface = surfaces.find(s => s.surface_type === 'custom');
    expect(customSurface).toBeDefined();
    expect(customSurface?.surface_type).toBe('custom');
    expect(customSurface?.name).toBe('BatManClient');
    expect(customSurface?.label).toBe('Batman Integration');
    expect(customSurface?.description).toBe('Custom Batman API');
  });

  it('should compile custom connection with full features (inputs, response_formats, reasoning)', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin Connection"
    description: "This connection applies to a penguin"

    inputs:
            IsHappy: boolean = False
                description: "Is the penguin happy?"

    reasoning:
        instructions: ->
            | Always use high frequency when speaking to young penguins

        response_actions:
            high_freq: @response_formats.high_frequency_response

    response_formats:
        high_frequency_response:
            description: "Use this format when responding to high-frequency sounds"
            target: "apex://HighFrequencyHandler"
            inputs:
                frequency: number
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    const penguinSurface = surfaces.find(s => s.surface_type === 'custom');
    expect(penguinSurface).toBeDefined();
    expect(penguinSurface?.surface_type).toBe('custom');
    expect(penguinSurface?.name).toBe('penguin');
    expect(penguinSurface?.label).toBe('Penguin Connection');
    expect(penguinSurface?.inputs).toHaveLength(1);
    expect(penguinSurface?.format_definitions).toHaveLength(1);
    expect(penguinSurface?.tools).toHaveLength(1);
  });

  it('should compile @inputs references as connection.<name>.inputs.<field>', () => {
    const source = agentSource(`
connection service_email:
    outbound_route_type: OmniChannelFlow
    outbound_route_name: "flow://PenguinSlide"

    inputs:
        LegalDisclosure: string = "This response was generated by a penguin."

    reasoning:
        instructions: |
            Use {!@inputs.LegalDisclosure} in every response.
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'service_email');
    expect(surface).toBeDefined();
    expect(surface?.instructions).toContain(
      '{{connection.service_email.inputs.LegalDisclosure}}'
    );
  });

  it('should compile @inputs references using raw connection name for custom types', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin Connection"

    inputs:
        IsHappy: boolean = False

    reasoning:
        instructions: |
            If {!@inputs.IsHappy} is false, always serve Big Fish.
`);
    const result = compileSource(source);

    const surface = getSurfaces(result).find(s => s.name === 'penguin');
    expect(surface).toBeDefined();
    expect(surface?.instructions).toContain(
      '{{connection.penguin.inputs.IsHappy}}'
    );
  });

  it('should compile multiple custom connection types', () => {
    const source = agentSource(`
connection CustomAPI:
    label: "Custom API"
    adaptive_response_allowed: True

connection AnotherCustom:
    label: "Another Custom"
    adaptive_response_allowed: False
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    const customSurfaces = surfaces.filter(s => s.surface_type === 'custom');
    expect(customSurfaces).toHaveLength(2);

    const apiSurface = customSurfaces.find(s => s.name === 'CustomAPI');
    expect(apiSurface).toBeDefined();
    expect(apiSurface?.label).toBe('Custom API');
    expect(apiSurface?.adaptive_response_allowed).toBe(true);

    const anotherSurface = customSurfaces.find(s => s.name === 'AnotherCustom');
    expect(anotherSurface).toBeDefined();
    expect(anotherSurface?.label).toBe('Another Custom');
    expect(anotherSurface?.adaptive_response_allowed).toBe(false);
  });

  it('should compile mix of standard and custom connection types', () => {
    const source = agentSource(`
connection messaging:
    label: "Standard Messaging"
    adaptive_response_allowed: True

connection MyCustomConnection:
    label: "Custom Connection"
    adaptive_response_allowed: False
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces).toHaveLength(2);

    const messagingSurface = findSurface(result, 'messaging');
    expect(messagingSurface).toBeDefined();
    expect(messagingSurface?.surface_type).toBe('messaging');
    expect(messagingSurface?.name).toBeUndefined();
    expect(messagingSurface?.label).toBe('Standard Messaging');

    const customSurface = surfaces.find(s => s.surface_type === 'custom');
    expect(customSurface).toBeDefined();
    expect(customSurface?.surface_type).toBe('custom');
    expect(customSurface?.name).toBe('MyCustomConnection');
    expect(customSurface?.label).toBe('Custom Connection');
  });

  it('should compile custom connection with all three input types (string, number, boolean)', () => {
    const source = agentSource(`
connection MyAPIClient:
    label: "My API Client"
    description: "Custom API integration"

    inputs:
            api_key: string = "default-key"
                description: "API authentication key"
            timeout: number = 30
                description: "Request timeout in seconds"
            debug_mode: boolean = False
                description: "Enable debug logging"

    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    const customSurface = surfaces.find(s => s.surface_type === 'custom');
    expect(customSurface).toBeDefined();
    expect(customSurface?.name).toBe('MyAPIClient');
    expect(customSurface?.inputs).toHaveLength(3);

    const inputsByName = new Map(
      customSurface?.inputs?.map(i => [i.developer_name, i])
    );

    // Verify string input
    const apiKey = inputsByName.get('api_key');
    expect(apiKey?.data_type).toBe('string');
    expect(apiKey?.description).toBe('API authentication key');

    // Verify number input
    const timeout = inputsByName.get('timeout');
    expect(timeout?.data_type).toBe('number');
    expect(timeout?.description).toBe('Request timeout in seconds');

    // Verify boolean input
    const debugMode = inputsByName.get('debug_mode');
    expect(debugMode?.data_type).toBe('boolean');
    expect(debugMode?.description).toBe('Enable debug logging');
  });
});
*/

// ===========================================================================
// Surface name field behavior
// - Standard types: name is NOT set (undefined)
// - Custom types: name = original connection name, surface_type = "custom"
// ===========================================================================

describe('surface name field', () => {
  it('should not set name field for standard connection types', () => {
    const source = agentSource(`
connection messaging:
    label: "Messaging"
    adaptive_response_allowed: True

connection telephony:
    label: "Telephony"
    adaptive_response_allowed: True

connection service_email:
    label: "Email"
    adaptive_response_allowed: True

connection voice:
    label: "Voice"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces).toHaveLength(4);

    for (const surface of surfaces) {
      // For standard types, name should not be set
      expect(surface.name).toBeUndefined();
    }

    const messagingSurface = findSurface(result, 'messaging');
    expect(messagingSurface?.name).toBeUndefined();
    expect(messagingSurface?.surface_type).toBe('messaging');

    const telephonySurface = findSurface(result, 'telephony');
    expect(telephonySurface?.name).toBeUndefined();
    expect(telephonySurface?.surface_type).toBe('telephony');

    const emailSurface = findSurface(result, 'service_email');
    expect(emailSurface?.name).toBeUndefined();
    expect(emailSurface?.surface_type).toBe('service_email');

    const voiceSurface = findSurface(result, 'voice');
    expect(voiceSurface?.name).toBeUndefined();
    expect(voiceSurface?.surface_type).toBe('voice');
  });

  // TODO (@sophie-guan, @setu-shah): Uncomment when compilation is updated
  /*
  it('should set name to original connection name for custom types', () => {
    const source = agentSource(`
connection MyCustomAPI:
    label: "My API"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    const customSurface = surfaces.find(s => s.surface_type === 'custom');
    expect(customSurface).toBeDefined();
    expect(customSurface?.name).toBe('MyCustomAPI');
    expect(customSurface?.surface_type).toBe('custom');
  });
  */

  it('should normalize case for standard connection types', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection Slack:
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();
    // Standard types don't have name field
    expect(surface?.name).toBeUndefined();
    expect(surface?.surface_type).toBe('slack');
  });

  it('should not set name field for standard types', () => {
    const standardTypes = [
      'messaging',
      'service_email',
      'slack',
      'telephony',
      'voice',
    ];

    for (const type of standardTypes) {
      const agentType =
        type === 'slack' ? 'AgentforceEmployeeAgent' : 'AgentforceServiceAgent';
      const source = agentSourceWithType(
        agentType,
        `
connection ${type}:
    adaptive_response_allowed: True
`
      );
      const result = compileSource(source);

      const surface = findSurface(result, type);
      expect(surface, `${type} surface not found`).toBeDefined();
      expect(surface?.name, `${type} should not have name`).toBeUndefined();
      expect(surface?.surface_type, `${type} surface_type mismatch`).toBe(type);
    }
  });

  // TODO (@sophie-guan, @setu-shah): Uncomment when compilation is updated
  /*
  it('should compile connection inputs with correct data types (string, number, boolean)', () => {
    const source = agentSource(`
connection messaging:
    inputs:
            signature: string = "Best regards"
                description: "Email signature"
            max_retries: number = 3
                description: "Maximum retry attempts"
            enabled: boolean = True
                description: "Feature enabled flag"

    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.inputs).toHaveLength(3);

    const inputsByName = new Map(
      surface?.inputs?.map(i => [i.developer_name, i])
    );

    // string type → 'string' data_type with default value (quoted)
    const signature = inputsByName.get('signature');
    expect(signature).toBeDefined();
    expect(signature?.data_type).toBe('string');
    expect(signature?.label).toBe('Signature');
    expect(signature?.description).toBe('Email signature');
    expect(signature?.default).toBe("'Best regards'");
    expect(signature?.is_list).toBe(false);
    expect(signature?.visibility).toBe('Internal');

    // number type → 'number' data_type with default as number (native type)
    const maxRetries = inputsByName.get('max_retries');
    expect(maxRetries).toBeDefined();
    expect(maxRetries?.data_type).toBe('number');
    expect(maxRetries?.label).toBe('Max Retries');
    expect(maxRetries?.description).toBe('Maximum retry attempts');
    expect(maxRetries?.default).toBe(3);
    expect(maxRetries?.is_list).toBe(false);
    expect(maxRetries?.visibility).toBe('Internal');

    // boolean type → 'boolean' data_type with default as boolean (native type)
    const enabled = inputsByName.get('enabled');
    expect(enabled).toBeDefined();
    expect(enabled?.data_type).toBe('boolean');
    expect(enabled?.label).toBe('Enabled');
    expect(enabled?.description).toBe('Feature enabled flag');
    expect(enabled?.default).toBe(true);
    expect(enabled?.is_list).toBe(false);
    expect(enabled?.visibility).toBe('Internal');
  });
  */
});

// ===========================================================================
// Outbound route config behavior
// ===========================================================================

describe('outbound route config compilation', () => {
  it('should create route config only when both type and name are present', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Transferring"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "MyRoute"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface?.outbound_route_configs).toHaveLength(1);
    expect(surface?.outbound_route_configs?.[0]).toEqual({
      escalation_message: 'Transferring',
      outbound_route_type: 'OmniChannelFlow',
      outbound_route_name: 'MyRoute',
    });
  });

  it('should pass outbound_route_type through as-is (no default/transformation)', () => {
    const source = agentSource(`
connection telephony:
    outbound_route_type: "QueueBased"
    outbound_route_name: "MyQueue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'telephony');
    expect(surface?.outbound_route_configs?.[0]?.outbound_route_type).toBe(
      'QueueBased'
    );
  });

  it('should result in empty outbound_route_configs when neither type nor name is set', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Hello"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should result in empty outbound_route_configs when only type is set', () => {
    const source = agentSource(`
connection messaging:
    outbound_route_type: "OmniChannelFlow"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  it('should create route config with default type when only name is set', () => {
    const source = agentSource(`
connection messaging:
    outbound_route_name: "MyRoute"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface?.outbound_route_configs).toEqual([
      {
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'MyRoute',
      },
    ]);
  });
});

// ===========================================================================
// Surface field behavior
// ===========================================================================

describe('surface field behavior', () => {
  it('should omit adaptive_response_allowed when not set', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Hello"
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    // Property should be absent, not false
    expect(
      Object.prototype.hasOwnProperty.call(surface, 'adaptive_response_allowed')
    ).toBe(false);
  });

  it('should not have escalation_message at surface level', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    // escalation_message lives in outbound_route_configs, not at surface level
    expect(
      Object.prototype.hasOwnProperty.call(surface, 'escalation_message')
    ).toBe(false);
  });

  it('should always include outbound_route_configs (empty array when no routes)', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.outbound_route_configs).toBeDefined();
    expect(surface?.outbound_route_configs).toEqual([]);
  });

  // TODO (@sophie-guan, @setu-shah): Uncomment when compilation is updated
  /*
  it('should include instructions when set', () => {
    const source = agentSource(`
connection messaging:
    reasoning:
        instructions: |
            Be helpful and concise
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.instructions).toBe('Be helpful and concise');
  });

  it('should compile response_formats with source only', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True

    response_formats:
        my_format:
            label: "My Format"
            description: "A test format"
            source: "response_format://SurfaceAction__MessagingChoices"
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.format_definitions).toBeDefined();
    expect(surface?.format_definitions).toHaveLength(1);

    const format = surface?.format_definitions?.[0];
    expect(format?.developer_name).toBe('my_format');
    expect(format?.label).toBe('My Format');
    expect(format?.description).toBe('A test format');
    expect(format?.source).toBe('SurfaceAction__MessagingChoices');
    expect(format?.invocation_target_type).toBeUndefined();
    expect(format?.invocation_target_name).toBeUndefined();
    expect(format?.input_schema).toBeUndefined();
  });

  it('should compile response_formats with target and structured inputs', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True

    response_formats:
        custom_format:
            label: "Custom Format"
            description: "A custom format"
            target: "apex://MyApexClass"
            inputs:
                message: string
                    description: "The message"
                    is_required: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.format_definitions).toBeDefined();
    expect(surface?.format_definitions).toHaveLength(1);

    const format = surface?.format_definitions?.[0];
    expect(format?.developer_name).toBe('custom_format');
    expect(format?.label).toBe('Custom Format');
    expect(format?.description).toBe('A custom format');
    expect(format?.invocation_target_type).toBe('apex');
    expect(format?.invocation_target_name).toBe('MyApexClass');

    const schema = JSON.parse(format?.input_schema ?? '{}');
    expect(schema.type).toBe('object');
    expect(schema.properties.message.type).toBe('string');
    expect(schema.properties.message.description).toBe('The message');
    expect(schema.required).toEqual(['message']);
  });

  it('should compile response_formats with multiple input types', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True

    response_formats:
        custom_format:
            label: "Custom Format"
            description: "A custom format"
            target: "apex://MyApexClass"
            inputs:
                name: string
                    is_required: True
                count: integer
                    is_required: True
                score: number
                active: boolean
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    expect(schema.properties.name.type).toBe('string');
    expect(schema.properties.count.type).toBe('integer');
    expect(schema.properties.score.type).toBe('number');
    expect(schema.properties.active.type).toBe('boolean');
    expect(schema.required).toEqual(['name', 'count']);
  });

  it('should compile response_formats with array types', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True

    response_formats:
        choices_format:
            target: "apex://ChoicesHandler"
            inputs:
                message: string
                    is_required: True
                choices: list[string]
                    is_required: True
                tags: list[number]
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    expect(schema.properties.choices.type).toBe('array');
    expect(schema.properties.choices.items).toEqual({ type: 'string' });
    expect(schema.properties.tags.type).toBe('array');
    expect(schema.properties.tags.items).toEqual({ type: 'number' });
    expect(schema.required).toEqual(['message', 'choices']);
  });

  it('should compile response_formats with const default value', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True

    response_formats:
        form_format:
            target: "apex://FormHandler"
            inputs:
                form_id: string = "registrationForm"
                    description: "Fixed identifier"
                    is_required: True
                message: string
                    is_required: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    expect(schema.properties.form_id.type).toBe('string');
    expect(schema.properties.form_id.const).toBe('registrationForm');
    expect(schema.properties.form_id.description).toBe('Fixed identifier');
    expect(schema.required).toEqual(['form_id', 'message']);
  });

  it('should compile response_formats with numeric constraints', () => {
    const source = agentSource(`
connection messaging:
    adaptive_response_allowed: True

    response_formats:
        constrained_format:
            target: "apex://Handler"
            inputs:
                greeting: string
                    min_length: 1
                    max_length: 200
                confidence: integer
                    minimum: 1
                    maximum: 10
                items: list[string]
                    min_items: 1
                    max_items: 5
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    expect(schema.properties.greeting.minLength).toBe(1);
    expect(schema.properties.greeting.maxLength).toBe(200);
    expect(schema.properties.confidence.minimum).toBe(1);
    expect(schema.properties.confidence.maximum).toBe(10);
    expect(schema.properties.items.minItems).toBe(1);
    expect(schema.properties.items.maxItems).toBe(5);
  });

  it('should compile response_formats with complex nested inputs', () => {
    const source = agentSource(`
connection messaging:
    response_formats:
        product_recommendations:
            description: "A product recommendation response for a customer."
            target: "apex://ProductRecommendations"
            inputs:
                greeting: string
                    description: "A personalized greeting acknowledging the customer's request."
                    is_required: True
                    min_length: 1
                    max_length: 200

                summary: string
                    description: "Brief summary of the recommendations and why they were selected."
                    is_required: True
                    min_length: 1

                recommendations: list[object]
                    description: "List of product recommendations."
                    is_required: True
                    min_items: 1
                    max_items: 5

                    product_name: string
                        description: "Name of the recommended product."
                        is_required: True

                    reason: string
                        description: "Why this product is being recommended."
                        is_required: True

                    price_range: string
                        description: "Price category of the product."
                        is_required: True
                        enum:
                            - "budget"
                            - "mid-range"
                            - "premium"

                    confidence: integer
                        description: "How confident the recommendation is (1-10)."
                        is_required: True
                        minimum: 1
                        maximum: 10

                    image_url: string
                        description: "URL to product image if available."
                        is_required: False

                tone: string
                    description: "The tone used in the response."
                    is_required: False
                    enum:
                        - "casual"
                        - "professional"
                        - "enthusiastic"

                follow_up_question: string
                    description: "A question to ask the customer to refine recommendations further."
                    is_required: False

                disclaimer: string = "Recommendations may not reflect current pricing or availability."
                    description: "Standard disclaimer text."
                    is_required: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.format_definitions).toHaveLength(1);

    const format = surface?.format_definitions?.[0];
    expect(format?.developer_name).toBe('product_recommendations');
    expect(format?.description).toBe(
      'A product recommendation response for a customer.'
    );
    expect(format?.invocation_target_type).toBe('apex');
    expect(format?.invocation_target_name).toBe('ProductRecommendations');

    const schema = JSON.parse(format?.input_schema ?? '{}');
    expect(schema.type).toBe('object');

    // Top-level required fields
    expect(schema.required).toEqual([
      'greeting',
      'summary',
      'recommendations',
      'disclaimer',
    ]);

    // greeting: string with constraints
    expect(schema.properties.greeting).toEqual({
      type: 'string',
      description:
        "A personalized greeting acknowledging the customer's request.",
      minLength: 1,
      maxLength: 200,
    });

    // summary: string with min_length
    expect(schema.properties.summary).toEqual({
      type: 'string',
      description:
        'Brief summary of the recommendations and why they were selected.',
      minLength: 1,
    });

    // recommendations: list[object] with nested sub-fields
    const recs = schema.properties.recommendations;
    expect(recs.type).toBe('array');
    expect(recs.description).toBe('List of product recommendations.');
    expect(recs.minItems).toBe(1);
    expect(recs.maxItems).toBe(5);

    // Nested object items
    const items = recs.items;
    expect(items.type).toBe('object');
    expect(items.required).toEqual([
      'product_name',
      'reason',
      'price_range',
      'confidence',
    ]);

    expect(items.properties.product_name).toEqual({
      type: 'string',
      description: 'Name of the recommended product.',
    });
    expect(items.properties.reason).toEqual({
      type: 'string',
      description: 'Why this product is being recommended.',
    });
    expect(items.properties.price_range).toEqual({
      type: 'string',
      description: 'Price category of the product.',
      enum: ['budget', 'mid-range', 'premium'],
    });
    expect(items.properties.confidence).toEqual({
      type: 'integer',
      description: 'How confident the recommendation is (1-10).',
      minimum: 1,
      maximum: 10,
    });
    expect(items.properties.image_url).toEqual({
      type: 'string',
      description: 'URL to product image if available.',
    });

    // tone: string with enum, not required
    expect(schema.properties.tone).toEqual({
      type: 'string',
      description: 'The tone used in the response.',
      enum: ['casual', 'professional', 'enthusiastic'],
    });

    // follow_up_question: optional string
    expect(schema.properties.follow_up_question).toEqual({
      type: 'string',
      description:
        'A question to ask the customer to refine recommendations further.',
    });

    // disclaimer: string with const default
    expect(schema.properties.disclaimer).toEqual({
      type: 'string',
      description: 'Standard disclaimer text.',
      const: 'Recommendations may not reflect current pricing or availability.',
    });
  });

  it('should compile messaging_component schema as raw format', () => {
    const source = agentSource(`
connection messaging:
    response_formats:
        forms_component:
            description: "Use this when the user wants to create a case."
            inputs:
                penguin_form: object
                    schema: "messaging_component://1mdSB000002Z7VJYA0"
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    expect(schema.properties.penguin_form).toEqual({
      isMessagingComponent: true,
      messagingDefinitionNameOrId: '1mdSB000002Z7VJYA0',
    });
  });

  it('should compile additional_system_instructions from connection level', () => {
    const source = agentSource(`
connection messaging:
    additional_system_instructions: |
        Use recipient name if provided
        Focus on the newest message

    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.additional_system_instructions).toContain(
      'Use recipient name'
    );
    expect(surface?.additional_system_instructions).toContain(
      'Focus on the newest message'
    );
  });

  it('should compile @response_actions references in surface instructions', () => {
    const source = agentSource(`
connection messaging:
    reasoning:
        instructions: |
            Use format {!@response_actions.my_format} for responses
            Also consider {!@response_actions.other_format}

        response_actions:
            my_format: @response_formats.my_format
            other_format: @response_formats.other_format

    response_formats:
        my_format:
            label: "My Format"
            description: "A test format"

        other_format:
            label: "Other Format"
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.instructions).toBe(
      'Use format response_formats.my_format for responses\nAlso consider response_formats.other_format'
    );
  });

  it('should resolve reasoning.response_actions aliases to connection.response_formats names', () => {
    const source = agentSource(`
connection messaging:
    reasoning:
        response_actions:
            my_choice: @response_formats.messaging_choices
                description: "Use when user needs choices"
            my_link: @response_formats.messaging_rich_link

        instructions: |
            Use {!@response_actions.my_choice} when offering options
            Also use {!@response_actions.my_link} for links

    response_formats:
        messaging_choices:
            label: "Choices"
            description: "A choices format"
            source: "response_format://SurfaceAction__MessagingChoices"

        messaging_rich_link:
            label: "Rich Link"
            source: "response_format://SurfaceAction__MessagingRichLink"
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    // @response_actions.my_choice resolves via responseFormatReferenceMap to messaging_choices
    // @response_actions.my_link resolves via responseFormatReferenceMap to messaging_rich_link
    expect(surface?.instructions).toBe(
      'Use response_formats.messaging_choices when offering options\nAlso use response_formats.messaging_rich_link for links'
    );
  });

  it('should compile reasoning.response_actions from reasoning block', () => {
    const source = agentSource(`
connection messaging:
    reasoning:
        response_actions:
            my_choice: @response_formats.messaging_choices
            my_link: @response_formats.messaging_rich_link

    response_formats:
        messaging_choices:
            label: "Choices"
            description: "A choices format"
            source: "response_format://SurfaceAction__MessagingChoices"

        messaging_rich_link:
            label: "Rich Link"
            source: "response_format://SurfaceAction__MessagingRichLink"

    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.tools).toBeDefined();
    expect(surface?.tools).toHaveLength(2);

    const choice = surface?.tools?.find(f => f.name === 'my_choice');
    expect(choice).toBeDefined();
    expect(choice?.type).toBe('format');
    expect(choice?.target).toBe('messaging_choices');
    expect(choice?.description).toBe('My Choice');

    const link = surface?.tools?.find(f => f.name === 'my_link');
    expect(link).toBeDefined();
    expect(link?.type).toBe('format');
    expect(link?.target).toBe('messaging_rich_link');
    expect(link?.description).toBe('My Link');
  });

  it('should compile full connection with all fields', () => {
    const source = agentSource(`
connection messaging:
    label: "Messaging Connection"
    description: "Main messaging surface"

    escalation_message: "Escalating to agent"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "flow://AgentRoute"

    inputs:
            signature: string = "Best regards"
                description: "Email signature"

    additional_system_instructions: |
        Use recipient name if provided

    reasoning:
        instructions: |
            Always append signature

        response_actions:
            choices: @response_formats.messaging_choices
                description: "Use for selections"

    response_formats:
        messaging_choices:
            label: "Choices"
            description: "Multiple choice format"
            source: "response_format://SurfaceAction__MessagingChoices"

        custom_format:
            label: "Custom"
            description: "Custom format"
            target: "apex://CustomFormat"
            inputs:
                schema: string

    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.surface_type).toBe('messaging');
    expect(surface?.adaptive_response_allowed).toBe(true);
    expect(surface?.additional_system_instructions).toContain(
      'Use recipient name'
    );
    expect(surface?.instructions).toContain('Always append signature');
    expect(surface?.inputs).toHaveLength(1);
    expect(surface?.format_definitions).toHaveLength(2);
    expect(surface?.tools).toHaveLength(1);
    expect(surface?.outbound_route_configs).toHaveLength(1);
  });
  */
});

// ===========================================================================
// Multiple connections integration
// ===========================================================================

describe('multiple connections', () => {
  it('should compile messaging and telephony connections as separate surfaces', () => {
    const source = agentSource(`
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
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(2);
    expect(surfaces.map(s => s.surface_type)).toEqual(
      expect.arrayContaining(['messaging', 'telephony'])
    );

    const messagingSurface = findSurface(result, 'messaging');
    const telephonySurface = findSurface(result, 'telephony');

    expect(
      messagingSurface?.outbound_route_configs?.[0]?.outbound_route_name
    ).toBe('flow://chat_route');
    expect(
      telephonySurface?.outbound_route_configs?.[0]?.outbound_route_name
    ).toBe('flow://phone_route');
    expect(telephonySurface?.adaptive_response_allowed).toBe(false);
  });

  it('should compile three connection types together', () => {
    const source = agentSource(`
connection messaging:
    escalation_message: "Escalating to chat"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Chat_Queue"
    adaptive_response_allowed: True

connection telephony:
    escalation_message: "Escalating to phone"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Phone_Queue"
    adaptive_response_allowed: False

connection service_email:
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Email_Queue"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(3);
    expect(surfaces.map(s => s.surface_type).sort()).toEqual([
      'messaging',
      'service_email',
      'telephony',
    ]);
  });

  it('should compile slack alongside messaging for Employee agent', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection slack:
    adaptive_response_allowed: True

connection messaging:
    escalation_message: "Transferring to agent"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "support_queue"
    adaptive_response_allowed: False
`
    );
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(2);

    const slackSurface = findSurface(result, 'slack');
    const messagingSurface = findSurface(result, 'messaging');

    expect(slackSurface).toBeDefined();
    expect(slackSurface?.adaptive_response_allowed).toBe(true);
    expect(slackSurface?.outbound_route_configs).toEqual([]);

    expect(messagingSurface).toBeDefined();
    expect(messagingSurface?.adaptive_response_allowed).toBe(false);
    expect(messagingSurface?.outbound_route_configs).toEqual([
      {
        escalation_message: 'Transferring to agent',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'support_queue',
      },
    ]);

    // No warnings expected for Employee agent with slack
    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'employee')).toBe(false);
  });
});

// ===========================================================================
// Full integration: parse + compile with connection blocks
// ===========================================================================

describe('full integration with connection blocks', () => {
  it('should compile a full agent script with a single messaging connection', () => {
    const source = `
config:
    agent_name: "ServiceBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "bot@example.com"

system:
    instructions: "You are a service agent."

connection messaging:
    escalation_message: "Transferring..."
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "MyRoute"
    adaptive_response_allowed: True

start_agent main:
    description: "Handle user requests"
    reasoning:
        instructions: "Route the user"
`;
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(1);

    const surface = surfaces[0];
    expect(surface.surface_type).toBe('messaging');
    expect(surface.adaptive_response_allowed).toBe(true);
    expect(surface.outbound_route_configs).toEqual([
      {
        escalation_message: 'Transferring...',
        outbound_route_type: 'OmniChannelFlow',
        outbound_route_name: 'MyRoute',
      },
    ]);
  });

  it('should compile an Employee agent script with slack connection', () => {
    const source = `
config:
    agent_name: "EmployeeBot"
    agent_type: "AgentforceEmployeeAgent"
    default_agent_user: "bot@example.com"

system:
    instructions: "You are an employee assistant."

connection slack:
    adaptive_response_allowed: True

start_agent main:
    description: "Help employees"
    reasoning:
        instructions: "Assist the employee"
`;
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(1);

    const surface = surfaces[0];
    expect(surface.surface_type).toBe('slack');
    expect(surface.adaptive_response_allowed).toBe(true);
    expect(surface.outbound_route_configs).toEqual([]);

    // No warnings for slack with Employee agent
    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'slack')).toBe(false);
  });

  it('should produce warning when slack used with ServiceAgent in full script', () => {
    const source = `
config:
    agent_name: "ServiceBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "bot@example.com"

connection slack:
    adaptive_response_allowed: True

start_agent main:
    description: "desc"
`;
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'employee')).toBe(true);
  });

  it('should produce warning when service_email has escalation_message in full script', () => {
    const source = `
config:
    agent_name: "ServiceBot"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "bot@example.com"

connection service_email:
    escalation_message: "Should warn"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "Email_Queue"
    adaptive_response_allowed: True

start_agent main:
    description: "desc"
`;
    const result = compileSource(source);

    const surface = findSurface(result, 'service_email');
    expect(surface).toBeDefined();

    const warnings = getWarnings(result);
    expect(hasDiagnosticMatching(warnings, 'service email')).toBe(true);
  });
});

// ===========================================================================
// Slack field validation — moved to lint pass (connectionValidationRule)
// See: dialect/agentforce/src/tests/lint.test.ts > "connection validation rules"
// ===========================================================================

// ===========================================================================
// "empty" keyword for connections
// Python: TestEmptyKeyword
// ===========================================================================

describe('empty keyword for connections', () => {
  // =======================================================================
  // Happy path: empty keyword compiles correctly
  // =======================================================================

  // Python: test_surfaces.test_slack_with_empty_generates_minimal_surface
  it('should compile slack with empty keyword to minimal surface', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection slack:
    empty
`
    );
    const result = compileSource(source);

    const surface = findSurface(result, 'slack');
    expect(surface).toBeDefined();
    expect(surface!.outbound_route_configs).toEqual([]);
    const errors = getErrors(result);
    expect(errors.length).toBe(0);
  });

  // Python: test_surfaces.test_multiple_connections_with_slack_empty_and_messaging_full
  it('should compile both slack empty and messaging full without error', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection slack:
    empty

connection messaging:
    escalation_message: "Transferring"
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "support_queue"
    adaptive_response_allowed: True
`
    );
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(2);

    const slackSurface = findSurface(result, 'slack');
    expect(slackSurface).toBeDefined();
    expect(slackSurface!.outbound_route_configs).toEqual([]);

    const messagingSurface = findSurface(result, 'messaging');
    expect(messagingSurface).toBeDefined();
    expect(messagingSurface!.outbound_route_configs.length).toBeGreaterThan(0);
  });

  // Python: test_surfaces.test_slack_empty_case_insensitive
  it('should handle empty keyword case-insensitively for Slack', () => {
    const source = agentSourceWithType(
      'AgentforceEmployeeAgent',
      `
connection Slack:
    empty
`
    );
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBeGreaterThanOrEqual(1);
    const errors = getErrors(result);
    expect(errors.length).toBe(0);
  });

  // Python: test_surfaces.test_test_aea_script_with_empty_slack_connection_compiles_successfully
  it('should compile full agent script with empty slack connection', () => {
    const source = `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceEmployeeAgent"
    default_agent_user: "bot@example.com"

system:
    instructions: "You are a helpful assistant."

connection slack:
    empty

start_agent main:
    description: "Handle user requests"
    reasoning:
        instructions: ->
            | Help the user with their request.
`;
    const result = compileSource(source);

    const surfaces = getSurfaces(result);
    expect(surfaces.length).toBe(1);

    const slackSurface = surfaces[0];
    expect(slackSurface.surface_type).toBe('slack');
    expect(slackSurface.outbound_route_configs).toEqual([]);

    const errors = getErrors(result);
    expect(errors.length).toBe(0);
  });

  // TODO (@sophie-guan, @setu-shah): Uncomment when compilation is updated
  /*
  it('should compile connection with source field', () => {
    const source = agentSource(`
connection messaging:
    source: "connection://MyCustomSource"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.source).toBe('MyCustomSource');
  });

  describe('source URI validation', () => {
    it('should error when connection source does not use connection:// scheme', () => {
      const source = agentSource(`
connection messaging:
    source: "MyCustomSource"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'connection://' scheme")
      ).toBe(true);
      expect(hasDiagnosticMatching(errors, 'MyCustomSource')).toBe(true);
    });

    it('should error when connection source uses wrong scheme (response_format://)', () => {
      const source = agentSource(`
connection messaging:
    source: "response_format://SomeAction"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'connection://' scheme")
      ).toBe(true);
    });

    it('should error when connection source uses apex:// scheme', () => {
      const source = agentSource(`
connection messaging:
    source: "apex://MyApexClass"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'connection://' scheme")
      ).toBe(true);
      expect(hasDiagnosticMatching(errors, 'apex://MyApexClass')).toBe(true);
    });

    it('should error when response_format source does not use response_format:// scheme', () => {
      const source = agentSource(`
connection messaging:
    response_formats:
        my_format:
            source: "SurfaceAction__MessagingChoices"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'response_format://' scheme")
      ).toBe(true);
      expect(
        hasDiagnosticMatching(errors, 'SurfaceAction__MessagingChoices')
      ).toBe(true);
    });

    it('should error when response_format source uses wrong scheme (connection://)', () => {
      const source = agentSource(`
connection messaging:
    response_formats:
        my_format:
            source: "connection://SurfaceAction__MessagingChoices"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'response_format://' scheme")
      ).toBe(true);
    });

    it('should error when response_format source uses apex:// scheme', () => {
      const source = agentSource(`
connection messaging:
    response_formats:
        my_format:
            source: "apex://MyApexClass"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'response_format://' scheme")
      ).toBe(true);
    });

    it('should error when response_format source uses flow:// scheme', () => {
      const source = agentSource(`
connection messaging:
    response_formats:
        my_format:
            source: "flow://MyFlow"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBeGreaterThan(0);
      expect(
        hasDiagnosticMatching(errors, "must use 'response_format://' scheme")
      ).toBe(true);
    });

    it('should validate multiple response_formats with mixed correct and incorrect sources', () => {
      const source = agentSource(`
connection messaging:
    response_formats:
        correct_format:
            source: "response_format://SurfaceAction__ValidFormat"
        missing_scheme:
            source: "SurfaceAction__InvalidFormat"
        wrong_scheme:
            source: "apex://AnotherInvalidFormat"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      // Should have 2 errors (for the two invalid sources)
      expect(errors.length).toBe(2);

      // Both errors should be about response_format:// scheme
      const schemeErrors = errors.filter(e =>
        e.message.includes("must use 'response_format://' scheme")
      );
      expect(schemeErrors.length).toBe(2);

      // Check that the correct format doesn't generate an error
      const correctFormatError = errors.find(e =>
        e.message.includes('SurfaceAction__ValidFormat')
      );
      expect(correctFormatError).toBeUndefined();

      // Check that invalid formats are mentioned in errors
      expect(
        hasDiagnosticMatching(errors, 'SurfaceAction__InvalidFormat')
      ).toBe(true);
      expect(hasDiagnosticMatching(errors, 'apex://AnotherInvalidFormat')).toBe(
        true
      );
    });

    it('should allow connection source with correct connection:// scheme', () => {
      const source = agentSource(`
connection messaging:
    source: "connection://MyCustomSource"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBe(0);

      const surface = findSurface(result, 'messaging');
      expect(surface?.source).toBe('MyCustomSource');
    });

    it('should allow response_format source with correct response_format:// scheme', () => {
      const source = agentSource(`
connection messaging:
    response_formats:
        my_format:
            label: "My Format"
            source: "response_format://SurfaceAction__MessagingChoices"
    adaptive_response_allowed: True
`);
      const result = compileSource(source);

      const errors = getErrors(result);
      expect(errors.length).toBe(0);

      const surface = findSurface(result, 'messaging');
      expect(surface?.format_definitions).toHaveLength(1);
      expect(surface?.format_definitions?.[0].source).toBe(
        'SurfaceAction__MessagingChoices'
      );
    });
  });
  */

  // Validation tests for empty keyword (wrong connection types, mixed fields)
  // live in dialect/agentforce/src/tests/lint.test.ts > "connection validation rules"
});

// ===========================================================================
// Nested object inputs compilation
// ===========================================================================

// TODO (@sophie-guan, @setu-shah): Uncomment when compilation is updated
/*
describe('nested object inputs compilation', () => {
  it('should compile nested object sub-fields into JSON Schema', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin"
    response_formats:
        time_picker:
            target: "apex://TimePickerHandler"
            inputs:
                message: string
                    is_required: True
                location: object
                    is_required: True
                    name: string
                        is_required: True
                    latitude: string
                        is_required: True
                    radius: number
                        is_required: False
`);
    const result = compileSource(source);
    const surfaces = getSurfaces(result);
    const surface = surfaces.find(s => s.surface_type === 'custom');
    expect(surface).toBeDefined();

    const format = surface?.format_definitions?.[0];
    expect(format?.developer_name).toBe('time_picker');

    const schema = JSON.parse(format?.input_schema ?? '{}');
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['message', 'location']);

    // location should be a nested object with its own properties
    const location = schema.properties.location;
    expect(location.type).toBe('object');
    expect(location.properties.name.type).toBe('string');
    expect(location.properties.latitude.type).toBe('string');
    expect(location.properties.radius.type).toBe('number');
    expect(location.required).toEqual(['name', 'latitude']);
  });

  it('should compile object[] with nested sub-fields', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin"
    response_formats:
        choices:
            target: "apex://ChoicesHandler"
            inputs:
                choices: list[object]
                    is_required: True
                    text: string
                        is_required: True
                    id: string
                        is_required: True
`);
    const result = compileSource(source);
    const surfaces = getSurfaces(result);
    const surface = surfaces.find(s => s.surface_type === 'custom');

    const formatDef = surface?.format_definitions?.[0];
    const schema = JSON.parse(formatDef?.input_schema ?? '{}');

    // list[object] → array with items as nested object
    const choices = schema.properties.choices;
    expect(choices.type).toBe('array');
    expect(choices.items.type).toBe('object');
    expect(choices.items.properties.text.type).toBe('string');
    expect(choices.items.properties.id.type).toBe('string');
    expect(choices.items.required).toEqual(['text', 'id']);
  });

  it('should compile deeply nested objects', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin"
    response_formats:
        deep_format:
            target: "apex://DeepHandler"
            inputs:
                outer: object
                    is_required: True
                    middle: object
                        is_required: True
                        inner: string
                            is_required: True
`);
    const result = compileSource(source);
    const surfaces = getSurfaces(result);
    const surface = surfaces.find(s => s.surface_type === 'custom');

    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    const outer = schema.properties.outer;
    expect(outer.type).toBe('object');
    expect(outer.required).toEqual(['middle']);

    const middle = outer.properties.middle;
    expect(middle.type).toBe('object');
    expect(middle.properties.inner.type).toBe('string');
    expect(middle.required).toEqual(['inner']);
  });

  it('should compile nested object with description and constraints', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin"
    response_formats:
        rich_format:
            target: "apex://RichHandler"
            inputs:
                details: object
                    description: "Detail object"
                    is_required: True
                    name: string
                        description: "The name"
                        min_length: 1
                        max_length: 100
                    count: integer
                        minimum: 0
                        maximum: 999
`);
    const result = compileSource(source);
    const surfaces = getSurfaces(result);
    const surface = surfaces.find(s => s.surface_type === 'custom');

    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    const details = schema.properties.details;
    expect(details.type).toBe('object');
    expect(details.description).toBe('Detail object');

    expect(details.properties.name.type).toBe('string');
    expect(details.properties.name.description).toBe('The name');
    expect(details.properties.name.minLength).toBe(1);
    expect(details.properties.name.maxLength).toBe(100);
    expect(details.properties.count.type).toBe('integer');
    expect(details.properties.count.minimum).toBe(0);
    expect(details.properties.count.maximum).toBe(999);
  });

  it('should compile label property to JSON Schema title', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin"
    response_formats:
        product:
            target: "apex://ProductHandler"
            inputs:
                productName: string
                    label: "Product Name"
                    description: "The name of the product"
                    is_required: True
`);
    const result = compileSource(source);
    const surfaces = getSurfaces(result);
    const surface = surfaces.find((s: any) => s.surface_type === 'custom');

    const format = surface?.format_definitions?.[0];
    const schema = JSON.parse(format?.input_schema ?? '{}');

    const productName = schema.properties.productName;
    expect(productName.type).toBe('string');
    expect(productName.title).toBe('Product Name'); // label → title
    expect(productName.description).toBe('The name of the product');
    expect(schema.required).toContain('productName');
  });

  it('should compile label property to title', () => {
    const source = agentSource(`
connection penguin:
    label: "Penguin"
    response_formats:
        mixed_format:
            target: "apex://MixedHandler"
            inputs:
                # label as PROPERTY (raw string value) - compiles to JSON Schema title
                displayName: string
                    label: "Display Name"
                    description: "Name shown to users"
                    is_required: True

                # Non-property names work fine as subfields
                items: list[object]
                    is_required: True
                    itemLabel: string
                        is_required: True
                    itemValue: number
                        is_required: True
`);
    const result = compileSource(source);
    const surfaces = getSurfaces(result);
    const surface = surfaces.find((s: any) => s.surface_type === 'custom');

    const formatDef = surface?.format_definitions?.[0];
    const schema = JSON.parse(formatDef?.input_schema ?? '{}');

    // Case 1: label as PROPERTY - compiles to title
    const displayName = schema.properties.displayName;
    expect(displayName.type).toBe('string');
    expect(displayName.title).toBe('Display Name'); // property label → JSON Schema title
    expect(displayName.description).toBe('Name shown to users');

    // Case 2: Non-property names work fine as subfields
    const items = schema.properties.items;
    expect(items.type).toBe('array');
    expect(items.items.type).toBe('object');
    expect(items.items.properties.itemLabel).toBeDefined();
    expect(items.items.properties.itemLabel.type).toBe('string');
    expect(items.items.properties.itemLabel.title).toBeUndefined();
    expect(items.items.properties.itemValue).toBeDefined();
    expect(items.items.properties.itemValue.type).toBe('number');
    expect(items.items.required).toEqual(['itemLabel', 'itemValue']);
  });
});
*/
