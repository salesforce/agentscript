/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import { parse } from '@agentscript/parser';
import { createLanguageService } from '@agentscript/language';
import { agentforceDialect } from '../index.js';

function analyze(source: string) {
  const service = createLanguageService({ dialect: agentforceDialect });
  service.update(parse(source).rootNode);
  return service;
}

describe('AgentIQ bundle integration in Agentforce', () => {
  test('accepts a complete agent with a bundle workflow trigger', () => {
    const service = analyze(
      [
        'config:',
        '    agent_type: "GoalBasedAgent"',
        '    developer_name: "SalesPipelineAccelerator"',
        '',
        'system:',
        '    instructions: "Accelerate the sales pipeline."',
        '',
        'bundles:',
        '    prospecting:',
        '        target: "bundle://prospecting"',
        '    outreach:',
        '        target: "bundle://outreach"',
        '',
        'orchestrator agent:',
        '    reasoning:',
        '        instructions: ->',
        '            | Accelerate the sales pipeline.',
        '',
        'trigger every_5_mins:',
        '    schedule: "*/5 * * * *"',
        '    target: @bundles.outreach.workflows.send_emails',
        '',
        'connected_subagent researcher:',
        '    target: "agent://Researcher"',
        '    description: "Researches accounts."',
      ].join('\n')
    );

    expect(service.diagnostics).toEqual([]);
  });

  test('rejects a bundle as a trigger invocation target', () => {
    const service = analyze(
      [
        'bundles:',
        '    outreach:',
        '        target: "bundle://outreach"',
        'trigger invalid:',
        '    schedule: "0 8 * * *"',
        '    target: @bundles.outreach',
      ].join('\n')
    );

    expect(service.diagnostics.map(d => d.code)).toContain(
      'invalid-trigger-target'
    );
  });

  test('does not treat a bundle as a callable reasoning action', () => {
    const service = analyze(
      [
        'bundles:',
        '    outreach:',
        '        target: "bundle://outreach"',
        'subagent worker:',
        '    description: "Does the work."',
        '    reasoning:',
        '        actions:',
        '            invalid: @bundles.outreach',
      ].join('\n')
    );

    expect(service.diagnostics.map(d => d.code)).toContain(
      'constraint-resolved-type'
    );
  });

  test('rejects malformed bundle member paths', () => {
    const service = analyze(
      [
        'bundles:',
        '    outreach:',
        '        target: "bundle://outreach"',
        'trigger invalid:',
        '    schedule: "0 8 * * *"',
        '    target: @bundles.outreach.actions.send_emails',
      ].join('\n')
    );

    expect(service.diagnostics.map(d => d.code)).toContain(
      'invalid-trigger-target'
    );
  });
});
