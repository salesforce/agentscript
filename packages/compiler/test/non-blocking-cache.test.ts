/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import { compile } from '../src/compile.js';
import { agentDslAuthoring } from '../src/types.js';
import { checkSchemaConformance, parseSource } from './test-utils.js';

function compileAction(
  cache = 'cache:\n                expiration: 60',
  behavior = 'fire_and_forget'
) {
  return compile(
    parseSource(`
config:
    developer_name: "ToolOptions"

start_agent main:
    description: "Test tool options"
    actions:
        Lookup:
            description: "Look up a record"
            target: "flow://Lookup"
            ${cache}
    reasoning:
        instructions: "Look up a record"
        actions:
            lookup: @actions.Lookup
                execution_mode: "${behavior}"
            lookup_again: @actions.Lookup
`)
  );
}

describe('action cache and execution behavior', () => {
  it.each([
    ['1.5', 1500],
    ['0.001', 1],
    ['1.2345', 1235],
    ['0.5005', 501],
    ['0.5015', 502],
    ['0.5004999999999998', 500],
    ['0.5005000000000001', 501],
    ['1000000000', 1000000000000],
  ])('converts expiration %s seconds to %s milliseconds', (seconds, ttl) => {
    const { output, diagnostics } = compileAction(
      `cache:\n                expiration: ${seconds}`
    );
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    expect(node?.action_definitions?.[0]?.cache).toEqual({ ttl });
    expect(checkSchemaConformance(output)).toEqual([]);
  });

  it('compiles explicit blocking the same as omitted execution_mode', () => {
    const { output, diagnostics } = compileAction('', 'blocking');
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    for (const name of ['lookup', 'lookup_again']) {
      const tool = node?.tools.find(t => t.name === name);
      expect(tool).toBeDefined();
      expect(tool).not.toHaveProperty('non_blocking_behavior');
      expect(tool).not.toHaveProperty('execution_mode');
    }
    expect(checkSchemaConformance(output)).toEqual([]);
  });

  it('emits cache on the definition and non-blocking behavior only on the selected tool reference', () => {
    const { output, diagnostics } = compileAction();
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    expect(node?.action_definitions?.[0]).toMatchObject({
      developer_name: 'Lookup',
      cache: { ttl: 60000 },
    });
    expect(node?.action_definitions?.[0]).not.toHaveProperty(
      'non_blocking_behavior'
    );
    expect(node?.action_definitions?.[0]?.cache).not.toHaveProperty(
      'expiration'
    );
    expect(node?.tools.find(t => t.name === 'lookup')).toMatchObject({
      target: 'Lookup',
      non_blocking_behavior: 'fire_and_forget',
    });
    expect(node?.tools.find(t => t.name === 'lookup')).not.toHaveProperty(
      'execution_mode'
    );
    expect(node?.tools.find(t => t.name === 'lookup_again')).not.toHaveProperty(
      'non_blocking_behavior'
    );
    expect(agentDslAuthoring.safeParse(output).success).toBe(true);
    expect(checkSchemaConformance(output)).toEqual([]);
  });

  it.each(['0', '-1', '0.0001', '10000000000000'])(
    'omits invalid cache expiration %s from output',
    expiration => {
      const { output } = compileAction(
        `cache:\n                expiration: ${expiration}`
      );
      const node = output.agent_version.nodes.find(
        n => n.developer_name === 'main'
      );
      expect(node?.action_definitions?.[0]).not.toHaveProperty('cache');
    }
  );

  it('does not emit an unknown execution mode', () => {
    const { output } = compileAction(
      'cache:\n                expiration: 60',
      'later'
    );
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    expect(node?.tools.find(t => t.name === 'lookup')).not.toHaveProperty(
      'non_blocking_behavior'
    );
  });

  it('emits cache on an inherited top-level action definition', () => {
    const { output } = compile(
      parseSource(`
config:
    developer_name: "GlobalOptions"
actions:
    Lookup:
        description: "Look up a record"
        target: "flow://Lookup"
        cache:
            expiration: 30
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            |Lookup records
subagent worker:
    description: "Worker"
`)
    );
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'worker'
    );
    expect(node?.action_definitions?.[0]).toMatchObject({
      cache: { ttl: 30000 },
    });
    expect(node?.tools.find(t => t.target === 'Lookup')).not.toHaveProperty(
      'non_blocking_behavior'
    );
  });

  it.each(['fire_and_forget', 'blocking'])(
    'compiles execution_mode %s on a supervision tool reference',
    mode => {
      const { output } = compile(
        parseSource(`
config:
    developer_name: "DelegationOptions"
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            |Delegate tasks
        actions:
            delegate: @subagent.worker
                execution_mode: "${mode}"
subagent worker:
    description: "Worker"
    reasoning:
        instructions: ->
            |Work
`)
      );
      const node = output.agent_version.nodes.find(
        n => n.developer_name === 'main'
      );
      const tool = node?.tools.find(t => t.name === 'delegate');
      expect(tool).toMatchObject({
        type: 'supervision',
      });
      if (mode === 'blocking') {
        expect(tool).not.toHaveProperty('non_blocking_behavior');
      } else {
        expect(tool).toHaveProperty('non_blocking_behavior', 'fire_and_forget');
      }
      expect(agentDslAuthoring.safeParse(output).success).toBe(true);
      expect(checkSchemaConformance(output)).toEqual([]);
    }
  );

  it('emits cache and non-blocking behavior from an orchestrator', () => {
    const { output, diagnostics } = compile(
      parseSource(`
config:
    developer_name: "OrchestratorOptions"
orchestrator main:
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"
            cache:
                expiration: 60
    reasoning:
        actions:
            lookup: @actions.Lookup
                execution_mode: "fire_and_forget"
`)
    );
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const node = output.agent_version.nodes.find(
      n => n.type === 'orchestrator'
    );
    expect(node?.action_definitions?.[0]).toMatchObject({
      cache: { ttl: 60000 },
    });
    expect(node?.tools?.[0]).toMatchObject({
      non_blocking_behavior: 'fire_and_forget',
    });
    expect(checkSchemaConformance(output)).toEqual([]);
  });

  it('allows post-actions to use their own outputs after a fire-and-forget tool', () => {
    const { output, diagnostics } = compile(
      parseSource(`
config:
    developer_name: "PostActionOutputOptions"
variables:
    result: string
start_agent main:
    description: "Main"
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"
        Followup:
            description: "Follow up"
            target: "flow://Followup"
    reasoning:
        actions:
            lookup: @actions.Lookup
                execution_mode: "fire_and_forget"
                run @actions.Followup
                    set @variables.result = @outputs.business_result
`)
    );
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    expect(
      output.agent_version.nodes.find(n => n.developer_name === 'main')
        ?.post_tool_call
    ).toBeDefined();
  });

  it('compiles blocking execution on a built-in utility', () => {
    const { diagnostics } = compile(
      parseSource(`
config:
    developer_name: "UtilityOptions"
start_agent main:
    description: "Main"
    reasoning:
        instructions: ->
            |Help
        actions:
            escalate: @utils.escalate
                execution_mode: "blocking"
`)
    );
    expect(
      diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
  });

  it.each(['choices', 'json'])(
    'omits fire-and-forget render rules with %s',
    renderer => {
      const source = `
config:
    developer_name: "RenderOptions"
connection messaging:
    response_formats:
        choices:
            description: "Choice format"
            inputs:
                items: string
start_agent main:
    description: "Main"
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"
    reasoning:
        actions:
            lookup: @actions.Lookup
                execution_mode: "fire_and_forget"
                when @connection.messaging
                    render: @response_formats.${renderer}
                        show_and_return: True
`;
      const result = compile(parseSource(source));
      expect(
        result.output.agent_version.nodes
          .find(n => n.developer_name === 'main')
          ?.tools.find(t => t.name === 'lookup')
      ).not.toHaveProperty('render_rules');

      const blocking = compile(
        parseSource(source.replace('"fire_and_forget"', '"blocking"'))
      );
      expect(
        blocking.diagnostics.filter(
          d => d.severity === DiagnosticSeverity.Error
        )
      ).toEqual([]);
      expect(
        blocking.output.agent_version.nodes
          .find(n => n.developer_name === 'main')
          ?.tools.find(t => t.name === 'lookup')?.render_rules
      ).toEqual([
        {
          surface_type: 'messaging',
          response_format_name: renderer,
          end_turn: true,
        },
      ]);
    }
  );
});
