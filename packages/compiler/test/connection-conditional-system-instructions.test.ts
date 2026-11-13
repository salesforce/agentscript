/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { compile } from '../src/compile.js';
import type { Action } from '../src/types.js';
import { parseSource } from './test-utils.js';

/** The gate that limits an action to the `service_email` connection. */
const EMAIL =
  'lower(system.current_connection or "") in ["service_email", "serviceemail"]';

/**
 * The last action for `service_email`: when its lines added any text, appends
 * that text to the system instructions.
 */
const EMAIL_CONNECTION_APPEND = {
  when: `(${EMAIL}) and (state.AgentScriptInternal_connection_system_instructions != "")`,
  set: {
    AgentScriptInternal_system_instructions:
      'template::{{state.AgentScriptInternal_system_instructions}}\n{{state.AgentScriptInternal_connection_system_instructions}}',
  },
};

// Compiled `enabled` / state-update values are typed `unknown` by the schema;
// keep them as-is so `toEqual` still compares the raw compiled values.
interface ActionSummary {
  when: unknown;
  set: Record<string, unknown>;
}

/** Compiles `source` and returns the named node. */
function compileNode(source: string, name: string) {
  const node = compile(parseSource(source)).output.agent_version.nodes.find(
    candidate => candidate.developer_name === name
  );
  expect(node).toBeDefined();
  return node as {
    instructions?: string;
    before_reasoning_iteration?: Action[];
  };
}

/**
 * Compiles `source` and returns each `before_reasoning_iteration` action of the
 * named node as `{ when: <enabled>, set: <state updates> }`.
 */
function compileActions(source: string, name = 'main'): ActionSummary[] {
  const compiled = compileNode(source, name).before_reasoning_iteration ?? [];
  return compiled.map(action => ({
    when: action.enabled,
    set: Object.fromEntries(
      (action.state_updates ?? []).flatMap(update => Object.entries(update))
    ),
  }));
}

