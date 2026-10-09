/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  LOG_LEVEL_SEVERITY,
  type LogLevel,
  type LogRecord,
  type LogTransport,
} from './types.js';

/** Context bound to a logger and merged into every record it emits. */
export interface LogContext {
  component?: string;
  runId?: string;
  sessionId?: string;
  fields?: Record<string, unknown>;
}

export interface LoggerOptions {
  /** Minimum level emitted; quieter levels are dropped. Default `info`. */
  level?: LogLevel;
  /** Sinks records are written to. Default: none (a silent logger). */
  transports?: LogTransport[];
  /** Bound context merged into every record. */
  context?: LogContext;
  /** Injectable clock (defaults to `Date.now`) for deterministic tests. */
  now?: () => number;
}

/**
 * Component-scoped structured logger with `runId`/`sessionId` correlation and
 * pluggable transports. Use {@link Logger.child} to derive a scoped logger that
 * inherits transports + level but layers on more context — e.g. the runtime
 * creates a child per turn bound to that turn's `runId`.
 *
 * A logger with no transports is a no-op, so the runtime can always log without
 * a caller having to opt in.
 */
export class Logger {
  private readonly level: LogLevel;
  private readonly threshold: number;
  private readonly transports: LogTransport[];
  private readonly context: LogContext;
  private readonly now: () => number;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.threshold = LOG_LEVEL_SEVERITY[this.level];
    this.transports = options.transports ?? [];
    this.context = options.context ?? {};
    this.now = options.now ?? Date.now;
  }

  /** Derive a logger that inherits config and layers on more context. */
  child(context: LogContext): Logger {
    return new Logger({
      level: this.level,
      transports: this.transports,
      now: this.now,
      context: {
        component: context.component ?? this.context.component,
        runId: context.runId ?? this.context.runId,
        sessionId: context.sessionId ?? this.context.sessionId,
        fields:
          context.fields || this.context.fields
            ? { ...this.context.fields, ...context.fields }
            : undefined,
      },
    });
  }

  trace(message: string, fields?: Record<string, unknown>): void {
    this.log('trace', message, fields);
  }
  debug(message: string, fields?: Record<string, unknown>): void {
    this.log('debug', message, fields);
  }
  info(message: string, fields?: Record<string, unknown>): void {
    this.log('info', message, fields);
  }
  warn(message: string, fields?: Record<string, unknown>): void {
    this.log('warn', message, fields);
  }
  error(message: string, fields?: Record<string, unknown>): void {
    this.log('error', message, fields);
  }

  /** True when a record at `level` would be emitted (for guarding hot paths). */
  isEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= this.threshold;
  }

  log(
    level: LogLevel,
    message: string,
    fields?: Record<string, unknown>
  ): void {
    if (LOG_LEVEL_SEVERITY[level] < this.threshold) return;
    if (this.transports.length === 0) return;

    const merged =
      fields || this.context.fields
        ? { ...this.context.fields, ...fields }
        : undefined;
    const record: LogRecord = {
      timestamp: this.now(),
      level,
      component: this.context.component ?? 'app',
      message,
      runId: this.context.runId,
      sessionId: this.context.sessionId,
      fields: merged,
    };
    for (const transport of this.transports) {
      transport.write(record);
    }
  }

  async flush(): Promise<void> {
    await Promise.all(this.transports.map(t => Promise.resolve(t.flush?.())));
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      this.transports.map(t => Promise.resolve(t.shutdown?.()))
    );
  }
}

/** A shared silent logger for defaults; emits nothing (no transports). */
export const NOOP_LOGGER = new Logger();
