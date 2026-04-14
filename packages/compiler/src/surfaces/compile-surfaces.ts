import { NamedMap } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { OutboundRouteConfig, ResponseAction } from '../types.js';
import type { ParsedConnection } from '../parsed-types.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedBoolean,
  iterateNamedMap,
} from '../ast-helpers.js';
import { normalizeDeveloperName } from '../utils.js';
import type { Sourceable } from '../sourced.js';

/**
 * Surface output type for the compiled AgentJSON.
 */
interface Surface {
  surface_type: string;
  adaptive_response_allowed?: boolean;
  instructions?: string | null;
  outbound_route_configs?: OutboundRouteConfig[];
  response_actions?: ResponseAction[];
}

/**
 * Known connection type mappings.
 */
const CONNECTION_TYPES: Record<string, string> = {
  messaging: 'messaging',
  service_email: 'service_email',
  slack: 'slack',
  telephony: 'telephony',
  voice: 'voice',
};

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
  const instructions = extractSourcedString(def.instructions) ?? undefined;

  // Compile outbound route configs (includes escalation_message)
  const outboundRouteConfigs = compileOutboundRouteConfigs(def, ctx);

  // Compile response actions
  const responseActions = compileResponseActions(def, ctx);

  // Validate connection type constraints
  validateConnection(name, connectionType, def, agentType, ctx);

  const surface: Sourceable<Surface> = {
    surface_type: connectionType,
  };

  if (adaptiveResponseAllowed !== undefined) {
    surface.adaptive_response_allowed = adaptiveResponseAllowed;
  }
  if (instructions !== undefined) {
    surface.instructions = instructions;
  }
  // Always include outbound_route_configs (empty array when none configured)
  surface.outbound_route_configs = outboundRouteConfigs;
  if (responseActions.length > 0) {
    surface.response_actions = responseActions;
  }

  return surface as Surface;
}

/**
 * Map a connection block name to a surface type.
 * Known types are normalized via the lookup table; unknown types pass through as-is.
 */
function getConnectionType(name: string): string {
  return CONNECTION_TYPES[name.toLowerCase()] ?? name;
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

function compileResponseActions(
  def: ParsedConnection,
  _ctx: CompilerContext
): ResponseAction[] {
  if (!def.response_actions) return [];

  const result: ResponseAction[] = [];

  for (const [name, actionDef] of iterateNamedMap(
    def.response_actions as NamedMap<Record<string, unknown>> | undefined
  )) {
    const description = extractSourcedString(actionDef.description) ?? '';
    const label =
      extractSourcedString(actionDef.label) ?? normalizeDeveloperName(name);

    const action: Sourceable<ResponseAction> = {
      developer_name: name,
      label,
      description,
    };
    result.push(action as ResponseAction);
  }

  return result;
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
