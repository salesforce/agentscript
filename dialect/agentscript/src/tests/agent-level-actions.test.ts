/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for agent-level `actions:` — action definitions declared at the
 * document root, inherited by every subagent and referenceable from their
 * reasoning actions via `@actions.X`.
 */

import { describe, expect, test } from 'vitest';
import { isNamedMap } from '@agentscript/language';
import {
  parseDocument,
  parseWithDiagnostics,
  emitDocument,
  stripMeta,
} from './test-utils.js';
import { AgentScriptSchema } from '../schema.js';

describe('agent-level actions', () => {
  test('parses actions at the document root', () => {
    const doc = parseDocument(
      ['actions:', '    log_message:', '        target: "flow://log"'].join(
        '\n'
      )
    );
    expect(isNamedMap(doc.actions)).toBe(true);
    expect(doc.actions?.get('log_message')).toBeDefined();
  });

  test('agent-level action is referenceable from a subagent reasoning action', () => {
    const result = parseWithDiagnostics(
      [
        'actions:',
        '    log_message:',
        '        target: "flow://log"',
        'subagent main:',
        '    description: "m"',
        '    reasoning:',
        '        instructions: ->',
        '            | do',
        '        actions:',
        '            log: @actions.log_message',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  test('subagent-level actions still resolve their own @outputs (no regression)', () => {
    // Guards the scope-navigation change: `action` is now hosted both at root
    // and nested under `subagent`; nested resolution must still work.
    const result = parseWithDiagnostics(
      [
        'subagent main:',
        '    description: "m"',
        '    actions:',
        '        fetch:',
        '            outputs:',
        '                status: string',
        '            target: "flow://fetch"',
        '    reasoning:',
        '        instructions: ->',
        '            | do',
        '        actions:',
        '            fetch: @actions.fetch',
        '                set @variables.s = @outputs.status',
        'variables:',
        '    s: mutable string',
      ].join('\n'),
      AgentScriptSchema
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  test('round-trips', () => {
    const source = [
      'actions:',
      '    log_message:',
      '        target: "flow://log"',
    ].join('\n');
    const ast1 = parseDocument(source);
    const ast2 = parseDocument(emitDocument(ast1));
    expect(stripMeta(ast1)).toEqual(stripMeta(ast2));
  });
});
