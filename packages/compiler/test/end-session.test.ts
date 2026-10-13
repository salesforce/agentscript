/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * End session compilation tests.
 *
 * Tests @utils.end_session tool compilation.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import { END_SESSION_TARGET } from '../src/constants.js';
import { isHandOffAction } from '../src/types.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('end_session', () => {
  it('should compile end_session to a tool targeting __end_session_action__', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System instructions"

start_agent main:
    description: "Route user"
    reasoning:
        instructions: ->
            | Route user
        actions:
            finish: @utils.end_session
                description: "End the conversation."
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      (n: { developer_name: string }) => n.developer_name === 'main'
    )!;

    const tool = node.tools.find((t: { name: string }) => t.name === 'finish')!;
    expect(tool).toBeDefined();
    expect(tool.type).toBe('action');
    expect(tool.target).toBe(END_SESSION_TARGET);
    expect(tool.description).toBe('End the conversation.');

    // No handoff actions — end_session is a simple tool
    const endHandoffs = (node.after_all_tool_calls ?? []).filter(
      (h: { target: string }) => h.target === END_SESSION_TARGET
    );
    expect(endHandoffs.length).toBe(0);
  });

  it('should use default description when none provided', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

start_agent main:
    description: "desc"
    reasoning:
        instructions: ->
            | Route user
        actions:
            finish: @utils.end_session
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      (n: { developer_name: string }) => n.developer_name === 'main'
    )!;

    const tool = node.tools.find((t: { name: string }) => t.name === 'finish')!;
    expect(tool.description).toBe('End the session');
  });
});

describe('end_session with available when', () => {
  it('should create tool with enabled condition from available when', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

variables:
    allow_end: mutable boolean = False

start_agent main:
    description: "Handle request"
    reasoning:
        instructions: ->
            | Handle request
        actions:
            finish: @utils.end_session
                description: "End the session"
                available when @variables.allow_end
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      (n: { developer_name: string }) => n.developer_name === 'main'
    )!;

    const tool = node.tools.find((t: { name: string }) => t.name === 'finish')!;
    expect(tool).toBeDefined();
    expect(tool.type).toBe('action');
    expect(tool.target).toBe(END_SESSION_TARGET);
    expect(tool.enabled).toBe('state.allow_end');
  });

  it('should work alongside escalate', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

start_agent main:
    description: "Handle request"
    reasoning:
        instructions: ->
            | Handle request
        actions:
            escalate_to_human: @utils.escalate
                description: "Escalate to human"
            finish: @utils.end_session
                description: "End the session"
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      (n: { developer_name: string }) => n.developer_name === 'main'
    )!;

    expect(node.tools.length).toBe(2);
    expect(node.tools[0].name).toBe('escalate_to_human');
    expect(node.tools[1].name).toBe('finish');
    expect(node.tools[1].target).toBe(END_SESSION_TARGET);

    // Only escalate produces a handoff, not end_session
    const handoffs = node.after_all_tool_calls ?? [];
    expect(handoffs.length).toBe(1);
    expect(handoffs[0].target).toBe('__human__');
  });
});

describe('deterministic end_session directive', () => {
  it('compiles bare `end_session` to an end-session action + end_turn_first handoff', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

start_agent main:
    description: "Handle request"
    reasoning:
        instructions: ->
            | Handle request
    after_reasoning: ->
        end_session
`;
    const { output, diagnostics } = compile(parseSource(source));
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toHaveLength(0);

    const node = output.agent_version.nodes.find(
      (n: { developer_name: string }) => n.developer_name === 'main'
    )!;

    const after = (node.after_reasoning ?? []) as {
      type: string;
      target: string;
      end_turn_first?: boolean;
      state_updates?: unknown;
    }[];

    // 1. The end-session action: shaped like a state update but carrying only
    //    the synthetic target. `end_turn_first` is NOT a field on `action`.
    const action = after.find(a => a.target === END_SESSION_TARGET)!;
    expect(action).toBeDefined();
    expect(action.type).toBe('action');
    expect(action.end_turn_first).toBeUndefined();
    expect(action.state_updates).toBeUndefined();

    // 2. A handoff carrying end_turn_first, targeting the current node.
    const handoff = after.find(a => isHandOffAction(a) && a.end_turn_first)!;
    expect(handoff).toBeDefined();
    expect(handoff.end_turn_first).toBe(true);
    expect(handoff.target).toBe('main');

    // The action precedes the handoff.
    expect(after.indexOf(action)).toBeLessThan(after.indexOf(handoff));
  });

  it('gates both the action and the handoff on a wrapping `if` condition', () => {
    const source = `
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "tester@example.com"

system:
    instructions: "System"

variables:
    done: mutable boolean = False

start_agent main:
    description: "Handle request"
    reasoning:
        instructions: ->
            | Handle request
    after_reasoning:
        if @variables.done:
            end_session
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      (n: { developer_name: string }) => n.developer_name === 'main'
    )!;

    const after = (node.after_reasoning ?? []) as {
      type: string;
      target: string;
      end_turn_first?: boolean;
      enabled?: string;
    }[];

    const action = after.find(a => a.target === END_SESSION_TARGET)!;
    const handoff = after.find(a => isHandOffAction(a) && a.end_turn_first)!;
    // The `if` condition is AND-ed into the enabled guard on both.
    expect(action.enabled).toContain('AgentScriptInternal_condition_1');
    expect(handoff.enabled).toContain('AgentScriptInternal_condition_1');
  });
});
