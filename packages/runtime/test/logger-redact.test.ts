/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { redact } from '../src/logger/redact.js';

describe('redact', () => {
  it('redacts key-based secrets (case insensitive)', () => {
    const input = {
      apiKey: 'my-secret-key',
      API_KEY: 'another-key',
      Authorization: 'Bearer token123',
      password: 'secret123',
      user: 'alice',
    };
    const result = redact(input);
    expect(result).toEqual({
      apiKey: '[REDACTED]',
      API_KEY: '[REDACTED]',
      Authorization: '[REDACTED]',
      password: '[REDACTED]',
      user: 'alice',
    });
  });

  it('redacts nested secrets', () => {
    const input = {
      config: {
        headers: {
          authorization: 'Bearer abc123',
          'x-api-key': 'key456',
        },
      },
      data: { message: 'hello' },
    };
    const result = redact(input);
    expect(result).toEqual({
      config: {
        headers: {
          authorization: '[REDACTED]',
          'x-api-key': '[REDACTED]',
        },
      },
      data: { message: 'hello' },
    });
  });

  it('redacts secrets in arrays', () => {
    const input = {
      items: [
        { apiKey: 'key1', value: 1 },
        { token: 'token2', value: 2 },
      ],
    };
    const result = redact(input);
    expect(result).toEqual({
      items: [
        { apiKey: '[REDACTED]', value: 1 },
        { token: '[REDACTED]', value: 2 },
      ],
    });
  });

  it('redacts pattern-based secrets (Bearer tokens)', () => {
    const input = {
      note: 'Authorization header is Bearer abc123def456ghi789',
    };
    const result = redact(input);
    expect(result).toEqual({
      note: 'Authorization header is [REDACTED]',
    });
  });

  it('redacts OpenAI-style keys', () => {
    const input = {
      note: 'Use this key: sk-abcd1234efgh5678ijkl9012mnop3456qrst7890',
    };
    const result = redact(input);
    expect(result).toEqual({
      note: 'Use this key: [REDACTED]',
    });
  });

  it('redacts AWS access keys', () => {
    const input = {
      message: 'AWS key: AKIAIOSFODNN7EXAMPLE',
    };
    const result = redact(input);
    expect(result).toEqual({
      message: 'AWS key: [REDACTED]',
    });
  });

  it('redacts GitHub personal access tokens', () => {
    const input = {
      token: 'ghp_1234567890abcdefghijklmnopqrstuvwx',
    };
    const result = redact(input);
    expect(result).toEqual({
      token: '[REDACTED]',
    });
  });

  it('redacts Slack tokens', () => {
    const fakeSlackToken = ['xoxb', '1234567890', 'abcdefghijklmn'].join('-');
    const input = {
      note: `Slack token: ${fakeSlackToken}`,
    };
    const result = redact(input);
    expect(result).toEqual({
      note: 'Slack token: [REDACTED]',
    });
  });

  it('handles circular references', () => {
    const input: any = { a: 1 };
    input.self = input;
    const result = redact(input);
    expect(result).toEqual({ a: 1, self: '[REDACTED:cycle]' });
  });

  it('does not mutate the original', () => {
    const input = { apiKey: 'secret' };
    const result = redact(input);
    expect(input.apiKey).toBe('secret');
    expect(result.apiKey).toBe('[REDACTED]');
  });

  it('leaves non-secret data untouched', () => {
    const input = {
      user: 'alice',
      message: 'hello world',
      count: 42,
      active: true,
    };
    const result = redact(input);
    expect(result).toEqual(input);
  });

  it('handles primitives', () => {
    expect(redact('hello')).toBe('hello');
    expect(redact(42)).toBe(42);
    expect(redact(true)).toBe(true);
    expect(redact(null)).toBe(null);
    expect(redact(undefined)).toBe(undefined);
  });

  it('redacts secrets at max depth', () => {
    let input: any = { apiKey: 'secret' };
    for (let i = 0; i < 12; i++) {
      input = { nested: input };
    }
    const result = redact(input);
    // Should cap at depth 10.
    expect(JSON.stringify(result)).toContain('[REDACTED:depth]');
  });

  it('handles Error objects safely', () => {
    const input = {
      error: new Error('Something failed'),
    };
    const result = redact(input);
    expect(result).toEqual({
      error: 'Error: Something failed',
    });
  });

  it('handles Date objects safely', () => {
    const date = new Date('2026-07-23T00:00:00Z');
    const input = { timestamp: date };
    const result = redact(input);
    expect(result).toEqual({
      timestamp: '2026-07-23T00:00:00.000Z',
    });
  });

  it('handles Buffer objects safely', () => {
    const input = { data: Buffer.from('hello') };
    const result = redact(input);
    expect(result).toEqual({ data: '[Buffer]' });
  });

  it('redacts both key and pattern in same object', () => {
    const input = {
      authorization: 'Bearer abc123def456',
      note: 'Another token: Bearer xyz789abc123',
    };
    const result = redact(input);
    expect(result).toEqual({
      authorization: '[REDACTED]',
      note: 'Another token: [REDACTED]',
    });
  });
});
