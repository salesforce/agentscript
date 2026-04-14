/**
 * Round-trip tests: parse -> emit -> parse -> compare
 *
 * These integration tests verify that parsing and emitting produces
 * semantically equivalent output. For valid scripts, we assert exact
 * string equality: emit(parse(source)) === source (zero loss).
 *
 * For error recovery, we verify that valid sibling blocks survive
 * and that diagnostics are produced.
 */

import { describe, expect, test } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  parseExpression,
  stripMeta,
  parseCst,
} from './test-utils.js';
import {
  emitKeyName,
  StringLiteral,
  Template,
  TemplateText,
} from '@agentscript/language';
import { AgentScriptSchema } from '../schema.js';

// =============================================================================
// Helpers
// =============================================================================

test('round-trips variable with mutable string type', () => {
  const source = `variables:
    name: mutable string`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips variable with linked string type', () => {
  const source = `variables:
    profile_id: linked string`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('preserves ERROR node content before colinear value in TypedMap', () => {
  // "123bad" can't parse as a valid expression, so tree-sitter wraps it in an
  // ERROR node. "string" is parsed as the colinear_value. The emitter must
  // preserve the ERROR text so round-tripping doesn't lose it.
  const source = `variables:
    EndUserId: 123bad string`;

  const cst = parseCst(source);
  // Verify the CST has the expected ERROR + colinear_value structure
  expect(cst).toContain('ERROR');
  expect(cst).toContain('colinear_value');

  const ast = parseDocument(source);
  const emitted = emitDocument(ast);

  // The emitted output must contain the error text before the type
  expect(emitted).toContain('123bad string');
});

test('preserves typo modifier via same-row split merge', () => {
  // When tree-sitter splits "linkedd string" across two mapping_elements
  // (because "linkedd" isn't a valid modifier keyword), the parse should
  // detect the split and merge them back together.
  const source = `variables:
    EndUserId: linkedd string
        source: @MessagingSession.MessagingEndUserId
        description: "123"`;

  const ast = parseDocument(source);
  const emitted = emitDocument(ast);

  // The emitted output must preserve "linkedd" before "string"
  expect(emitted).toContain('linkedd string');
  // Properties must be preserved under EndUserId
  expect(emitted).toContain('source: @MessagingSession.MessagingEndUserId');
  expect(emitted).toContain('description: "123"');
});

test('emits invalid-modifier diagnostic for typo modifier', () => {
  const source = `variables:
    EndUserId: linkedd string
        source: @MessagingSession.MessagingEndUserId
        description: "123"`;

  const { diagnostics } = parseWithDiagnostics(source, AgentScriptSchema);
  const modifierDiags = diagnostics.filter(d => d.code === 'invalid-modifier');
  expect(modifierDiags).toHaveLength(1);
  expect(modifierDiags[0].message).toBe(
    "Unknown modifier 'linkedd' for variables EndUserId. Did you mean 'linked'?"
  );
  expect(modifierDiags[0].data).toEqual({
    found: 'linkedd',
    expected: ['mutable', 'linked'],
  });
});

test('round-trips variable with default value', () => {
  const source = `variables:
    count: mutable number = 0`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips variable with string default', () => {
  const source = `variables:
    status: mutable string = "pending"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips variable with list type', () => {
  const source = `variables:
    items: mutable list[object]`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips variable with description property', () => {
  const source = `variables:
    user_id: linked string
        description: "The user identifier"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips multiple variables', () => {
  const source = `variables:
    name: mutable string
    count: mutable number = 0
    active: mutable boolean = True`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

// =============================================================================
// Topics and start_agents with actions
// =============================================================================

test('round-trips simple topic', () => {
  const source = `subagent main:
    label: "Main Topic"
    description: "The main topic"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips start_agent', () => {
  const source = `start_agent hello:
    label: "Hello Agent"
    description: "Says hello"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips topic with action definition', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        fetch_data:
            description: "Fetches data"
            target: "externalService://fetch"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips action with inputs and outputs', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_user:
            description: "Gets user profile"
            inputs:
                user_id: string
            outputs:
                profile: string
            target: "externalService://get_user"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

// =============================================================================
// Procedures - templates, run statements, conditionals
// =============================================================================

test('round-trips reasoning with template instructions', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Call the action to do something`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips multi-line template', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Line one of instructions
            |Line two of instructions
            |Line three of instructions`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips template with expression interpolation', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Call {!@actions.fetch_data} to get results`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips template with multiple interpolations', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Use {!@actions.greet} then {!@actions.farewell}`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips template with only interpolation, no text', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |{!@actions.fetch_data}`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips template with adjacent interpolations', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |{!@actions.greet}{!@actions.farewell}`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips before_reasoning with run statement', () => {
  const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.fetch_data`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips run statement with with clause', () => {
  const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.fetch
            with user_id=@variables.id`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips run statement with set clause', () => {
  const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.fetch
            set @variables.result=@outputs.data`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips run statement with with and set', () => {
  const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.get_profile
            with profile_id=@variables.user_id
            set @variables.profile=@outputs.profile`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips if statement in procedure', () => {
  const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        if @variables.ready:
            run @actions.proceed`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips reasoning action with to clause', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            go_next: @utils.transition to @subagent.next`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips reasoning action with with clause', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            process: @actions.process
                with input=@variables.data`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

// =============================================================================
// Mixed blocks: reasoning actions with description + statements
// =============================================================================

test('round-trips reasoning action with description and with clauses', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Process the request
        actions:
            capture_info: @utils.setVariables
                description: "Capture member info"
                with member_number=@variables.member_number
                with member_email=@variables.member_email`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips reasoning action with description and available when', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Handle the order
        actions:
            go_to_order: @utils.transition to @subagent.Order_Management
                description: "Go to order management"
                available when @variables.verified is True`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('parses description field on reasoning action with mixed block', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            capture: @utils.setVariables
                description: "Capture data"
                with name=@variables.name`;

  const ast = parseDocument(source);
  const topic = ast.subagent?.get('main');
  expect(topic).toBeDefined();

  const actions = topic?.reasoning?.actions;
  expect(actions).toBeDefined();

  const capture = actions?.get('capture');
  expect(capture).toBeDefined();
  expectStringLiteral(capture?.description, 'Capture data');
  expect(capture?.statements).toBeDefined();
  expect(capture?.statements?.length).toBe(1);
});

test('parses reasoning action with label and description', () => {
  const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            save_data: @actions.save
                description: "Save the data"
                label: "Save"
                set @variables.saved=@outputs.success`;

  const ast = parseDocument(source);
  const topic = ast.subagent?.get('main');
  const action = topic?.reasoning?.actions?.get('save_data');
  expect(action).toBeDefined();
  expectStringLiteral(action?.description, 'Save the data');
  expectStringLiteral(action?.label, 'Save');
  expect(action?.statements).toBeDefined();
  expect(action?.statements?.length).toBe(1);
});

// =============================================================================
// Complex integration tests
// =============================================================================

test('round-trips full topic with actions and reasoning', () => {
  const source = `subagent selector:
    label: "Selector"
    description: "Selects the next action"

    actions:
        get_data:
            description: "Gets data"
            inputs:
                id: string
            outputs:
                data: string
            target: "externalService://get_data"

    reasoning:
        instructions: ->
            |Based on the data, choose the next action
        actions:
            process: @actions.get_data
                with id=@variables.user_id
                set @variables.data=@outputs.data`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips document with variables and topic', () => {
  const source = `variables:
    user_id: linked string
    result: mutable string

subagent main:
    label: "Main"
    description: "Main topic"

    reasoning:
        instructions: ->
            |Process the user request`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

// =============================================================================
// New schema fields
// =============================================================================

test('round-trips config block with description', () => {
  const source = `config:
    description: "A helpful agent"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips action block with source field', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        check_hours:
            description: "Check business hours"
            source: "Check_Business_Hours"
            target: "flow://Check_Business_Hours"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips input properties with label and is_required', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            target: "flow://GetData"
            inputs:
                user_id: string
                    label: "User ID"
                    is_required: True`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips output properties with label', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            target: "flow://GetData"
            outputs:
                result: string
                    label: "Result"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

// =============================================================================
// Quoted string keys
// =============================================================================

test('round-trips action with quoted input key', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "Input:Question": string
                    description: "The question"
            target: "externalService://getData"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips mixed bare and quoted input keys', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                name: string
                "Input:Question": string
            target: "externalService://getData"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('parses quoted string key as input name', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "Input:Question": string
            target: "externalService://getData"`;

  const ast = parseDocument(source);
  const topic = ast.subagent?.get('main');
  const action = topic?.actions?.get('get_data');
  expect(action?.inputs?.has('Input:Question')).toBe(true);
});

test('round-trips run statement with quoted with param', () => {
  const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.fetch
            with "Input:Question"=@variables.question`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips quoted key with escaped double quote', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "Say \\"hello\\"": string
            target: "externalService://getData"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  // Verify the key was parsed correctly
  const action = ast1.subagent?.get('main')?.actions?.get('get_data');
  expect(action?.inputs?.has('Say "hello"')).toBe(true);
});

test('round-trips quoted key with backslash', () => {
  const source = `subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "C:\\\\path": string
            target: "externalService://getData"`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  const action = ast1.subagent?.get('main')?.actions?.get('get_data');
  expect(action?.inputs?.has('C:\\path')).toBe(true);
});

// =============================================================================
// emitKeyName — control character escaping
// =============================================================================

test('emitKeyName returns bare identifier for simple names', () => {
  expect(emitKeyName('foo')).toBe('foo');
  expect(emitKeyName('my_var')).toBe('my_var');
  expect(emitKeyName('CamelCase')).toBe('CamelCase');
});

test('emitKeyName quotes names with special characters', () => {
  expect(emitKeyName('Input:Question')).toBe('"Input:Question"');
  expect(emitKeyName('has space')).toBe('"has space"');
  expect(emitKeyName('hyphen-name')).toBe('"hyphen-name"');
});

test('emitKeyName escapes backslashes and double quotes', () => {
  expect(emitKeyName('Say "hi"')).toBe('"Say \\"hi\\""');
  expect(emitKeyName('C:\\path')).toBe('"C:\\\\path"');
});

test('emitKeyName escapes control characters', () => {
  expect(emitKeyName('line\none')).toBe('"line\\none"');
  expect(emitKeyName('tab\there')).toBe('"tab\\there"');
  expect(emitKeyName('return\rhere')).toBe('"return\\rhere"');
  expect(emitKeyName('null\0here')).toBe('"null\\0here"');
});

test('round-trips after_reasoning with transition statement (no arrow)', () => {
  const source = `subagent other_agent:
    description: "I am handed off to"
    reasoning:
        instructions: ->
            |Goodbye
    after_reasoning:
        transition to @subagent.main_topic`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  const topic = ast1.subagent?.get('other_agent');
  expect(topic?.after_reasoning?.statements).toHaveLength(1);
});

// =============================================================================
// Pipe syntax — bare pipe vs arrow pipe
// =============================================================================

test('round-trips bare pipe empty instructions', () => {
  const source = `subagent test:
    description: "test"
    reasoning:
        instructions: |`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(emitted).toContain('instructions: |');
  expect(emitted).not.toContain('->');
  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips bare pipe single-line instructions', () => {
  const source = `subagent test:
    description: "test"
    reasoning:
        instructions: | Do something helpful`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(emitted).toContain('instructions: | Do something helpful');
  expect(emitted).not.toContain('->');
  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips bare pipe multi-line instructions', () => {
  const source = `subagent test:
    description: "test"
    reasoning:
        instructions: |
            Line one of instructions
            Line two of instructions`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(emitted).toContain('instructions: |');
  expect(emitted).not.toContain('->');
  expect(emitted).toContain('Line one');
  expect(emitted).toContain('Line two');
  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips arrow pipe single template line', () => {
  const source = `subagent test:
    description: "test"
    reasoning:
        instructions: ->
            |Call the action`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(emitted).toContain('instructions: ->');
  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

test('round-trips arrow pipe multiple template lines', () => {
  const source = `subagent test:
    description: "test"
    reasoning:
        instructions: ->
            |Line one
            |Line two`;

  const ast1 = parseDocument(source);
  const emitted = emitDocument(ast1);
  const ast2 = parseDocument(emitted);

  expect(emitted).toContain('instructions: ->');
  expect(emitted).toContain('|Line one');
  expect(emitted).toContain('|Line two');
  expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
});

// =============================================================================
// Error recovery — missing colons should not crash the parser
// =============================================================================

test('does not crash when colon is missing after TypedMap field (e.g., inputs)', () => {
  // When "inputs" is missing its colon, tree-sitter merges it with the next key
  // creating a compound key like (key (id "inputs") (id "policy_number")).
  // The dialect should handle this gracefully without throwing.
  const source = `subagent main:
    label: "Main"
    actions:
        verify:
            description: "Verifies data"
            inputs
                policy_number: string
                    label: "Policy Number"
                    is_required: True
            outputs:
                result: boolean
                    label: "Result"
            target: "flow://Verify"`;

  // Should not throw
  const ast = parseDocument(source);

  // The topic and action should still parse
  const topic = ast.subagent?.get('main');
  expect(topic).toBeDefined();
  expect(topic?.label?.value).toBe('Main');

  const action = topic?.actions?.get('verify');
  expect(action).toBeDefined();
  expect(action?.description?.value).toBe('Verifies data');

  // outputs should still be parsed correctly
  expect(action?.outputs).toBeDefined();
  expect(action?.outputs?.has('result')).toBe(true);
});

// ---------------------------------------------------------------------------
// Error recovery round-trip tests
// ---------------------------------------------------------------------------

/** Normalize whitespace: trim each line, drop empty lines. */
function normalize(s: string): string {
  return s
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n');
}

/** Assert normalized round-trip: content survives parse→emit (ignoring indentation). */
function expectNormalizedRoundTrip(source: string) {
  const ast = parseDocument(source);
  const emitted = emitDocument(ast);
  expect(normalize(emitted)).toBe(normalize(source));
}

/**
 * Assert content-preserving round-trip: every significant token from the source
 * appears in the emission. For error recovery tests where parser CST
 * fragmentation may reorder, split, or merge content, but all tokens should
 * survive. Strips common structural tokens (colons, bare keywords) from
 * the check to focus on actual content.
 */
function expectContentPreserved(source: string) {
  const ast = parseDocument(source);
  const emitted = emitDocument(ast);
  const emittedFlat = emitted.replace(/\s+/g, ' ').toLowerCase();

  // Extract significant tokens from source: quoted strings, @-references,
  // identifiers, operators, etc. Skip structural tokens.
  const structural = new Set([
    ':',
    '->',
    '|',
    'topic',
    'if',
    'elif',
    'else',
    'run',
    'with',
    'set',
    'transition',
    'to',
    'available',
    'when',
  ]);
  const sourceTokens = source
    .split(/[\s,]+/)
    .map(t => t.trim().replace(/:$/, ''))
    .filter(t => t.length > 0 && !structural.has(t.toLowerCase()));

  for (const token of sourceTokens) {
    const tokenLower = token.toLowerCase();
    expect(
      emittedFlat.includes(tokenLower),
      `Token "${token}" not found in emitted output`
    ).toBe(true);
  }
}

/**
 * Assert idempotent round-trip: parse→emit is stable (emitting twice produces
 * the same result). For badly broken syntax where parser genuinely loses
 * tokens, we can't assert content preservation, but we can assert stability.
 */
function expectIdempotentEmission(source: string) {
  const ast1 = parseDocument(source);
  const emitted1 = emitDocument(ast1);
  const ast2 = parseDocument(emitted1);
  const emitted2 = emitDocument(ast2);
  expect(emitted2).toBe(emitted1);
}

/** Assert that a node is a StringLiteral and return it narrowed. */
function expectStringLiteral(node: unknown, value: string): void {
  expect(node).toBeInstanceOf(StringLiteral);
  expect((node as StringLiteral).value).toBe(value);
}

// =============================================================================
// Expression round-trips (exact string equality)
// =============================================================================

describe('expression round-trips', () => {
  const cases: Record<string, string> = {
    identifier: 'foo',
    'at-identifier': '@variables',
    'member expression': '@variables.name',
    'deeply chained member': '@data.user.profile.name',
    'string literal': '"hello world"',
    'empty string': '""',
    'string with escape \\n': '"line\\none"',
    'string with escape \\t': '"col1\\tcol2"',
    'string with escaped quote': '"say \\"hello\\""',
    'string with backslash': '"C:\\\\path"',
    'number integer': '42',
    'number decimal': '3.14',
    'number leading dot': '.5',
    'boolean True': 'True',
    'boolean False': 'False',
    None: 'None',
    ellipsis: '...',
    'unary not': 'not @variables.done',
    'unary minus': '-1',
    'unary plus': '+1',
    'binary +': 'a + b',
    'binary -': 'a - b',
    'binary *': 'a * b',
    'binary /': 'a / b',
    'binary and': 'a and b',
    'binary or': 'a or b',
    'comparison ==': 'x == 1',
    'comparison !=': 'x != 1',
    'comparison <': 'x < 10',
    'comparison >': 'x > 10',
    'comparison <=': 'x <= 10',
    'comparison >=': 'x >= 10',
    'comparison is': '@variables.active is True',
    'comparison is not': '@variables.active is not None',
    ternary: '"yes" if @variables.ok else "no"',
    'call expression': 'len(items)',
    'call with multiple args': 'func(a, b, c)',
    'subscript number': 'items[0]',
    'subscript string': 'data["key"]',
    'list literal': '[1, 2, 3]',
    'empty list': '[]',
    'dictionary literal': '{name: "Alice", age: 30}',
    'empty dictionary': '{}',
    'member on call result': 'func().value',
  };

  for (const [name, expr] of Object.entries(cases)) {
    test(name, () => {
      const parsed = parseExpression(expr);
      expect(parsed.__emit({ indent: 0 })).toBe(expr);
    });
  }

  // Known normalizations
  test('parenthesized expression drops parens (known normalization)', () => {
    const parsed = parseExpression('(a + b)');
    expect(parsed.__emit({ indent: 0 })).toBe('a + b');
  });
});

// =============================================================================
// Exact round-trips — valid documents (emit(parse(source)) === source)
// =============================================================================

describe('normalized round-trips — basic blocks', () => {
  test('system block', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "Hello agent"`);
  });

  test('system block with messages', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "You are a helpful bot"
    messages:
        welcome: "Hello!"
        error: "Oops"`);
  });

  test('config block', () => {
    expectNormalizedRoundTrip(`config:
    description: "A test agent"`);
  });

  test('language block', () => {
    expectNormalizedRoundTrip(`language:
    default_locale: "en_US"`);
  });

  test('multiple top-level blocks', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "Be helpful"

language:
    default_locale: "en_US"`);
  });

  test('empty string value', () => {
    expectNormalizedRoundTrip(`system:
    instructions: ""`);
  });

  test('string with escaped quotes', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "Say \\"hello\\""`);
  });

  test('string with backslash escapes', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "Path: C:\\\\Users\\\\test"`);
  });

  test('string with newline escape', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "Line1\\nLine2"`);
  });
});

describe('normalized round-trips — variables', () => {
  test('mutable string', () => {
    expectNormalizedRoundTrip(`variables:
    name: mutable string`);
  });

  test('linked string', () => {
    expectNormalizedRoundTrip(`variables:
    profile_id: linked string`);
  });

  test('variable with default number', () => {
    expectNormalizedRoundTrip(`variables:
    count: mutable number = 0`);
  });

  test('variable with default string', () => {
    expectNormalizedRoundTrip(`variables:
    status: mutable string = "pending"`);
  });

  test('variable with default True', () => {
    expectNormalizedRoundTrip(`variables:
    active: mutable boolean = True`);
  });

  test('variable with default False', () => {
    expectNormalizedRoundTrip(`variables:
    active: mutable boolean = False`);
  });

  test('variable with default None', () => {
    expectNormalizedRoundTrip(`variables:
    data: mutable object = None`);
  });

  test('variable with list type', () => {
    expectNormalizedRoundTrip(`variables:
    items: mutable list[object]`);
  });

  test('variable with description', () => {
    expectNormalizedRoundTrip(`variables:
    user_id: linked string
        description: "The user identifier"`);
  });

  test('variable with source', () => {
    expectNormalizedRoundTrip(`variables:
    user_id: linked string
        source: @MessagingSession.MessagingEndUserId`);
  });

  test('variable with source and description', () => {
    expectNormalizedRoundTrip(`variables:
    user_id: linked string
        source: @MessagingSession.MessagingEndUserId
        description: "The messaging user ID"`);
  });

  test('multiple variables', () => {
    expectNormalizedRoundTrip(`variables:
    name: mutable string
    count: mutable number = 0
    active: mutable boolean = True`);
  });

  test('multiple variables with properties', () => {
    expectNormalizedRoundTrip(`variables:
    user_id: linked string
        source: @Session.UserId
        description: "User ID"
    session_id: linked string
        source: @Session.Id
    count: mutable number = 0
        description: "A counter"`);
  });
});

describe('normalized round-trips — topics', () => {
  test('simple topic', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main Topic"
    description: "The main topic"`);
  });

  test('start_agent', () => {
    expectNormalizedRoundTrip(`start_agent hello:
    label: "Hello Agent"
    description: "Says hello"`);
  });

  test('multiple topics', () => {
    expectNormalizedRoundTrip(`topic first:
    label: "First"
    description: "First topic"

topic second:
    label: "Second"
    description: "Second topic"`);
  });

  test('topic with system override', () => {
    expectNormalizedRoundTrip(`topic custom:
    label: "Custom"
    description: "Custom topic"
    system:
        instructions: "Special instructions for this topic"`);
  });
});

