/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export type SpanStatus = 'ok' | 'error' | 'unset';

export interface SpanEvent {
  name: string;
  timestamp: number;
  attributes?: Record<string, unknown>;
}

export interface Span {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number;
  endTime?: number;
  status: SpanStatus;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

/**
 * An exporter receives completed spans for processing (e.g. sending to a
 * backend, logging to the console, or accumulating in memory for testing).
 */
export interface SpanExporter {
  export(spans: Span[]): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

/**
 * Fans out spans to multiple exporters.
 */
export class MultiSpanExporter implements SpanExporter {
  constructor(private readonly exporters: SpanExporter[]) {}

  async export(spans: Span[]): Promise<void> {
    const results = this.exporters.map(e => e.export(spans));
    await Promise.all(
      results.map(r => (r instanceof Promise ? r : Promise.resolve(r)))
    );
  }

  async shutdown(): Promise<void> {
    const results = this.exporters.map(e =>
      e.shutdown ? e.shutdown() : undefined
    );
    await Promise.all(
      results.map(r => (r instanceof Promise ? r : Promise.resolve(r)))
    );
  }
}
