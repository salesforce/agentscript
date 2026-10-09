/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LOG_LEVEL_SEVERITY,
  type LogRecord,
  type LogTransport,
} from './types.js';
import { redact } from './redact.js';

/**
 * Writes each record as a single JSON line to the console, routing `warn`/
 * `error` to `console.error` and everything else to `console.log`. Matches the
 * one-JSON-object-per-line shape the server already emits for HTTP logs.
 */
export class ConsoleLogTransport implements LogTransport {
  write(record: LogRecord): void {
    const redacted = redact(record);
    const line = JSON.stringify(redacted);
    if (record.level === 'warn' || record.level === 'error') {
      console.error(line);
    } else {
      console.log(line);
    }
  }
}

export interface MemoryLogTransportOptions {
  /** Maximum records retained; older records are dropped (ring buffer). */
  capacity?: number;
}

/**
 * Retains the most recent records in a bounded ring buffer for querying (the
 * `/v1/logs` route + playground Logs tab read from this). Bounded so a
 * long-running dev server can't grow memory without limit.
 */
export class MemoryLogTransport implements LogTransport {
  private readonly capacity: number;
  private records: LogRecord[] = [];

  constructor(options: MemoryLogTransportOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 1000);
  }

  write(record: LogRecord): void {
    const redacted = redact(record);
    this.records.push(redacted);
    if (this.records.length > this.capacity) {
      // Drop the oldest overflow in one splice rather than shifting per-write.
      this.records.splice(0, this.records.length - this.capacity);
    }
  }

  /**
   * Return retained records, newest first, optionally filtered. `limit` caps
   * the number returned after filtering.
   */
  query(filter: LogQuery = {}): LogRecord[] {
    const minSeverity = filter.minSeverity ?? 0;
    let out = this.records;
    if (
      filter.sessionId !== undefined ||
      filter.runId !== undefined ||
      filter.component !== undefined ||
      minSeverity > 0
    ) {
      out = out.filter(r => {
        if (filter.sessionId !== undefined && r.sessionId !== filter.sessionId)
          return false;
        if (filter.runId !== undefined && r.runId !== filter.runId)
          return false;
        if (
          filter.component !== undefined &&
          !r.component.startsWith(filter.component)
        )
          return false;
        if (minSeverity > 0 && LOG_LEVEL_SEVERITY[r.level] < minSeverity)
          return false;
        return true;
      });
    }
    // Newest first.
    const reversed = [...out].reverse();
    return filter.limit ? reversed.slice(0, filter.limit) : reversed;
  }

  /** Number of retained records. */
  get size(): number {
    return this.records.length;
  }

  reset(): void {
    this.records = [];
  }
}

export interface LogQuery {
  sessionId?: string;
  runId?: string;
  /** Component prefix match (e.g. `runtime` matches `runtime.turn`). */
  component?: string;
  /** Only records with severity >= this numeric value (see LOG_LEVEL_SEVERITY). */
  minSeverity?: number;
  limit?: number;
}