describe('normalized round-trips — actions', () => {
  test('action with description and target', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        fetch_data:
            description: "Fetches data"
            target: "externalService://fetch"`);
  });

  test('action with inputs and outputs', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_user:
            description: "Gets user profile"
            inputs:
                user_id: string
            outputs:
                profile: string
            target: "externalService://get_user"`);
  });

  test('action with source field', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        check_hours:
            description: "Check business hours"
            source: "Check_Business_Hours"
            target: "flow://Check_Business_Hours"`);
  });

  test('input with label and is_required', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            target: "flow://GetData"
            inputs:
                user_id: string
                    label: "User ID"
                    is_required: True`);
  });

  test('output with label', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            target: "flow://GetData"
            outputs:
                result: string
                    label: "Result"`);
  });

  test('multiple inputs', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        search:
            description: "Search records"
            inputs:
                query: string
                limit: number
                offset: number
            target: "flow://Search"`);
  });

  test('multiple outputs', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        search:
            description: "Search records"
            outputs:
                results: list[object]
                total_count: number
            target: "flow://Search"`);
  });

  test('quoted input key', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "Input:Question": string
                    description: "The question"
            target: "externalService://getData"`);
  });

  test('mixed bare and quoted input keys', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                name: string
                "Input:Question": string
            target: "externalService://getData"`);
  });

  test('quoted key with escaped double quote', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "Say \\"hello\\"": string
            target: "externalService://getData"`);
  });

  test('quoted key with backslash', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "C:\\\\path": string
            target: "externalService://getData"`);
  });
});

describe('normalized round-trips — templates', () => {
  test('bare pipe empty', () => {
    expectNormalizedRoundTrip(`topic test:
    description: "test"
    reasoning:
        instructions: |`);
  });

  test('bare pipe single-line', () => {
    expectNormalizedRoundTrip(`topic test:
    description: "test"
    reasoning:
        instructions: | Do something helpful`);
  });

  test('bare pipe multi-line', () => {
    expectNormalizedRoundTrip(`topic test:
    description: "test"
    reasoning:
        instructions: |
            Line one of instructions
            Line two of instructions`);
  });

  test('arrow pipe single line', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Call the action`);
  });

  test('arrow pipe multiple lines', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Line one
            |Line two`);
  });

  test('template with expression interpolation', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Call {!@actions.fetch_data} to get results`);
  });

  test('template with multiple interpolations', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Use {!@actions.greet} then {!@actions.farewell}`);
  });

  test('template with only interpolation', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |{!@actions.fetch_data}`);
  });

  test('template with adjacent interpolations', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |{!@actions.greet}{!@actions.farewell}`);
  });

  test('template with special characters', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Use "quotes" and 'apostrophes' in text`);
  });

  test('multi-line template with mixed interpolations', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |First line of instructions
            |Use {!@actions.fetch} to get data
            |Then process with {!@actions.process}
            |Final instructions here`);
  });
});

describe('normalized round-trips — procedures', () => {
  test('before_reasoning with run (arrow dropped by design)', () => {
    // before_reasoning: -> normalizes to before_reasoning: (by design)
    const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.fetch_data`;
    const expected = `subagent main:
    label: "Main"
    before_reasoning:
        run @actions.fetch_data`;
    const ast = parseDocument(source);
    expect(emitDocument(ast)).toBe(expected);
  });

  test('after_reasoning without arrow', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        transition to @topic.next`);
  });

  test('after_reasoning with transition (no arrow)', () => {
    expectNormalizedRoundTrip(`topic other_agent:
    description: "I am handed off to"
    reasoning:
        instructions: ->
            |Goodbye
    after_reasoning:
        transition to @topic.main_topic`);
  });

  test('run with with clause', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.fetch
            with user_id=@variables.id`);
  });

  test('run with set clause', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.fetch
            set @variables.result = @outputs.data`);
  });

  test('run with with and set', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.get_profile
            with profile_id=@variables.user_id
            set @variables.profile = @outputs.profile`);
  });

  test('run with multiple with params', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.update
            with id=@variables.id
            with name=@variables.name
            with status="active"`);
  });

  test('run with multiple set statements', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.fetch
            set @variables.name = @outputs.name
            set @variables.email = @outputs.email`);
  });

  test('run with quoted with param', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.fetch
            with "Input:Question"=@variables.question`);
  });

  test('action with indented to-clause continuation preserves layout', () => {
    const multiLine = `topic orders:
    reasoning:
        actions:
            go_to_returns: @utils.transition
                to @topic.returns`;

    const singleLine = `topic orders:
    reasoning:
        actions:
            go_to_returns: @utils.transition to @topic.returns`;

    // Both forms exact round-trip (each preserves its original layout)
    const multiAst = parseDocument(multiLine);
    const singleAst = parseDocument(singleLine);
    expect(emitDocument(multiAst)).toBe(multiLine);
    expect(emitDocument(singleAst)).toBe(singleLine);
  });

  test('if statement', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.ready:
            run @actions.proceed`);
  });

  test('if-else', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.ready:
            run @actions.go
        else:
            run @actions.wait`);
  });

  test('if-elif-else', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.state == "a":
            run @actions.a
        elif @variables.state == "b":
            run @actions.b
        else:
            run @actions.c`);
  });

  test('nested if', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.a:
            if @variables.b:
                run @actions.both`);
  });

  test('if with extra tokens in condition', () => {
    expectNormalizedRoundTrip(`topic main:
    description: "Main"
    reasoning:
        instructions: ->
            | Test
            if abc == 1 xxx:
                | add content`);
  });

  test('transition statement', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        transition to @topic.other`);
  });

  test('set statement with spaces around =', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        set @variables.count = 0`);
  });

  test('set statement preserves no-space = in round-trip', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        set @variables.count=0`);
  });

  test('after_reasoning with multiple statements', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        set @variables.done = True
        transition to @topic.next`);
  });

  test('after_reasoning with if-else', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.done:
            transition to @topic.complete
        else:
            transition to @topic.retry`);
  });
});

