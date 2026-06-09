/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { NamedMap, ParameterDeclarationNode } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { OutboundRouteConfig, ResponseAction } from '../types.js';
import type { ParsedConnection } from '../parsed-types.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedBoolean,
  extractSourcedDescription,
  getExpressionName,
  iterateNamedMap,
} from '../ast-helpers.js';
import { normalizeDeveloperName } from '../utils.js';
import type { Sourceable } from '../sourced.js';
import { extractDefaultValue } from '../variables/state-variables.js';
import { surfaceInputParameter } from '../generated/agent-dsl.js';
import type { z } from 'zod';

type SurfaceInputParameter = z.infer<typeof surfaceInputParameter>;

/**
 * Surface output type for the compiled AgentJSON.
 */
interface Surface {
  surface_type: string;
  // name?: string;
  // label?: string;
  // description?: string;
  // source?: string;
  adaptive_response_allowed?: boolean;
  instructions?: string | null;
  // additional_system_instructions?: string | null;
  outbound_route_configs?: OutboundRouteConfig[];
  response_actions?: ResponseAction[];
  input_parameters?: SurfaceInputParameter[];
  // format_definitions?: ResponseFormat[];
  // tools?: FormatTool[];
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
  // customer_web_client: 'customer_web_client',
};

// const CUSTOM_CONNECTION_TYPE = 'custom';

/**
 * Map AgentScript types to surface input parameter data types.
 */
const SCALAR_TO_SURFACE_INPUT_TYPE: Record<
  string,
  'string' | 'boolean' | 'integer' | 'double'
> = {
  string: 'string',
  boolean: 'boolean',
  number: 'double',
};

function toSurfaceInputParameterDataType(
  scalarType: string
): 'string' | 'boolean' | 'integer' | 'double' {
  return SCALAR_TO_SURFACE_INPUT_TYPE[scalarType.toLowerCase()] ?? 'string';
}

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

  // Compile inputs (aka surface variables)
  const inputs = compileInputs(def, ctx);

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
  if (inputs.length > 0) {
    surface.input_parameters = inputs;
  }

  return surface as Surface;
}

