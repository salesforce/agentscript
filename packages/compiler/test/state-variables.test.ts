/**
 * State variable compilation tests — ported from Python:
 * - test_state_variables.py
 *
 * Tests comprehensive state variable compilation covering type mappings,
 * label formatting, default values, name validation, list types, visibility,
 * and error diagnostics.
 *
 * Does NOT duplicate tests already in variables.test.ts (basic string/number/boolean,
 * internal variable deduplication, linked variable exclusion).
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import type { CompileResult } from '../src/compile.js';
import type { StateVariable, AgentVersion } from '../src/types.js';
import { DiagnosticSeverity } from '../src/diagnostics.js';
import { parseSource } from './test-utils.js';
import {
  NEXT_TOPIC_VARIABLE,
  AGENT_INSTRUCTIONS_VARIABLE,
  RUNTIME_CONDITION_VARIABLE,
} from '../src/constants.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The three always-present internal state variable names. */
const INTERNAL_VARIABLE_NAMES = new Set([
  NEXT_TOPIC_VARIABLE,
  AGENT_INSTRUCTIONS_VARIABLE,
  RUNTIME_CONDITION_VARIABLE,
]);

/** Compile a source string and return the CompileResult. */
function compileSource(source: string): CompileResult {
  return compile(parseSource(source));
}

/**
 * Extract state_variables from the compile result.
 * The agent_version can be a single object or an array; state_variables is optional.
 * The compiler always produces a single agent_version with state_variables populated.
 */
function getStateVariables(result: CompileResult): StateVariable[] {
  const av = result.output.agent_version as AgentVersion;
  return (av.state_variables ?? []) as StateVariable[];
}

/** Extract user-defined (non-internal) state variables from a compile result. */
function getUserStateVariables(result: CompileResult): StateVariable[] {
  return getStateVariables(result).filter(
    (v: StateVariable) => !INTERNAL_VARIABLE_NAMES.has(v.developer_name)
  );
}

/** Find a state variable by developer_name. */
function findStateVar(
  result: CompileResult,
  name: string
): StateVariable | undefined {
  return getStateVariables(result).find(
    (v: StateVariable) => v.developer_name === name
  );
}

/** Minimal .agent scaffold: wraps a variables block with required config + start_agent. */
function agentSource(variablesBlock: string): string {
  return `
config:
    agent_name: "TestBot"

${variablesBlock}

start_agent main:
    description: "desc"
`;
}

// ---------------------------------------------------------------------------
// Label formatting
// ---------------------------------------------------------------------------

describe('state variables: label formatting', () => {
  it('should generate title-case label from snake_case name', () => {
    const result = compileSource(
      agentSource(`
variables:
    complex_variable_name: mutable string = "test"`)
    );
    const sv = findStateVar(result, 'complex_variable_name');
    expect(sv).toBeDefined();
    expect(sv!.label).toBe('Complex Variable Name');
  });

  it('should generate title-case label from a single-word name', () => {
    const result = compileSource(
      agentSource(`
variables:
    simple: mutable string`)
    );
    const sv = findStateVar(result, 'simple');
    expect(sv).toBeDefined();
    expect(sv!.label).toBe('Simple');
  });

  it('should use label as description when no explicit description is given', () => {
    const result = compileSource(
      agentSource(`
variables:
    my_var: mutable string`)
    );
    const sv = findStateVar(result, 'my_var');
    expect(sv).toBeDefined();
    expect(sv!.label).toBe('My Var');
    expect(sv!.description).toBe('My Var');
  });

  it('should use explicit description when provided', () => {
    const result = compileSource(
      agentSource(`
variables:
    my_var: mutable string
        description: "Custom description here"`)
    );
    const sv = findStateVar(result, 'my_var');
    expect(sv).toBeDefined();
    expect(sv!.description).toBe('Custom description here');
  });

  it('should use explicit label when provided', () => {
    const result = compileSource(
      agentSource(`
variables:
    my_var: mutable string
        label: "My Custom Label"`)
    );
    const sv = findStateVar(result, 'my_var');
    expect(sv).toBeDefined();
    expect(sv!.label).toBe('My Custom Label');
  });

  it('should split CamelCase names into spaced title case', () => {
    const result = compileSource(
      agentSource(`
variables:
    MixedCase: mutable string`)
    );
    const sv = findStateVar(result, 'MixedCase');
    expect(sv).toBeDefined();
    // normalizeDeveloperName splits CamelCase: "Mixed Case"
    expect(sv!.label).toBe('Mixed Case');
  });
});