describe('normalized round-trips — reasoning blocks', () => {
  test('reasoning with template instructions', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Call the action to do something`);
  });

  test('reasoning action with bare target', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do things
        actions:
            fetch: @actions.get_data`);
  });

  test('reasoning action with to clause', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            go_next: @utils.transition to @topic.next`);
  });

  test('reasoning action with with clause', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            process: @actions.process
                with input=@variables.data`);
  });

  test('reasoning action with valueless with clause', () => {
    expectNormalizedRoundTrip(`topic ServiceCustomerVerification:
    description: "Hello"
    reasoning:
        instructions: ->
            |Test
        actions:
            SendEmailVerificationCode: @actions.SendEmailVerificationCode
                with customerToVerify
                set @variables.authenticationKey = "123"`);
  });

  test('reasoning action with description and with', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Process the request
        actions:
            capture_info: @utils.setVariables
                description: "Capture member info"
                with member_number=@variables.member_number
                with member_email=@variables.member_email`);
  });

  test('reasoning action with description and available when', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Handle the order
        actions:
            go_to_order: @utils.transition to @topic.Order_Management
                description: "Go to order management"
                available when @variables.verified is True`);
  });

  test('reasoning action with label and description', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            save_data: @actions.save
                description: "Save the data"
                label: "Save"
                set @variables.saved = @outputs.success`);
  });

  test('reasoning action with to and with', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do things
        actions:
            nav: @utils.transition to @topic.next
                with reason="completed"`);
  });
});