// --- Commented out: new compileSurface body from 2001dc63 ---
// function compileSurface(
//   name: string,
//   def: ParsedConnection,
//   agentType: string | undefined,
//   ctx: CompilerContext
// ): Surface | undefined {
//   const connectionType = getConnectionType(name);
//
//   const adaptiveResponseAllowed =
//     extractSourcedBoolean(def.adaptive_response_allowed) ?? undefined;
//
//   // Parse and validate connection source (must be connection://...)
//   const sourceUri = extractStringValue(def.source);
//   let source: string | undefined;
//   if (sourceUri) {
//     const { scheme, path } = parseUri(sourceUri);
//     if (scheme !== 'connection') {
//       ctx.error(
//         `Connection source must use 'connection://' scheme, got: '${sourceUri}'`,
//         def.__cst?.range
//       );
//     }
//     source = path || sourceUri;
//   }
//
//   const label = extractStringValue(def.label) ?? undefined;
//   const description = extractStringValue(def.description) ?? undefined;
//
//   // Set connection name for @inputs reference resolution
//   ctx.connectionName = name;
//
//   // Clear response format reference map for this surface
//   ctx.responseFormatReferenceMap.clear();
//
//   // Compile reasoning.response_actions first to populate responseFormatReferenceMap
//   // (needed for @response_actions resolution in instructions)
//   const tools = compileAvailableFormats(
//     def.reasoning?.response_actions as
//       | NamedMap<Record<string, unknown>>
//       | undefined,
//     ctx
//   );
//
//   // Extract instructions from reasoning block
//   const instructionsNode = def.reasoning?.instructions as
//     | Record<string, unknown>
//     | undefined;
//   const instructionsRaw = instructionsNode
//     ? compileTemplateValue(instructionsNode, ctx, {
//         allowFormatReferences: true,
//       })
//     : undefined;
//   const instructions = instructionsRaw ? dedent(instructionsRaw) : undefined;
//
//   // Extract additional_system_instructions from connection level
//   const sysInstrNode = def.additional_system_instructions as
//     | Record<string, unknown>
//     | undefined;
//   const additionalSystemInstructionsRaw = sysInstrNode
//     ? compileTemplateValue(sysInstrNode, ctx, { allowFormatReferences: true })
//     : undefined;
//   const additionalSystemInstructions = additionalSystemInstructionsRaw
//     ? dedent(additionalSystemInstructionsRaw)
//     : undefined;
//
//   // Compile outbound route configs (includes escalation_message)
//   const outboundRouteConfigs = compileOutboundRouteConfigs(def, ctx);
//
//   // Compile inputs
//   const inputs = compileInputs(def, ctx);
//
//   // Compile format_definitions (response_formats from .agent file)
//   const responseFormats = compileResponseFormats(
//     def.response_formats as NamedMap<Record<string, unknown>> | undefined,
//     ctx
//   );
//
//   // Validate connection type constraints
//   validateConnection(name, connectionType, def, agentType, ctx);
//
//   const surface: Sourceable<Surface> = {
//     surface_type: connectionType,
//     ...(connectionType === CUSTOM_CONNECTION_TYPE ? { name } : {}),
//   };
//   if (label !== undefined) {
//     surface.label = label;
//   }
//   if (description !== undefined) {
//     surface.description = description;
//   }
//   if (source !== undefined) {
//     surface.source = source;
//   }
//   if (adaptiveResponseAllowed !== undefined) {
//     surface.adaptive_response_allowed = adaptiveResponseAllowed;
//   }
//   if (instructions !== undefined) {
//     surface.instructions = instructions;
//   }
//   if (additionalSystemInstructions !== undefined) {
//     surface.additional_system_instructions = additionalSystemInstructions;
//   }
//   // Always include outbound_route_configs (empty array when none configured)
//   surface.outbound_route_configs = outboundRouteConfigs;
//   if (inputs.length > 0) {
//     surface.inputs = inputs;
//   }
//   if (responseFormats.length > 0) {
//     surface.format_definitions = responseFormats;
//   }
//   if (tools.length > 0) {
//     surface.tools = tools;
//   }
//
//   return surface as Surface;
// }

/**
 * Map a connection block name to a surface type.
 * Known types are normalized via the lookup table; unknown types pass through as-is.
 */
function getConnectionType(name: string): string {
  return CONNECTION_TYPES[name.toLowerCase()] ?? name;
  // return CONNECTION_TYPES[name.toLowerCase()] ?? CUSTOM_CONNECTION_TYPE;
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

function compileInputs(
  def: ParsedConnection,
  ctx: CompilerContext
): SurfaceInputParameter[] {
  const inputs = def.inputs;
  if (!inputs) return [];

  const result: SurfaceInputParameter[] = [];

  for (const [name, decl] of iterateNamedMap(
    inputs as NamedMap<ParameterDeclarationNode> | undefined
  )) {
    const param = compileConnectionInput(name, decl, ctx);
    if (param) result.push(param);
  }

  return result;
}

/**
 * Compile a connection input as a surface input parameter.
 */
function compileConnectionInput(
  name: string,
  decl: ParameterDeclarationNode,
  _ctx: CompilerContext
): SurfaceInputParameter | undefined {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr) return undefined;

  // Properties nested under .properties
  const props = decl.properties as Record<string, unknown> | undefined;

  const dataType = toSurfaceInputParameterDataType(typeStr);

  // Extract default value
  const defaultValue = extractDefaultValue(decl.defaultValue, dataType, false);

  const label =
    extractStringValue(props?.['label']) ?? normalizeDeveloperName(name);
  const description =
    extractSourcedDescription(props?.['description']) ?? label;

  const inputParam: Sourceable<SurfaceInputParameter> = {
    developer_name: name,
    label,
    description,
    data_type: dataType,
  };

  // Only include default_value when it has a value
  if (defaultValue !== null) {
    inputParam.default_value = defaultValue;
  }

  return inputParam as SurfaceInputParameter;
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