// ---------------------------------------------------------------------------
// Name validation warnings
// ---------------------------------------------------------------------------

describe('state variables: name validation', () => {
  it('should emit warning for variable name starting with underscore', () => {
    const result = compileSource(
      agentSource(`
variables:
    _leading: mutable string = "test"`)
    );

    const warnings = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Warning &&
        d.message.includes('start or end with underscores')
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain('_leading');
  });

  it('should emit warning for variable name ending with underscore', () => {
    const result = compileSource(
      agentSource(`
variables:
    trailing_: mutable string = "test"`)
    );

    const warnings = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Warning &&
        d.message.includes('start or end with underscores')
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain('trailing_');
  });

  it('should emit error for variable name with consecutive underscores', () => {
    const result = compileSource(
      agentSource(`
variables:
    bad__name: mutable string = "test"`)
    );

    const errors = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes('should not contain double underscores')
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('bad__name');
  });

  it('should produce schema-validation errors for names violating the developer_name regex', () => {
    // The Zod schema enforces /^[A-Za-z](_?[A-Za-z0-9])*$/ on developer_name.
    // Names with double underscores or leading underscores will fail validation.
    const result = compileSource(
      agentSource(`
variables:
    bad__name: mutable string = "test"`)
    );

    const errors = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes('should not contain double underscores')
    );
    // The name "bad__name" violates the developer_name rules, so we expect an error
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('bad__name');
  });

  it('should allow double underscores in source field mappings but not in variable names', () => {
    // Variable names with __ are rejected, but source field mappings with __ are allowed
    const result = compileSource(
      agentSource(`
variables:
    valid_name: linked string
        source: @session.some__field__name
        description: "Linked with double underscores in source"
    bad__name: mutable string = "test"`)
    );

    // The linked variable with double underscores in SOURCE should succeed
    const contextVars =
      result.output.global_configuration.context_variables ?? [];
    const linkedVar = contextVars.find(
      (v: { developer_name: string }) => v.developer_name === 'valid_name'
    );
    expect(linkedVar).toBeDefined();

    // The mutable variable with double underscores in NAME should fail
    const errors = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes('should not contain double underscores')
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('bad__name');

    // bad__name should NOT be in state_variables
    const badVar = findStateVar(result, 'bad__name');
    expect(badVar).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple variables with mixed types
// ---------------------------------------------------------------------------

describe('state variables: multiple variables with mixed types', () => {
  it('should compile multiple variables of different scalar types', () => {
    const result = compileSource(
      agentSource(`
variables:
    name: mutable string = "Alice"
    count: mutable number = 42
    active: mutable boolean = True
    data: mutable object`)
    );

    const nameVar = findStateVar(result, 'name');
    expect(nameVar).toBeDefined();
    expect(nameVar!.data_type).toBe('string');
    expect(nameVar!.default).toBe("'Alice'");
    expect(nameVar!.is_list).toBe(false);

    const countVar = findStateVar(result, 'count');
    expect(countVar).toBeDefined();
    expect(countVar!.data_type).toBe('number');
    expect(countVar!.default).toBe(42);

    const activeVar = findStateVar(result, 'active');
    expect(activeVar).toBeDefined();
    expect(activeVar!.data_type).toBe('boolean');
    expect(activeVar!.default).toBe(true);

    const dataVar = findStateVar(result, 'data');
    expect(dataVar).toBeDefined();
    expect(dataVar!.data_type).toBe('object');
  });

  it('should preserve ordering: internal variables first, then user variables', () => {
    const result = compileSource(
      agentSource(`
variables:
    alpha: mutable string
    beta: mutable number = 0`)
    );

    const stateVars = getStateVariables(result);

    // First N variables should be internal ones
    const internalCount = stateVars.filter(v =>
      INTERNAL_VARIABLE_NAMES.has(v.developer_name)
    ).length;
    expect(internalCount).toBe(3);

    // Internal vars should come before user vars
    const firstUserIdx = stateVars.findIndex(
      (v: StateVariable) => !INTERNAL_VARIABLE_NAMES.has(v.developer_name)
    );
    const lastInternalIdx = stateVars.reduce(
      (acc: number, v: StateVariable, idx: number) =>
        INTERNAL_VARIABLE_NAMES.has(v.developer_name) ? idx : acc,
      -1
    );
    expect(firstUserIdx).toBeGreaterThan(lastInternalIdx);
  });
});

// ---------------------------------------------------------------------------
// Mixed default values (null, zero, false)
// ---------------------------------------------------------------------------

describe('state variables: mixed default values', () => {
  it('should handle variable with no default (omitted)', () => {
    const result = compileSource(
      agentSource(`
variables:
    no_default: mutable string`)
    );

    const sv = findStateVar(result, 'no_default');
    expect(sv).toBeDefined();
    // When default is not provided, it should be omitted or undefined
    expect(sv!.default).toBeUndefined();
  });

  it('should omit default for object variable with no explicit default', () => {
    const result = compileSource(
      agentSource(`
variables:
    data: mutable object`)
    );

    const sv = findStateVar(result, 'data');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    // Python omits default for object vars with no explicit default — no {} synthesized
    expect(sv!.default).toBeUndefined();
  });

  it('should populate default for object variable with dict literal default', () => {
    const result = compileSource(
      agentSource(`
variables:
    order_billing_address: mutable object = {"is_completed":False, "first_name": "", "last_name": "", "street_address": "", "postal_code": "", "city": "", "province": ""}`)
    );

    const sv = findStateVar(result, 'order_billing_address');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({
      is_completed: false,
      first_name: '',
      last_name: '',
      street_address: '',
      postal_code: '',
      city: '',
      province: '',
    });
  });

  it('should populate default for list[object] variable with dict-literal elements', () => {
    const result = compileSource(
      agentSource(`
variables:
    test_list: mutable list[object] = [{"is_completed": True}]`)
    );

    const sv = findStateVar(result, 'test_list');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.is_list).toBe(true);
    expect(sv!.default).toEqual([{ is_completed: true }]);
  });

  it('should populate default for list[string] variable with bare string elements', () => {
    const result = compileSource(
      agentSource(`
variables:
    test_string_list: mutable list[string] = ["hello", "shaun"]`)
    );

    const sv = findStateVar(result, 'test_string_list');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('string');
    expect(sv!.is_list).toBe(true);
    // List string elements are NOT single-quoted (unlike scalar string defaults)
    expect(sv!.default).toEqual(['hello', 'shaun']);
  });

  it('should emit empty object default for object variable with {} default', () => {
    const result = compileSource(
      agentSource(`
variables:
    data: mutable object = {}`)
    );

    const sv = findStateVar(result, 'data');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({});
  });

  it('should omit default for object variable with None default', () => {
    const result = compileSource(
      agentSource(`
variables:
    data: mutable object = None`)
    );

    const sv = findStateVar(result, 'data');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    // Python treats "= None" as no default for object vars — should not emit {}
    expect(sv!.default).toBeUndefined();
  });

  it('should handle variable with zero default value', () => {
    const result = compileSource(
      agentSource(`
variables:
    zero_val: mutable number = 0`)
    );

    const sv = findStateVar(result, 'zero_val');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe(0);
  });

  it('should handle variable with negative number default', () => {
    const result = compileSource(
      agentSource(`
variables:
    negative_num: mutable number = -1`)
    );

    const sv = findStateVar(result, 'negative_num');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe(-1);
  });

  it('should handle variable with False default value', () => {
    const result = compileSource(
      agentSource(`
variables:
    flag: mutable boolean = False`)
    );

    const sv = findStateVar(result, 'flag');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe(false);
  });

  it('should handle variable with empty string default value', () => {
    const result = compileSource(
      agentSource(`
variables:
    empty_str: mutable string = ""`)
    );

    const sv = findStateVar(result, 'empty_str');
    expect(sv).toBeDefined();
    // Empty string gets single-quoted: "''"
    expect(sv!.default).toBe("''");
  });

  it('should compile mixed default values together correctly', () => {
    const result = compileSource(
      agentSource(`
variables:
    with_default: mutable string = "has_value"
    no_default: mutable string
    zero_default: mutable number = 0
    false_default: mutable boolean = False`)
    );

    const withDefault = findStateVar(result, 'with_default');
    expect(withDefault).toBeDefined();
    expect(withDefault!.default).toBe("'has_value'");

    const noDefault = findStateVar(result, 'no_default');
    expect(noDefault).toBeDefined();
    expect(noDefault!.default).toBeUndefined();

    const zeroDefault = findStateVar(result, 'zero_default');
    expect(zeroDefault).toBeDefined();
    expect(zeroDefault!.default).toBe(0);

    const falseDefault = findStateVar(result, 'false_default');
    expect(falseDefault).toBeDefined();
    expect(falseDefault!.default).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Empty variables block
// ---------------------------------------------------------------------------

describe('state variables: empty variables block', () => {
  it('should produce only internal state variables when no user variables are defined', () => {
    const result = compileSource(`
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`);

    const stateVars = getStateVariables(result);

    // Should contain exactly the 3 always-present internal variables
    expect(stateVars.length).toBe(3);

    const names = new Set(stateVars.map(v => v.developer_name));
    expect(names.has(NEXT_TOPIC_VARIABLE)).toBe(true);
    expect(names.has(AGENT_INSTRUCTIONS_VARIABLE)).toBe(true);
    expect(names.has(RUNTIME_CONDITION_VARIABLE)).toBe(true);
  });

  it('should have correct types on internal state variables', () => {
    const result = compileSource(`
config:
    agent_name: "TestBot"

start_agent main:
    description: "desc"
`);

    const nextTopic = findStateVar(result, NEXT_TOPIC_VARIABLE);
    expect(nextTopic).toBeDefined();
    expect(nextTopic!.data_type).toBe('string');
    expect(nextTopic!.visibility).toBe('Internal');

    const instructions = findStateVar(result, AGENT_INSTRUCTIONS_VARIABLE);
    expect(instructions).toBeDefined();
    expect(instructions!.data_type).toBe('string');

    const condition = findStateVar(result, RUNTIME_CONDITION_VARIABLE);
    expect(condition).toBeDefined();
    expect(condition!.data_type).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// Date, timestamp, currency, id type conversion
// ---------------------------------------------------------------------------

describe('state variables: date, timestamp, currency, id types', () => {
  it('should compile date variable type', () => {
    const result = compileSource(
      agentSource(`
variables:
    birth_date: mutable date = "2025-09-04"`)
    );

    const sv = findStateVar(result, 'birth_date');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('date');
    expect(sv!.is_list).toBe(false);
    // Date default values are string-typed and get single-quoted
    expect(sv!.default).toBe("'2025-09-04'");
  });

  it('should compile timestamp variable type', () => {
    const result = compileSource(
      agentSource(`
variables:
    created_at: mutable timestamp = "2025-09-04T12:01:00Z"`)
    );

    const sv = findStateVar(result, 'created_at');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('timestamp');
    expect(sv!.default).toBe("'2025-09-04T12:01:00Z'");
  });

  it('should compile currency variable type', () => {
    const result = compileSource(
      agentSource(`
variables:
    price: mutable currency = 123.45`)
    );

    const sv = findStateVar(result, 'price');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('currency');
    expect(sv!.default).toBe(123.45);
  });

  it('should compile id variable type as string', () => {
    // In the SCALAR_TO_STATE_VARIABLE_TYPE mapping, 'id' maps to 'string'
    const result = compileSource(
      agentSource(`
variables:
    record_id: mutable id = "user_123"`)
    );

    const sv = findStateVar(result, 'record_id');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('string');
    // id is a string-type, so defaults get single-quoted
    expect(sv!.default).toBe("'user_123'");
  });

  it('should compile datetime variable type as timestamp', () => {
    // In the SCALAR_TO_STATE_VARIABLE_TYPE mapping, 'datetime' maps to 'timestamp'
    const result = compileSource(
      agentSource(`
variables:
    event_time: mutable datetime = "2025-09-04T12:01:00Z"`)
    );

    const sv = findStateVar(result, 'event_time');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('timestamp');
  });
});

// ---------------------------------------------------------------------------
// List / array type conversion
// ---------------------------------------------------------------------------

describe('state variables: list type conversion', () => {
  it('should compile list[string] variable', () => {
    const result = compileSource(
      agentSource(`
variables:
    tags: mutable list[string]`)
    );

    const sv = findStateVar(result, 'tags');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('string');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[number] variable', () => {
    const result = compileSource(
      agentSource(`
variables:
    scores: mutable list[number]`)
    );

    const sv = findStateVar(result, 'scores');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('number');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[boolean] variable', () => {
    const result = compileSource(
      agentSource(`
variables:
    flags: mutable list[boolean]`)
    );

    const sv = findStateVar(result, 'flags');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('boolean');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[object] variable with empty array default', () => {
    const result = compileSource(
      agentSource(`
variables:
    items: mutable list[object] = []`)
    );

    const sv = findStateVar(result, 'items');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[date] variable', () => {
    const result = compileSource(
      agentSource(`
variables:
    dates: mutable list[date]`)
    );

    const sv = findStateVar(result, 'dates');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('date');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[timestamp] variable', () => {
    const result = compileSource(
      agentSource(`
variables:
    timestamps: mutable list[timestamp]`)
    );

    const sv = findStateVar(result, 'timestamps');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('timestamp');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[currency] variable', () => {
    const result = compileSource(
      agentSource(`
variables:
    prices: mutable list[currency]`)
    );

    const sv = findStateVar(result, 'prices');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('currency');
    expect(sv!.is_list).toBe(true);
  });

  it('should compile list[id] variable as string list', () => {
    const result = compileSource(
      agentSource(`
variables:
    ids: mutable list[id]`)
    );

    const sv = findStateVar(result, 'ids');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('string');
    expect(sv!.is_list).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

describe('state variables: visibility', () => {
  it('should default to Internal visibility when not specified', () => {
    const result = compileSource(
      agentSource(`
variables:
    private_var: mutable string = "test"`)
    );

    const sv = findStateVar(result, 'private_var');
    expect(sv).toBeDefined();
    expect(sv!.visibility).toBe('Internal');
  });

  it('should compile variable with "public" visibility as External', () => {
    const result = compileSource(
      agentSource(`
variables:
    exposed_var: mutable string = "public_value"
        visibility: "public"`)
    );

    const sv = findStateVar(result, 'exposed_var');
    expect(sv).toBeDefined();
    expect(sv!.visibility).toBe('External');
  });

  it('should compile variable with "private" visibility as Internal', () => {
    const result = compileSource(
      agentSource(`
variables:
    hidden_var: mutable string = "secret"
        visibility: "private"`)
    );

    const sv = findStateVar(result, 'hidden_var');
    expect(sv).toBeDefined();
    expect(sv!.visibility).toBe('Internal');
  });

  it('should compile variable with "External" visibility', () => {
    const result = compileSource(
      agentSource(`
variables:
    ext_var: mutable string = "exposed"
        visibility: "External"`)
    );

    const sv = findStateVar(result, 'ext_var');
    expect(sv).toBeDefined();
    expect(sv!.visibility).toBe('External');
  });

  it('should compile variable with "Internal" visibility', () => {
    const result = compileSource(
      agentSource(`
variables:
    int_var: mutable string = "internal"
        visibility: "Internal"`)
    );

    const sv = findStateVar(result, 'int_var');
    expect(sv).toBeDefined();
    expect(sv!.visibility).toBe('Internal');
  });

  it('should emit warning for unknown visibility value and default to Internal', () => {
    const result = compileSource(
      agentSource(`
variables:
    weird_var: mutable string = "test"
        visibility: "banana"`)
    );

    const sv = findStateVar(result, 'weird_var');
    expect(sv).toBeDefined();
    expect(sv!.visibility).toBe('Internal');

    const warnings = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Warning &&
        d.message.includes('Unknown visibility')
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].message).toContain('banana');
  });
});

// ---------------------------------------------------------------------------
// Context variable name duplication
// ---------------------------------------------------------------------------

describe('state variables: context variable duplication', () => {
  it('should skip mutable variable when same name exists as linked (context) variable', () => {
    // When a linked and mutable variable have the same name, the linked one
    // takes precedence as a context variable, and the mutable definition
    // is excluded from state_variables since the name is already claimed.
    //
    // In the TS compiler, compileStateVariables checks `contextVarNames`
    // and skips if the name is already there.
    const result = compileSource(
      agentSource(`
variables:
    shared_name: linked string
        source: @session.SharedValue
        description: "Linked version"
    unique_state: mutable number = 42`)
    );

    // The linked variable should be in context_variables
    const contextVars =
      result.output.global_configuration.context_variables ?? [];
    const linkedVar = contextVars.find(
      (v: { developer_name: string }) => v.developer_name === 'shared_name'
    );
    expect(linkedVar).toBeDefined();

    // The mutable variable with the same name should NOT be in state_variables
    const stateVar = findStateVar(result, 'shared_name');
    expect(stateVar).toBeUndefined();

    // The unique mutable variable should still be in state_variables
    const uniqueVar = findStateVar(result, 'unique_state');
    expect(uniqueVar).toBeDefined();
    expect(uniqueVar!.data_type).toBe('number');
    expect(uniqueVar!.default).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Unsupported types produce errors
// ---------------------------------------------------------------------------

describe('state variables: unsupported types', () => {
  it('should produce error diagnostic for unsupported variable type', () => {
    // Using a made-up type name that isn't in the mapping
    const result = compileSource(
      agentSource(`
variables:
    bad_type_var: mutable foobar = "test"`)
    );

    const errors = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes('Unsupported state variable type')
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('bad_type_var');

    // The variable should NOT be included in state_variables
    const sv = findStateVar(result, 'bad_type_var');
    expect(sv).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// String default value quoting
// ---------------------------------------------------------------------------

describe('state variables: string default value quoting', () => {
  it('should single-quote string defaults', () => {
    const result = compileSource(
      agentSource(`
variables:
    greeting: mutable string = "hello world"`)
    );

    const sv = findStateVar(result, 'greeting');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe("'hello world'");
  });

  it('should single-quote date defaults', () => {
    const result = compileSource(
      agentSource(`
variables:
    start_date: mutable date = "2025-01-01"`)
    );

    const sv = findStateVar(result, 'start_date');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe("'2025-01-01'");
  });

  it('should single-quote timestamp defaults', () => {
    const result = compileSource(
      agentSource(`
variables:
    event_at: mutable timestamp = "2025-01-01T00:00:00Z"`)
    );

    const sv = findStateVar(result, 'event_at');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe("'2025-01-01T00:00:00Z'");
  });

  it('should single-quote id defaults (since id maps to string)', () => {
    const result = compileSource(
      agentSource(`
variables:
    entity_id: mutable id = "abc123"`)
    );

    const sv = findStateVar(result, 'entity_id');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe("'abc123'");
  });

  it('should NOT quote number defaults', () => {
    const result = compileSource(
      agentSource(`
variables:
    amount: mutable number = 99`)
    );

    const sv = findStateVar(result, 'amount');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe(99);
    expect(typeof sv!.default).toBe('number');
  });

  it('should NOT quote boolean defaults', () => {
    const result = compileSource(
      agentSource(`
variables:
    enabled: mutable boolean = True`)
    );

    const sv = findStateVar(result, 'enabled');
    expect(sv).toBeDefined();
    expect(sv!.default).toBe(true);
    expect(typeof sv!.default).toBe('boolean');
  });
});

// ---------------------------------------------------------------------------
// End-to-end: full compilation with many variable types
// ---------------------------------------------------------------------------

describe('state variables: end-to-end compilation', () => {
  it('should compile a realistic set of variables with correct output shape', () => {
    const result = compileSource(`
config:
    agent_name: "TestBot"

variables:
    counter: mutable number = 0
        description: "A counter"
    user_name: mutable string = ""
    is_active: mutable boolean = False
    activity_log: mutable list[object] = []

start_agent main:
    description: "desc"
`);

    expect(
      result.diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
        .length
    ).toBe(0);

    const counter = findStateVar(result, 'counter');
    expect(counter).toBeDefined();
    expect(counter!.data_type).toBe('number');
    expect(counter!.default).toBe(0);
    expect(counter!.label).toBe('Counter');
    expect(counter!.description).toBe('A counter');
    expect(counter!.is_list).toBe(false);
    expect(counter!.visibility).toBe('Internal');

    const userName = findStateVar(result, 'user_name');
    expect(userName).toBeDefined();
    expect(userName!.data_type).toBe('string');
    expect(userName!.default).toBe("''");
    expect(userName!.label).toBe('User Name');

    const isActive = findStateVar(result, 'is_active');
    expect(isActive).toBeDefined();
    expect(isActive!.data_type).toBe('boolean');
    expect(isActive!.default).toBe(false);
    expect(isActive!.label).toBe('Is Active');

    const activityLog = findStateVar(result, 'activity_log');
    expect(activityLog).toBeDefined();
    expect(activityLog!.data_type).toBe('object');
    expect(activityLog!.is_list).toBe(true);
    expect(activityLog!.label).toBe('Activity Log');
  });

  it('should include exactly 3 internal + N user variables', () => {
    const result = compileSource(
      agentSource(`
variables:
    a: mutable string
    b: mutable number = 0
    c: mutable boolean = True`)
    );

    const allVars = getStateVariables(result);
    expect(allVars.length).toBe(6); // 3 internal + 3 user

    const userVars = getUserStateVariables(result);
    expect(userVars.length).toBe(3);
    expect(userVars.map(v => v.developer_name)).toEqual(
      expect.arrayContaining(['a', 'b', 'c'])
    );
  });
});

// ---------------------------------------------------------------------------
// Name validation (ported from Python Pydantic validators)
// ---------------------------------------------------------------------------

describe('state variables: name validation', () => {
  // Python: test_state_variables.test_variable_name_with_double_underscores_logs_error
  it('should produce diagnostic for variable with consecutive underscores', () => {
    const result = compileSource(
      agentSource(`
variables:
    Account_Number__c: mutable string`)
    );

    const errors = result.diagnostics.filter(
      d =>
        d.severity === DiagnosticSeverity.Error &&
        d.message.includes('should not contain double underscores')
    );
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].message).toContain('Account_Number__c');
  });

  // Python: test_state_variables.test_variable_name_starting_with_underscore_logs_error
  it('should produce diagnostic for variable starting with underscore', () => {
    const result = compileSource(
      agentSource(`
variables:
    _invalid_name: mutable string`)
    );

    const diags = result.diagnostics;
    const nameError = diags.find(
      d =>
        d.message.toLowerCase().includes('start') &&
        d.message.toLowerCase().includes('underscore')
    );
    expect(nameError).toBeDefined();
  });

  // Python: test_state_variables.test_variable_name_ending_with_underscore_logs_error
  it('should produce diagnostic for variable ending with underscore', () => {
    const result = compileSource(
      agentSource(`
variables:
    invalid_name_: mutable string`)
    );

    const diags = result.diagnostics;
    const nameError = diags.find(
      d =>
        d.message.toLowerCase().includes('end') &&
        d.message.toLowerCase().includes('underscore')
    );
    expect(nameError).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Dict and object defaults
// ---------------------------------------------------------------------------

describe('state variables: dict and object defaults', () => {
  it('should compile variable with empty dict default', () => {
    const result = compileSource(
      agentSource(`
variables:
    empty_dict: mutable object = {}`)
    );

    const sv = findStateVar(result, 'empty_dict');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({});
  });

  it('should compile variable with populated dict default', () => {
    const result = compileSource(
      agentSource(`
variables:
    config: mutable object = {name: "test", value: 123}`)
    );

    const sv = findStateVar(result, 'config');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({ name: 'test', value: 123 });
  });

  it('should compile variable with nested dict default', () => {
    const result = compileSource(
      agentSource(`
variables:
    nested: mutable object = {outer: {inner: "value"}}`)
    );

    const sv = findStateVar(result, 'nested');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({ outer: { inner: 'value' } });
  });

  it('should compile variable with dict containing empty string values', () => {
    const result = compileSource(
      agentSource(`
variables:
    supplier_data: mutable object = {vat_number: "", company_name: "", supplier_id: "", pec: ""}`)
    );

    const sv = findStateVar(result, 'supplier_data');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({
      vat_number: '',
      company_name: '',
      supplier_id: '',
      pec: '',
    });
  });

  it('should compile variable with dict containing quoted keys', () => {
    const result = compileSource(
      agentSource(`
variables:
    test_data: mutable object = {"var1": "", "var2": "foo"}`)
    );

    const sv = findStateVar(result, 'test_data');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.default).toEqual({
      var1: '',
      var2: 'foo',
    });
  });

  it('should compile list with empty array default', () => {
    const result = compileSource(
      agentSource(`
variables:
    items: mutable list[object] = []`)
    );

    const sv = findStateVar(result, 'items');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('object');
    expect(sv!.is_list).toBe(true);
    expect(sv!.default).toEqual([]);
  });

  it('should compile list with populated array default', () => {
    const result = compileSource(
      agentSource(`
variables:
    tags: mutable list[string] = ["a", "b", "c"]`)
    );

    const sv = findStateVar(result, 'tags');
    expect(sv).toBeDefined();
    expect(sv!.data_type).toBe('string');
    expect(sv!.is_list).toBe(true);
    expect(sv!.default).toEqual(['a', 'b', 'c']);
  });

  it('should still omit default for None and missing defaults', () => {
    const result = compileSource(
      agentSource(`
variables:
    obj_none: mutable object = None
    obj_no_default: mutable object`)
    );

    expect(findStateVar(result, 'obj_none')!.default).toBeUndefined();
    expect(findStateVar(result, 'obj_no_default')!.default).toBeUndefined();
  });
});
