/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generate a W3C-compliant trace ID (32 hex chars / 16 bytes). */
export function generateTraceId(): string {
  return randomHex(16);
}

/** Generate a W3C-compliant span ID (16 hex chars / 8 bytes). */
export function generateSpanId(): string {
  return randomHex(8);
}
