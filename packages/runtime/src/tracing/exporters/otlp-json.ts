/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, SpanExporter } from '../types.js';

export interface OtlpJsonSpanExporterOptions {
  /** The OTLP endpoint URL. */
  url: string;
  /** Optional headers (e.g. for auth). */
  headers?: Record<string, string>;
}

/**
 * Exports spans as OTLP JSON to an HTTP endpoint.
 */
export class OtlpJsonSpanExporter implements SpanExporter {
  constructor(private readonly opts: OtlpJsonSpanExporterOptions) {}

  async export(spans: Span[]): Promise<void> {
    const body = JSON.stringify({
      resourceSpans: [
        {
          scopeSpans: [
            {
              spans: spans.map(s => ({
                traceId: s.traceId,
                spanId: s.spanId,
                parentSpanId: s.parentSpanId,
                name: s.name,
                startTimeUnixNano: s.startTime * 1_000_000,
                endTimeUnixNano: (s.endTime ?? s.startTime) * 1_000_000,
                status: { code: s.status === 'error' ? 2 : 1 },
                attributes: Object.entries(s.attributes).map(([k, v]) => ({
                  key: k,
                  value: { stringValue: String(v) },
                })),
              })),
            },
          ],
        },
      ],
    });

    await fetch(this.opts.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.opts.headers,
      },
      body,
    });
  }

  shutdown(): void {
    // No-op.
  }
}
