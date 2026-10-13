/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { defaultRules } from '../lint/passes/index.js';
import { parseDocument, testSchemaCtx } from './test-utils.js';

function lint(source: string) {
  const ast = parseDocument(source);
  const result = new LintEngine({ passes: defaultRules() }).run(
    ast,
    testSchemaCtx
  );
  return result.diagnostics;
}

function toolSource(
  body: string,
  mode = 'fire_and_forget',
  node = 'start_agent main:'
) {
  return `
config:
    developer_name: "ExecutionOptions"
variables:
    result: string
connection messaging:
    response_formats:
        choices:
            description: "Choices"
${node}
    description: "Main"
    actions:
        Lookup:
            description: "Lookup"
            target: "flow://Lookup"
            outputs:
                business_result: string
        Followup:
            description: "Follow up"
            target: "flow://Followup"
            inputs:
                id: string
            outputs:
                business_result: string
    reasoning:
        actions:
            lookup: @actions.Lookup
                execution_mode: "${mode}"
                ${body}
topic fallback:
    description: "Fallback"
`;
}

describe('execution mode lint', () => {
  it.each([
    'set @variables.result = str(@outputs.business_result)',
    'set @variables.result = @outputs["business_result"]',
    'run @actions.Followup\n                    with id=@outputs.business_result',
    'if @outputs.business_result == "done":\n                    transition to @topic.fallback',
    'if True:\n                    run @actions.Followup\n                        with id=@outputs.business_result',
  ])('rejects unavailable outputs in %s', body => {
    const errors = lint(toolSource(body)).filter(
      d => d.code === 'non-blocking-output-unavailable'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].range).toBeDefined();
    expect(
      lint(toolSource(body, 'blocking')).filter(
        d => d.code === 'non-blocking-output-unavailable'
      )
    ).toEqual([]);
  });

  it.each([
    'start_agent main:',
    'topic main:',
    'subagent main:',
    'orchestrator main:',
  ])('checks output availability on %s', node => {
    expect(
      lint(
        toolSource(
          'set @variables.result = @outputs.business_result',
          'fire_and_forget',
          node
        )
      ).some(d => d.code === 'non-blocking-output-unavailable')
    ).toBe(true);
  });

  it('allows follow-up actions to use their own outputs', () => {
    const errors = lint(
      toolSource(
        'run @actions.Followup\n                    set @variables.result = @outputs.business_result'
      )
    );
    expect(
      errors.filter(d => d.code === 'non-blocking-output-unavailable')
    ).toEqual([]);
  });

  it.each(['choices', 'json'])(
    'rejects fire-and-forget rendering with %s',
    renderer => {
      const body = `when @connection.messaging\n                    render: @response_formats.${renderer}\n                        show_and_return: True`;
      const diagnostic = lint(toolSource(body)).find(
        d => d.code === 'non-blocking-output-unavailable'
      );
      expect(diagnostic?.message).toContain('render');
      expect(diagnostic?.range).toBeDefined();
      expect(
        lint(toolSource(body, 'blocking')).filter(
          d => d.code === 'non-blocking-output-unavailable'
        )
      ).toEqual([]);
    }
  );

  it.each(['transition', 'setVariables', 'escalate', 'end_session'])(
    'rejects non-blocking execution on @utils.%s',
    utility => {
      const source = toolSource('').replace(
        '@actions.Lookup',
        `@utils.${utility}`
      );
      const diagnostic = lint(source).find(
        d => d.code === 'execution-mode-unsupported'
      );
      expect(diagnostic?.severity).toBe(DiagnosticSeverity.Error);
      expect(diagnostic?.range).toBeDefined();
      expect(
        lint(source.replace('"fire_and_forget"', '"blocking"')).filter(
          d => d.code === 'execution-mode-unsupported'
        )
      ).toEqual([]);
    }
  );

  it('rejects non-blocking execution on a router', () => {
    const source = toolSource('').replace(
      '    description: "Main"',
      '    description: "Main"\n    model_config:\n        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"'
    );
    expect(
      lint(source).some(d => d.code === 'execution-mode-unsupported')
    ).toBe(true);
  });

  it.each(['setVariables', 'escalate'])(
    'rejects non-blocking execution on a utility action named %s',
    name => {
      const source = toolSource('').replace(
        'lookup: @actions.Lookup',
        `${name}: @actions.Lookup`
      );
      expect(
        lint(source).some(d => d.code === 'execution-mode-unsupported')
      ).toBe(true);
    }
  );

  it('does not classify an agent-wide model as a router', () => {
    const source = toolSource('').replace(
      'variables:',
      'model_config:\n    model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"\nvariables:'
    );
    expect(
      lint(source).filter(d => d.code === 'execution-mode-unsupported')
    ).toEqual([]);
  });

  it('allows non-blocking execution on an orchestrator with a local model', () => {
    const source = toolSource(
      '',
      'fire_and_forget',
      'orchestrator main:'
    ).replace(
      '    description: "Main"',
      '    model_config:\n        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"'
    );
    expect(
      lint(source).filter(d => d.code === 'execution-mode-unsupported')
    ).toEqual([]);
  });

  it('allows non-blocking execution on a custom subagent with a local model', () => {
    const source = toolSource(
      '',
      'fire_and_forget',
      'subagent main:\n    schema: "node://byon/team/worker/v1"'
    ).replace(
      '    description: "Main"',
      '    description: "Main"\n    model_config:\n        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"'
    );
    expect(
      lint(source).filter(d => d.code === 'execution-mode-unsupported')
    ).toEqual([]);
  });

  it.each(['setVariables', 'escalate'])('allows supervision named %s', name => {
    const source = toolSource('').replace(
      'lookup: @actions.Lookup',
      `${name}: @topic.fallback`
    );
    expect(
      lint(source).filter(d => d.code === 'execution-mode-unsupported')
    ).toEqual([]);
  });
});
