/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { compileSource } from '../src/index.js';

/**
 * End-to-end coverage that recommended_prompts value validation — which lives
 * in the dialect lint pass `recommended-prompts-validation.ts` — surfaces
 * through `compileSource`, whose result merges lint + compile diagnostics.
 */
function buildSource(opts: {
  welcomeScreen?: boolean;
  starterPrompts?: string; // raw body under `starter_prompts:`
}): string {
  const welcome = opts.welcomeScreen ?? true;
  const prompts =
    opts.starterPrompts !== undefined
      ? `        starter_prompts:${opts.starterPrompts}\n`
      : '';
  return `
config:
    agent_name: "TestBot"
    agent_type: "AgentforceEmployeeAgent"

system:
    instructions: "Help the user"
    recommended_prompts:
        welcome_screen: ${welcome ? 'True' : 'False'}
${prompts}
start_agent main:
    description: "Test"
`;
}

function yamlPrompts(count: number, len = 10): string {
  const value = 'x'.repeat(len);
  return (
    '\n' +
    Array.from({ length: count }, () => `            - "${value}"`).join('\n')
  );
}

function inlinePrompts(count: number, len = 10): string {
  const value = 'x'.repeat(len);
  const items = Array.from({ length: count }, () => `"${value}"`).join(', ');
  return ` [${items}]`;
}

describe('compileSource: recommended_prompts value validation', () => {
  test('flags welcome_screen gating', () => {
    const { diagnostics } = compileSource(
      buildSource({ welcomeScreen: false, starterPrompts: yamlPrompts(3) })
    );
    expect(diagnostics.map(d => d.code)).toContain(
      'recommended-prompts-welcome-screen'
    );
  });

  test('flags fewer than 3 entries', () => {
    const { diagnostics } = compileSource(
      buildSource({ starterPrompts: inlinePrompts(2) })
    );
    expect(diagnostics.map(d => d.code)).toContain(
      'recommended-prompts-min-entries'
    );
  });

  test('flags more than 20 entries', () => {
    const { diagnostics } = compileSource(
      buildSource({ starterPrompts: yamlPrompts(21) })
    );
    expect(diagnostics.map(d => d.code)).toContain(
      'recommended-prompts-max-entries'
    );
  });

  test('flags per-string length over 50 characters', () => {
    const { diagnostics } = compileSource(
      buildSource({ starterPrompts: yamlPrompts(3, 51) })
    );
    expect(diagnostics.map(d => d.code)).toContain(
      'recommended-prompts-length'
    );
  });

  test('a valid configuration compiles clean and emits the block', () => {
    const { output, diagnostics } = compileSource(
      buildSource({ starterPrompts: yamlPrompts(3, 20) })
    );
    const recCodes = diagnostics
      .map(d => d.code)
      .filter(c => c?.startsWith('recommended-prompts'));
    expect(recCodes).toEqual([]);

    const outputRecord = output as unknown as Record<string, unknown>;
    const agentVersion = outputRecord.agent_version as Record<string, unknown>;
    expect(agentVersion.recommended_prompts).toBeDefined();
  });
});
