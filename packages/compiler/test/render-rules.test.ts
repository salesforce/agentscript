/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Render-rules compilation tests.
 *
 * Covers `when @connection.<surface>` blocks inside `subagent.reasoning.actions`
 * bodies. The compiler lifts each valid block into a single `RenderRule`
 * on `Tool.render_rules`. Empty/bare blocks emit no rule; malformed
 * `render:`/`show_and_return:` values emit compiler errors.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, findNode, isActionTool } from './test-utils.js';
import { STATE_UPDATE_ACTION } from '../src/constants.js';
import { DiagnosticSeverity } from '@agentscript/types';
import type { RenderRule } from '../src/types.js';

/**
 * Minimal agent shape with a single subagent and one reasoning action.
 * Body is appended verbatim so tests can slot the `when` clause under test in.
 */
function agentWithReasoningBody(body: string): string {
  return `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    response_formats:
        choices:
            description: "Choice format"
            inputs:
                items: string
        LWC_Test1:
            description: "LWC format"
            inputs:
                foo: string

start_agent main:
    description: "root"

subagent find_restaurants:
    description: "restaurants"
    actions:
        Get_List_of_Restaurants:
            description: "Fetch restaurants"
            target: "flow://GetList"
            inputs:
                location: string
    reasoning:
        instructions: ->
            | test
        actions:
            Get_List_of_Restaurants: @actions.Get_List_of_Restaurants
                with location = "seattle"
${body}
`;
}

function getReasoningActionTool(
  result: ReturnType<typeof compile>,
  nodeName: string
) {
  const node = findNode(result.output, nodeName, 'subagent');
  const actionTools = (node.tools ?? [])
    .filter(isActionTool)
    .filter(t => t.target !== STATE_UPDATE_ACTION);
  if (actionTools.length !== 1) {
    throw new Error(
      `Expected 1 action tool on ${nodeName}, got ${actionTools.length}`
    );
  }
  return actionTools[0];
}

function errors(result: ReturnType<typeof compile>) {
  return result.diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
}

describe('render_rules — response_format renderer', () => {
  it('emits one rule with end_turn=false when only render: is present', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @response_formats.choices`
    );
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toEqual([
      {
        surface_type: 'messaging',
        response_format_name: 'choices',
        end_turn: false,
      } satisfies RenderRule,
    ]);
  });

  it('threads show_and_return: True through to end_turn=true', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @response_formats.choices
                        show_and_return: True`
    );
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules?.[0]?.end_turn).toBe(true);
  });

  it('threads show_and_return: False through to end_turn=false', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @response_formats.choices
                        show_and_return: False`
    );
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);
    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules?.[0]?.end_turn).toBe(false);
  });

  it('emits multiple rules — one per when block — in source order', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @response_formats.choices
                        show_and_return: True
                when @connection.ecv2
                    render: @response_formats.LWC_Test1
                        show_and_return: False`
    );
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toEqual([
      {
        surface_type: 'messaging',
        response_format_name: 'choices',
        end_turn: true,
      },
      {
        surface_type: 'ecv2',
        response_format_name: 'LWC_Test1',
        end_turn: false,
      },
    ]);
  });
});

describe('render_rules — longform @connection.<surface>.response_formats.<name>', () => {
  it('accepts longform reference and emits response_format renderer', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @connection.messaging.response_formats.choices`
    );
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toEqual([
      {
        surface_type: 'messaging',
        response_format_name: 'choices',
        end_turn: false,
      } satisfies RenderRule,
    ]);
  });
});

describe('render_rules — built-in @response_formats.json', () => {
  it('accepts @response_formats.json without requiring the connection to declare a `json` format', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @response_formats.json`
    );
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toEqual([
      {
        surface_type: 'messaging',
        response_format_name: 'json',
        end_turn: false,
      },
    ]);
  });
});

