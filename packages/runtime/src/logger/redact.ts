/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Redacts sensitive values from log records before they hit console, memory,
 * or external transports. Two layers:
 * 1. Key-based: any object key matching a known secret-bearing name (apiKey,
 *    authorization, password, token, etc.) has its value replaced with [REDACTED].
 * 2. Pattern-based: string values matching known secret formats (Bearer tokens,
 *    AWS keys, GitHub tokens, etc.) are also redacted, even if the key is benign.
 */

const REDACTED = '[REDACTED]';
const MAX_DEPTH = 10;

/** Keys that should be redacted (case-insensitive, normalized). */
const REDACTED_KEYS: ReadonlySet<string> = new Set([
  'apikey',
  'api_key',
  'authorization',
  'password',
  'token',
  'secret',
  'privatekey',
  'private_key',
  'xapikey',
  'x-api-key',
  'cookie',
  'setcookie',
  'set-cookie',
  'bearer',
  'refreshtoken',
  'refresh_token',
  'accesstoken',
  'access_token',
  'idtoken',
  'id_token',
  'clientsecret',
  'client_secret',
  'apisecret',
  'api_secret',
]);

/** Patterns matching common secret formats in string values. */
const RAW_SECRET_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/g, // Bearer tokens
  /\bsk-[A-Za-z0-9_-]{20,}\b/g, // OpenAI-style keys
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access keys
  /\bghp_[A-Za-z0-9]{36}\b/g, // GitHub personal access tokens (classic)
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g, // GitHub fine-grained PATs
  /\bgh[oprsu]_[A-Za-z0-9]{36}\b/g, // GitHub OAuth/app/refresh/server/user tokens
  /\bx-access-token:[^@\s]+@/g, // token embedded in a clone URL
  /\bsha(?:1|256)=[A-Fa-f0-9]{40,64}\b/g, // GitHub webhook HMAC signatures
  /\bxox[baprs]-[0-9]{10,}-[A-Za-z0-9]+\b/g, // Slack tokens
];

/**
 * Normalize a key for comparison: lowercase, strip separators.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replaceAll(/[_\-.\s]/g, '');
}

/**
 * Redact known secret patterns from a string value.
 */
function redactString(value: string): string {
  let result = value;
  for (const pattern of RAW_SECRET_PATTERNS) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

/**
 * Recursively walk a value and redact secrets. Returns a deep clone with
 * sensitive data replaced by [REDACTED]. Handles circular references safely.
 *
 * @param value - The value to redact (primitives, objects, arrays).
 * @param seen - Tracks visited objects to detect cycles.
 * @param depth - Current recursion depth (capped at MAX_DEPTH).
 */
function redactValue(
  value: unknown,
  seen: WeakSet<object>,
  depth: number
): unknown {
  // Cap recursion depth to avoid pathological input.
  if (depth > MAX_DEPTH) {
    return '[REDACTED:depth]';
  }

  // Primitives: redact strings, pass through others.
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }

  // Non-plain objects (Buffer, Error, Date, class instances): serialize to string form.
  if (typeof value === 'object') {
    // Check for cycles.
    if (seen.has(value)) {
      return '[REDACTED:cycle]';
    }
    seen.add(value);

    // Handle arrays.
    if (Array.isArray(value)) {
      return value.map(item => redactValue(item, seen, depth + 1));
    }

    // Don't traverse Buffer, Error, Date, or other non-plain objects.
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Return a safe string representation.
      if (value instanceof Error) {
        return `Error: ${value.message}`;
      }
      if (value instanceof Date) {
        return value.toISOString();
      }
      if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
        return '[Buffer]';
      }
      return Object.prototype.toString.call(value);
    }

    // Recursively redact plain objects.
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const normalized = normalizeKey(key);
      if (REDACTED_KEYS.has(normalized)) {
        // Key-based redaction: replace the value regardless of type.
        out[key] = REDACTED;
      } else {
        // Recurse into the value.
        out[key] = redactValue(val, seen, depth + 1);
      }
    }
    return out;
  }

  // Functions, symbols, etc.: return a safe representation.
  return String(value);
}

/**
 * Redact secrets from a log record. Returns a deep clone of the input with
 * sensitive values replaced by [REDACTED]. Does NOT mutate the original.
 */
export function redact<T>(value: T): T {
  return redactValue(value, new WeakSet(), 0) as T;
}
