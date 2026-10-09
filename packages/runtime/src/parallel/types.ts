/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export type ParallelStrategy = 'auto' | 'always' | 'never';

export type FailurePolicy = 'fail-fast' | 'wait-all';

export interface ParallelDispatchOptions {
  /** Whether to dispatch tool calls in parallel. Default: 'auto'. */
  strategy?: ParallelStrategy;
  /** Tools that must always execute sequentially (by name). */
  sequentialTools?: string[];
  /** How to handle failures. Default: 'wait-all'. */
  failurePolicy?: FailurePolicy;
}

export interface ParallelDelegationOptions {
  /** How to handle child failures. Default: 'wait-all'. */
  failurePolicy?: FailurePolicy;
  /** Per-child timeout in milliseconds. */
  perChildTimeoutMs?: number;
  /** State merge strategy when multiple children return mutations. Default: 'last-wins'. */
  stateMerge?: 'last-wins' | 'error-on-conflict' | 'custom';
  /** Custom merge function (required when stateMerge is 'custom'). */
  mergeFn?: (
    changes: Array<Record<string, unknown>>
  ) => Record<string, unknown>;
}
