/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * End-to-end sanity: the AgentIQ design doc's "Complete Example"
 * (autonomous_ae.agent) — minus the plugin-integration pieces, which land in
 * a later branch — parses cleanly against the base schema with the new
 * goal-based-agent constructs (orchestrator, workflows, trigger,
 * agent-level actions, config.agent_type).
 */

import { describe, expect, test } from 'vitest';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  stripMeta,
} from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';

const AUTONOMOUS_AE = [
  'config:',
  '    agent_type: "GoalBasedAgent"',
  '',
  'system:',
  '    instructions: |',
  '        Sales Pipeline Accelerator. Domain: Sales.',
  '',
  'orchestrator agent:',
  '    actions:',
  '        log_message:',
  '            target: "flow://log_message"',
  '    reasoning:',
  '        instructions: ->',
  '            | You are a sales pipeline accelerator.',
  '        actions:',
  '            log_message:',
  '                description: "Log a message"',
  '',
  'actions:',
  '    log_message:',
  '        target: "flow://log_message"',
  '',
  'workflows:',
  '    engineering:',
  '        agent: @connected_subagent.agent_1',
  '    marketing:',
  '        prompt: "find all the leads"',
  '',
  'trigger:',
  '    every_5_mins:',
  '        schedule: "*/5 * * * *"',
  '        target: @workflows.engineering',
  '',
  'variables:',
  '    something: mutable string',
  '',
  'connected_subagent agent_1:',
  '    target: "agent://Agent_1"',
  '    label: "Agent 1"',
  '    description: "Agent 1"',
].join('\n');

describe('AgentIQ complete example (base constructs)', () => {
  test('parses with no diagnostics', () => {
    const result = parseWithDiagnostics(AUTONOMOUS_AE, AgentScriptSchema);
    expect(result.diagnostics).toHaveLength(0);
  });

  test('exposes all top-level goal-based constructs', () => {
    const doc = parseDocument(AUTONOMOUS_AE);
    expect(doc.config?.agent_type).toBeDefined();
    expect(doc.orchestrator?.get('agent')).toBeDefined();
    expect(doc.actions?.get('log_message')).toBeDefined();
    expect(doc.workflows?.get('engineering')).toBeDefined();
    expect(doc.workflows?.get('marketing')).toBeDefined();
    expect(doc.trigger?.get('every_5_mins')).toBeDefined();
  });

  test('round-trips', () => {
    const ast1 = parseDocument(AUTONOMOUS_AE);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });
});
