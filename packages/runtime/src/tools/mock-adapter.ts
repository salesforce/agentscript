/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolAdapter, ToolAdapterInvocation } from './registry.js';

/**
 * Adapter that returns a pre-declared JSON value for matching exact targets,
 * delegating everything else to an optional fallback. Designed to sit in front
 * of real adapters in playgrounds / test harnesses.
 *
 * Keyed by full URI (e.g. `fn://search_flights`, `http://api.example.com/x`)
 * rather than by scheme, because the mock table is user-authored and the
 * whole point is to override specific invocations.
 *
 * Register the same instance under every scheme you want to intercept — it
 * doesn't care which scheme it was looked up under; exact-target match is
 * what counts.
 */
export class MockToolAdapter implements ToolAdapter {
  constructor(
    private readonly mocks: Map<string, Record<string, unknown>>,
    private readonly fallback?: ToolAdapter
  ) {}

  async invoke({
    target,
    args,
  }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
    const mock = this.mocks.get(target);
    if (mock !== undefined) return mock;
    if (this.fallback) return this.fallback.invoke({ target, args });
    throw new Error(`No mock or fallback adapter for "${target}"`);
  }
}
