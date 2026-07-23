/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the identifier-shape constraint on connection-target URIs.
 *
 * The `llm.target`, `actions.target` and trigger `target` fields all embed the
 * shared `AGENTFABRIC_IDENTIFIER_PATTERN` fragment inside their scheme regex.
 * The framework surfaces mismatches as `constraint-pattern` diagnostics.
 */
import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '@agentscript/language';
import { parseAndLintSource } from './test-utils.js';

function patternDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.code === 'constraint-pattern');
}

const HEADER = '# @dialect: AGENTFABRIC=1.0-BETA';

function llmSource(target: string): string {
  return `${HEADER}

config:
  agent_name: "id-shape"

llm:
  primary:
    target: "${target}"
    kind: "OpenAI"
    model: "gpt-4o-mini"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
}

function actionSource(target: string, kind = 'mcp:tool'): string {
  const extra = kind === 'mcp:tool' ? '    tool_name: "lookup"\n' : '';
  return `${HEADER}

config:
  agent_name: "id-shape"

actions:
  lookup:
    target: "${target}"
    kind: "${kind}"
${extra}
echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
}

function triggerSource(target: string): string {
  return `${HEADER}

config:
  agent_name: "id-shape"

trigger t:
  kind: "a2a"
  target: "${target}"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
}

describe('connection-target identifier pattern', () => {
  describe('llm.target', () => {
    it.each([
      'llm://openai',
      'llm://gpt-4o',
      'llm://my_llm',
      'llm://a.b',
      'llm://A1_b.c-d2',
      'llm://xx',
    ])('accepts %s', target => {
      const result = parseAndLintSource(llmSource(target));
      expect(patternDiagnostics(result.diagnostics)).toHaveLength(0);
    });

    it.each([
      ['llm://x', 'single-char identifier'],
      ['llm://1abc', 'digit prefix'],
      ['llm://abc_', 'trailing underscore'],
      ['llm://abc.', 'trailing dot'],
      ['llm://abc-', 'trailing hyphen'],
      ['llm://café', 'unicode letter'],
      ['llm://my conn', 'whitespace in identifier'],
      ['llm://', 'empty identifier'],
    ])('rejects %s (%s)', target => {
      const result = parseAndLintSource(llmSource(target));
      const found = patternDiagnostics(result.diagnostics);
      expect(found.length).toBeGreaterThan(0);
      expect(found[0].severity).toBe(1);
    });

    it('accepts a long conformant identifier', () => {
      const target = `llm://${'a'.repeat(299)}z`;
      const result = parseAndLintSource(llmSource(target));
      expect(patternDiagnostics(result.diagnostics)).toHaveLength(0);
    });
  });

  describe('actions.target (a2a and mcp)', () => {
    it.each([
      ['a2a://agent', 'a2a:send_message'],
      ['mcp://knowledge', 'mcp:tool'],
      ['mcp://search_mcp', 'mcp:tool'],
      ['a2a://agent-1.name_x', 'a2a:send_message'],
    ])('accepts %s', (target, kind) => {
      const result = parseAndLintSource(actionSource(target, kind));
      expect(patternDiagnostics(result.diagnostics)).toHaveLength(0);
    });

    it.each([
      ['mcp://x', 'mcp:tool', 'single-char identifier'],
      ['a2a://1abc', 'a2a:send_message', 'digit prefix'],
      ['mcp://abc.', 'mcp:tool', 'trailing dot'],
      ['a2a://', 'a2a:send_message', 'empty identifier'],
    ])('rejects %s (%s / %s)', (target, kind) => {
      const result = parseAndLintSource(actionSource(target, kind));
      expect(patternDiagnostics(result.diagnostics).length).toBeGreaterThan(0);
    });
  });

  describe('trigger.target (brokers)', () => {
    it.each([
      'brokers://my-agent/a2a',
      'brokers://customer-support-flow/a2a',
      'broker://ab/cd',
    ])('accepts %s', target => {
      const result = parseAndLintSource(triggerSource(target));
      expect(patternDiagnostics(result.diagnostics)).toHaveLength(0);
    });

    it.each([
      ['brokers://x/a2a', 'single-char broker name'],
      ['brokers://agent/x', 'single-char interface name'],
      ['brokers://1abc/a2a', 'digit-prefixed broker'],
      ['brokers://agent/1a', 'digit-prefixed interface'],
      ['brokers://agent_/a2a', 'trailing underscore in broker'],
      ['brokers://agent/', 'empty interface'],
      ['brokers:///a2a', 'empty broker'],
    ])('rejects %s (%s)', target => {
      const result = parseAndLintSource(triggerSource(target));
      expect(patternDiagnostics(result.diagnostics).length).toBeGreaterThan(0);
    });
  });
});