describe('conditional connection additional_system_instructions', () => {
  it('collects each line and condition only on its connection', () => {
    const actions = compileActions(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False
    tier: mutable string = "standard"

connection service_email:
    additional_system_instructions: ->
        | Always confirm the caller's identity.
        if @variables.verified:
            | You may discuss account details for {!@variables.tier} customers.
        else:
            | Do not reveal account details.
        if @variables.tier == "premium":
            | Offer priority callback.

start_agent main:
    description: "Main"
`);

    expect(actions).toEqual([
      { when: 'True', set: { AgentScriptInternal_system_instructions: "''" } },
      {
        when: 'True',
        set: { AgentScriptInternal_connection_system_instructions: "''" },
      },
      {
        when: EMAIL,
        set: {
          AgentScriptInternal_connection_system_instructions:
            "template::{{state.AgentScriptInternal_connection_system_instructions}}\nAlways confirm the caller's identity.",
        },
      },
      {
        when: EMAIL,
        set: { AgentScriptInternal_condition_1: 'state.verified' },
      },
      {
        when: `(${EMAIL}) and (state.AgentScriptInternal_condition_1)`,
        set: {
          AgentScriptInternal_connection_system_instructions:
            'template::{{state.AgentScriptInternal_connection_system_instructions}}\nYou may discuss account details for {{state.tier}} customers.',
        },
      },
      {
        when: `(${EMAIL}) and (not (state.AgentScriptInternal_condition_1))`,
        set: {
          AgentScriptInternal_connection_system_instructions:
            'template::{{state.AgentScriptInternal_connection_system_instructions}}\nDo not reveal account details.',
        },
      },
      {
        when: EMAIL,
        set: {
          AgentScriptInternal_condition_1: 'state.tier == "premium"',
        },
      },
      {
        when: `(${EMAIL}) and (state.AgentScriptInternal_condition_1)`,
        set: {
          AgentScriptInternal_connection_system_instructions:
            'template::{{state.AgentScriptInternal_connection_system_instructions}}\nOffer priority callback.',
        },
      },
      EMAIL_CONNECTION_APPEND,
    ]);
  });

  it('keeps static system instructions as text and appends the connection text', () => {
    const source = `config:
    agent_name: "TestBot"

system:
    instructions: "You are a support agent."

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | You may discuss account details.

start_agent main:
    description: "Main"
`;

    // The static text is not rebuilt; only the connection part is.
    expect(compileNode(source, 'main').instructions).toBe(
      'You are a support agent.{{state.AgentScriptInternal_system_instructions}}'
    );
    expect(compileActions(source)).toEqual([
      { when: 'True', set: { AgentScriptInternal_system_instructions: "''" } },
      {
        when: 'True',
        set: { AgentScriptInternal_connection_system_instructions: "''" },
      },
      {
        when: EMAIL,
        set: { AgentScriptInternal_condition_1: 'state.verified' },
      },
      {
        when: `(${EMAIL}) and (state.AgentScriptInternal_condition_1)`,
        set: {
          AgentScriptInternal_connection_system_instructions:
            'template::{{state.AgentScriptInternal_connection_system_instructions}}\nYou may discuss account details.',
        },
      },
      EMAIL_CONNECTION_APPEND,
    ]);
  });

  it('starts each connection with empty collected text', () => {
    const actions = compileActions(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | Email.

connection messaging:
    additional_system_instructions: ->
        if @variables.verified:
            | Messaging.

start_agent main:
    description: "Main"
`);

    // Each connection rebuilds its text from empty, starting with its own
    // `True` reset.
    expect(actions).toEqual([
      { when: 'True', set: { AgentScriptInternal_system_instructions: "''" } },
      {
        when: 'True',
        set: { AgentScriptInternal_connection_system_instructions: "''" },
      },
      {
        when: EMAIL,
        set: { AgentScriptInternal_condition_1: 'state.verified' },
      },
      {
        when: `(${EMAIL}) and (state.AgentScriptInternal_condition_1)`,
        set: {
          AgentScriptInternal_connection_system_instructions:
            'template::{{state.AgentScriptInternal_connection_system_instructions}}\nEmail.',
        },
      },
      EMAIL_CONNECTION_APPEND,
      {
        when: 'True',
        set: { AgentScriptInternal_connection_system_instructions: "''" },
      },
      {
        when: 'lower(system.current_connection or "") in ["messaging"]',
        set: { AgentScriptInternal_condition_1: 'state.verified' },
      },
      {
        when: '(lower(system.current_connection or "") in ["messaging"]) and (state.AgentScriptInternal_condition_1)',
        set: {
          AgentScriptInternal_connection_system_instructions:
            'template::{{state.AgentScriptInternal_connection_system_instructions}}\nMessaging.',
        },
      },
      {
        when: '(lower(system.current_connection or "") in ["messaging"]) and (state.AgentScriptInternal_connection_system_instructions != "")',
        set: EMAIL_CONNECTION_APPEND.set,
      },
    ]);
  });

  it('gates each connection on its own lowercase spellings', () => {
    const actions = compileActions(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False

connection web_chat:
    additional_system_instructions: ->
        if @variables.verified:
            | Web chat.

connection messaging:
    additional_system_instructions: ->
        if @variables.verified:
            | Messaging.

start_agent main:
    description: "Main"
`);
    const connectionBlocks = actions.filter(
      action =>
        'AgentScriptInternal_system_instructions' in action.set &&
        action.when !== 'True'
    );

    expect(connectionBlocks.map(action => action.when)).toEqual([
      '(lower(system.current_connection or "") in ["web_chat", "webchat"]) and (state.AgentScriptInternal_connection_system_instructions != "")',
      '(lower(system.current_connection or "") in ["messaging"]) and (state.AgentScriptInternal_connection_system_instructions != "")',
    ]);
  });

  it('does not reuse the condition slot a file reference is gated on', () => {
    const node = compileNode(
      `config:
    agent_name: "TestBot"
    file_upload:
        mode: "managed"

system:
    instructions: ->
        if @variables.verified:
            | See {!@system_variables.uploaded_files[0]}.

variables:
    verified: mutable boolean = False
    tier: mutable string = "standard"

connection service_email:
    additional_system_instructions: ->
        if @variables.tier == "gold":
            | Gold.

start_agent main:
    description: "Main"
`,
      'main'
    ) as {
      file_references?: { enabled?: string }[];
      before_reasoning_iteration?: Action[];
    };
    const connectionConditions = (node.before_reasoning_iteration ?? [])
      .filter(action => action.enabled === EMAIL)
      .flatMap(action => Object.keys(action.state_updates?.[0] ?? {}));

    // The file reference is enabled by the system condition in slot 1, so the
    // connection condition takes the next slot.
    expect(node.file_references).toEqual([
      expect.objectContaining({
        enabled: 'state.AgentScriptInternal_condition_1',
      }),
    ]);
    expect(connectionConditions).toEqual(['AgentScriptInternal_condition_2']);
  });

  it('keeps router nodes free of connection text', () => {
    const source = `config:
    agent_name: "TestBot"

system:
    instructions: "Route requests."

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | You may discuss account details.

start_agent router:
    description: "Router"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"

subagent helper:
    description: "Helper"
`;

    // The router keeps its static text and gets no actions...
    expect(compileNode(source, 'router').instructions).toBe('Route requests.');
    expect(compileActions(source, 'router')).toEqual([]);
    // ...while the standard subagent next to it gets the connection actions.
    expect(compileNode(source, 'helper').instructions).toBe(
      'Route requests.{{state.AgentScriptInternal_system_instructions}}'
    );
  });

  it('declares no connection variables when only a router exists', () => {
    const output = compile(
      parseSource(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | You may discuss account details.

start_agent router:
    description: "Router"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
`)
    ).output.agent_version;

    const declared =
      output.state_variables?.map(variable => variable.developer_name) ?? [];

    expect(declared).not.toContain(
      'AgentScriptInternal_connection_system_instructions'
    );
    expect(declared.filter(name => name.includes('_condition_'))).toEqual([]);
  });

  it('reports a user variable with the reserved connection variable name', () => {
    const result = compile(
      parseSource(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False
    AgentScriptInternal_connection_system_instructions: mutable string = "mine"

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | You may discuss account details.

start_agent main:
    description: "Main"
`)
    );
    const declared = result.output.agent_version.state_variables?.filter(
      variable =>
        variable.developer_name ===
        'AgentScriptInternal_connection_system_instructions'
    );

    expect(result.diagnostics.map(d => d.code)).toContain(
      'dynamic-system-instructions-variable-conflict'
    );
    // The internal declaration replaces the user's.
    expect(declared).toEqual([
      expect.objectContaining({ default: "''", visibility: 'Internal' }),
    ]);
  });

  it('removes conditional connection text from the surface and keeps static text', () => {
    const output = compile(
      parseSource(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | You may discuss account details.

connection messaging:
    additional_system_instructions: "Keep messages short."

start_agent main:
    description: "Main"
`)
    ).output;
    const surface = (type: string) =>
      output.agent_version.surfaces?.find(
        candidate => candidate.surface_type === type
      );

    expect(surface('service_email')?.additional_system_instructions).toBe(
      undefined
    );
    expect(surface('messaging')?.additional_system_instructions).toBe(
      'Keep messages short.'
    );
  });

  it('reports an unsupported connection procedure and keeps only the system text', () => {
    const source = `config:
    agent_name: "TestBot"

system:
    instructions: "You are a support agent."

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            set @variables.verified = False

start_agent main:
    description: "Main"
`;
    const result = compile(parseSource(source));
    const surface = result.output.agent_version.surfaces?.find(
      candidate => candidate.surface_type === 'service_email'
    );

    expect(result.diagnostics.map(d => d.code)).toContain(
      'unsupported-system-instruction-statement'
    );
    // The procedure is dropped, not compiled into a state update.
    expect(compileNode(source, 'main')).toEqual(
      expect.objectContaining({ instructions: 'You are a support agent.' })
    );
    expect(compileActions(source)).toEqual([]);
    expect(surface?.additional_system_instructions).toBe(undefined);
  });

  it('reports an unsupported procedure without an if and drops it from the surface', () => {
    const result = compile(
      parseSource(`config:
    agent_name: "TestBot"

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        set @variables.verified = True
        | You may discuss account details.

start_agent main:
    description: "Main"
`)
    );
    const surface = result.output.agent_version.surfaces?.find(
      candidate => candidate.surface_type === 'service_email'
    );

    expect(result.diagnostics.map(d => d.code)).toContain(
      'unsupported-system-instruction-statement'
    );
    expect(surface?.additional_system_instructions).toBe(undefined);
  });

  it('drops an unsupported system procedure and keeps the connection text', () => {
    const actions = compileActions(`config:
    agent_name: "TestBot"

system:
    instructions: ->
        | Hi.
        set @variables.verified = True

variables:
    verified: mutable boolean = False

connection service_email:
    additional_system_instructions: ->
        if @variables.verified:
            | You may discuss account details.

start_agent main:
    description: "Main"
`);
    const texts = actions.flatMap(action => Object.values(action.set));

    expect(
      texts.some(text => typeof text === 'string' && text.includes('Hi.'))
    ).toBe(false);
    expect(actions.at(-1)).toEqual(EMAIL_CONNECTION_APPEND);
  });
});
