/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import { parse } from '@agentscript/parser';
import {
  createLanguageService,
  isNamedMap,
  StringLiteral,
} from '@agentscript/language';
import {
  AgentforcePluginSchemaInfo,
  agentforcePluginDialect,
} from '../bundle-schema.js';
import { AgentforceSchemaInfo } from '../schema.js';

function analyze(source: string) {
  const service = createLanguageService({ dialect: agentforcePluginDialect });
  service.update(parse(source).rootNode);
  return service;
}

describe('agentforce plugin dialect', () => {
  test('accepts the complete plugin construct subset through parse and lint', () => {
    const service = analyze(
      [
        '# @dialect: agentforce-plugin',
        'system:',
        '    instructions: "Prospect accounts."',
        'actions:',
        '    do_thing:',
        '        description: "Does a thing."',
        '        target: "flow://do_thing"',
        'workflows:',
        '    send_emails:',
        '        prompt: "Send the queued emails."',
        'subagent researcher:',
        '    description: "Researches accounts."',
      ].join('\n')
    );

    expect(service.diagnostics).toHaveLength(0);
    const ast = service.ast as Record<string, unknown>;
    expect(ast.system).toBeDefined();
    expect(isNamedMap(ast.actions)).toBe(true);
    expect(isNamedMap(ast.workflows)).toBe(true);
    expect(isNamedMap(ast.subagent)).toBe(true);
  });

  test('uses Agentforce action validation', () => {
    const service = analyze(
      [
        'actions:',
        '    incomplete:',
        '        description: "Missing target"',
      ].join('\n')
    );

    expect(
      service.diagnostics.some(
        diagnostic =>
          diagnostic.code === 'missing-required-field' &&
          diagnostic.message.includes('target')
      )
    ).toBe(true);
  });

  test('drops top-level skills from the plugin format', () => {
    const service = analyze(
      ['skills:', '    lookup:', '        target: "skill://lookup"'].join('\n')
    );

    expect(
      service.diagnostics.some(
        diagnostic =>
          diagnostic.code === 'unknown-block' &&
          diagnostic.message.includes('skills')
      )
    ).toBe(true);
    expect((service.ast as Record<string, unknown>).skills).toBeUndefined();
  });

  test('rejects agent-only top-level constructs', () => {
    const service = analyze(
      [
        'orchestrator agent:',
        '    agents:',
        '        - @subagent.researcher',
        'context:',
        '    salesforce:',
        '        enabled: True',
        'trigger:',
        '    daily:',
        '        schedule: "0 0 * * *"',
        '        target: @workflows.run',
        'config:',
        '    agent_type: "GoalBasedAgent"',
      ].join('\n')
    );

    for (const block of ['orchestrator', 'context', 'trigger', 'config']) {
      expect(
        service.diagnostics.some(
          diagnostic =>
            diagnostic.code === 'unknown-block' &&
            diagnostic.message.includes(block)
        )
      ).toBe(true);
      expect((service.ast as Record<string, unknown>)[block]).toBeUndefined();
    }
  });

  test('runs shared AgentIQ workflow validation', () => {
    const service = analyze(['workflows:', '    x:'].join('\n'));

    expect(
      service.diagnostics.some(
        diagnostic => diagnostic.code === 'workflow-exactly-one-target'
      )
    ).toBe(true);
  });

  test('system block contains only plugin instructions', () => {
    const service = analyze(
      ['system:', '    instructions: "Plugin instructions."'].join('\n')
    );
    const system = (service.ast as Record<string, unknown>).system as {
      instructions?: unknown;
    };

    expect(system.instructions).toBeInstanceOf(StringLiteral);
  });

  test('inherits Agentforce reference metadata', () => {
    expect(AgentforcePluginSchemaInfo.globalScopes).toBe(
      AgentforceSchemaInfo.globalScopes
    );
    expect(AgentforcePluginSchemaInfo.nodeMemberAccess).toBe(
      AgentforceSchemaInfo.nodeMemberAccess
    );
  });
});
