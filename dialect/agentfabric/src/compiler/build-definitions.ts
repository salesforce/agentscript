/**
 * Build ActionDefinition entries from actions and the built-in IdentityAction.
 * Mirrors _get_definitions() in the Python adaptor.
 */

import type {
  ActionDefinition,
  Definition,
} from './unified-agent-specification.js';
import { ObjectTypes } from './unified-agent-specification.js';
import type { AgentFabricCompilerContext } from './compiler-context.js';
import { extractString } from './utils.js';

/**
 * JSON schema for A2A MessageSendParams input.
 * Simplified static schema matching the Python adaptor's MessageSendParams.model_json_schema().
 */
const MESSAGE_SEND_PARAMS_SCHEMA = {
  type: 'object',
  properties: {
    message: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        parts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string' },
              text: { type: 'string' },
            },
          },
        },
      },
    },
  },
};

/**
 * Permissive JSON schema for MCP tool input.
 * Actual schemas are discovered at runtime via MCP protocol; this placeholder
 * ensures the definition is valid and the runtime can resolve the ref.
 */
const MCP_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {},
  additionalProperties: true,
};

/**
 * JSON schema for ToolCallResultEvent output.
 */
const TOOL_CALL_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    result: { type: 'object' },
  },
};

function cloneSchema<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function buildDefinitions(
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  _ctx: AgentFabricCompilerContext
): Definition[] {
  const result: Definition[] = [];

  if (actionDefs) {
    for (const [name, def] of actionDefs) {
      const kind = extractString((def as Record<string, unknown>).kind);
      if (kind === 'a2a:send_message') {
        const target =
          extractString((def as Record<string, unknown>).target) ?? '';
        const connectionUrl = target.replace(
          /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//,
          ''
        );
        const record = def as Record<string, unknown>;
        const defaultLabel = `${name}-action`;
        const defaultDescription = `A2A tool: ${name}`;
        const label = extractString(record.label) ?? defaultLabel;
        const description =
          extractString(record.description) ?? defaultDescription;

        const actionDef: ActionDefinition = {
          name: `${name}-action`,
          type: ObjectTypes.ACTION,
          client: `${name}-client`,
          label,
          description,
          'invocation-target-type': 'agent',
          'invocation-target-name': name,
          'input-schema': cloneSchema(MESSAGE_SEND_PARAMS_SCHEMA),
          'output-schema': cloneSchema(TOOL_CALL_RESULT_SCHEMA),
          behavior: {
            'require-user-confirmation': false,
            'include-in-progress-indicator': false,
          },
          metadata: {
            protocol: 'a2a',
            url: connectionUrl,
            platform: 'Mulesoft',
          },
        };
        result.push(actionDef);
      } else if (kind === 'mcp:tool') {
        const record = def as Record<string, unknown>;
        const toolName = extractString(record.tool_name) ?? name;
        const target = extractString(record.target) ?? '';
        const connection = target.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
        const defaultLabel = `${name}-action`;
        const defaultDescription = `MCP tool: ${name}`;
        const label = extractString(record.label) ?? defaultLabel;
        const description =
          extractString(record.description) ?? defaultDescription;

        const actionDef: ActionDefinition = {
          name: `${name}-action`,
          type: ObjectTypes.ACTION,
          client: `${name}-client`,
          label,
          description,
          'invocation-target-type': 'mcp',
          'invocation-target-name': toolName,
          'input-schema': cloneSchema(MCP_TOOL_INPUT_SCHEMA),
          'output-schema': cloneSchema(TOOL_CALL_RESULT_SCHEMA),
          behavior: {
            'require-user-confirmation': false,
            'include-in-progress-indicator': false,
          },
          metadata: {
            protocol: 'mcp',
            connection,
            tool_name: toolName,
          },
        };
        result.push(actionDef);
      }
    }
  }

  // Always include IdentityAction
  result.push({
    name: 'IdentityAction',
    type: ObjectTypes.ACTION,
    client: 'in-built',
    label: 'State Update Action',
    description: 'Generic action for updating state variables',
    'invocation-target-type': 'internal',
    'invocation-target-name': 'state-update-action',
    'input-schema': {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    'output-schema': {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
  });

  return result;
}