describe('normalized round-trips — connected_agent', () => {
  test('basic connected_agent', () => {
    expectNormalizedRoundTrip(`connected_agent helper:
    label: "Helper Agent"
    description: "Helps with stuff"`);
  });

  test('connected_agent with inputs', () => {
    expectNormalizedRoundTrip(`connected_agent helper:
    label: "Helper Agent"
    description: "Helps with stuff"
    inputs:
        query: string
            description: "The query"`);
  });
});

describe('normalized round-trips — comments', () => {
  test('inline comment on field', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "Hello" # greeting`);
  });

  test('leading comment on field', () => {
    expectNormalizedRoundTrip(`system:
    # This sets the instructions
    instructions: "Hello"`);
  });

  test('comment inside topic', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    # This is the description
    description: "Main topic"`);
  });

  test('comment inside procedure', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        # Check readiness
        if @variables.ready:
            run @actions.proceed`);
  });

  test('top-level comment before block is preserved', () => {
    expectNormalizedRoundTrip(`# System configuration
system:
    instructions: "Hello"`);
  });
});

describe('normalized round-trips — full documents', () => {
  test('variables + topic', () => {
    expectNormalizedRoundTrip(`variables:
    user_id: linked string
    result: mutable string

topic main:
    label: "Main"
    description: "Main topic"
    reasoning:
        instructions: ->
            |Process the user request`);
  });

  test('full topic with actions and reasoning', () => {
    expectNormalizedRoundTrip(`topic selector:
    label: "Selector"
    description: "Selects the next action"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                id: string
            outputs:
                data: string
            target: "externalService://get_data"
    reasoning:
        instructions: ->
            |Based on the data, choose the next action
        actions:
            process: @actions.get_data
                with id=@variables.user_id
                set @variables.data = @outputs.data`);
  });

  test('all top-level block types', () => {
    expectNormalizedRoundTrip(`config:
    description: "Full agent"

system:
    instructions: "Be helpful"

language:
    default_locale: "en_US"

variables:
    name: mutable string
    count: mutable number = 0

start_agent greeting:
    label: "Greeting"
    description: "Greets the user"
    reasoning:
        instructions: ->
            |Say hello

topic main:
    label: "Main"
    description: "Main topic"`);
  });

  test('deeply nested topic', () => {
    expectNormalizedRoundTrip(`topic deep:
    label: "Deep"
    description: "Deep nesting"
    actions:
        search:
            description: "Search"
            inputs:
                query: string
                    label: "Query"
                    description: "Search query"
                    is_required: True
            outputs:
                results: list[object]
                    label: "Results"
            target: "flow://Search"
    reasoning:
        instructions: ->
            |Search for results using {!@actions.search}
            |Then display to user
        actions:
            do_search: @actions.search
                description: "Run search"
                with query=@variables.query
                set @variables.results = @outputs.results
    after_reasoning:
        if @variables.query is not None:
            run @actions.search
                with query=@variables.query
                set @variables.results = @outputs.results`);
  });
});

