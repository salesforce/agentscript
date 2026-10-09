/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Span, SpanExporter, SpanStatus } from './types.js';
import { generateTraceId, generateSpanId } from './ids.js';

/**
 * Tracing context that manages a tree of spans for a single trace.
 *
 * The sequential reasoning loop nests spans LIFO via `startSpan`/`endSpan` and
 * a stack tracks the "current" span. Parallel dispatch runs N concurrent
 * children that share one parent — those use `startChildSpan` (off-stack) and
 * close via `endSpanById`, so concurrent siblings never cross-pop each other.
 *
 * Completed spans buffer internally until `flush()` or `drainAll()`.
 */
export class TracingContext {
  private readonly traceId: string;
  private readonly stack: Span[] = [];
  private readonly active: Map<string, Span> = new Map();
  private readonly completed: Span[] = [];
  private readonly exporter: SpanExporter | undefined;

  constructor(opts?: { traceId?: string; exporter?: SpanExporter }) {
    this.traceId = opts?.traceId ?? generateTraceId();
    this.exporter = opts?.exporter;
  }

  getTraceId(): string {
    return this.traceId;
  }

  /** The currently-active (top of stack) span, or undefined if empty. */
  current(): Span | undefined {
    return this.stack[this.stack.length - 1];
  }

  /**
   * Start a new sequential child span. The current top-of-stack span becomes
   * the parent. The new span goes on the stack and is closed by `endSpan()`.
   */
  startSpan(name: string, attributes?: Record<string, unknown>): Span {
    const parent = this.current();
    const span: Span = {
      name,
      traceId: this.traceId,
      spanId: generateSpanId(),
      parentSpanId: parent?.spanId,
      startTime: Date.now(),
      status: 'unset',
      attributes: attributes ?? {},
      events: [],
    };
    this.stack.push(span);
    this.active.set(span.spanId, span);
    return span;
  }

  /**
   * End the current (top of stack) span. Sets its endTime and status, then
   * moves it to the completed buffer.
   */
  endSpan(status?: SpanStatus): Span | undefined {
    const span = this.stack.pop();
    if (!span) return undefined;
    this.finalize(span, status);
    return span;
  }

  /**
   * End a specific span by id — required for off-stack spans started via
   * `startChildSpan`, and for closing the parent of a parallel batch from a
   * known spanId rather than relying on stack position.
   */
  endSpanById(spanId: string, status?: SpanStatus): Span | undefined {
    const span = this.active.get(spanId);
    if (!span) return undefined;
    const idx = this.stack.lastIndexOf(span);
    if (idx >= 0) this.stack.splice(idx, 1);
    this.finalize(span, status);
    return span;
  }

  private finalize(span: Span, status?: SpanStatus): void {
    span.endTime = Date.now();
    span.status = status ?? 'ok';
    this.active.delete(span.spanId);
    this.completed.push(span);
  }

  /**
   * End every still-active span with the given status (used on abort/error).
   * Drains both stacked and off-stack spans.
   */
  drainAll(status: SpanStatus = 'error'): Span[] {
    const drained: Span[] = [];
    for (const span of Array.from(this.active.values())) {
      this.endSpanById(span.spanId, status);
      drained.push(span);
    }
    return drained;
  }

  /** Flush completed spans to the exporter (if configured). */
  async flush(): Promise<Span[]> {
    const spans = [...this.completed];
    this.completed.length = 0;
    if (this.exporter && spans.length > 0) {
      await this.exporter.export(spans);
    }
    return spans;
  }

  /**
   * Start an off-stack child of an explicit parent. Use for siblings that may
   * run concurrently (parallel tool dispatch). Close with `endSpanById`.
   */
  startChildSpan(
    parentSpanId: string,
    name: string,
    attributes?: Record<string, unknown>
  ): Span {
    const span: Span = {
      name,
      traceId: this.traceId,
      spanId: generateSpanId(),
      parentSpanId,
      startTime: Date.now(),
      status: 'unset',
      attributes: attributes ?? {},
      events: [],
    };
    this.active.set(span.spanId, span);
    return span;
  }

  /** Get completed spans without flushing. */
  getCompleted(): ReadonlyArray<Span> {
    return this.completed;
  }

  /** True if all spans have been ended. */
  isEmpty(): boolean {
    return this.active.size === 0;
  }
}
