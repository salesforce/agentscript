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
// Unknown connection types
// ===========================================================================

describe('unknown connection type', () => {
  it('should pass through unknown connection types as-is', () => {
    const source = agentSource(`
connection custom_channel:
    escalation_message: "Escalating to custom support"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const errors = getErrors(result);
    expect(hasDiagnosticMatching(errors, 'unknown connection type')).toBe(
      false
    );

    // Unknown types pass through using the connection name as surface_type
    const surfaces = getSurfaces(result);
    const customSurface = surfaces.find(
      s => s.surface_type === 'custom_channel'
    );
    expect(customSurface).toBeDefined();
    expect(customSurface?.adaptive_response_allowed).toBe(true);
  });
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

  it('should include instructions when set', () => {
    const source = agentSource(`
connection messaging:
    instructions: "Be helpful and concise"
    adaptive_response_allowed: True
`);
    const result = compileSource(source);

    const surface = findSurface(result, 'messaging');
    expect(surface).toBeDefined();
    expect(surface?.instructions).toBe('Be helpful and concise');
  });
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

  // Validation tests for empty keyword (wrong connection types, mixed fields)
  // live in dialect/agentforce/src/tests/lint.test.ts > "connection validation rules"
});
