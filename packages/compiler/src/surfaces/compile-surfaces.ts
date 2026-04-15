import { NamedMap, ParameterDeclarationNode } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  OutboundRouteConfig,
  StateVariable,
  FormatTool,
} from '../types.js';
import type { ParsedConnection } from '../parsed-types.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedBoolean,
  extractDescriptionValue,
  getExpressionName,
  isListType,
  iterateNamedMap,
} from '../ast-helpers.js';
import { toStateVariableDataType } from '../variables/variable-utils.js';
import { extractDefaultValue } from '../variables/state-variables.js';
import { dedent, normalizeDeveloperName, parseUri } from '../utils.js';
import type { Sourceable } from '../sourced.js';
import {
  compileResponseFormats,
  compileAvailableFormats,
  type ResponseFormat,
} from './compile-response-formats.js';
import { compileTemplateValue } from '../expressions/compile-template.js';

/**
 * Surface output type for the compiled AgentJSON.
 */
interface Surface {
  surface_type: string;
  name?: string;
  label?: string;
  description?: string;
  source?: string;
  adaptive_response_allowed?: boolean;
  instructions?: string | null;
  additional_system_instructions?: string | null;
  outbound_route_configs?: OutboundRouteConfig[];
  inputs?: StateVariable[];
  format_definitions?: ResponseFormat[];
  tools?: FormatTool[];
}

/**
 * Standard connection type mappings.
 */
const CONNECTION_TYPES: Record<string, string> = {
  messaging: 'messaging',
  service_email: 'service_email',
  slack: 'slack',
  telephony: 'telephony',
  voice: 'voice',
  customer_web_client: 'customer_web_client',
};

const CUSTOM_CONNECTION_TYPE = 'custom';

/**
 * Compile connection blocks into Surface[].
 */
export function compileSurfaces(
  connections: NamedMap<ParsedConnection> | undefined,
  agentType: string | undefined,
  ctx: CompilerContext
): Surface[] {
  if (!connections) return [];

  const result: Surface[] = [];

  for (const [name, def] of iterateNamedMap(connections)) {
    const surface = compileSurface(name, def, agentType, ctx);
    if (surface) {
      result.push(surface);
    }
  }

  return result;
}

function compileSurface(
  name: string,
  def: ParsedConnection,
  agentType: string | undefined,
  ctx: CompilerContext
): Surface | undefined {
  const connectionType = getConnectionType(name);

  const adaptiveResponseAllowed =
    extractSourcedBoolean(def.adaptive_response_allowed) ?? undefined;

  // Parse and validate connection source (must be connection://...)
  const sourceUri = extractStringValue(def.source);
  let source: string | undefined;
  if (sourceUri) {
    const { scheme, path } = parseUri(sourceUri);
    if (scheme !== 'connection') {
      ctx.error(
        `Connection source must use 'connection://' scheme, got: '${sourceUri}'`,
        def.__cst?.range
      );
    }
    source = path || sourceUri;
  }

  const label = extractStringValue(def.label) ?? undefined;
  const description = extractStringValue(def.description) ?? undefined;

  // Set connection name for @inputs reference resolution
  ctx.connectionName = name;

  // Clear response format reference map for this surface
  ctx.responseFormatReferenceMap.clear();

  // Compile reasoning.response_actions first to populate responseFormatReferenceMap
  // (needed for @response_actions resolution in instructions)
  const tools = compileAvailableFormats(
    def.reasoning?.response_actions as
      | NamedMap<Record<string, unknown>>
      | undefined,
    ctx
  );

  // Extract instructions from reasoning block
  const instructionsNode = def.reasoning?.instructions as
    | Record<string, unknown>
    | undefined;
  const instructionsRaw = instructionsNode
    ? compileTemplateValue(instructionsNode, ctx, {
        allowFormatReferences: true,
      })
    : undefined;
  const instructions = instructionsRaw ? dedent(instructionsRaw) : undefined;

  // Extract additional_system_instructions from connection level
  const sysInstrNode = def.additional_system_instructions as
    | Record<string, unknown>
    | undefined;
  const additionalSystemInstructionsRaw = sysInstrNode
    ? compileTemplateValue(sysInstrNode, ctx, { allowFormatReferences: true })
    : undefined;
  const additionalSystemInstructions = additionalSystemInstructionsRaw
    ? dedent(additionalSystemInstructionsRaw)
    : undefined;

  // Compile outbound route configs (includes escalation_message)
  const outboundRouteConfigs = compileOutboundRouteConfigs(def, ctx);

  // Compile inputs
  const inputs = compileInputs(def, ctx);

  // Compile format_definitions (response_formats from .agent file)
  const responseFormats = compileResponseFormats(
    def.response_formats as NamedMap<Record<string, unknown>> | undefined,
    ctx
  );

  // Validate connection type constraints
  validateConnection(name, connectionType, def, agentType, ctx);

  const surface: Sourceable<Surface> = {
    surface_type: connectionType,
    ...(connectionType === CUSTOM_CONNECTION_TYPE ? { name } : {}),
  };
  if (label !== undefined) {
    surface.label = label;
  }
  if (description !== undefined) {
    surface.description = description;
  }
  if (source !== undefined) {
    surface.source = source;
  }
  if (adaptiveResponseAllowed !== undefined) {
    surface.adaptive_response_allowed = adaptiveResponseAllowed;
  }
  if (instructions !== undefined) {
    surface.instructions = instructions;
  }
  if (additionalSystemInstructions !== undefined) {
    surface.additional_system_instructions = additionalSystemInstructions;
  }
  // Always include outbound_route_configs (empty array when none configured)
  surface.outbound_route_configs = outboundRouteConfigs;
  if (inputs.length > 0) {
    surface.inputs = inputs;
  }
  if (responseFormats.length > 0) {
    surface.format_definitions = responseFormats;
  }
  if (tools.length > 0) {
    surface.tools = tools;
  }

  return surface as Surface;
}