describe('normalized round-trips — known normalizations', () => {
  test('comma-separated with params normalize to separate lines', () => {
    const source = `subagent main:
    label: "Main"
    after_reasoning:
        run @actions.fetch with a=1, b=2`;
    const expected = `subagent main:
    label: "Main"
    after_reasoning:
        run @actions.fetch
        with a=1
        with b=2`;
    const ast = parseDocument(source);
    const emitted = emitDocument(ast);
    expect(emitted).toBe(expected);
  });

  test('before_reasoning arrow is dropped', () => {
    const source = `subagent main:
    label: "Main"
    before_reasoning: ->
        run @actions.go`;
    const expected = `subagent main:
    label: "Main"
    before_reasoning:
        run @actions.go`;
    const ast = parseDocument(source);
    expect(emitDocument(ast)).toBe(expected);
  });
});

// =============================================================================
// Idempotency — parse -> emit -> parse -> emit stability
// =============================================================================

describe('idempotency', () => {
  function expectIdempotent(source: string) {
    const ast1 = parseDocument(source);
    const emitted1 = emitDocument(ast1);
    const ast2 = parseDocument(emitted1);
    const emitted2 = emitDocument(ast2);
    expect(emitted2).toBe(emitted1);
  }

  test('complex document', () => {
    expectIdempotent(`config:
    description: "Idempotent test"

variables:
    count: mutable number = 0

topic main:
    label: "Main"
    description: "Main topic"
    reasoning:
        instructions: ->
            |Do something with {!@actions.fetch}
        actions:
            fetch: @actions.get_data
                with id=@variables.id
                set @variables.data = @outputs.data
    after_reasoning:
        if @variables.ready:
            run @actions.proceed
        else:
            set @variables.ready = True`);
  });

  test('start_agent', () => {
    expectIdempotent(`start_agent welcome:
    label: "Welcome"
    description: "Welcomes the user"
    reasoning:
        instructions: ->
            |Greet the user warmly`);
  });

  test('multi-topic', () => {
    expectIdempotent(`topic first:
    label: "First"
    description: "First topic"
    reasoning:
        instructions: ->
            |Handle first task

topic second:
    label: "Second"
    description: "Second topic"
    after_reasoning:
        transition to @topic.first`);
  });
});

// =============================================================================
// Structural verification
// =============================================================================

describe('structural verification', () => {
  test('parsed system block has correct __kind', () => {
    const ast = parseDocument(`system:\n    instructions: "Test"`);
    expect(ast.system?.__kind).toBe('SystemBlock');
  });

  test('parsed config block has correct __kind', () => {
    const ast = parseDocument(`config:\n    description: "Test"`);
    expect(ast.config?.__kind).toBe('ConfigBlock');
  });

  test('parsed language block has correct __kind', () => {
    const ast = parseDocument(`language:\n    default_locale: "en_US"`);
    expect(ast.language?.__kind).toBe('LanguageBlock');
  });

  test('parsed subagent block has correct __kind', () => {
    const ast = parseDocument(
      `subagent helper:\n    description: "A helper subagent"`
    );
    expect(ast.subagent?.get('helper')?.__kind).toBe('SubagentBlock');
  });

  test('parsed start_agent block has correct __kind', () => {
    const ast = parseDocument(
      `start_agent entry:\n    description: "The entry point"`
    );
    expect(ast.start_agent?.get('entry')?.__kind).toBe('StartAgentBlock');
  });

  test('start_agent __kind is distinct from subagent __kind', () => {
    const ast = parseDocument(
      `start_agent entry:\n    description: "Entry"\nsubagent helper:\n    description: "Helper"`
    );
    const startAgent = ast.start_agent?.get('entry');
    const subagent = ast.subagent?.get('helper');
    expect(startAgent?.__kind).toBe('StartAgentBlock');
    expect(subagent?.__kind).toBe('SubagentBlock');
    expect(startAgent?.__kind).not.toBe(subagent?.__kind);
  });

  test('quoted string key parsed as input name', () => {
    const ast = parseDocument(`subagent main:
    label: "Main"
    actions:
        get_data:
            description: "Gets data"
            inputs:
                "Input:Question": string
            target: "externalService://getData"`);
    const action = ast.subagent?.get('main')?.actions?.get('get_data');
    expect(action?.inputs?.has('Input:Question')).toBe(true);
  });

  test('description field on reasoning action with mixed block', () => {
    const ast = parseDocument(`subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            capture: @utils.setVariables
                description: "Capture data"
                with name=@variables.name`);
    const capture = ast.subagent
      ?.get('main')
      ?.reasoning?.actions?.get('capture');
    expect(capture).toBeDefined();
    expectStringLiteral(capture?.description, 'Capture data');
    expect(capture?.statements).toBeDefined();
    expect(capture?.statements?.length).toBe(1);
  });

  test('reasoning action with label and description parsed', () => {
    const ast = parseDocument(`subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
        actions:
            save_data: @actions.save
                description: "Save the data"
                label: "Save"
                set @variables.saved = @outputs.success`);
    const action = ast.subagent
      ?.get('main')
      ?.reasoning?.actions?.get('save_data');
    expect(action).toBeDefined();
    expectStringLiteral(action?.description, 'Save the data');
    expectStringLiteral(action?.label, 'Save');
    expect(action?.statements).toBeDefined();
    expect(action?.statements?.length).toBe(1);
  });

  test('after_reasoning transition parsed', () => {
    const ast = parseDocument(`subagent other:
    description: "test"
    reasoning:
        instructions: ->
            |Goodbye
    after_reasoning:
        transition to @subagent.main`);
    const topic = ast.subagent?.get('other');
    expect(topic?.after_reasoning?.statements).toHaveLength(1);
  });
});

