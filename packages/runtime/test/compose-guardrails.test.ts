/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  composeGuardrails,
  customGuardrail,
} from '../src/guardrails/validators.js';
import type {
  GuardrailContext,
  GuardrailInput,
} from '../src/guardrails/types.js';
import type { ToolCall } from '../src/llm/types.js';

function makeCtx(overrides?: Partial<GuardrailContext>): GuardrailContext {
  return {
    node: 'test-node',
    state: {},
    attempt: 0,
    maxRetries: 2,
    messages: [],
    ...overrides,
  };
}

function makeInput(text: string, toolCalls: ToolCall[] = []): GuardrailInput {
  return { text, toolCalls };
}

const SAMPLE_TOOL_CALLS: ToolCall[] = [
  { id: 't1', name: 'doStuff', arguments: { x: 1 } },
];

/**
 * T1.4 — composeGuardrails target filter run-set per output shape.
 *
 * Regression: composed guardrails must mirror the same target filter the
 * Runtime applies — single-target children only skip when the output truly
 * lacks their target, while `target: 'both'` children always run.
 */
describe('T1.4 — composeGuardrails target filter run-set', () => {
  function makeCounters() {
    const calls = { text: 0, tool: 0, both: 0 };
    const textGuard = customGuardrail(
      'text-only',
      () => {
        calls.text++;
        return { valid: true };
      },
      { target: 'text', maxRetries: 0 }
    );
    const toolGuard = customGuardrail(
      'tool-only',
      () => {
        calls.tool++;
        return { valid: true };
      },
      { target: 'tool-calls', maxRetries: 0 }
    );
    const bothGuard = customGuardrail(
      'both',
      () => {
        calls.both++;
        return { valid: true };
      },
      { target: 'both', maxRetries: 0 }
    );
    const composed = composeGuardrails([textGuard, toolGuard, bothGuard]);
    return { calls, composed };
  }

  it('text-only output: text + both run; tool skipped', async () => {
    const { calls, composed } = makeCounters();
    const result = await composed.validate(makeInput('hello'), makeCtx());
    expect(result).toEqual({ valid: true });
    expect(calls).toEqual({ text: 1, tool: 0, both: 1 });
  });

  it('tool-calls-only output: tool + both run; text skipped', async () => {
    const { calls, composed } = makeCounters();
    const result = await composed.validate(
      makeInput('', SAMPLE_TOOL_CALLS),
      makeCtx()
    );
    expect(result).toEqual({ valid: true });
    expect(calls).toEqual({ text: 0, tool: 1, both: 1 });
  });

  it('mixed output (text + tool calls): all three guardrails run', async () => {
    const { calls, composed } = makeCounters();
    const result = await composed.validate(
      makeInput('here is text', SAMPLE_TOOL_CALLS),
      makeCtx()
    );
    expect(result).toEqual({ valid: true });
    expect(calls).toEqual({ text: 1, tool: 1, both: 1 });
  });
});
