/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  toStateVariableDataType,
  toContextVariableDataType,
  toParameterDataType,
  resolveParameterTypeInfo,
  stateVarToParameterDataType,
  isStringType,
  isUnsupportedVariableType,
} from '../src/variables/variable-utils.js';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

// ---------------------------------------------------------------------------
// Variable type mapping utilities
// ---------------------------------------------------------------------------

describe('toStateVariableDataType', () => {
  it('should map string to string', () => {
    expect(toStateVariableDataType('string')).toBe('string');
  });

  it('should map text to string', () => {
    expect(toStateVariableDataType('text')).toBe('string');
  });

  it('should map number to number', () => {
    expect(toStateVariableDataType('number')).toBe('number');
  });

  it('should map boolean to boolean', () => {
    expect(toStateVariableDataType('boolean')).toBe('boolean');
  });

  it('should map object to object', () => {
    expect(toStateVariableDataType('object')).toBe('object');
  });

  it('should map date to date', () => {
    expect(toStateVariableDataType('date')).toBe('date');
  });

  it('should map datetime to timestamp', () => {
    expect(toStateVariableDataType('datetime')).toBe('timestamp');
  });

  it('should map currency to currency', () => {
    expect(toStateVariableDataType('currency')).toBe('currency');
  });

  it('should map id to string', () => {
    expect(toStateVariableDataType('id')).toBe('string');
  });

  it('should be case-insensitive', () => {
    expect(toStateVariableDataType('String')).toBe('string');
    expect(toStateVariableDataType('NUMBER')).toBe('number');
  });

  it('should return undefined for unknown types', () => {
    expect(toStateVariableDataType('foo')).toBeUndefined();
  });
});

describe('toContextVariableDataType', () => {
  it('should map string to string', () => {
    expect(toContextVariableDataType('string')).toBe('string');
  });

  it('should map number to number', () => {
    expect(toContextVariableDataType('number')).toBe('number');
  });

  it('should map datetime to timestamp', () => {
    expect(toContextVariableDataType('datetime')).toBe('timestamp');
  });
});

describe('toParameterDataType', () => {
  it('should map string to String', () => {
    expect(toParameterDataType('string')).toBe('String');
  });

  it('should map number to Double', () => {
    expect(toParameterDataType('number')).toBe('Double');
  });

  it('should map boolean to Boolean', () => {
    expect(toParameterDataType('boolean')).toBe('Boolean');
  });

  it('should map object to LightningTypes', () => {
    expect(toParameterDataType('object')).toBe('LightningTypes');
  });

  it('should map date to Date', () => {
    expect(toParameterDataType('date')).toBe('Date');
  });

  it('should map datetime to DateTime', () => {
    expect(toParameterDataType('datetime')).toBe('DateTime');
  });

  it('should map currency to Double', () => {
    expect(toParameterDataType('currency')).toBe('Double');
  });

  it('should map id to ID', () => {
    expect(toParameterDataType('id')).toBe('ID');
  });
});

describe('resolveParameterTypeInfo', () => {
  it('should resolve basic string type', () => {
    const result = resolveParameterTypeInfo('string', false);
    expect(result.dataType).toBe('String');
    expect(result.complexDataTypeName).toBeNull();
  });

  it('should resolve object with complex data type name', () => {
    const result = resolveParameterTypeInfo('object', false, 'MyCustomType');
    expect(result.dataType).toBe('LightningTypes');
    expect(result.complexDataTypeName).toBe('MyCustomType');
  });

  it('should resolve object list without explicit complex type', () => {
    const result = resolveParameterTypeInfo('object', true);
    expect(result.dataType).toBe('LightningTypes');
    expect(result.complexDataTypeName).toBe('lightning__objectType');
  });

  it('should default to String for unknown types', () => {
    const result = resolveParameterTypeInfo('unknown', false);
    expect(result.dataType).toBe('String');
    expect(result.complexDataTypeName).toBeNull();
  });
});

describe('stateVarToParameterDataType', () => {
  it('should map string to String', () => {
    expect(stateVarToParameterDataType('string')).toBe('String');
  });

  it('should map number to Double', () => {
    expect(stateVarToParameterDataType('number')).toBe('Double');
  });

  it('should default to String for unknown types', () => {
    expect(stateVarToParameterDataType('unknown')).toBe('String');
  });
});

describe('isStringType', () => {
  it('should identify string as a string type', () => {
    expect(isStringType('string')).toBe(true);
  });

  it('should identify date as a string type', () => {
    expect(isStringType('date')).toBe(true);
  });

  it('should identify timestamp as a string type', () => {
    expect(isStringType('timestamp')).toBe(true);
  });

  it('should identify id as a string type', () => {
    expect(isStringType('id')).toBe(true);
  });

  it('should not identify number as string type', () => {
    expect(isStringType('number')).toBe(false);
  });

  it('should not identify boolean as string type', () => {
    expect(isStringType('boolean')).toBe(false);
  });
});

describe('isUnsupportedVariableType', () => {
  it('should identify datetime as unsupported', () => {
    expect(isUnsupportedVariableType('datetime')).toBe(true);
  });

  it('should not identify string as unsupported', () => {
    expect(isUnsupportedVariableType('string')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// State variable compilation (integration)
// ---------------------------------------------------------------------------

describe('state variables compilation', () => {
  it('should compile string variable with default value', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    user_name: mutable string = "default"
        description: "The user name"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const userNameVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'user_name'
    );
    expect(userNameVar).toBeDefined();
    expect(userNameVar!.data_type).toBe('string');
    expect(userNameVar!.is_list).toBe(false);
    expect(userNameVar!.visibility).toBe('Internal');
  });

  it('should compile number variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    count: mutable number = 0
        description: "A counter"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const countVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'count'
    );
    expect(countVar).toBeDefined();
    expect(countVar!.data_type).toBe('number');
    expect(countVar!.default).toBe(0);
  });

  it('should compile boolean variable', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    is_active: mutable boolean = False
        description: "Active flag"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);
    const boolVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'is_active'
    );
    expect(boolVar).toBeDefined();
    expect(boolVar!.data_type).toBe('boolean');
  });

  it('should not duplicate internal variables with user variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    my_var: mutable string = ""

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);

    const nextTopicCount = output.agent_version.state_variables.filter(
      v => v.developer_name === 'AgentScriptInternal_next_topic'
    ).length;
    expect(nextTopicCount).toBe(1);
  });

  it('should not include linked variables as state variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    account_id: linked string
        description: "Linked account"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);

    const accountVar = output.agent_version.state_variables.find(
      v => v.developer_name === 'account_id'
    );
    expect(accountVar).toBeUndefined();
  });

  it('should include linked variables as context variables', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    account_id: linked string
        source: @Case.AccountId
        description: "Linked account"

start_agent main:
    description: "desc"
`;
    const ast = parseSource(source);
    const { output } = compile(ast);

    const contextVar = output.global_configuration.context_variables.find(
      v => v.developer_name === 'account_id'
    );
    expect(contextVar).toBeDefined();
    expect(contextVar!.field_mapping).toBe('Case.AccountId');
    expect(contextVar!.data_type).toBe('string');
  });
});
