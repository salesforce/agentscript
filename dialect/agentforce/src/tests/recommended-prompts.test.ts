/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, emitDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  return engine.run(ast, testSchemaCtx).diagnostics;
}

describe('recommended_prompts block', () => {
  const fullSource = `
system:
    instructions: "Help the user"
    recommended_prompts:
        in_conversation: True
        welcome_screen: True
        starter_prompts:
            - "How can I help?"
            - "Track my order"
            - "Return a product"

config:
    agent_name: "TestAgent"
    agent_type: "AgentforceEmployeeAgent"

start_agent main:
    description: "Test"

    reasoning:
        instructions: ->
            | Help the user
`;

  it('should parse recommended_prompts under system', () => {
    const parsed = parseDocument(fullSource);
    const system = parsed.system as Record<string, unknown>;
    expect(system).toBeDefined();
    expect(system.recommended_prompts).toBeDefined();
  });

  it('should parse in_conversation and welcome_screen booleans', () => {
    const parsed = parseDocument(fullSource);
    const system = parsed.system as Record<string, unknown>;
    const recs = system.recommended_prompts as Record<string, unknown>;
    expect(recs.in_conversation).toBeDefined();
    expect(recs.welcome_screen).toBeDefined();
  });

  it('should parse welcome_starter_prompts sequence', () => {
    const parsed = parseDocument(fullSource);
    const system = parsed.system as Record<string, unknown>;
    const recs = system.recommended_prompts as Record<string, unknown>;
    expect(recs.starter_prompts).toBeDefined();
  });

  it('should emit recommended_prompts round-trip', () => {
    const parsed = parseDocument(fullSource);
    const emitted = emitDocument(parsed);
    expect(emitted).toContain('recommended_prompts:');
    expect(emitted).toContain('in_conversation: True');
    expect(emitted).toContain('welcome_screen: True');
    expect(emitted).toContain('starter_prompts:');
  });
});

// ============================================================================
// Value validation (lint pass: recommended-prompts-validation)
// ============================================================================

