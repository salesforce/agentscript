/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * W-24388338: LLM-filled inputs (`with param = ...` or the bare `with param`
 * shorthand) are only valid on reasoning actions (reasoning.actions). On a
 * deterministic `run` — before_reasoning, after_reasoning, reasoning.instructions,
 * or a run nested under a reasoning action (post_tool_call) — they must raise a
 * compile error instead of silently emitting a literal `...` that fails at
 * runtime. Required inputs left unprovided on these runs get a warning.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import type { Action } from '../src/types.js';
import { DiagnosticSeverity } from '@agentscript/types';

/** Head with a `lookup_order` action that has two required inputs. */
const HEAD = `
config:
    agent_name: "TestBot"

variables:
    customer_id: mutable string = ""
`;

const ACTIONS_BLOCK = `
    actions:
        lookup_order:
            description: "Look up an order"
            inputs:
                order_number: string
                    is_required: True
                customer_id: string
                    is_required: True
            outputs:
                status: string
            target: "flow://Lookup_Order"
`;

function errors(diagnostics: { severity: number; message: string }[]) {
  return diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
}

function warnings(diagnostics: { severity: number; message: string }[]) {
  return diagnostics.filter(d => d.severity === DiagnosticSeverity.Warning);
}

function mainNode(source: string) {
  const { output, diagnostics } = compile(parseSource(source));
  const node = output.agent_version.nodes.find(
    n => n.developer_name === 'main'
  )!;
  return { node, diagnostics };
}

describe('LLM-filled inputs on deterministic runs raise a compile error', () => {
  it('before_reasoning: `with param = ...` errors and does not reach bound_inputs', () => {
    const { node, diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    before_reasoning:
        run @actions.lookup_order
            with order_number=...
            with customer_id=@variables.customer_id
    reasoning:
        instructions: ->
            | Help the customer.
`);

    const errs = errors(diagnostics);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('reasoning.actions');
    expect(errs[0].message).toContain('order_number');

    // The invalid input must NOT land in bound_inputs as a literal "...".
    const action = (node.before_reasoning ?? []).find(
      (a: Action) => a.target === 'lookup_order'
    );
    expect(action).toBeDefined();
    expect(action?.bound_inputs).toEqual({
      customer_id: 'state.customer_id',
    });
    expect(action?.llm_inputs).toEqual([]);
  });

  it('after_reasoning: `with param = ...` errors', () => {
    const { diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    after_reasoning:
        run @actions.lookup_order
            with order_number=...
            with customer_id=@variables.customer_id
    reasoning:
        instructions: ->
            | Help the customer.
`);
    expect(errors(diagnostics)).toHaveLength(1);
    expect(errors(diagnostics)[0].message).toContain('reasoning.actions');
  });

  it('reasoning.instructions: `with param = ...` on an embedded run errors', () => {
    const { diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    reasoning:
        instructions: ->
            run @actions.lookup_order
                with order_number=...
                with customer_id=@variables.customer_id
            | Help the customer.
`);
    expect(errors(diagnostics)).toHaveLength(1);
    expect(errors(diagnostics)[0].message).toContain('reasoning.actions');
  });

  it('post_tool_call: `with param = ...` on a nested run errors', () => {
    const { diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
    actions:
        notify:
            description: "Notify"
            target: "flow://Notify"
        lookup_order:
            description: "Look up an order"
            inputs:
                order_number: string
                    is_required: True
            target: "flow://Lookup_Order"
    reasoning:
        instructions: ->
            | Help the customer.
        actions:
            do_notify: @actions.notify
                run @actions.lookup_order
                    with order_number=...
`);
    expect(errors(diagnostics)).toHaveLength(1);
    expect(errors(diagnostics)[0].message).toContain('reasoning.actions');
  });

  it('bare `with param` (no `= ...`) on a deterministic run also errors', () => {
    const { diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    before_reasoning:
        run @actions.lookup_order
            with order_number
            with customer_id=@variables.customer_id
    reasoning:
        instructions: ->
            | Help the customer.
`);
    const errs = errors(diagnostics);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain('order_number');
    expect(errs[0].message).toContain('reasoning.actions');
  });
});

describe('missing required inputs on deterministic runs warn', () => {
  it('before_reasoning: an unprovided required input warns', () => {
    const { diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    before_reasoning:
        run @actions.lookup_order
            with customer_id=@variables.customer_id
    reasoning:
        instructions: ->
            | Help the customer.
`);
    // No error — just a warning for the unprovided required order_number.
    expect(errors(diagnostics)).toHaveLength(0);
    const warns = warnings(diagnostics);
    expect(
      warns.some(w => w.message.includes('Required input "order_number"'))
    ).toBe(true);
  });

  it('does not warn when all required inputs are bound', () => {
    const { diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    before_reasoning:
        run @actions.lookup_order
            with order_number=@variables.customer_id
            with customer_id=@variables.customer_id
    reasoning:
        instructions: ->
            | Help the customer.
`);
    expect(errors(diagnostics)).toHaveLength(0);
    expect(
      warnings(diagnostics).filter(w => w.message.includes('Required input'))
    ).toHaveLength(0);
  });
});

describe('LLM-filled inputs stay valid on reasoning.actions tools', () => {
  it('`with param = ...` on a reasoning action still compiles to llm_inputs with no error', () => {
    const { node, diagnostics } = mainNode(`${HEAD}
start_agent main:
    description: "Main"
${ACTIONS_BLOCK}
    reasoning:
        instructions: ->
            | Help the customer.
        actions:
            lookup: @actions.lookup_order
                with order_number=...
                with customer_id=@variables.customer_id
`);
    expect(errors(diagnostics)).toHaveLength(0);
    const tool = (node.tools ?? []).find(t => t.target === 'lookup_order');
    expect(tool).toBeDefined();
    expect(tool?.llm_inputs).toEqual(['order_number']);
    expect(tool?.bound_inputs).toEqual({ customer_id: 'state.customer_id' });
  });
});
