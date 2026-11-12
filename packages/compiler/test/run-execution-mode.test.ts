/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import { compile } from '../src/compile.js';
import { isAction } from '../src/types.js';
import { checkSchemaConformance, findNode, parseSource } from './test-utils.js';

function source(mode = 'execution_mode: "fire_and_forget"') {
  return `
config:
    developer_name: "BackgroundLookup"
variables:
    record_id: string = "example"
start_agent main:
    description: "Look up records"
    actions:
        Lookup:
            description: "Look up a record"
            target: "flow://Lookup"
            cache:
                expiration: 60
            inputs:
                id: string
    before_reasoning:
        run @actions.Lookup
            ${mode}
            with id=@variables.record_id
    reasoning:
        instructions: ->
            | Look up records when requested.
        actions:
            lookup: @actions.Lookup
`;
}

describe('deterministic run execution mode', () => {
  it('keeps background lifecycle execution separate from the reasoning tool and cache definition', () => {
    const { output, diagnostics } = compile(parseSource(source()));
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const node = findNode(output, 'main', 'subagent');
    const action = node.before_reasoning
      ?.filter(isAction)
      .find(a => a.target === 'Lookup');
    expect(action).toMatchObject({
      non_blocking_behavior: 'fire_and_forget',
      bound_inputs: { id: 'state.record_id' },
      llm_inputs: [],
    });
    expect(action).not.toHaveProperty('execution_mode');
    expect(action?.bound_inputs).not.toHaveProperty('execution_mode');
    expect(node.tools?.find(t => t.name === 'lookup')).not.toHaveProperty(
      'non_blocking_behavior'
    );
    expect(node.action_definitions?.[0]).toMatchObject({
      cache: { ttl: 60000 },
    });
    expect(node.action_definitions?.[0]).not.toHaveProperty(
      'non_blocking_behavior'
    );
    expect(checkSchemaConformance(output)).toEqual([]);
  });

  it('compiles omitted and explicit blocking modes identically', () => {
    const omitted = compile(parseSource(source('')));
    const explicit = compile(parseSource(source('execution_mode: "blocking"')));
    expect(JSON.parse(JSON.stringify(explicit.output))).toEqual(
      JSON.parse(JSON.stringify(omitted.output))
    );
  });

  it('retains conditional guards on a background invocation', () => {
    const conditional = source().replace(
      '        run @actions.Lookup\n            execution_mode: "fire_and_forget"\n            with id=@variables.record_id',
      '        if @variables.record_id != "":\n            run @actions.Lookup\n                execution_mode: "fire_and_forget"\n                with id=@variables.record_id'
    );
    const { output } = compile(parseSource(conditional));
    const action = findNode(output, 'main', 'subagent')
      .before_reasoning?.filter(isAction)
      .find(a => a.target === 'Lookup');
    expect(action?.non_blocking_behavior).toBe('fire_and_forget');
    expect(action?.enabled).toContain('state.AgentScriptInternal_condition_1');
    expect(
      findNode(output, 'main', 'subagent')
        .before_reasoning?.filter(isAction)
        .flatMap(a => a.state_updates ?? [])
    ).toContainEqual({
      AgentScriptInternal_condition_1: 'state.record_id != ""',
    });
  });

  it('does not change the existing execution mode field on reasoning references', () => {
    const { output } = compile(
      parseSource(
        source().replace(
          '            lookup: @actions.Lookup',
          '            lookup: @actions.Lookup\n                execution_mode: "fire_and_forget"'
        )
      )
    );
    expect(
      findNode(output, 'main', 'subagent').tools?.find(t => t.name === 'lookup')
        ?.non_blocking_behavior
    ).toBe('fire_and_forget');
  });

  it.each([
    ['execution_mode: "later"', 'invalid-run-option'],
    ['execution_mode: @variables.record_id', 'invalid-run-option'],
    [
      'execution_mode: "blocking"\n            execution_mode: "fire_and_forget"',
      'duplicate-run-option',
    ],
    [
      'execution_mode: "fire_and_forget"\n            set @variables.record_id = "updated"',
      'non-blocking-state-update',
    ],
  ])('reports %s without a separate lint invocation', (option, code) => {
    const { output, diagnostics } = compile(parseSource(source(option)));
    expect(
      diagnostics.some(
        d => d.code === code && d.severity === DiagnosticSeverity.Error
      )
    ).toBe(true);
    const action = findNode(output, 'main', 'subagent')
      .before_reasoning?.filter(isAction)
      .find(a => a.target === 'Lookup');
    expect(action).not.toHaveProperty('non_blocking_behavior');
  });

  it('preserves the execution mode source range', () => {
    const { output, ranges } = compile(parseSource(source()));
    const action = findNode(output, 'main', 'subagent')
      .before_reasoning?.filter(isAction)
      .find(a => a.target === 'Lookup');
    expect(action).toBeDefined();
    expect(ranges.get(action!)?.get('non_blocking_behavior')?.start.line).toBe(
      source()
        .split('\n')
        .findIndex(line => line.includes('execution_mode'))
    );
  });

  it('lowers the option on an after_reasoning invocation', () => {
    const { output, diagnostics } = compile(
      parseSource(
        source().replace('    before_reasoning:', '    after_reasoning:')
      )
    );
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    expect(
      findNode(output, 'main', 'subagent')
        .after_reasoning?.filter(isAction)
        .find(a => a.target === 'Lookup')?.non_blocking_behavior
    ).toBe('fire_and_forget');
  });

  it('lowers the option on procedural instructions', () => {
    const text = source('')
      .replace(
        '    before_reasoning:',
        '    reasoning:\n        instructions: ->'
      )
      .replace(
        '        run @actions.Lookup\n            \n            with id=@variables.record_id',
        '            run @actions.Lookup\n                execution_mode: "fire_and_forget"\n                with id=@variables.record_id'
      )
      .split('    reasoning:\n        instructions: ->\n            |')[0];
    const { output, diagnostics } = compile(parseSource(text));
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    expect(
      findNode(output, 'main', 'subagent')
        .before_reasoning_iteration?.filter(isAction)
        .find(a => a.target === 'Lookup')?.non_blocking_behavior
    ).toBe('fire_and_forget');
  });

  it('lowers a background follow-up without changing the parent reasoning tool', () => {
    const text = source('').replace(
      '            lookup: @actions.Lookup',
      '            lookup: @actions.Lookup\n                run @actions.Lookup\n                    execution_mode: "fire_and_forget"\n                    with id=@variables.record_id'
    );
    const { output, diagnostics } = compile(parseSource(text));
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const node = findNode(output, 'main', 'subagent');
    expect(
      node.post_tool_call?.[0]?.actions?.find(a => a.target === 'Lookup')
        ?.non_blocking_behavior
    ).toBe('fire_and_forget');
    expect(node.tools?.find(t => t.name === 'lookup')).not.toHaveProperty(
      'non_blocking_behavior'
    );
  });

  it('rejects invocation options in workflow steps rather than ignoring them', () => {
    const text =
      source('').split('    before_reasoning:')[0] +
      `
    reasoning:
        instructions: ->
            | Use the lookup workflow.
workflow lookup_workflow:
    description: "Look up records"
    actions:
        Lookup:
            description: "Look up a record"
            target: "flow://Lookup"
            outputs:
                id: string
    steps: ->
        run @actions.Lookup
            execution_mode: "fire_and_forget"
            set @variables.record_id = @outputs.id
`;
    const { output, diagnostics } = compile(parseSource(text));
    expect(
      diagnostics.some(d => d.code === 'workflow-unsupported-statement')
    ).toBe(true);
    expect(
      JSON.stringify(findNode(output, 'lookup_workflow', 'workflow'))
    ).not.toContain('"non_blocking_behavior":"fire_and_forget"');
  });
});
