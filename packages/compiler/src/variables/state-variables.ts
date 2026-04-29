/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Expression } from '@agentscript/language';
import {
  NamedMap,
  VariableDeclarationNode,
  NoneLiteral,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { ContextVariable, StateVariable } from '../types.js';
import type { Range } from '@agentscript/types';
import {
  ALWAYS_PRESENT_STATE_VARIABLES,
  INSTRUCTION_STATE_VARIABLE,
  CONDITION_STATE_VARIABLE,
} from '../constants.js';
import { toStateVariableDataType, isStringType } from './variable-utils.js';
import { normalizeDeveloperName } from '../utils.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedDescription,
  extractBooleanValue,
  extractNumberValue,
  extractExpressionValue,
  getExpressionName,
  isListType,
  iterateNamedMap,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';

/**
 * Compile all state variables from the AST.
 *
 * Includes:
 * - Always-present internal variables (next_topic)
 * - Conditional internal variables (agent_instructions, condition) when needed
 * - User-defined mutable variables
 */
export function compileStateVariables(
  variables: NamedMap<VariableDeclarationNode> | undefined,
  contextVariables: ContextVariable[],
  _blocks: unknown[],
  ctx: CompilerContext
): StateVariable[] {
  const result: StateVariable[] = [];

  // Always-present internal state variables
  for (const sv of ALWAYS_PRESENT_STATE_VARIABLES) {
    result.push({ ...sv });
  }

  // Always include instruction and condition variables
  result.push({ ...INSTRUCTION_STATE_VARIABLE });
  result.push({ ...CONDITION_STATE_VARIABLE });

  // User-defined mutable variables
  if (variables) {
    const contextVarNames = new Set(
      contextVariables.map(v => v.developer_name)
    );
    const internalNames = new Set(result.map(v => v.developer_name));

    for (const [name, def] of iterateNamedMap(variables)) {
      // Skip linked variables (those are context variables)
      if (def.modifier?.name === 'linked') continue;

      // Skip if already exists as context or internal variable
      if (contextVarNames.has(name) || internalNames.has(name)) continue;

      const stateVar = compileStateVariable(name, def, ctx);
      if (stateVar) {
        result.push(stateVar);
        ctx.mutableVariableNames.add(name);
      }
    }
  }

  return result;
}

function compileStateVariable(
  name: string,
  def: VariableDeclarationNode,
  ctx: CompilerContext
): StateVariable | undefined {
  // Validate variable name
  if (name.startsWith('_') || name.endsWith('_')) {
    ctx.warning(
      `Variable name '${name}' should not start or end with underscores`,
      def.__cst?.range
    );
  }

  if (name.includes('__')) {
    ctx.error(
      `Variable name '${name}' should not contain double underscores`,
      def.__cst?.range
    );
    return undefined;
  }

  const typeStr = getExpressionName(def.type);
  if (!typeStr) {
    ctx.error(`Variable '${name}' is missing a type`, def.__cst?.range);
    return undefined;
  }

  const dataType = toStateVariableDataType(typeStr);
  if (!dataType) {
    ctx.error(
      `Unsupported state variable type: '${typeStr}' for variable '${name}'`,
      def.__cst?.range
    );
    return undefined;
  }

  const isList = isListType(def.type);
  const defaultValue = extractDefaultValue(def.defaultValue, dataType, isList);
  const label =
    extractSourcedString(
      (def.properties as Record<string, unknown> | undefined)?.['label']
    ) ?? normalizeDeveloperName(name);
  const description =
    extractSourcedDescription(
      (def.properties as Record<string, unknown> | undefined)?.['description']
    ) ?? label;
  const rawVisibility = extractStringValue(
    (def.properties as Record<string, unknown> | undefined)?.['visibility']
  );
  const visibility = mapVisibility(rawVisibility, name, ctx, def.__cst?.range);

  const stateVar: Sourceable<StateVariable> = {
    developer_name: name,
    label,
    description,
    data_type: dataType,
    is_list: isList,
    visibility,
  };

  // Only include default when it has a value
  if (defaultValue !== null) {
    stateVar.default = defaultValue as StateVariable['default'];
  }

  return stateVar as StateVariable;
}

function mapVisibility(
  value: string | undefined,
  variableName: string,
  ctx: CompilerContext,
  range: Range | undefined
): 'Internal' | 'External' {
  if (!value) return 'Internal';

  const normalized = value.trim().toLowerCase();
  if (normalized === 'private' || normalized === 'internal') {
    return 'Internal';
  }
  if (normalized === 'public' || normalized === 'external') {
    return 'External';
  }

  ctx.warning(
    `Unknown visibility "${value}" on variable '${variableName}'. Expected public/private (or External/Internal); defaulting to Internal.`,
    range
  );
  return 'Internal';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function extractDefaultValue(
  defaultVal: Expression | undefined,
  dataType: string,
  isList: boolean
): string | number | boolean | unknown[] | Record<string, unknown> | null {
  if (defaultVal === undefined || defaultVal === null) return null;

  // `= None` parses to a NoneLiteral AST node — Python omits default for None,
  // so we treat it as "no default" regardless of the data type.
  if (defaultVal instanceof NoneLiteral) {
    return null;
  }

  // List defaults: extract the list literal elements as-is. Unlike scalar
  // string defaults, list string elements are NOT single-quoted.
  if (isList) {
    if (defaultVal.__kind !== 'ListLiteral') return null;
    const raw = extractExpressionValue(defaultVal);
    if (!Array.isArray(raw)) return [];
    return raw;
  }

  // Object (non-list) defaults: populate from the dict literal entries.
  // Empty `{}` (or anything non-dict) falls back to an empty object.
  if (dataType === 'object') {
    if (defaultVal.__kind !== 'DictLiteral') return {};
    const raw = extractExpressionValue(defaultVal);
    return (raw as Record<string, unknown> | undefined) ?? {};
  }

  // Primitive scalar defaults
  const strVal = extractStringValue(defaultVal);
  if (strVal !== undefined) {
    // String types get single-quoted defaults
    if (isStringType(dataType)) {
      return `'${strVal}'`;
    }
    return strVal;
  }

  const numVal = extractNumberValue(defaultVal);
  if (numVal !== undefined) return numVal;

  const boolVal = extractBooleanValue(defaultVal);
  if (boolVal !== undefined) return boolVal;

  return null;
}
