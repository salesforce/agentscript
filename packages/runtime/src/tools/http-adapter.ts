/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolAdapter, ToolAdapterInvocation } from './registry.js';

export interface HttpAdapterOptions {
  headers?: Record<string, string>;
  method?: 'POST' | 'PUT' | 'PATCH';
}

/**
 * Adapter for `http://` and `https://` targets. POSTs the args as JSON and
 * expects a JSON object back; that object is the tool result and feeds
 * `state_updates` via the `result.<field>` references in the IR.
 */
export class HttpAdapter implements ToolAdapter {
  constructor(private readonly opts: HttpAdapterOptions = {}) {}

  async invoke({
    target,
    args,
    signal,
  }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
    const res = await fetch(target, {
      method: this.opts.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.headers ?? {}),
      },
      body: JSON.stringify(args),
      signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP tool "${target}" returned ${res.status}`);
    }
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      return (await res.json()) as Record<string, unknown>;
    }
    return { body: await res.text() };
  }
}
