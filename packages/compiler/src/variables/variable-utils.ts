/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Type mapping utilities for variables.
 *
 * Maps between AgentScript variable types and the various
 * output format type strings used in AgentJSON.
 */

import { z } from 'zod';
import {
  stateVariableType,
  contextVariableType,
  parameterDataType,
} from '../generated/agent-dsl.js';

// Enum types inferred from the zod schema
export type StateVariableDataType = z.infer<typeof stateVariableType>;
export type ContextVariableDataType = z.infer<typeof contextVariableType>;
export type ParameterDataType = z.infer<typeof parameterDataType>;

// ---------------------------------------------------------------------------
// Variable → StateVariable data_type
// ---------------------------------------------------------------------------

const SCALAR_TO_STATE_VARIABLE_TYPE: Record<string, StateVariableDataType> = {
  string: 'string',
  text: 'string',
  number: 'number',
  boolean: 'boolean',
  object: 'object',
  date: 'date',
  datetime: 'timestamp',
  timestamp: 'timestamp',
  currency: 'currency',
  id: 'string',
};

export function toStateVariableDataType(
  scalarType: string
): StateVariableDataType | undefined {
  return SCALAR_TO_STATE_VARIABLE_TYPE[scalarType.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Variable → ContextVariable data_type
// ---------------------------------------------------------------------------

const SCALAR_TO_CONTEXT_VARIABLE_TYPE: Record<string, ContextVariableDataType> =
  {
    string: 'string',
    text: 'string',
    number: 'number',
    boolean: 'boolean',
    date: 'date',
    datetime: 'timestamp',
    timestamp: 'timestamp',
    currency: 'currency',
    id: 'id',
  };

export function toContextVariableDataType(
  scalarType: string
): ContextVariableDataType | undefined {
  return SCALAR_TO_CONTEXT_VARIABLE_TYPE[scalarType.toLowerCase()];
}

// ---------------------------------------------------------------------------
// Variable → ParameterDataType (for action inputs/outputs)
// ---------------------------------------------------------------------------

const SCALAR_TO_PARAMETER_DATA_TYPE: Record<string, ParameterDataType> = {
  string: 'String',
  text: 'String',
  number: 'Double',
  integer: 'Integer',
  long: 'Long',
  boolean: 'Boolean',
  object: 'LightningTypes',
  date: 'Date',
  datetime: 'DateTime',
  timestamp: 'DateTime',
  currency: 'Double',
  id: 'ID',
};

export function toParameterDataType(
  scalarType: string
): ParameterDataType | undefined {
  return SCALAR_TO_PARAMETER_DATA_TYPE[scalarType.toLowerCase()];
}

/**
 * Resolve the final parameter data type and complex_data_type_name
 * for action parameters.
 */
export function resolveParameterTypeInfo(
  scalarType: string,
  _isList: boolean,
  complexDataTypeName?: string
): { dataType: ParameterDataType; complexDataTypeName: string | null } {
  const baseType = toParameterDataType(scalarType);

  if (!baseType) {
    return {
      dataType: 'String',
      complexDataTypeName: complexDataTypeName ?? null,
    };
  }

  // Object types with complex data type names use specific handling
  if (baseType === 'LightningTypes' && complexDataTypeName) {
    // Check if this is an Apex class type
    if (complexDataTypeName.startsWith('@apexClassType/')) {
      // Strip the @apexClassType/ prefix and use ApexDefined as data_type
      const strippedName = complexDataTypeName.substring(
        '@apexClassType/'.length
      );
      return {
        dataType: 'ApexDefined',
        complexDataTypeName: strippedName,
      };
    }

    return {
      dataType: 'LightningTypes',
      complexDataTypeName,
    };
  }

  // Object types default to lightning__objectType
  if (baseType === 'LightningTypes') {
    return {
      dataType: 'LightningTypes',
      complexDataTypeName: 'lightning__objectType',
    };
  }

  // For other types, preserve explicit complex_data_type_name without
  // promoting the base type (e.g., String with lightning__textType stays String)
  return {
    dataType: baseType,
    complexDataTypeName: complexDataTypeName ?? null,
  };
}

// ---------------------------------------------------------------------------
// State variable → Parameter data type
// ---------------------------------------------------------------------------

const STATE_VAR_TO_PARAMETER_TYPE: Record<string, ParameterDataType> = {
  string: 'String',
  number: 'Double',
  boolean: 'Boolean',
  object: 'LightningTypes',
  date: 'Date',
  timestamp: 'DateTime',
  currency: 'Double',
  id: 'ID',
};

export function stateVarToParameterDataType(
  stateVarType: string
): ParameterDataType {
  return STATE_VAR_TO_PARAMETER_TYPE[stateVarType] ?? 'String';
}

// ---------------------------------------------------------------------------
// String types that get single-quoted default values
// ---------------------------------------------------------------------------

const STRING_TYPES = new Set(['string', 'date', 'timestamp', 'id']);

export function isStringType(dataType: string): boolean {
  return STRING_TYPES.has(dataType.toLowerCase());
}

// ---------------------------------------------------------------------------
// Unsupported variable types
// ---------------------------------------------------------------------------

const UNSUPPORTED_TYPES = new Set(['datetime', 'time', 'integer', 'long']);

export function isUnsupportedVariableType(typeStr: string): boolean {
  return UNSUPPORTED_TYPES.has(typeStr.toLowerCase());
}
