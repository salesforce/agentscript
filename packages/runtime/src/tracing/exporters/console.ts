/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, SpanExporter } from '../types.js';

/**
 * Logs spans to the console for debugging.
 */
export class ConsoleSpanExporter implements SpanExporter {
  export(spans: Span[]): void {
    for (const span of spans) {
      const duration = span.endTime
        ? `${span.endTime - span.startTime}ms`
        : 'open';
      console.warn(
        `[SPAN] ${span.name} (${span.spanId}) trace=${span.traceId} ` +
          `parent=${span.parentSpanId ?? 'root'} status=${span.status} ` +
          `duration=${duration}`
      );
    }
  }

  shutdown(): void {
    // No-op.
  }
}