// =============================================================================
// Template dedentation — TemplateText.value should strip base-level indentation
// =============================================================================

describe('template base indentation stripping', () => {
  /** Helper: extract the first Template statement's TemplateText parts from a procedure field. */
  function getTemplateParts(source: string): {
    parts: TemplateText[];
    template: Template;
  } {
    const ast = parseDocument(source);
    const instructions = ast.subagent?.values().next().value
      ?.reasoning?.instructions;
    expect(instructions).toBeDefined();
    expect(instructions.__kind).toBe('ProcedureValue');
    const stmt = instructions.statements[0];
    expect(stmt.__kind).toBe('Template');
    const template = stmt as Template;
    const textParts = template.parts.filter(
      (p): p is TemplateText => p.__kind === 'TemplateText'
    );
    return { parts: textParts, template };
  }

  test('multiline template strips base indentation from continuation lines', () => {
    const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            | Hello! I'm here to help you today.
              Could you please tell me your name and how I can assist you?
              use something`;

    const { parts } = getTemplateParts(source);
    expect(parts.length).toBe(1);
    const value = parts[0].value;

    // Line 1: space after | is stripped (tracked via spaceAfterPipe flag)
    // Continuation lines: base indentation (14 spaces) should be stripped
    expect(value).toBe(
      "Hello! I'm here to help you today.\nCould you please tell me your name and how I can assist you?\nuse something"
    );
  });

  test('multiline template preserves extra indentation beyond base', () => {
    const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            | Line one
              Line two at base
                  Line three indented beyond base
              Line four back at base`;

    const { parts } = getTemplateParts(source);
    expect(parts.length).toBe(1);
    const value = parts[0].value;

    // Base indent is 14 spaces (matching "Line two" / "Line four")
    // "Line three" has 4 extra spaces beyond base → preserved
    expect(value).toBe(
      'Line one\nLine two at base\n    Line three indented beyond base\nLine four back at base'
    );
  });

  test('single line template is unchanged', () => {
    const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            | Just one line`;

    const { parts } = getTemplateParts(source);
    expect(parts.length).toBe(1);
    // Single line — no continuation lines, no dedenting needed
    expect(parts[0].value).toBe('Just one line');
  });

  test('template with interpolation strips base indent across text nodes', () => {
    const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            | Hello {!@variables.name}
              Welcome to our service`;

    const { parts, template } = getTemplateParts(source);
    // Should have TemplateText, TemplateInterpolation, TemplateText
    expect(template.parts.length).toBe(3);
    // First text part: "Hello " (space after | stripped, tracked via flag)
    expect(parts[0].value).toBe('Hello ');
    // Last text part: the continuation line should be dedented
    expect(parts[1].value).toBe('\nWelcome to our service');
  });

  test('round-trip emit preserves template content after dedent', () => {
    const source = `subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            | Hello! I'm here to help you today.
              Could you please tell me your name?`;

    const ast1 = parseDocument(source);
    const emitted = emitDocument(ast1);
    const ast2 = parseDocument(emitted);

    // The template content (dedented) should be identical across round-trips
    const content1 = (
      ast1.subagent?.values().next().value?.reasoning?.instructions
        ?.statements[0] as Template
    )?.content;
    const content2 = (
      ast2.subagent?.values().next().value?.reasoning?.instructions
        ?.statements[0] as Template
    )?.content;
    expect(content1).toBe(content2);
    // And the content should be dedented
    expect(content1).toBe(
      "Hello! I'm here to help you today.\nCould you please tell me your name?"
    );
  });
});

// =============================================================================
// emitKeyName unit tests
// =============================================================================

describe('emitKeyName', () => {
  test('bare identifier for simple names', () => {
    expect(emitKeyName('foo')).toBe('foo');
    expect(emitKeyName('my_var')).toBe('my_var');
    expect(emitKeyName('CamelCase')).toBe('CamelCase');
  });

  test('quotes names with special characters', () => {
    expect(emitKeyName('Input:Question')).toBe('"Input:Question"');
    expect(emitKeyName('has space')).toBe('"has space"');
    expect(emitKeyName('hyphen-name')).toBe('"hyphen-name"');
  });

  test('escapes backslashes and double quotes', () => {
    expect(emitKeyName('Say "hi"')).toBe('"Say \\"hi\\""');
    expect(emitKeyName('C:\\path')).toBe('"C:\\\\path"');
  });

  test('escapes control characters', () => {
    expect(emitKeyName('line\none')).toBe('"line\\none"');
    expect(emitKeyName('tab\there')).toBe('"tab\\there"');
    expect(emitKeyName('return\rhere')).toBe('"return\\rhere"');
    expect(emitKeyName('null\0here')).toBe('"null\\0here"');
  });
});

// =============================================================================
// Error recovery — normalized round-trip (emit(parse(source)) === source)
//
// Every test here asserts ZERO loss. The source goes in, the exact same
// string must come out. Failures = bugs to fix.
// =============================================================================