describe('render_rules — empty when @connection.X block', () => {
  it('emits a compiler error and no rule when the when-block has no render: clause', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging`
    );
    const result = compile(parseSource(source));

    const errs = errors(result);
    expect(
      errs.some(e =>
        e.message.includes(
          "'when @connection.messaging' block requires a 'render:' clause"
        )
      )
    ).toBe(true);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toBeUndefined();
  });

  it('emits no render_rules field when the action has no when blocks at all', () => {
    const source = agentWithReasoningBody('');
    const result = compile(parseSource(source));
    expect(errors(result)).toEqual([]);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toBeUndefined();
  });
});

describe('render_rules — malformed clauses emit errors', () => {
  it('errors when render: references a namespace other than @response_formats or @connection.<X>.response_format', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @variables.foo`
    );
    const result = compile(parseSource(source));

    const errs = errors(result);
    expect(
      errs.some(e =>
        e.message.includes(
          "'render:' value must reference '@response_formats.<name>'"
        )
      )
    ).toBe(true);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toBeUndefined();
  });

  it("errors when the connectionRef namespace isn't @connection", () => {
    const source = agentWithReasoningBody(
      `                when @variables.foo
                    render: @response_formats.choices`
    );
    const result = compile(parseSource(source));

    expect(errors(result).length).toBeGreaterThan(0);

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toBeUndefined();
  });

  it('errors on a second `render:` clause inside the same when block', () => {
    const source = agentWithReasoningBody(
      `                when @connection.messaging
                    render: @response_formats.choices
                    render: @response_formats.LWC_Test1`
    );
    const result = compile(parseSource(source));

    const errs = errors(result);
    expect(errs.some(e => /multiple 'render:' clauses/.test(e.message))).toBe(
      true
    );

    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toBeUndefined();
  });
});

/**
 * Agent with a messaging `card` format and a service_email `email` format,
 * whose single reasoning action carries the `when` blocks in `body`.
 */
function agentWithBindings(body: string): string {
  return `
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    name: mutable string = "Ada"

connection messaging:
    response_formats:
        card:
            description: "Card"
            inputs:
                title: string
                subtitle:
                    type: string
                    is_required: False
                header:
                    type: object
                        fields:
                            label: string
                            meta:
                                type: object
                                    fields:
                                        tag: string
                rows:
                    type: list
                        value: object
                            fields:
                                cell: string
                                hint: string
                tags:
                    type: list
                        value: string

connection service_email:
    inputs:
        signature: string = "Support"
    response_formats:
        email:
            description: "Email"
            inputs:
                sign_off: string
                greeting: string = "Hi"
                from_name: string = @inputs.signature
                owner: string = @variables.name
                info:
                    type: object
                        fields:
                            lang: string = "en"
                            code: string

start_agent main:
    description: "root"

subagent find_restaurants:
    description: "restaurants"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
            outputs:
                subject: string
                total: integer
    reasoning:
        instructions: ->
            | test
        actions:
            Lookup: @actions.Lookup
${body}
`;
}

/** Return the input_bindings of a render rule on the `Lookup` tool. */
function bindingsOf(result: ReturnType<typeof compile>, index = 0) {
  const tool = getReasoningActionTool(result, 'find_restaurants');
  return tool.render_rules?.[index]?.input_bindings;
}

