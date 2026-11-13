/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseAndLintSource } from './test-utils.js';

/** Build a minimal `.agent` source with a single Anthropic-family llm entry. */
function llmSource(body: string): string {
  return `
config:
  agent_name: "anthropic-agent"

llm:
  claude:
${body}
`;
}

function codes(source: string): string[] {
  return parseAndLintSource(source)
    .diagnostics.filter(d => d.source !== 'parser')
    .map(d => d.code)
    .filter((c): c is string => typeof c === 'string');
}

function messagesFor(source: string, code: string): string[] {
  return parseAndLintSource(source)
    .diagnostics.filter(d => d.source !== 'parser' && d.code === code)
    .map(d => d.message);
}

/** True when `max_tokens` is reported as a missing required field. */
function missingMaxTokens(source: string): boolean {
  return messagesFor(source, 'missing-required-field').some(m =>
    m.includes('max_tokens')
  );
}

function hasCode(source: string, code: string): boolean {
  return codes(source).includes(code);
}

describe('Anthropic / BedrockAnthropic LLM rules', () => {
  it('accepts a valid Anthropic entry', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    effort: "xhigh"
    thinking: "adaptive"
    stop_sequences:
      - "stop now"
      - "exit"`);
    const found = codes(source);
    expect(found).not.toContain('constraint-enum');
    expect(missingMaxTokens(source)).toBe(false);
    expect(found).not.toContain('llm-max-tokens-not-integer');
    expect(found).not.toContain('llm-thinking-always-on');
    expect(found).not.toContain('unknown-field');
  });

  it('accepts a valid BedrockAnthropic entry', () => {
    const source = llmSource(`    target: "llm://claude-bedrock-connection"
    kind: "BedrockAnthropic"
    model: "us.anthropic.claude-opus-4-8"
    max_tokens: 1024`);
    const found = codes(source);
    expect(found).not.toContain('constraint-enum');
    expect(missingMaxTokens(source)).toBe(false);
    expect(found).not.toContain('unknown-field');
  });

  it.each(['claude-opus-4-7', 'claude-opus-4-8', 'claude-newfamily-6-1'])(
    'accepts %s on Anthropic',
    model => {
      const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "${model}"
    max_tokens: 1024`);
      expect(hasCode(source, 'constraint-pattern')).toBe(false);
    }
  );

  it.each([
    'claude-opus-4-6',
    'claude-sonnet-4-5',
    'claude-haiku-4-5-20251001',
    'claude-sonnet-5-20260101',
  ])('rejects %s on Anthropic', model => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "${model}"
    max_tokens: 1024`);
    expect(hasCode(source, 'constraint-pattern')).toBe(true);
  });

  it('rejects a model older than Claude 4.7', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-2"
    max_tokens: 1024`);
    expect(hasCode(source, 'constraint-pattern')).toBe(true);
  });

  it('requires max_tokens', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"`);
    expect(missingMaxTokens(source)).toBe(true);
  });

  it('rejects a non-integer max_tokens', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 10.5`);
    expect(hasCode(source, 'llm-max-tokens-not-integer')).toBe(true);
  });

  it.each(['0', '-1'])('rejects max_tokens %s', value => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: ${value}`);
    expect(hasCode(source, 'constraint-minimum')).toBe(true);
  });

  it('rejects max_output_tokens (Claude kinds use max_tokens)', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    max_output_tokens: 1024`);
    expect(hasCode(source, 'unknown-field')).toBe(true);
  });

  it('rejects thinking: disabled on an always-thinking model', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-fable-5"
    max_tokens: 1024
    thinking: "disabled"`);
    expect(hasCode(source, 'llm-thinking-always-on')).toBe(true);
  });

  it('allows thinking: disabled on a model that allows it', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    thinking: "disabled"`);
    expect(hasCode(source, 'llm-thinking-always-on')).toBe(false);
  });

  it('rejects an invalid effort value via the schema enum', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    effort: "extreme"`);
    const messages = messagesFor(source, 'constraint-enum');
    expect(messages.some(m => m.includes("'effort'"))).toBe(true);
  });

  it('rejects an invalid thinking value via the schema enum', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    thinking: "sometimes"`);
    const messages = messagesFor(source, 'constraint-enum');
    expect(messages.some(m => m.includes("'thinking'"))).toBe(true);
  });

  it('accepts every documented effort and thinking value', () => {
    for (const effort of ['high', 'medium', 'low']) {
      for (const thinking of ['adaptive', 'disabled']) {
        const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    effort: "${effort}"
    thinking: "${thinking}"`);
        expect(hasCode(source, 'constraint-enum')).toBe(false);
      }
    }
  });

  it('is case-sensitive on kind (claude != Anthropic)', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024`);
    expect(hasCode(source, 'unknown-variant')).toBe(true);
  });

  it('rejects OpenAI-only fields under an Anthropic kind', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    reasoning_effort: "HIGH"`);
    expect(hasCode(source, 'unknown-field')).toBe(true);
  });

  it('rejects sampling fields (temperature) under an Anthropic kind', () => {
    const source = llmSource(`    target: "llm://claude-connection"
    kind: "Anthropic"
    model: "claude-sonnet-5"
    max_tokens: 1024
    temperature: 0.5`);
    expect(hasCode(source, 'unknown-field')).toBe(true);
  });

  it('still accepts temperature under the OpenAI kind', () => {
    const source = llmSource(`    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"
    temperature: 0.5`);
    expect(hasCode(source, 'unknown-field')).toBe(false);
  });

  describe('stop_sequences items', () => {
    // Dash-list form: an inline `[...]` under an ExpressionSequence only parses
    // on newer @agentscript/language than the one this package pins.
    const withStop = (kind: string, items: string[]) =>
      llmSource(`    target: "llm://claude-connection"
    kind: "${kind}"
    model: "claude-sonnet-5"
    max_tokens: 1024
    stop_sequences:
${items.map(item => `      - ${item}`).join('\n')}`);

    it.each(['Anthropic', 'BedrockAnthropic'])(
      'accepts strings and string expressions under %s',
      kind => {
        for (const items of [
          ['"a"', '"b"'],
          ['"single"'],
          ['"a"', '@variables.x'],
          ['"a"', '"{!@variables.x}"'],
        ]) {
          expect(
            hasCode(withStop(kind, items), 'llm-stop-sequences-invalid')
          ).toBe(false);
        }
      }
    );

    it.each(['Anthropic', 'BedrockAnthropic'])(
      'rejects non-string items under %s',
      kind => {
        for (const items of [
          ['1', '2'],
          ['"a"', '1.5'],
          ['"a"', 'True'],
          ['"a"', 'none'],
          ['"a"', '["b"]'],
          ['"a"', '{"k": 1}'],
        ]) {
          expect(
            hasCode(withStop(kind, items), 'llm-stop-sequences-invalid')
          ).toBe(true);
        }
      }
    );
  });

  describe('BedrockAnthropic kind', () => {
    const bedrock = (extra: string, model = 'us.anthropic.claude-sonnet-5') =>
      llmSource(`    target: "llm://claude-bedrock-connection"
    kind: "BedrockAnthropic"
    model: "${model}"
${extra}`);

    it('accepts effort, thinking and stop_sequences', () => {
      const source = bedrock(`    max_tokens: 1024
    effort: "low"
    thinking: "adaptive"
    stop_sequences:
      - "stop now"`);
      const found = codes(source);
      expect(found).not.toContain('unknown-field');
      expect(found).not.toContain('constraint-enum');
      expect(missingMaxTokens(source)).toBe(false);
    });

    it('rejects a model older than Claude 4.7', () => {
      const source = bedrock('    max_tokens: 1024', 'claude-2');
      expect(hasCode(source, 'constraint-pattern')).toBe(true);
    });

    it('accepts a Bedrock inference-profile id as the model', () => {
      for (const model of [
        'us.anthropic.claude-sonnet-5',
        'us.anthropic.claude-opus-4-8',
      ]) {
        const source = bedrock('    max_tokens: 1024', model);
        expect(hasCode(source, 'constraint-enum')).toBe(false);
      }
    });

    it('rejects the first-party id on BedrockAnthropic', () => {
      const source = bedrock('    max_tokens: 1024', 'claude-sonnet-5');
      expect(hasCode(source, 'constraint-pattern')).toBe(true);
    });

    it('rejects a Bedrock-form id older than Claude 4.7', () => {
      const source = bedrock('    max_tokens: 1024', 'us.anthropic.claude-2');
      expect(hasCode(source, 'constraint-pattern')).toBe(true);
    });

    it.each([
      'us.anthropic.claude-sonnet-5',
      'global.anthropic.claude-sonnet-5',
      'global.anthropic.claude-opus-4-7',
      'us.anthropic.claude-newfamily-6-1',
    ])('accepts %s', model => {
      const source = bedrock('    max_tokens: 1024', model);
      expect(hasCode(source, 'constraint-pattern')).toBe(false);
    });

    it.each([
      'eu.anthropic.claude-sonnet-5',
      'us.anthropic.claude-opus-4-6',
      'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      'us.anthropic.claude-sonnet-5-v1:0',
    ])('rejects %s', model => {
      const source = bedrock('    max_tokens: 1024', model);
      expect(hasCode(source, 'constraint-pattern')).toBe(true);
    });

    it('rejects thinking: disabled on a Bedrock-form always-thinking id', () => {
      const source = bedrock(
        `    max_tokens: 1024
    thinking: "disabled"`,
        'us.anthropic.claude-fable-5'
      );
      expect(hasCode(source, 'llm-thinking-always-on')).toBe(true);
    });

    it('requires max_tokens', () => {
      expect(missingMaxTokens(bedrock(''))).toBe(true);
    });

    it('rejects a non-integer max_tokens', () => {
      const source = bedrock('    max_tokens: 10.5');
      expect(hasCode(source, 'llm-max-tokens-not-integer')).toBe(true);
    });

    it('rejects thinking: disabled on an always-thinking model', () => {
      const source = bedrock(
        `    max_tokens: 1024
    thinking: "disabled"`,
        'us.anthropic.claude-fable-5-1'
      );
      expect(hasCode(source, 'llm-thinking-always-on')).toBe(true);
    });

    it('rejects sampling fields and OpenAI-only fields', () => {
      const source = bedrock(`    max_tokens: 1024
    temperature: 0.5
    top_p: 0.9
    reasoning_effort: "HIGH"`);
      expect(messagesFor(source, 'unknown-field')).toHaveLength(3);
    });

    it('is case-sensitive on kind (bedrockanthropic != BedrockAnthropic)', () => {
      const source = llmSource(`    target: "llm://claude-bedrock-connection"
    kind: "bedrockanthropic"
    model: "us.anthropic.claude-sonnet-5"
    max_tokens: 1024`);
      expect(hasCode(source, 'unknown-variant')).toBe(true);
    });
  });
});
