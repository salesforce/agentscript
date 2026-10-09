/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retry logic for LLM step failures with exponential backoff.
 *
 * Retries transient errors (429, 5xx, network/timeout) with exponential backoff
 * and jitter. Respects Retry-After headers and AbortSignal cancellation.
 */

// Default: 3 attempts total (2 retries after the initial call).
// With base 500ms and factor 2, this gives: initial attempt, wait 500ms±jitter,
// retry 1, wait 1000ms±jitter, retry 2. Total ~2s of backoff before exhaustion.
export const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 30_000; // Cap at 30s per attempt
const RETRY_FACTOR = 2;
// Full jitter (0-100% of base) to avoid herd retries.
const JITTER_FACTOR = 1.0;

function buildErrorPattern(patterns: readonly string[]): RegExp {
  return new RegExp(patterns.join('|'), 'i');
}

/**
 * Account-level exhaustion that will NOT clear on its own: quota, budget, and
 * subscription limits. Providers frequently surface these as HTTP 429 (the same
 * status as a transient rate-limit), so retrying just burns backoff and, on a
 * metered plan, money. This pattern is checked BEFORE the status code so it
 * overrides the "429 ⇒ retryable" rule.
 *
 * String set curated from real-world gateway and SDK wording across OpenAI,
 * OpenCode, OpenRouter, …
 */
const NON_RETRYABLE_LIMIT_PATTERN = buildErrorPattern([
  // Subscription / free-tier caps returned as 429 JSON error types.
  'GoUsageLimitError',
  'FreeUsageLimitError',
  'monthly usage limit reached',
  'available balance',
  // Generic quota / budget / billing exhaustion. `insufficient_quota` is
  // OpenAI's billing error code; the rest cover common gateway wording.
  'insufficient_quota',
  'out of budget',
  'quota exceeded',
  'billing',
]);

/**
 * Transient provider / transport failures that a retry can plausibly clear,
 * matched on the error message when no HTTP status is available (or to catch
 * SDK/stream wording that carries no status).
 */
const RETRYABLE_PROVIDER_PATTERN = buildErrorPattern([
  // Provider load / HTTP status / server-side transients embedded in text.
  'overloaded',
  'rate.?limit',
  'too many requests',
  '\\b429\\b',
  '\\b50[0-9]\\b',
  '\\b524\\b',
  'service.?unavailable',
  'server.?error',
  'internal.?error',
  'provider.?returned.?error',
  // Network / proxy / fetch transport failures.
  'network.?error',
  'connection.?error',
  'connection.?refused',
  'connection.?lost',
  'other side closed',
  'fetch failed',
  'upstream.?connect',
  'reset before headers',
  'socket hang up',
  'socket connection was closed',
  'timed? out',
  'timeout',
  'terminated',
  // WebSocket transports report close/error text instead of HTTP text.
  'websocket.?closed',
  'websocket.?error',
  // Premature stream endings from SDKs (Anthropic, Bedrock/Smithy).
  'ended without',
  'stream ended before message_stop',
  'http2 request did not get a response',
  // Explicit retry guidance emitted mid-stream.
  'you can retry your request',
  'try your request again',
  'please retry your request',
  // gRPC-based providers (e.g. NVIDIA NIM).
  'ResourceExhausted',
]);

export interface RetryOptions {
  /** Maximum number of attempts (including the initial call). Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds. Defaults to 500. */
  baseDelayMs?: number;
  /** Exponential backoff factor. Defaults to 2. */
  factor?: number;
  /** Maximum delay cap in milliseconds. Defaults to 30000. */
  maxDelayMs?: number;
}

/**
 * Classify whether an error is retryable.
 *
 * Retryable:
 * - Network/connection errors (ECONNRESET, ETIMEDOUT, etc.)
 * - Timeout errors
 * - HTTP 429 (rate limit)
 * - HTTP 5xx (server errors: 500, 502, 503, 504)
 *
 * Non-retryable:
 * - Abort errors (user cancellation)
 * - Billing/quota/subscription exhaustion (even when surfaced as HTTP 429)
 * - 4xx other than 429 (client errors: 400, 401, 403, 404, etc.)
 * - Other deterministic failures
 */
