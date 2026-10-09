/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  jsonSchemaGuardrail,
  regexGuardrail,
  contentPolicyGuardrail,
  customGuardrail,
  composeGuardrails,
} from '../src/guardrails/validators.js';
import type {
  GuardrailContext,
  GuardrailInput,
} from '../src/guardrails/types.js';

function makeInput(text: string): GuardrailInput {
  return { text, toolCalls: [] };
}

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

// ---------------------------------------------------------------------------
// jsonSchemaGuardrail
// ---------------------------------------------------------------------------

describe('jsonSchemaGuardrail', () => {
  const schema = {
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0, maximum: 150 },
      email: { type: 'string', pattern: '^[^@]+@[^@]+$' },
      role: { type: 'string', enum: ['admin', 'user', 'guest'] },
    },
    additionalProperties: false,
  };

  const guardrail = jsonSchemaGuardrail({ schema });

  it('passes valid JSON', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 30 })),
      makeCtx()
    );
    expect(result).toEqual({ valid: true });
  });

  it('fails on invalid JSON', () => {
    const result = guardrail.validate(makeInput('not json'), makeCtx());
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain('Invalid JSON');
  });

  it('fails on missing required field', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice' })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'required')).toBe(true);
  });

  it('fails on wrong type', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 'thirty' })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'type')).toBe(true);
  });

  it('fails on non-integer when integer expected', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 30.5 })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
  });

  it('fails on enum violation', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 30, role: 'superadmin' })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'enum')).toBe(true);
  });

  it('passes on valid enum value', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 30, role: 'admin' })),
      makeCtx()
    );
    expect(result).toEqual({ valid: true });
  });

  it('fails on minimum violation', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: -1 })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'minimum')).toBe(true);
  });

  it('fails on maximum violation', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 200 })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'maximum')).toBe(true);
  });

  it('fails on pattern violation', () => {
    const result = guardrail.validate(
      makeInput(
        JSON.stringify({ name: 'Alice', age: 30, email: 'not-an-email' })
      ),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'pattern')).toBe(true);
  });

  it('passes on valid pattern', () => {
    const result = guardrail.validate(
      makeInput(
        JSON.stringify({ name: 'Alice', age: 30, email: 'alice@example.com' })
      ),
      makeCtx()
    );
    expect(result).toEqual({ valid: true });
  });

  it('fails on minLength violation', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: '', age: 30 })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'minLength')).toBe(true);
  });

  it('fails on additionalProperties', () => {
    const result = guardrail.validate(
      makeInput(JSON.stringify({ name: 'Alice', age: 30, extra: true })),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    const errors = (result as { errors: Array<{ code: string }> }).errors;
    expect(errors.some(e => e.code === 'additionalProperties')).toBe(true);
  });

  it('validates array items', () => {
    const arraySchema = {
      type: 'array',
      items: { type: 'number', minimum: 0 },
    };
    const g = jsonSchemaGuardrail({ schema: arraySchema });
    const validResult = g.validate(makeInput('[1, 2, 3]'), makeCtx());
    expect(validResult).toEqual({ valid: true });

    const invalidResult = g.validate(makeInput('[1, -2, 3]'), makeCtx());
    expect(invalidResult).toHaveProperty('valid', false);
  });

  it('uses custom name and maxRetries', () => {
    const g = jsonSchemaGuardrail({
      schema: { type: 'string' },
      name: 'my-schema',
      maxRetries: 5,
    });
    expect(g.name).toBe('my-schema');
    expect(g.maxRetries).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// regexGuardrail
// ---------------------------------------------------------------------------

describe('regexGuardrail', () => {
  it('passes when pattern matches', () => {
    const g = regexGuardrail({ pattern: /^\d+$/ });
    const result = g.validate(makeInput('12345'), makeCtx());
    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('fails when pattern does not match', () => {
    const g = regexGuardrail({ pattern: /^\d+$/ });
    const result = g.validate(makeInput('abc'), makeCtx());
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain(
      'must match pattern'
    );
  });

  it('inverts: fails when pattern matches', () => {
    const g = regexGuardrail({ pattern: /password/i, invert: true });
    const result = g.validate(makeInput('my Password is 123'), makeCtx());
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain('must NOT match');
  });

  it('inverts: passes when pattern does not match', () => {
    const g = regexGuardrail({ pattern: /password/i, invert: true });
    const result = g.validate(makeInput('hello world'), makeCtx());
    expect(result).toEqual({ valid: true, reason: undefined });
  });

  it('uses custom name', () => {
    const g = regexGuardrail({ pattern: /test/, name: 'my-regex' });
    expect(g.name).toBe('my-regex');
  });

  it('defaults maxRetries to 1', () => {
    const g = regexGuardrail({ pattern: /test/ });
    expect(g.maxRetries).toBe(1);
  });

  it('resets lastIndex for global regex patterns', () => {
    const pattern = /test/g;
    const g = regexGuardrail({ pattern });
    // First call
    const r1 = g.validate(makeInput('test'), makeCtx());
    expect(r1.valid).toBe(true);
    // Second call should also pass (lastIndex is reset)
    const r2 = g.validate(makeInput('test'), makeCtx());
    expect(r2.valid).toBe(true);
  });

  it('does not mutate caller-supplied global regex lastIndex', async () => {
    // Stronger invariant than "second call still matches": the caller's RegExp
    // instance must be left untouched, since they may share it across other
    // code paths that depend on its lastIndex.
    const pattern = /test/g;
    pattern.lastIndex = 7;
    const g = regexGuardrail({ pattern });
    await g.validate(makeInput('test test test'), makeCtx());
    expect(pattern.lastIndex).toBe(7);
  });

  it('does not mutate caller-supplied sticky regex lastIndex', async () => {
    const pattern = /target/y;
    pattern.lastIndex = 3;
    const g = regexGuardrail({ pattern });
    await g.validate(makeInput('xyztarget'), makeCtx());
    expect(pattern.lastIndex).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// contentPolicyGuardrail
// ---------------------------------------------------------------------------

describe('contentPolicyGuardrail', () => {
  it('blocks content matching blocklist string', () => {
    const g = contentPolicyGuardrail({ blocklist: ['confidential'] });
    const result = g.validate(
      makeInput('This is Confidential information'),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain('Blocked content');
  });

  it('blocks content matching blocklist regex', () => {
    const g = contentPolicyGuardrail({ blocklist: [/\b\d{3}-\d{2}-\d{4}\b/] });
    const result = g.validate(makeInput('SSN: 123-45-6789'), makeCtx());
    expect(result).toHaveProperty('valid', false);
  });

  it('passes when no blocklist matches', () => {
    const g = contentPolicyGuardrail({ blocklist: ['secret', 'password'] });
    const result = g.validate(makeInput('hello world'), makeCtx());
    expect(result).toEqual({ valid: true });
  });

  it('fails when requirelist content is missing', () => {
    const g = contentPolicyGuardrail({ requirelist: ['disclaimer'] });
    const result = g.validate(makeInput('Just some text'), makeCtx());
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain(
      'Required content missing'
    );
  });

  it('passes when requirelist content is present', () => {
    const g = contentPolicyGuardrail({ requirelist: ['disclaimer'] });
    const result = g.validate(
      makeInput('This includes a Disclaimer at the end'),
      makeCtx()
    );
    expect(result).toEqual({ valid: true });
  });

  it('checks both blocklist and requirelist together', () => {
    const g = contentPolicyGuardrail({
      blocklist: ['forbidden'],
      requirelist: ['approved'],
    });

    // blocked content takes priority
    const blocked = g.validate(
      makeInput('This is forbidden and approved'),
      makeCtx()
    );
    expect(blocked).toHaveProperty('valid', false);
    expect((blocked as { reason: string }).reason).toContain('Blocked');

    // missing required
    const missing = g.validate(makeInput('Just normal text'), makeCtx());
    expect(missing).toHaveProperty('valid', false);
    expect((missing as { reason: string }).reason).toContain('Required');

    // passes
    const ok = g.validate(makeInput('This is approved'), makeCtx());
    expect(ok).toEqual({ valid: true });
  });

  it('does not mutate caller-supplied blocklist regex lastIndex', async () => {
    const pattern = /secret/g;
    pattern.lastIndex = 5;
    const g = contentPolicyGuardrail({ blocklist: [pattern] });
    await g.validate(makeInput('xxxxxsecret'), makeCtx());
    expect(pattern.lastIndex).toBe(5);
  });

  it('resets lastIndex for global regex patterns in blocklist', () => {
    const pattern = /secret/gi;
    const g = contentPolicyGuardrail({ blocklist: [pattern] });
    // First call
    const r1 = g.validate(makeInput('this is secret'), makeCtx());
    expect(r1.valid).toBe(false);
    // Second call should also detect (lastIndex is reset)
    const r2 = g.validate(makeInput('this is secret'), makeCtx());
    expect(r2.valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// customGuardrail
// ---------------------------------------------------------------------------

describe('customGuardrail', () => {
  it('calls custom function with correct arguments', async () => {
    const input = makeInput('test');
    const ctx = makeCtx({ node: 'custom-node', attempt: 1 });

    let receivedInput: GuardrailInput | undefined;
    let receivedCtx: GuardrailContext | undefined;

    const g = customGuardrail('my-custom', (out, c) => {
      receivedInput = out;
      receivedCtx = c;
      return { valid: true };
    });

    await g.validate(input, ctx);

    expect(receivedInput).toBe(input);
    expect(receivedCtx).toBe(ctx);
  });

  it('returns custom validation result', () => {
    const g = customGuardrail('length-check', out => {
      if (out.text.length > 10) {
        return { valid: false, reason: 'Too long' };
      }
      return { valid: true };
    });

    expect(g.validate(makeInput('short'), makeCtx())).toEqual({ valid: true });
    expect(
      g.validate(makeInput('this is a very long string'), makeCtx())
    ).toEqual({
      valid: false,
      reason: 'Too long',
    });
  });

  it('supports async validation', async () => {
    const g = customGuardrail('async-check', async out => {
      await Promise.resolve();
      return { valid: out.text === 'ok' };
    });

    const result = await g.validate(makeInput('ok'), makeCtx());
    expect(result).toEqual({ valid: true });
  });

  it('defaults to target both and maxRetries 2', () => {
    const g = customGuardrail('test', () => ({ valid: true }));
    expect(g.target).toBe('both');
    expect(g.maxRetries).toBe(2);
  });

  it('respects options', () => {
    const g = customGuardrail('test', () => ({ valid: true }), {
      target: 'text',
      maxRetries: 5,
    });
    expect(g.target).toBe('text');
    expect(g.maxRetries).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// T1.3 — Regex lastIndex isolation across guardrails / repeated calls
// ---------------------------------------------------------------------------

describe('T1.3 — regex lastIndex isolation', () => {
  it('global regex shared across regex + content-policy keeps lastIndex untouched', async () => {
    const pattern = /forbidden/g;
    pattern.lastIndex = 7;

    const regex = regexGuardrail({ pattern, invert: true });
    const policy = contentPolicyGuardrail({ blocklist: [pattern] });

    // First validator
    await regex.validate(makeInput('forbidden in here'), makeCtx());
    expect(pattern.lastIndex).toBe(7);

    // Second validator, reuses the same RegExp instance
    await policy.validate(makeInput('also forbidden'), makeCtx());
    expect(pattern.lastIndex).toBe(7);

    // Repeat to make sure neither call advanced or reset lastIndex.
    await regex.validate(makeInput('still forbidden text'), makeCtx());
    await policy.validate(makeInput('definitely forbidden'), makeCtx());
    expect(pattern.lastIndex).toBe(7);
  });

  it('sticky regex shared across two validators keeps lastIndex untouched', async () => {
    const pattern = /target/y;
    pattern.lastIndex = 7;

    const regex = regexGuardrail({ pattern });
    const policy = contentPolicyGuardrail({ blocklist: [pattern] });

    await regex.validate(makeInput('xyztarget more'), makeCtx());
    expect(pattern.lastIndex).toBe(7);

    await policy.validate(makeInput('another target line'), makeCtx());
    expect(pattern.lastIndex).toBe(7);
  });

  it('plain string blocklist is wrapped case-insensitively', async () => {
    const policy = contentPolicyGuardrail({ blocklist: ['forbidden'] });
    const result = await policy.validate(
      makeInput('Forbidden content here'),
      makeCtx()
    );
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain('Blocked content');
  });
});

// ---------------------------------------------------------------------------
// composeGuardrails
// ---------------------------------------------------------------------------

describe('composeGuardrails', () => {
  it('passes when all guardrails pass', async () => {
    const g = composeGuardrails([
      regexGuardrail({ pattern: /\d+/ }),
      contentPolicyGuardrail({ blocklist: ['forbidden'] }),
    ]);

    const result = await g.validate(makeInput('has 123 numbers'), makeCtx());
    expect(result).toEqual({ valid: true });
  });

  it('fails on first failure', async () => {
    const g = composeGuardrails([
      regexGuardrail({ pattern: /^\d+$/ }),
      contentPolicyGuardrail({ requirelist: ['hello'] }),
    ]);

    const result = await g.validate(makeInput('not digits'), makeCtx());
    expect(result).toHaveProperty('valid', false);
    expect((result as { reason: string }).reason).toContain(
      'must match pattern'
    );
  });

  it('skips text-only guardrails only when output has no text', async () => {
    // Mirrors runLlmStepWithGuardrails: text-only guardrails run whenever
    // there's text to validate — having tool calls alongside doesn't excuse
    // the text from validation.
    const textOnly = jsonSchemaGuardrail({ schema: { type: 'object' } });
    const g = composeGuardrails([textOnly]);

    // No text + tool calls → text-only guardrail skipped.
    const skipped = await g.validate(
      { text: '', toolCalls: [{ id: '1', name: 't', arguments: {} }] },
      makeCtx()
    );
    expect(skipped).toEqual({ valid: true });

    // Text present (even alongside tool calls) → guardrail must run.
    const ranWithBoth = await g.validate(
      {
        text: 'not valid json',
        toolCalls: [{ id: '1', name: 't', arguments: {} }],
      },
      makeCtx()
    );
    expect(ranWithBoth.valid).toBe(false);
  });

  it('skips tool-calls-only guardrails when no tool calls', async () => {
    const toolOnly = customGuardrail(
      'tool-checker',
      () => ({ valid: false, reason: 'should be skipped' }),
      { target: 'tool-calls' }
    );

    const g = composeGuardrails([toolOnly]);
    const result = await g.validate(makeInput('just text'), makeCtx());
    expect(result).toEqual({ valid: true });
  });

  it('computes maxRetries as the max of composed guardrails', () => {
    const g = composeGuardrails([
      regexGuardrail({ pattern: /test/, maxRetries: 1 }),
      jsonSchemaGuardrail({ schema: { type: 'string' }, maxRetries: 5 }),
    ]);
    expect(g.maxRetries).toBe(5);
  });

  it('generates chain name from component names', () => {
    const g = composeGuardrails([
      regexGuardrail({ pattern: /test/, name: 'r1' }),
      contentPolicyGuardrail({ name: 'cp1' }),
    ]);
    expect(g.name).toBe('chain:[r1,cp1]');
  });

  it('handles empty guardrail array gracefully', async () => {
    const g = composeGuardrails([]);
    expect(g.maxRetries).toBe(2);
    const result = await g.validate(makeInput('anything'), makeCtx());
    expect(result).toEqual({ valid: true });
  });
});