/**
 * Map a connection block name to a surface type.
 * Returns 'custom' for non-standard connection types.
 */
function getConnectionType(name: string): string {
  return CONNECTION_TYPES[name.toLowerCase()] ?? CUSTOM_CONNECTION_TYPE;
}

function compileOutboundRouteConfigs(
  def: ParsedConnection,
  _ctx: CompilerContext
): OutboundRouteConfig[] {
  const routeType = extractSourcedString(def.outbound_route_type);
  const routeName = extractSourcedString(def.outbound_route_name);
  const escalationMessage = extractSourcedString(def.escalation_message);

  // Any routing field triggers route config creation
  if (!routeType && !routeName && !escalationMessage) {
    return [];
  }

  if (routeName) {
    const config: Sourceable<OutboundRouteConfig> = {
      outbound_route_type:
        (routeType as Sourceable<OutboundRouteConfig['outbound_route_type']>) ??
        'OmniChannelFlow',
      outbound_route_name: routeName,
    };
    if (escalationMessage !== undefined) {
      config.escalation_message = escalationMessage;
    }
    return [config as OutboundRouteConfig];
  }

  return [];
}

function compileInputs(
  def: ParsedConnection,
  ctx: CompilerContext
): StateVariable[] {
  const inputs = def.inputs;
  if (!inputs) return [];

  const result: StateVariable[] = [];

  for (const [name, decl] of iterateNamedMap(
    inputs as NamedMap<ParameterDeclarationNode> | undefined
  )) {
    const param = compileConnectionInput(name, decl, ctx);
    if (param) result.push(param);
  }

  return result;
}

/**
 * Compile a connection input as a variable
 */
function compileConnectionInput(
  name: string,
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
): StateVariable | undefined {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr) return undefined;

  // Properties nested under .properties
  const props = decl.properties as Record<string, unknown> | undefined;

  const isList = isListType(decl.type);
  const dataType = toStateVariableDataType(typeStr);

  if (!dataType) {
    ctx.error(
      `Unsupported connection input type: '${typeStr}' for input '${name}'`,
      decl.__cst?.range
    );
    return undefined;
  }

  // Extract default value
  const defaultValue = extractDefaultValue(decl.defaultValue, dataType, isList);

  const label =
    extractStringValue(props?.['label']) ?? normalizeDeveloperName(name);
  const description = extractDescriptionValue(props?.['description']) ?? label;

  const stateVar: StateVariable = {
    developer_name: name,
    label,
    description,
    data_type: dataType,
    is_list: isList,
    visibility: 'Internal',
  };

  // Only include default when it has a value
  if (defaultValue !== null) {
    stateVar.default = defaultValue as StateVariable['default'];
  }

  return stateVar;
}

function validateConnection(
  _name: string,
  connectionType: string,
  def: ParsedConnection,
  agentType: string | undefined,
  ctx: CompilerContext
): void {
  switch (connectionType) {
    case 'slack': {
      if (agentType && !agentType.includes('Employee')) {
        ctx.warning(
          `Slack connection is only supported for Employee agent types`,
          def.__cst?.range
        );
      }
      break;
    }
    case 'service_email': {
      const escalationMessage = extractStringValue(def.escalation_message);
      if (escalationMessage) {
        ctx.warning(
          `Service email connections do not support escalation_message`,
          def.__cst?.range
        );
      }
      break;
    }
  }
}
