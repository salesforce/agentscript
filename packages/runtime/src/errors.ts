/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export class AbortError extends Error {
  override readonly name = 'AbortError';
  readonly reason: unknown;
  constructor(reason?: unknown) {
    super(
      typeof reason === 'string'
        ? reason
        : reason instanceof Error
          ? reason.message
          : 'The operation was aborted'
    );
    this.reason = reason;
  }
}
