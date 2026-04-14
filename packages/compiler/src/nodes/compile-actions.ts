import {
  NamedMap,
  ParameterDeclarationNode,
  MemberExpression,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type {
  ActionDefinition,
  InputParameter,
  OutputParameter,
} from '../types.js';
import { resolveParameterTypeInfo } from '../variables/variable-utils.js';
import { normalizeDeveloperName, parseUri } from '../utils.js';
import {
  extractStringValue,
  extractBooleanValue,
  extractSourcedString,
  extractSourcedDescription,
  extractSourcedBoolean,
  getCstRange,
  getExpressionName,
  isListType,
  iterateNamedMap,
} from '../ast-helpers.js';
import type { Sourced, Sourceable } from '../sourced.js';
import { sourced } from '../sourced.js';

/**
 * Compile action definitions from a topic's actions map.
 */
export function compileActionDefinitions(
  actions: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): ActionDefinition[] {
  if (!actions) return [];

  const result: ActionDefinition[] = [];

  for (const [name, def] of iterateNamedMap(actions)) {
    const actionConfig = compileActionDefinition(name, def, ctx);
    if (actionConfig) {
      result.push(actionConfig);
    }
  }

  return result;
}

function compileActionDefinition(
  name: string,
  def: Record<string, unknown>,
  ctx: CompilerContext
): ActionDefinition | undefined {
  const description = extractSourcedDescription(def['description']) ?? '';
  const label =
    extractSourcedString(def['label']) ?? normalizeDeveloperName(name);

  const requireUserConfirmation =
    extractSourcedBoolean(def['require_user_confirmation']) ?? false;
  const includeInProgressIndicator =
    extractSourcedBoolean(def['include_in_progress_indicator']) ?? false;
  const progressIndicatorMessage =
    extractSourcedString(def['progress_indicator_message']) ?? undefined;

  // Parse target URI (e.g. "flow://check_business_hours") to derive invocation type/name
  const targetUri = extractStringValue(def['target']);
  let invocationTargetType = 'externalService';
  let invocationTargetName = name;

  if (targetUri) {
    const { scheme, path } = parseUri(targetUri);
    if (scheme) invocationTargetType = scheme;
    if (path) invocationTargetName = path;
  }

  const inputType = compileInputParameters(
    def['inputs'] as NamedMap<ParameterDeclarationNode> | undefined,
    ctx
  );
  const outputType = compileOutputParameters(
    def['outputs'] as NamedMap<ParameterDeclarationNode> | undefined,
    ctx
  );

  // source is only set when explicitly specified in the .agent file
  const source = extractSourcedString(def['source']) ?? undefined;

  const actionDef2: Sourceable<ActionDefinition> = {
    developer_name: name,
    label,
    description,
    require_user_confirmation: requireUserConfirmation,
    include_in_progress_indicator: includeInProgressIndicator,
    invocation_target_type: invocationTargetType,
    invocation_target_name: invocationTargetName,
    input_type: inputType,
    output_type: outputType,
  };

  // Add optional fields only when they have values
  if (source !== undefined) {
    (actionDef2 as Record<string, unknown>).source = source;
  }
  if (progressIndicatorMessage !== undefined) {
    (actionDef2 as Record<string, unknown>).progress_indicator_message =
      progressIndicatorMessage;
  }

  return actionDef2 as ActionDefinition;
}

function compileInputParameters(
  inputs: NamedMap<ParameterDeclarationNode> | undefined,
  ctx: CompilerContext
): InputParameter[] {
  if (!inputs) return [];

  const result: InputParameter[] = [];

  for (const [name, decl] of iterateNamedMap(inputs)) {
    const param = compileInputParameter(name, decl, ctx);
    if (param) result.push(param);
  }

  return result;
}

function compileInputParameter(
  name: string,
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
): InputParameter | undefined {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr) return undefined;

  // Properties (is_required, label, description, etc.) are nested under .properties
  const props = decl.properties as Record<string, unknown> | undefined;

  const isList = isListType(decl.type);
  const complexDataTypeName =
    extractStringValue(props?.['complex_data_type_name']) ?? undefined;
  const { dataType, complexDataTypeName: resolvedComplexName } =
    resolveParameterTypeInfo(typeStr, isList, complexDataTypeName);

  const isUserInput = extractSourcedBoolean(props?.['is_user_input']) ?? false;
  const required = extractSourcedBoolean(props?.['is_required']) ?? false;
  const schemaUri = extractSourcedString(props?.['schema']) ?? undefined;
  const constantValue = extractConstantValue(decl, ctx);

  const label =
    extractSourcedString(props?.['label']) ?? normalizeDeveloperName(name);
  const param: Sourceable<InputParameter> = {
    developer_name: name,
    label,
    description:
      extractSourcedDescription(props?.['description']) ??
      extractStringValue(props?.['label']) ??
      normalizeDeveloperName(name),
    data_type: dataType,
    is_list: isList,
    required,
    is_user_input: isUserInput,
  };

  // Add optional fields only when they have values
  if (resolvedComplexName != null) {
    // Use the resolved name (prefix-stripped) but carry the source range
    const cdtRange = getCstRange(props?.['complex_data_type_name']);
    param.complex_data_type_name = sourced(resolvedComplexName, cdtRange);
  }
  if (constantValue !== null) {
    param.constant_value = constantValue;
  }
  if (schemaUri !== undefined) {
    (param as Record<string, unknown>).schema = schemaUri;
  }

  return param as InputParameter;
}

