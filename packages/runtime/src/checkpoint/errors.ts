/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export class CheckpointVersionError extends Error {
  override readonly name = 'CheckpointVersionError';
  constructor(
    public readonly found: number,
    public readonly expected: number
  ) {
    super(
      `Checkpoint schema version ${found} is not compatible with runtime version ${expected}`
    );
  }
}

export class CheckpointIncompatibleError extends Error {
  override readonly name = 'CheckpointIncompatibleError';
  constructor(message: string) {
    super(message);
  }
}
