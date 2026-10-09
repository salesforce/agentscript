/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, SpanExporter } from '../types.js';

/**
 * In-memory span exporter that accumulates spans for testing/inspection.
 */
export class InMemorySpanExporter implements SpanExporter {
  private _spans: Span[] = [];

  export(spans: Span[]): void {
    this._spans.push(...spans);
  }

  /** All exported spans so far. */
  getSpans(): ReadonlyArray<Span> {
    return this._spans;
  }

  /** Clear accumulated spans. */
  reset(): void {
    this._spans = [];
  }

  shutdown(): void {
    // No-op for in-memory exporter.
  }
}
