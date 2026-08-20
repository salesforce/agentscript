/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for `config.agent_type` — the discriminator that distinguishes
 * standard agents from goal-based (AgentIQ) agents. It is a permissive
 * StringValue (any backend agent type is accepted); real enum enforcement
 * lives cross-repo, not in the dialect.
 */

import { describe, expect, test } from 'vitest';
import { StringLiteral } from '@agentscript/language';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  stripMeta,
} from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';

describe('config.agent_type', () => {
  test('parses GoalBasedAgent', () => {
    const doc = parseDocument(
      ['config:', '    agent_type: "GoalBasedAgent"'].join('\n')
    );
    expect(doc.config?.agent_type).toBeInstanceOf(StringLiteral);
    expect((doc.config?.agent_type as StringLiteral).value).toBe(
      'GoalBasedAgent'
    );
  });

  test('accepts any string value (not enum-enforced)', () => {
    const result = parseWithDiagnostics(
      ['config:', '    agent_type: "SomeCustomType"'].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
    expect((result.value.config?.agent_type as StringLiteral).value).toBe(
      'SomeCustomType'
    );
  });

  test('is optional', () => {
    const result = parseWithDiagnostics(
      ['config:', '    description: "no type"'].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
    expect(result.value.config?.agent_type).toBeUndefined();
  });

  test('round-trips', () => {
    const source = 'config:\n    agent_type: "GoalBasedAgent"';
    const ast1 = parseDocument(source);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });
});