export function isRetryableError(error: unknown): boolean {
  // Never retry on abort — user cancellation is terminal.
  if (isAbortError(error)) {
    return false;
  }

  const message = extractMessage(error);

  // Account-level exhaustion (quota/budget/subscription) will not clear on a
  // retry and often arrives AS a 429 — so this check precedes the status code.
  if (NON_RETRYABLE_LIMIT_PATTERN.test(message)) {
    return false;
  }

  // Check for HTTP status code on the error object (common pattern in fetch/SDK errors).
  const statusCode = extractStatusCode(error);
  if (statusCode !== undefined) {
    // 429 (rate limit) is retryable — unless it was a limit error caught above.
    if (statusCode === 429) return true;
    // 5xx (server errors) are retryable.
    if (statusCode >= 500 && statusCode < 600) return true;
    // Other status codes (4xx, 2xx, etc.) are not retryable.
    return false;
  }

  // No status code: fall back to matching the message against the curated set
  // of transient provider/transport failures (network drops, stream ends,
  // overload, explicit retry guidance, …).
  if (RETRYABLE_PROVIDER_PATTERN.test(message)) {
    return true;
  }

  // Legacy Node network error codes not covered verbatim above.
  const lower = message.toLowerCase();
  if (
    lower.includes('econnreset') ||
    lower.includes('econnrefused') ||
    lower.includes('etimedout') ||
    lower.includes('enetunreach') ||
    lower.includes('connection')
  ) {
    return true;
  }

  // Error types that are typically retryable.
  if (error instanceof Error) {
    const errorName = error.name.toLowerCase();
    if (errorName.includes('timeout') || errorName.includes('connection')) {
      return true;
    }
  }

  // Default: not retryable.
  return false;
}

/** Best-effort human-readable text for an unknown error value. */
function extractMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(error);
}

/**
 * Compute the backoff delay for a given attempt.
 *
 * @param attempt - 1-based attempt number (1 = first retry after initial failure).
 * @param retryAfterMs - Optional server-requested delay from Retry-After header.
 * @param options - Retry configuration.
 * @returns Delay in milliseconds.
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterMs: number | undefined,
  options: RetryOptions = {}
): number {
  // Server Retry-After takes precedence.
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return retryAfterMs;
  }

  const base = options.baseDelayMs ?? BASE_DELAY_MS;
  const factor = options.factor ?? RETRY_FACTOR;
  const maxDelay = options.maxDelayMs ?? MAX_DELAY_MS;

  // Exponential backoff: base * factor^(attempt-1), capped at maxDelay.
  const exponential = base * Math.pow(factor, attempt - 1);
  const capped = Math.min(exponential, maxDelay);

  // Add full jitter: random value in [0, capped].
  const jitter = Math.random() * capped * JITTER_FACTOR;
  return capped + jitter;
}

/**
 * Wrap an async function with retry logic.
 *
 * @param fn - The function to retry.
 * @param options - Retry configuration.
 * @param signal - Optional AbortSignal to cancel the retry loop.
 * @returns The result of the function.
 * @throws The last error if all attempts fail, or an abort error if cancelled.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
  signal?: AbortSignal
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check abort before each attempt.
    signal?.throwIfAborted();

    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // If this was the last attempt or the error is non-retryable, throw.
      if (attempt >= maxAttempts || !isRetryableError(error)) {
        throw error;
      }

      // Compute backoff delay.
      const retryAfterMs = extractRetryAfterMs(error);
      const delayMs = computeBackoffMs(attempt, retryAfterMs, options);

      // Wait, respecting abort signal.
      await sleep(delayMs, signal);
    }
  }

  // Should never reach here, but TypeScript doesn't know that.
  throw lastError;
}

/**
 * Sleep for a given duration, respecting an AbortSignal.
 *
 * @param ms - Duration in milliseconds.
 * @param signal - Optional AbortSignal to cancel the sleep.
 * @throws If the signal is aborted during the sleep.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

/**
 * Extract HTTP status code from an error object.
 */
function extractStatusCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const statusCode =
    (error as { statusCode?: unknown; status?: unknown }).statusCode ??
    (error as { status?: unknown }).status;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/**
 * Extract Retry-After delay from an error object (in milliseconds).
 */
function extractRetryAfterMs(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value =
    (error as { retryAfterMs?: unknown; retryAfter?: unknown }).retryAfterMs ??
    (error as { retryAfter?: unknown }).retryAfter;
  return typeof value === 'number' && value > 0 ? value : undefined;
}

/**
 * Check if an error is an abort error (user cancellation).
 */
function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  if (error instanceof Error && error.name === 'AbortError') return true;
  return false;
}
