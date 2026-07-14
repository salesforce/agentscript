/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { NamedMap, ParameterDeclarationNode } from '@agentscript/language';
import type { BlockCore } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  OutboundRouteConfig,
  ResponseAction,
  Surface,
  SurfaceInputParameter,
} from '../types.js';
import type { ParsedConnection } from '../parsed-types.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedBoolean,
  extractSourcedDescription,
  getExpressionName,
  iterateNamedMap,
} from '../ast-helpers.js';
import { dedent, normalizeDeveloperName } from '../utils.js';
import type { Sourceable } from '../sourced.js';
import { extractDefaultValue } from '../variables/state-variables.js';
import { compileResponseFormats } from './compile-response-formats.js';
import { compileTemplateValue } from '../expressions/compile-template.js';

/**
 * Known connection type mappings.
 */
const CONNECTION_TYPES: Record<string, string> = {
  messaging: 'messaging',
  service_email: 'service_email',
  slack: 'slack',
  telephony: 'telephony',
  voice: 'voice',
  customer_web_client: 'customer_web_client',
};

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

  // Set connection name for @inputs reference resolution
  ctx.connectionName = name;

  // Clear response format reference map for this surface
  ctx.responseFormatReferenceMap.clear();

  // Compile reasoning.response_actions first to populate responseFormatReferenceMap
  // (needed for @response_actions resolution in instructions)
  const responseActions = compileResponseActions(
    def.reasoning?.response_actions as
      | NamedMap<Record<string, unknown>>
      | undefined,
    ctx
  );

  // Extract instructions from reasoning block (template-based, format references allowed)
  const instructionsNode = def.reasoning?.instructions as
    | Record<string, unknown>
    | undefined;
  const instructions = instructionsNode
    ? dedent(
        compileTemplateValue(instructionsNode, ctx, {
          allowFormatReferences: true,
        })
      )
    : undefined;

  // Compile outbound route configs (includes escalation_message)
  const outboundRouteConfigs = compileOutboundRouteConfigs(def, ctx);

  // Compile inputs (aka surface variables)
  const inputs = compileInputs(def, ctx);

  // Compile format_definitions (response_formats)
  const responseFormats = compileResponseFormats(
    def.response_formats as NamedMap<BlockCore> | undefined,
    ctx
  );

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

  if (responseFormats.length > 0) {
    surface.response_formats = responseFormats;
  }

  if (responseActions.length > 0) {
    surface.response_actions = responseActions;
  }
  if (inputs.length > 0) {
    surface.input_parameters = inputs;
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

/**
 * Compile reasoning.response_actions from a connection block.
 * Returns ResponseAction[] for JSON output.
 */
function compileResponseActions(
  responseActions: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): ResponseAction[] {
  if (!responseActions) return [];

  const result: ResponseAction[] = [];

  for (const [name, def] of iterateNamedMap(responseActions)) {
    // Colinear value is accessible via .value (NamedBlock getter)
    const colinear = def['value'] as Record<string, unknown> | undefined;

    // Extract the reference name from the expression
    const target = extractFormatReference(colinear);
    if (!target) continue;

    // Map reasoning.response_actions name to response_formats definition
    // target for @response_actions references
    ctx.responseFormatReferenceMap.set(name, target);

    result.push({
      target,
      name,
      description: normalizeDeveloperName(name),
    });
  }

  return result;
}

/**
 * Extract the format reference from a colinear expression.
 * Handles @response_formats.format_name -> "format_name"
 */
function extractFormatReference(
  expr: Record<string, unknown> | undefined
): string | undefined {
  if (!expr) return undefined;

  const kind = expr['__kind'] as string | undefined;

  if (kind === 'MemberExpression') {
    // @response_formats.format_name
    // Property can be a string directly or an Identifier node
    const property = expr['property'];
    if (typeof property === 'string') {
      return property;
    }
    if (typeof property === 'object' && property !== null) {
      const propObj = property as Record<string, unknown>;
      if (propObj['__kind'] === 'Identifier') {
        return propObj['name'] as string;
      }
    }
  }

  return undefined;
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