describe('render_rules — `with` input bindings', () => {
  it('omits input_bindings when the render has no `with` clause', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card`)
      )
    );
    expect(errors(result)).toEqual([]);
    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules?.[0]).not.toHaveProperty('input_bindings');
  });

  it('emits every declared input in the render rule', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "Hi " + @variables.name
                        with tags = ["a", @outputs.subject]
                        show_and_return: True`)
      )
    );
    expect(errors(result)).toEqual([]);
    const tool = getReasoningActionTool(result, 'find_restaurants');
    expect(tool.render_rules).toEqual([
      {
        surface_type: 'messaging',
        response_format_name: 'card',
        end_turn: true,
        input_bindings: {
          title: '"Hi " + state.name',
          subtitle: null,
          header: { label: null, meta: { tag: null } },
          rows: null,
          tags: ['"a"', 'result.subject'],
        },
      } satisfies RenderRule,
    ]);
  });

  it('passes a scalar bound to an object or list input through unchanged', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "x"
                        with header = 5
                        with rows = True`)
      )
    );
    expect(bindingsOf(result)).toMatchObject({ header: '5', rows: 'True' });
  });
  it('fills the declared fields an inline dict omits with null, at every depth', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = @outputs.subject
                        with header = {meta: {}}
                        with rows = [{cell: @outputs.subject}, {hint: "h", cell: "c"}]`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)).toEqual({
      title: 'result.subject',
      subtitle: null,
      header: { label: null, meta: { tag: null } },
      rows: [
        { cell: 'result.subject', hint: null },
        { cell: '"c"', hint: '"h"' },
      ],
      tags: null,
    });
  });

  it('expands every unbound object to its fields, and compiles an unbound list to null', () => {
    const result = compile(
      parseSource(`
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    response_formats:
        card:
            description: "Card"
            inputs:
                title: string
                header:
                    type: object
                        fields:
                            label: string
                            meta:
                                type: object
                                    fields:
                                        tag: string = "new"
                                        rank: number
                extra:
                    type: object
                        fields:
                            note: string = "n/a"
                    is_required: False
                blob: object
                rows:
                    type: list
                        value: object
                            fields:
                                cell: string = "-"
                                meta:
                                    type: object
                                        fields:
                                            tag: string = "t"
                labels: list[string]

start_agent main:
    description: "root"

subagent find_restaurants:
    description: "restaurants"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | test
        actions:
            Lookup: @actions.Lookup
                when @connection.messaging
                    render: @response_formats.card
                        with title = "T"
                        with header = {label: "L"}
`)
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)).toEqual({
      title: '"T"',
      header: { label: '"L"', meta: { tag: '"new"', rank: null } },
      extra: { note: '"n/a"' },
      blob: null,
      rows: null,
      labels: null,
    });
  });

  it('compiles an optional object or list of objects with nothing to bind to null', () => {
    const result = compile(
      parseSource(`
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

connection messaging:
    response_formats:
        card:
            description: "Card"
            inputs:
                title: string
                opt_obj:
                    type: object
                        fields:
                            a: string
                    is_required: False
                opt_list:
                    type: list
                        value: object
                            fields:
                                b: string
                    is_required: False
                opt_defaulted:
                    type: object
                        fields:
                            e: string = "y"
                    is_required: False
                req_all_optional:
                    type: object
                        fields:
                            c:
                                type: string
                                is_required: False
                holder:
                    type: object
                        fields:
                            x: string
                            inner:
                                type: object
                                    fields:
                                        d: string
                                is_required: False

start_agent main:
    description: "root"

subagent find_restaurants:
    description: "restaurants"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | test
        actions:
            Lookup: @actions.Lookup
                when @connection.messaging
                    render: @response_formats.card
                        with title = "T"
                        with holder = {x: "1"}
`)
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)).toEqual({
      title: '"T"',
      opt_obj: null,
      opt_list: null,
      opt_defaulted: { e: '"y"' },
      req_all_optional: { c: null },
      holder: { x: '"1"', inner: null },
    });
  });

  it('keeps undeclared dict keys and inputs verbatim (the linter reports them)', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = {"Odd Key": 1}
                        with extra = @outputs.total`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)).toMatchObject({
      title: { 'Odd Key': '1' },
      extra: 'result.total',
    });
  });

  it('keeps a `__proto__` input or dict key as a plain entry', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = {"__proto__": {injected: "v"}}
                        with __proto__ = "x"`)
      )
    );
    const bindings = bindingsOf(result);
    // A `__proto__` key that sets the prototype is missing from the JSON.
    expect(JSON.stringify(bindings?.title)).toBe(
      '{"__proto__":{"injected":"\\"v\\""}}'
    );
    expect(JSON.stringify(bindings)).toContain('"__proto__":"\\"x\\""');
  });

  it('keeps the last value of a duplicate binding', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "first"
                        with title = "second"`)
      )
    );
    expect(bindingsOf(result)?.title).toBe('"second"');
  });

  it('resolves short and long connection inputs against the when connection', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.service_email
                    render: @response_formats.email
                        with sign_off = @inputs.signature + @connection.service_email.inputs.signature`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)?.sign_off).toBe(
      'connection.service_email.signature + connection.service_email.signature'
    );
  });

  it('fills an inline dict from field defaults, and an explicit binding beats the default', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.service_email
                    render: @response_formats.email
                        with greeting = None
                        with info = {code: "X"}`)
      )
    );
    expect(bindingsOf(result)).toMatchObject({
      greeting: null,
      info: { lang: '"en"', code: '"X"' },
    });
  });

  it('compiles each when block its own bindings against its own connection', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "T"
                when @connection.service_email
                    render: @response_formats.email
                        with sign_off = @inputs.signature`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result, 0)?.title).toBe('"T"');
    expect(bindingsOf(result, 1)?.sign_off).toBe(
      'connection.service_email.signature'
    );
  });
  it('scopes the connection to the render, leaving later @inputs uncontextualized', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.service_email
                    render: @response_formats.email
                        with sign_off = @inputs.signature
            Lookup_Again: @actions.Lookup
                available when @inputs.signature == "x"`)
      )
    );
    expect(
      result.diagnostics.some(d =>
        /not in a connection context/.test(d.message)
      )
    ).toBe(true);
  });

  it('compiles an ellipsis as an expression string', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = ...
                        with tags = ["a", ...]`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)).toMatchObject({
      title: '...',
      tags: ['"a"', '...'],
    });
  });

  it('compiles a spread list item to a spread expression string', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "x"
                        with tags = [*@outputs.subject, "a"]`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)?.tags).toEqual(['*result.subject', '"a"']);
  });

  it('compiles a bare None to null', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "x"
                        with subtitle = None`)
      )
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)?.subtitle).toBeNull();
  });

  it('compiles every leaf inside dicts and lists like a top-level value', () => {
    const result = compile(
      parseSource(
        agentWithBindings(`                when @connection.messaging
                    render: @response_formats.card
                        with title = "x"
                        with header = {label: "it's \\"q\\"", meta: {tag: "VIP" if @outputs.total > 1 else "Guest"}}
                        with rows = [{cell: -1.5, hint: False}, {cell: @outputs.subject, hint: None}]
                        with tags = ["a", @variables.name + "!", None]`)
      )
    );
    expect(bindingsOf(result)).toEqual({
      title: '"x"',
      subtitle: null,
      header: {
        label: '"it\'s \\"q\\""',
        meta: { tag: '"VIP" if result.total > 1 else "Guest"' },
      },
      rows: [
        { cell: '-1.5', hint: 'False' },
        { cell: 'result.subject', hint: null },
      ],
      tags: ['"a"', 'state.name + "!"', null],
    });
  });

  it('compiles each kind of format input default like a binding value', () => {
    const result = compile(
      parseSource(`
config:
    agent_name: "Test"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

variables:
    name: mutable string = "Ada"

connection service_email:
    inputs:
        signature: string = "Support"
    response_formats:
        email:
            description: "Email"
            inputs:
                sign_off: string
                quoted: string = "it's \\"me\\""
                empty: string = ""
                count: number = -1.50
                flag: boolean = False
                gone: string = None
                vip: string = "VIP" if @variables.name == "Ada" else "Guest"
                tags: list[string] = ["a", "b"]
                owner: string = @variables.name
                from_name: string = @inputs.signature
                info:
                    type: object
                        fields:
                            lang: string = "en"
                            code: string

start_agent main:
    description: "root"

subagent find_restaurants:
    description: "restaurants"
    actions:
        Lookup:
            description: "Look up"
            target: "flow://Lookup"
    reasoning:
        instructions: ->
            | test
        actions:
            Lookup: @actions.Lookup
                when @connection.service_email
                    render: @response_formats.email
                        with sign_off = "Bye"
`)
    );
    expect(errors(result)).toEqual([]);
    expect(bindingsOf(result)).toEqual({
      sign_off: '"Bye"',
      quoted: '"it\'s \\"me\\""',
      empty: '""',
      count: '-1.5',
      flag: 'False',
      gone: null,
      vip: '"VIP" if state.name == "Ada" else "Guest"',
      tags: ['"a"', '"b"'],
      owner: 'state.name',
      from_name: 'connection.service_email.signature',
      info: { lang: '"en"', code: null },
    });
  });
});
