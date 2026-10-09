/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export class DelegationTimeoutError extends Error {
  constructor(
    public readonly childNode: string,
    public readonly maxSteps: number,
    public readonly stepsTaken: number
  ) {
    super(
      `Delegation to "${childNode}" exceeded maxSteps (${stepsTaken}/${maxSteps})`
    );
    this.name = 'DelegationTimeoutError';
  }
}

export class DelegationDepthError extends Error {
  constructor(
    public readonly currentDepth: number,
    public readonly maxDepth: number
  ) {
    super(`Delegation depth ${currentDepth} exceeds maximum ${maxDepth}`);
    this.name = 'DelegationDepthError';
  }
}

export class StateConflictError extends Error {
  constructor(
    public readonly key: string,
    public readonly writerA: number,
    public readonly writerB: number
  ) {
    super(
      `Parallel delegation conflict on key "${key}" between child ${writerA} and child ${writerB}`
    );
    this.name = 'StateConflictError';
  }
}
