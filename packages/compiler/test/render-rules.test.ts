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
import { parseSource } from './test-utils.js';
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
  const node = result.output.agent_version.nodes.find(
    n => n.developer_name === nodeName
  );
  if (!node) throw new Error(`Node ${nodeName} not found`);
  const actionTools = node.tools.filter(t => t.target !== STATE_UPDATE_ACTION);
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