describe('recommended_prompts value validation (lint)', () => {
  /** Build a source with the given starter_prompts body + welcome_screen. */
  function buildSource(opts: {
    welcomeScreen?: boolean;
    starterPrompts?: string; // raw YAML/inline body under `starter_prompts:`
  }): string {
    const welcome = opts.welcomeScreen ?? true;
    const prompts =
      opts.starterPrompts !== undefined
        ? `        starter_prompts:${opts.starterPrompts}\n`
        : '';
    return `
system:
    instructions: "Help the user"
    recommended_prompts:
        in_conversation: True
        welcome_screen: ${welcome ? 'True' : 'False'}
${prompts}
config:
    agent_name: "TestAgent"
    agent_type: "AgentforceEmployeeAgent"

start_agent main:
    description: "Test"

    reasoning:
        instructions: ->
            | Help the user
`;
  }

  // YAML sequence body for N prompts, each of the given length.
  function yamlPrompts(count: number, len = 10): string {
    const value = 'x'.repeat(len);
    return (
      '\n' +
      Array.from({ length: count }, () => `            - "${value}"`).join('\n')
    );
  }

  // Inline-list body for N prompts, each of the given length.
  function inlinePrompts(count: number, len = 10): string {
    const value = 'x'.repeat(len);
    const items = Array.from({ length: count }, () => `"${value}"`).join(', ');
    return ` [${items}]`;
  }

  const codesOf = (diags: Diagnostic[]) => diags.map(d => d.code);

  describe('welcome_screen gating', () => {
    it('errors when starter_prompts set but welcome_screen is False (YAML)', () => {
      const diags = runLint(
        buildSource({ welcomeScreen: false, starterPrompts: yamlPrompts(3) })
      );
      const rec = diags.filter(
        d => d.code === 'recommended-prompts-welcome-screen'
      );
      expect(rec).toHaveLength(1);
      expect(rec[0].message).toContain('welcome_screen is True');
    });

    it('errors when starter_prompts set but welcome_screen is False (inline)', () => {
      const diags = runLint(
        buildSource({ welcomeScreen: false, starterPrompts: inlinePrompts(3) })
      );
      expect(codesOf(diags)).toContain('recommended-prompts-welcome-screen');
    });

    it('no error when welcome_screen is True', () => {
      const diags = runLint(
        buildSource({ welcomeScreen: true, starterPrompts: yamlPrompts(3) })
      );
      expect(codesOf(diags)).not.toContain(
        'recommended-prompts-welcome-screen'
      );
    });
  });

  describe('min entries (3)', () => {
    it('errors with fewer than 3 entries (YAML)', () => {
      const diags = runLint(buildSource({ starterPrompts: yamlPrompts(2) }));
      const rec = diags.filter(
        d => d.code === 'recommended-prompts-min-entries'
      );
      expect(rec).toHaveLength(1);
      expect(rec[0].message).toContain('at least 3 entries');
    });

    it('errors with fewer than 3 entries (inline)', () => {
      const diags = runLint(buildSource({ starterPrompts: inlinePrompts(2) }));
      expect(codesOf(diags)).toContain('recommended-prompts-min-entries');
    });

    it('no error with exactly 3 entries (inline)', () => {
      const diags = runLint(buildSource({ starterPrompts: inlinePrompts(3) }));
      expect(codesOf(diags)).not.toContain('recommended-prompts-min-entries');
    });
  });

  describe('max entries (20)', () => {
    it('errors with more than 20 entries (YAML)', () => {
      const diags = runLint(buildSource({ starterPrompts: yamlPrompts(21) }));
      const rec = diags.filter(
        d => d.code === 'recommended-prompts-max-entries'
      );
      expect(rec).toHaveLength(1);
      expect(rec[0].message).toContain('at most 20 entries');
    });

    it('errors with more than 20 entries (inline)', () => {
      const diags = runLint(buildSource({ starterPrompts: inlinePrompts(21) }));
      expect(codesOf(diags)).toContain('recommended-prompts-max-entries');
    });

    it('no error with exactly 20 entries', () => {
      const diags = runLint(buildSource({ starterPrompts: yamlPrompts(20) }));
      expect(codesOf(diags)).not.toContain('recommended-prompts-max-entries');
    });
  });

  describe('per-string length (1-50)', () => {
    it('errors when an entry exceeds 50 characters (YAML)', () => {
      const diags = runLint(
        buildSource({ starterPrompts: yamlPrompts(3, 51) })
      );
      const rec = diags.filter(d => d.code === 'recommended-prompts-length');
      expect(rec.length).toBeGreaterThanOrEqual(1);
      expect(rec[0].message).toContain('between 1 and 50 characters');
    });

    it('errors when an entry exceeds 50 characters (inline)', () => {
      const diags = runLint(
        buildSource({ starterPrompts: inlinePrompts(3, 51) })
      );
      expect(codesOf(diags)).toContain('recommended-prompts-length');
    });

    it('no length error for valid entries', () => {
      const diags = runLint(
        buildSource({ starterPrompts: yamlPrompts(3, 20) })
      );
      expect(codesOf(diags)).not.toContain('recommended-prompts-length');
    });

    it('errors on an empty entry (0 chars, YAML)', () => {
      const diags = runLint(buildSource({ starterPrompts: yamlPrompts(3, 0) }));
      const rec = diags.filter(d => d.code === 'recommended-prompts-length');
      expect(rec.length).toBeGreaterThanOrEqual(1);
      expect(rec[0].message).toContain('between 1 and 50 characters');
    });

    it('errors on an empty entry (0 chars, inline)', () => {
      const diags = runLint(
        buildSource({ starterPrompts: inlinePrompts(3, 0) })
      );
      expect(codesOf(diags)).toContain('recommended-prompts-length');
    });

    it('no length error for single-character entries (lower bound)', () => {
      const diags = runLint(buildSource({ starterPrompts: yamlPrompts(3, 1) }));
      expect(codesOf(diags)).not.toContain('recommended-prompts-length');
    });
  });

  describe('entry type (text only)', () => {
    it('errors on a boolean entry (YAML)', () => {
      const diags = runLint(
        buildSource({
          starterPrompts:
            '\n            - True\n            - "one"\n            - "two"\n            - "three"',
        })
      );
      const rec = diags.filter(d => d.code === 'recommended-prompts-type');
      expect(rec).toHaveLength(1);
      expect(rec[0].message).toContain('must be a text value');
    });

    it('errors on a boolean entry (inline)', () => {
      const diags = runLint(
        buildSource({ starterPrompts: ' [True, "one", "two", "three"]' })
      );
      expect(codesOf(diags)).toContain('recommended-prompts-type');
    });

    it('errors on a numeric entry (inline)', () => {
      const diags = runLint(
        buildSource({ starterPrompts: ' [42, "one", "two", "three"]' })
      );
      expect(codesOf(diags)).toContain('recommended-prompts-type');
    });

    it('a non-string entry is excluded from the minimum count and still flagged', () => {
      const diags = runLint(
        buildSource({ starterPrompts: ' [True, "one", "two"]' })
      );
      const codes = codesOf(diags);
      expect(codes).toContain('recommended-prompts-type');
      expect(codes).toContain('recommended-prompts-min-entries');
    });

    it('no type error for a valid string list', () => {
      const diags = runLint(buildSource({ starterPrompts: yamlPrompts(3) }));
      expect(codesOf(diags)).not.toContain('recommended-prompts-type');
    });
  });

  it('a valid configuration produces no recommended-prompts diagnostics', () => {
    const diags = runLint(buildSource({ starterPrompts: yamlPrompts(3, 20) }));
    const recCodes = codesOf(diags).filter(c =>
      c?.startsWith('recommended-prompts')
    );
    expect(recCodes).toEqual([]);
  });
});
