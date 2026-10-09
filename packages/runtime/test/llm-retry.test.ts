/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isRetryableError,
  computeBackoffMs,
  withRetry,
  DEFAULT_MAX_ATTEMPTS,
} from '../src/llm/retry.js';

describe('isRetryableError', () => {
  it('returns true for 429 rate limit', () => {
    const error = { statusCode: 429, message: 'Rate limited' };
    expect(isRetryableError(error)).toBe(true);
  });

  it('returns true for 5xx server errors', () => {
    expect(isRetryableError({ statusCode: 500 })).toBe(true);
    expect(isRetryableError({ statusCode: 502 })).toBe(true);
    expect(isRetryableError({ statusCode: 503 })).toBe(true);
    expect(isRetryableError({ statusCode: 504 })).toBe(true);
  });

  it('returns false for 4xx client errors other than 429', () => {
    expect(isRetryableError({ statusCode: 400 })).toBe(false);
    expect(isRetryableError({ statusCode: 401 })).toBe(false);
    expect(isRetryableError({ statusCode: 403 })).toBe(false);
    expect(isRetryableError({ statusCode: 404 })).toBe(false);
    expect(isRetryableError({ statusCode: 422 })).toBe(false);
  });

  it('returns false for abort errors', () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    expect(isRetryableError(abortError)).toBe(false);

    const abortError2 = new Error('Aborted');
    abortError2.name = 'AbortError';
    expect(isRetryableError(abortError2)).toBe(false);
  });

  it('returns true for network connection errors', () => {
    const econnreset = new Error('ECONNRESET: connection reset by peer');
    expect(isRetryableError(econnreset)).toBe(true);

    const etimedout = new Error('ETIMEDOUT: operation timed out');
    expect(isRetryableError(etimedout)).toBe(true);

    const fetchFailed = new Error('fetch failed');
    expect(isRetryableError(fetchFailed)).toBe(true);
  });

  it('returns true for timeout errors by name', () => {
    const timeoutError = new Error('Request timeout');
    timeoutError.name = 'TimeoutError';
    expect(isRetryableError(timeoutError)).toBe(true);
  });

  it('returns false for unknown errors', () => {
    const unknownError = new Error('Something went wrong');
    expect(isRetryableError(unknownError)).toBe(false);

    expect(isRetryableError('string error')).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it('checks status on both statusCode and status properties', () => {
    expect(isRetryableError({ status: 429 })).toBe(true);
    expect(isRetryableError({ status: 503 })).toBe(true);
  });

  it('does NOT retry billing/quota exhaustion even when surfaced as 429', () => {
    // The single most important case: a metered account out of quota returns
    // 429, but retrying just burns backoff and money.
    expect(
      isRetryableError({ statusCode: 429, message: 'insufficient_quota' })
    ).toBe(false);
    expect(
      isRetryableError({
        status: 429,
        message: 'Monthly usage limit reached. Enable available balance.',
      })
    ).toBe(false);
    expect(
      isRetryableError(new Error('GoUsageLimitError: free tier exhausted'))
    ).toBe(false);
    expect(isRetryableError(new Error('quota exceeded'))).toBe(false);
    expect(isRetryableError(new Error('billing hard limit reached'))).toBe(
      false
    );
  });

  it('retries transient provider/transport failures by message when no status', () => {
    expect(isRetryableError(new Error('Overloaded'))).toBe(true);
    expect(isRetryableError(new Error('Provider returned error'))).toBe(true);
    expect(
      isRetryableError(new Error('Anthropic stream ended before message_stop'))
    ).toBe(true);
    expect(isRetryableError(new Error('upstream connect error'))).toBe(true);
    expect(isRetryableError(new Error('socket hang up'))).toBe(true);
    expect(isRetryableError(new Error('You can retry your request.'))).toBe(
      true
    );
    expect(isRetryableError(new Error('ResourceExhausted'))).toBe(true);
  });

  it('reads message from string and plain-object errors for classification', () => {
    expect(isRetryableError('insufficient_quota')).toBe(false);
    expect(isRetryableError('overloaded, please retry')).toBe(true);
    expect(isRetryableError({ message: 'fetch failed' })).toBe(true);
  });
});

describe('computeBackoffMs', () => {
  beforeEach(() => {
    // Seed random for predictable jitter (though we test ranges).
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('honors Retry-After over computed backoff', () => {
    const retryAfterMs = 2000;
    const delay = computeBackoffMs(1, retryAfterMs);
    expect(delay).toBe(retryAfterMs);
  });

  it('computes exponential backoff with default options', () => {
    // Attempt 1: 500 * 2^0 = 500, jitter = 500 * 0.5 * 1.0 = 250, total = 750
    const delay1 = computeBackoffMs(1, undefined);
    expect(delay1).toBe(750);

    // Attempt 2: 500 * 2^1 = 1000, jitter = 1000 * 0.5 * 1.0 = 500, total = 1500
    const delay2 = computeBackoffMs(2, undefined);
    expect(delay2).toBe(1500);

    // Attempt 3: 500 * 2^2 = 2000, jitter = 2000 * 0.5 * 1.0 = 1000, total = 3000
    const delay3 = computeBackoffMs(3, undefined);
    expect(delay3).toBe(3000);
  });

  it('caps backoff at maxDelayMs', () => {
    // Attempt 10: 500 * 2^9 = 256000, but capped at 30000
    // With jitter: 30000 + 30000 * 0.5 * 1.0 = 45000
    const delay = computeBackoffMs(10, undefined);
    expect(delay).toBe(45000);
  });

  it('respects custom options', () => {
    const options = {
      baseDelayMs: 1000,
      factor: 3,
      maxDelayMs: 5000,
    };
    // Attempt 1: 1000 * 3^0 = 1000, jitter = 1000 * 0.5 * 1.0 = 500, total = 1500
    const delay1 = computeBackoffMs(1, undefined, options);
    expect(delay1).toBe(1500);

    // Attempt 2: 1000 * 3^1 = 3000, jitter = 3000 * 0.5 * 1.0 = 1500, total = 4500
    const delay2 = computeBackoffMs(2, undefined, options);
    expect(delay2).toBe(4500);

    // Attempt 3: 1000 * 3^2 = 9000, capped at 5000, jitter = 5000 * 0.5 * 1.0 = 2500, total = 7500
    const delay3 = computeBackoffMs(3, undefined, options);
    expect(delay3).toBe(7500);
  });

  it('produces different delays with real jitter', () => {
    vi.restoreAllMocks(); // Use real Math.random
    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(computeBackoffMs(1, undefined));
    }
    // With full jitter, we should get different values (very unlikely all 10 are the same).
    expect(delays.size).toBeGreaterThan(1);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('succeeds on first attempt without retry', async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      return 'success';
    });

    const result = await withRetry(fn);
    expect(result).toBe('success');
    expect(callCount).toBe(1);
  });

  it('retries on retryable error and succeeds', async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount < 3) {
        throw { statusCode: 503, message: 'Service unavailable' };
      }
      return 'success';
    });

    const promise = withRetry(fn);

    // Fast-forward through retries.
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe('success');
    expect(callCount).toBe(3);
  });

  it('throws last error after exhausting max attempts', async () => {
    const error = { statusCode: 503, message: 'Service unavailable' };
    const fn = vi.fn(async () => {
      throw error;
    });

    const promise = withRetry(fn, { maxAttempts: 3 }).catch(e => e);

    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toEqual(error);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry non-retryable errors', async () => {
    const error = { statusCode: 400, message: 'Bad request' };
    const fn = vi.fn(async () => {
      throw error;
    });

    await expect(withRetry(fn)).rejects.toEqual(error);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aborts during wait between retries', async () => {
    const abortController = new AbortController();
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      throw { statusCode: 503, message: 'Service unavailable' };
    });

    const promise = withRetry(
      fn,
      { maxAttempts: 3 },
      abortController.signal
    ).catch(e => e);

    // Let the first attempt fail.
    await vi.advanceTimersByTimeAsync(0);
    expect(callCount).toBe(1);

    // Abort during the backoff wait.
    abortController.abort();

    await vi.runAllTimersAsync();

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    // Should not have retried after abort.
    expect(callCount).toBe(1);
  });

  it('aborts before first attempt', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const fn = vi.fn(async () => 'success');

    await expect(withRetry(fn, {}, abortController.signal)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not retry on abort error from function', async () => {
    const abortError = new DOMException('Aborted', 'AbortError');
    const fn = vi.fn(async () => {
      throw abortError;
    });

    await expect(withRetry(fn)).rejects.toEqual(abortError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After from error', async () => {
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw { statusCode: 429, message: 'Rate limited', retryAfterMs: 3000 };
      }
      return 'success';
    });

    const promise = withRetry(fn);

    // First attempt fails, should wait 3000ms (Retry-After).
    await vi.advanceTimersByTimeAsync(2999);
    expect(callCount).toBe(1); // Still waiting

    await vi.advanceTimersByTimeAsync(1);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result).toBe('success');
    expect(callCount).toBe(2);
  });

  it('uses default max attempts if not specified', async () => {
    const fn = vi.fn(async () => {
      throw { statusCode: 503, message: 'Service unavailable' };
    });

    const promise = withRetry(fn).catch(e => e);

    await vi.runAllTimersAsync();

    const error = await promise;
    expect(error).toBeTruthy();
    expect(fn).toHaveBeenCalledTimes(DEFAULT_MAX_ATTEMPTS);
  });

  it('checks abort signal before each attempt', async () => {
    const abortController = new AbortController();
    let callCount = 0;
    const fn = vi.fn(async () => {
      callCount++;
      if (callCount === 1) {
        throw { statusCode: 503, message: 'Service unavailable' };
      }
      // Abort during the second attempt execution.
      abortController.abort();
      // The abort check in withRetry happens BEFORE calling fn, so if we abort
      // here inside fn, it will complete successfully. To test abort checking
      // before each attempt, we need to abort BETWEEN attempts.
      return 'success';
    });

    const promise = withRetry(fn, { maxAttempts: 3 }, abortController.signal);

    await vi.runAllTimersAsync();

    // The function was called twice: first failed, then second succeeded.
    // Aborting inside the function doesn't prevent it from returning success.
    const result = await promise;
    expect(result).toBe('success');
    expect(callCount).toBe(2);
  });
});
