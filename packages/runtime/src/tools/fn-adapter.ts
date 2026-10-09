/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolAdapter, ToolAdapterInvocation } from './registry.js';

export type FnHandler = (
  args: Record<string, unknown>
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

/**
 * Adapter for `fn://<name>` targets. Users register named JS functions
 * up front; the compiler's `target: "fn://foo"` in the IR routes here.
 */
export class FnAdapter implements ToolAdapter {
  private handlers = new Map<string, FnHandler>();

  register(name: string, handler: FnHandler): void {
    this.handlers.set(name, handler);
  }

  async invoke({
    target,
    args,
  }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
    const name = target.slice('fn://'.length);
    const fn = this.handlers.get(name);
    if (!fn) throw new Error(`No fn handler registered for "${target}"`);
    const result = await fn(args);
    return (result ?? {}) as Record<string, unknown>;
  }
}