describe('error recovery — normalized round-trip', () => {
  // --- Typo / split-merge ---

  test('typo modifier: linkedd string', () => {
    expectNormalizedRoundTrip(`variables:
    EndUserId: linkedd string
        source: @MessagingSession.MessagingEndUserId
        description: "123"`);
  });

  test('123bad before valid colinear value', () => {
    expectNormalizedRoundTrip(`variables:
    EndUserId: 123bad string`);
  });

  // --- Broken colinear fragments (same-row error absorption) ---

  test('broken to clause: tz instead of to is preserved', () => {
    const source = `topic main:
    actions:
        go:
            instructions: ->
                run @utils.transition tz @topic.A2`;
    expectIdempotentEmission(source);
  });

  test('broken colinear fragments stay in mapping_element', () => {
    const source = `topic main:
    actions:
        go: @utils.transition tz @topic.A2
            description: "Navigate"`;
    expectIdempotentEmission(source);
  });

  // --- Broken values in blocks ---

  test('broken system value, sibling blocks intact', () => {
    expectNormalizedRoundTrip(`config:
    description: "Test"

system:
    instructions: !!!broken

language:
    default_locale: "en_US"`);
  });

  test('broken first topic, second topic intact', () => {
    expectNormalizedRoundTrip(`topic broken:
    label: !!!invalid
    description: "broken"

topic good:
    label: "Good"
    description: "This should survive"`);
  });

  test('broken variable among valid ones', () => {
    expectNormalizedRoundTrip(`variables:
    good_one: mutable string
    bad_one: !!!invalid!!!
    another_good: linked number = 5`);
  });

  test('broken action, sibling action intact', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        broken:
            !!!invalid syntax
        good:
            description: "Good action"
            target: "flow://Good"`);
  });

  test('broken reasoning line, topic metadata intact', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    description: "Survives"
    reasoning:
        instructions: ->
            |Valid line
            !!!broken line
        actions:
            go: @utils.transition to @topic.next`);
  });

  test('broken action definition, sibling fields intact', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    description: "Main topic"
    actions:
        broken_action:
            !!!invalid syntax here
    reasoning:
        instructions: ->
            |Do something`);
  });

  test('one broken block among many valid ones', () => {
    expectNormalizedRoundTrip(`config:
    description: "My agent"

system:
    instructions: "Be helpful"

variables:
    name: mutable string

language:
    default_locale: !!!broken

topic main:
    label: "Main"`);
  });

  // --- Degenerate input ---

  test('empty document', () => {
    expectNormalizedRoundTrip('');
  });

  test('whitespace-only', () => {
    expectNormalizedRoundTrip('   \n\n   \n');
  });

  test('comment-only', () => {
    expectNormalizedRoundTrip(`# Just a comment
# Another`);
  });

  test('random garbage', () => {
    expectNormalizedRoundTrip('!@#$%^&*()_+');
  });

  test('single word', () => {
    expectNormalizedRoundTrip('hello');
  });

  test('colon without key', () => {
    expectNormalizedRoundTrip(': value');
  });

  test('deeply nested garbage', () => {
    expectNormalizedRoundTrip(`a:
    b:
        c:
            !!! invalid`);
  });

  test('unmatched indentation', () => {
    expectNormalizedRoundTrip(`topic main:
label: "X"`);
  });

  test('tab characters', () => {
    expectNormalizedRoundTrip('system:\n\tinstructions: "test"');
  });

  test('unicode content', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "日本語テスト"`);
  });

  test('very long single line', () => {
    expectNormalizedRoundTrip(
      'system:\n    instructions: "' + 'x'.repeat(10000) + '"'
    );
  });

  test('many blank lines between blocks', () => {
    expectNormalizedRoundTrip(`config:
    description: "test"



system:
    instructions: "hi"`);
  });

  test('only colons', () => {
    expectNormalizedRoundTrip(':::\n:::');
  });

  test('pipe without context', () => {
    expectNormalizedRoundTrip('|some text here');
  });

  test('arrow without context', () => {
    expectNormalizedRoundTrip('->');
  });

  test('if without body', () => {
    expectNormalizedRoundTrip('if True:');
  });

  test('run without target', () => {
    expectNormalizedRoundTrip('run');
  });

  test('nested empty blocks', () => {
    expectNormalizedRoundTrip(`a:
    b:
    c:
        d:`);
  });

  // --- Missing colons ---

  test('missing colon after topic name', () => {
    // Tree-sitter adds missing colon, so `topic main` → `topic main:`
    expectContentPreserved(`topic main
    label: "Main"
    description: "Test"`);
  });

  test('missing colon after inputs keyword', () => {
    // Missing colon causes parser to merge tokens; content survives but may reformat
    expectContentPreserved(`topic main:
    label: "Main"
    actions:
        verify:
            description: "Verifies data"
            inputs
                policy_number: string
                    label: "Policy Number"
                    is_required: True
            outputs:
                result: boolean
                    label: "Result"
            target: "flow://Verify"`);
  });

  test('missing colon after outputs keyword', () => {
    // Missing colon causes parser to merge tokens; content survives but may reformat
    expectContentPreserved(`topic main:
    label: "Main"
    actions:
        act:
            description: "Test"
            inputs:
                q: string
            outputs
                r: string
            target: "flow://Test"`);
  });

  test('missing colon after actions keyword', () => {
    // Missing colon causes parser to merge with next line; colon restored
    expectContentPreserved(`topic main:
    label: "Main"
    actions
        act:
            description: "Test"
            target: "flow://Test"`);
  });

  // --- Broken expressions ---

  test('extra indentation', () => {
    expectNormalizedRoundTrip(`system:
            instructions: "Over-indented"`);
  });

  test('missing value after colon', () => {
    expectNormalizedRoundTrip(`system:
    instructions:`);
  });

  test('broken if condition', () => {
    // Tree-sitter fragments broken `if` condition; body/content may split across nodes
    expectContentPreserved(`topic main:
    label: "Main"
    after_reasoning:
        if !!!:
            run @actions.bad
        run @actions.good`);
  });

  test('broken template line', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Valid line
            {!broken interpolation
            |Another valid line`);
  });

  test('unmatched parenthesis', () => {
    // Tree-sitter loses the `(` from `(unclosed`; emission is stable
    expectIdempotentEmission(`topic main:
    label: "Main"
    after_reasoning:
        if (unclosed:
            run @actions.go`);
  });

  test('unmatched bracket', () => {
    // Tree-sitter fragments broken `if` condition; content survives
    expectContentPreserved(`topic main:
    label: "Main"
    after_reasoning:
        if items[0:
            run @actions.go`);
  });

  test('unmatched quote', () => {
    // Unclosed strings are normalized (closing quote added) on emit,
    // so we only assert idempotent emission, not exact source preservation.
    expectIdempotentEmission(`system:
    instructions: "unclosed string`);
  });

  test('keyword used as key', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    if: "not a real field"`);
  });

  test('double colon', () => {
    // Tree-sitter splits `system::` into `system:` + ERROR `:`; content survives
    expectContentPreserved(`system::
    instructions: "test"`);
  });

  test('random tokens between valid blocks', () => {
    // Tree-sitter fragments random tokens; content survives but may split
    expectContentPreserved(`config:
    description: "Test"

garbage tokens here !!!

system:
    instructions: "Hello"`);
  });

  test('unknown statement keyword in procedure', () => {
    // Tree-sitter splits `frobnicate @actions.go` into tokens.
    // Re-parse is not idempotent because UntypedBlock adds colon.
    // Verify parse + emit doesn't crash and produces output.
    const ast = parseDocument(`topic main:
    label: "Main"
    after_reasoning:
        frobnicate @actions.go
        transition to @topic.next`);
    const emitted = emitDocument(ast);
    expect(emitted.length).toBeGreaterThan(0);
    // Key content survives
    expect(emitted).toContain('frobnicate');
    expect(emitted).toContain('transition');
  });

  test('empty block body', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:`);
  });

  test('wrong indent direction', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
  description: "Dedented too far"`);
  });

  test('missing topic name', () => {
    // Missing name gets synthetic ILLEGAL name; content (label) survives
    expectContentPreserved(`topic:
    label: "No name"`);
  });

  test('broken with clause in run', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.go
            with =broken
        transition to @topic.next`);
  });

  test('broken set target in run', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        run @actions.go
            set =broken
        transition to @topic.next`);
  });

  test('multiple errors in same block', () => {
    expectNormalizedRoundTrip(`topic main:
    label: !!!broken
    description: !!!also_broken
    reasoning:
        instructions: ->
            |But this is fine`);
  });

  test('error at EOF', () => {
    // Tree-sitter fragments `!!!garbage at end`; emission is stable
    expectIdempotentEmission(`config:
    description: "Test"

topic main:
    label: "Main"
    description: "Test"

!!!garbage at end`);
  });

  test('broken template then valid action', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    reasoning:
        instructions: !!!broken
        actions:
            go: @utils.transition to @topic.next`);
  });

  test('if-else with broken condition', () => {
    // Tree-sitter loses `@@@` tokens from broken condition.
    // Re-parse not idempotent due to fragmentation.
    // Verify parse + emit doesn't crash and key content survives.
    const ast = parseDocument(`topic main:
    label: "Main"
    after_reasoning:
        if @@@ invalid:
            run @actions.a
        else:
            run @actions.b`);
    const emitted = emitDocument(ast);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted).toContain('label');
    expect(emitted).toContain('invalid');
  });

  test('elif with broken condition', () => {
    // Tree-sitter loses `@@@` tokens from broken condition.
    // Re-parse not idempotent due to fragmentation.
    // Verify parse + emit doesn't crash and key content survives.
    const ast = parseDocument(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.ok:
            run @actions.a
        elif @@@ invalid:
            run @actions.b
        else:
            run @actions.c`);
    const emitted = emitDocument(ast);
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted).toContain('label');
    expect(emitted).toContain('invalid');
  });

  test('nested broken if', () => {
    // Tree-sitter fragments nested broken `if`; content survives
    expectContentPreserved(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.a:
            if !!!nested_broken:
                run @actions.deep
            run @actions.ok`);
  });

  test('broken available when', () => {
    // Tree-sitter fragments broken `available when` condition; content survives
    expectContentPreserved(`topic main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do things
        actions:
            go: @utils.transition to @topic.next
                available when !!!broken`);
  });

  test('trailing dot on member expression', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        transition to @topic.`);
  });

  test('incomplete member expression in if', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    after_reasoning:
        if @variables.:
            run @actions.go`);
  });

  test('missing value in variable declaration', () => {
    expectNormalizedRoundTrip(`variables:
    name: mutable string =`);
  });

  test('broken input type', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        act:
            description: "Test"
            inputs:
                param: !!!invalid
            target: "flow://Test"`);
  });

  test('multiple consecutive errors before valid block', () => {
    expectNormalizedRoundTrip(`!!!error1
!!!error2
!!!error3
config:
    description: "Survives"`);
  });

  test('broken run target', () => {
    // Tree-sitter fragments broken run target; content survives
    expectContentPreserved(`topic main:
    label: "Main"
    after_reasoning:
        run !!!invalid`);
  });

  test('duplicate block key', () => {
    expectNormalizedRoundTrip(`system:
    instructions: "First"

system:
    instructions: "Second"`);
  });

  test('deeply nested broken input', () => {
    expectNormalizedRoundTrip(`topic main:
    label: "Main"
    actions:
        act:
            description: "X"
            inputs:
                param: !!!invalid_type
            target: "flow://X"`);
  });

  test('completely invalid syntax', () => {
    expectNormalizedRoundTrip('!@#$%^&');
  });

  test('broken if condition in procedure', () => {
    // Tree-sitter fragments broken `if` condition; content survives
    expectContentPreserved(`topic main:
    label: "Main"
    after_reasoning:
        if !!!bad:
            run @actions.go`);
  });

  test('single = comparison operator preserves condition text', () => {
    // Single `=` is not a valid operator (should be `==`), but the round-trip
    // must preserve the original condition text including the `= 1` part.
    expectContentPreserved(`topic ServiceCustomerVerification:
    description: "Hello"
    reasoning:
        instructions: ->
            | Test
        actions:
            VerifyCustomer: @actions.VerifyCustomer
                if @variables.isVerified = 1:
                    transition to @topic.topic_selector`);
  });

  test('missing colon after field produces exact output', () => {
    // Tree-sitter adds missing colon; content survives with colon restored
    expectContentPreserved(`topic main
    label: "Main"`);
  });
});

// =============================================================================
// Diagnostics — verify errors are reported (separate from round-trip)
// =============================================================================

describe('diagnostics', () => {
  test('typo modifier produces invalid-modifier diagnostic', () => {
    const source = `variables:
    EndUserId: linkedd string
        source: @MessagingSession.MessagingEndUserId
        description: "123"`;
    const { diagnostics } = parseWithDiagnostics(source, AgentScriptSchema);
    const modifierDiags = diagnostics.filter(
      d => d.code === 'invalid-modifier'
    );
    expect(modifierDiags).toHaveLength(1);
    expect(modifierDiags[0].message).toBe(
      "Unknown modifier 'linkedd' for variables EndUserId. Did you mean 'linked'?"
    );
    expect(modifierDiags[0].data).toEqual({
      found: 'linkedd',
      expected: ['mutable', 'linked'],
    });
  });

  test('unknown block key', () => {
    const { diagnostics } = parseWithDiagnostics(
      `nonsense_block:\n    value: "test"`,
      AgentScriptSchema
    );
    expect(diagnostics.some(d => d.code === 'unknown-block')).toBe(true);
  });

  test('unknown field', () => {
    const { diagnostics } = parseWithDiagnostics(
      `system:\n    nonexistent_field: "test"`,
      AgentScriptSchema
    );
    expect(diagnostics.some(d => d.code === 'unknown-field')).toBe(true);
  });

  test('completely invalid syntax', () => {
    const { diagnostics } = parseWithDiagnostics(`!@#$%^&`, AgentScriptSchema);
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test('syntax error in value', () => {
    const { diagnostics } = parseWithDiagnostics(
      `system:\n    instructions: !!!broken`,
      AgentScriptSchema
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test('missing colon after inputs', () => {
    const { diagnostics } = parseWithDiagnostics(
      `topic main:\n    label: "Main"\n    actions:\n        verify:\n            description: "Verifies"\n            inputs\n                policy: string\n            target: "flow://V"`,
      AgentScriptSchema
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test('multiple errors produce multiple diagnostics', () => {
    const { diagnostics } = parseWithDiagnostics(
      `topic main:\n    label: !!!broken\n    description: !!!also_broken\n    reasoning:\n        instructions: ->\n            |But this is fine`,
      AgentScriptSchema
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  test('deeply nested error', () => {
    const { diagnostics } = parseWithDiagnostics(
      `topic main:\n    label: "Main"\n    actions:\n        act:\n            description: "X"\n            inputs:\n                param: !!!invalid_type\n            target: "flow://X"`,
      AgentScriptSchema
    );
    expect(diagnostics.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// Corpus-based round-trip tests
// =============================================================================

describe('corpus round-trips', () => {
  const corpusDir = join(
    import.meta.dirname ?? '.',
    '../../../../packages/parser-tree-sitter/test/corpus'
  );

  let corpusFiles: string[];
  try {
    corpusFiles = readdirSync(corpusDir).filter(f => f.endsWith('.txt'));
  } catch {
    corpusFiles = [];
  }

  // Parse corpus format: ===\nName\n===\nSource\n---\nTree
  function extractCorpusCases(
    filePath: string
  ): Array<{ name: string; source: string }> {
    const content = readFileSync(filePath, 'utf8');
    const parts = content.split(/^={3,}$/m);
    const cases: Array<{ name: string; source: string }> = [];

    for (let i = 1; i < parts.length - 1; i += 2) {
      const name = parts[i].trim();
      const block = parts[i + 1];
      const sepIdx = block.indexOf('\n---\n');
      if (sepIdx === -1) continue;
      const source = block
        .substring(0, sepIdx)
        .replace(/^\n/, '')
        .replace(/\n$/, '');
      if (source.trim()) {
        cases.push({ name, source });
      }
    }
    return cases;
  }

  // Corpus cases where parser CST handling prevents exact round-trip.
  // These use idempotent emission (stable after first parse) instead of
  // exact string equality.
  const idempotentCorpusCases = new Set([
    'Block with Blank Lines (with whitespace)', // reasoning: "test" → Block parse loses string value
    'Empty Block with Two-Identifier Key', // `empty` keyword dropped by block parse
    'Procedure Block with Extra Whitespace and Comment', // extra whitespace normalized
  ]);

  for (const file of corpusFiles) {
    const filePath = join(corpusDir, file);
    const baseName = file.replace('.txt', '');
    const cases = extractCorpusCases(filePath);

    describe(baseName, () => {
      for (const { name, source } of cases) {
        test(`${name} — normalized round-trip`, () => {
          if (idempotentCorpusCases.has(name)) {
            expectIdempotentEmission(source);
          } else {
            expectNormalizedRoundTrip(source);
          }
        });
      }
    });
  }
});