function compileOutputParameters(
  outputs: NamedMap<ParameterDeclarationNode> | undefined,
  ctx: CompilerContext
): OutputParameter[] {
  if (!outputs) return [];

  const result: OutputParameter[] = [];

  for (const [name, decl] of iterateNamedMap(outputs)) {
    const param = compileOutputParameter(name, decl, ctx);
    if (param) result.push(param);
  }

  return result;
}

function compileOutputParameter(
  name: string,
  decl: ParameterDeclarationNode,
  _ctx: CompilerContext
): OutputParameter | undefined {
  const typeStr = getExpressionName(decl.type);
  if (!typeStr) return undefined;

  // Properties (is_displayable, label, description, etc.) are nested under .properties
  const props = decl.properties as Record<string, unknown> | undefined;

  const isList = isListType(decl.type);
  const complexDataTypeName =
    extractStringValue(props?.['complex_data_type_name']) ?? undefined;
  const { dataType, complexDataTypeName: resolvedComplexName } =
    resolveParameterTypeInfo(typeStr, isList, complexDataTypeName);

  // Precedence logic: filter_from_agent takes precedence over is_used_by_planner
  // 1. If filter_from_agent is True, set is_used_by_planner to False (filter out)
  // 2. If filter_from_agent is False and is_used_by_planner is explicitly set, use it
  // 3. Otherwise default to True (don't filter)
  const filterFromAgent = extractBooleanValue(props?.['filter_from_agent']);
  const explicitIsUsedByPlanner = extractSourcedBoolean(
    props?.['is_used_by_planner']
  );
  const isDisplayable =
    extractSourcedBoolean(props?.['is_displayable']) ?? false;

  const isUsedByPlanner =
    filterFromAgent === true
      ? false // Override to false when filtering
      : (explicitIsUsedByPlanner ?? true); // Use explicit value or default to true

  const outLabel =
    extractSourcedString(props?.['label']) ?? normalizeDeveloperName(name);
  const param: Sourceable<OutputParameter> = {
    developer_name: name,
    label: outLabel,
    description:
      extractSourcedDescription(props?.['description']) ??
      normalizeDeveloperName(name),
    data_type: dataType,
    is_list: isList,
    is_used_by_planner: isUsedByPlanner,
    is_displayable: isDisplayable,
  };

  // Add optional fields only when they have values
  if (resolvedComplexName != null) {
    const cdtRange = getCstRange(props?.['complex_data_type_name']);
    param.complex_data_type_name = sourced(resolvedComplexName, cdtRange);
  }

  return param as OutputParameter;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractConstantValue(
  decl: ParameterDeclarationNode,
  ctx: CompilerContext
): Sourced<string | boolean> | null {
  const dv = decl.defaultValue;
  if (!dv) return null;

  // @knowledge references must be resolved at compile time because compiled
  // output cannot contain dynamic references - all constant values must be concrete
  if (dv instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(dv);
    if (decomposed && decomposed.namespace === 'knowledge') {
      const value = ctx.knowledgeFields.get(decomposed.property);
      if (value !== undefined) {
        return sourced(value, getCstRange(dv));
      }
      ctx.error(
        `Unknown @knowledge field: '${decomposed.property}'`,
        getCstRange(dv)
      );
    }
    // Other namespaces (@variables, @outputs, etc.) cannot be constant values
    return null;
  }

  // Handle literal string defaults
  const sourcedStr = extractSourcedString(dv);
  if (sourcedStr !== undefined) return sourcedStr;

  // Handle literal boolean defaults
  const sourcedBool = extractSourcedBoolean(dv);
  if (sourcedBool !== undefined) return sourcedBool;

  return null;
}
