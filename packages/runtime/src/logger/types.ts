/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Severity levels, ordered from most to least verbose. The numeric values are
 * used for threshold comparisons (a logger set to `info` emits `info`+`warn`+
 * `error`, dropping `debug`/`trace`).
 */
export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/** Numeric severity for a level; higher is more severe. */
export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
};

/**
 * A single structured log entry. `component` scopes the source (e.g.
 * `runtime.turn`, `server.http`); `runId`/`sessionId` correlate a record to a
 * turn or a session so the playground Logs tab can filter by them.
 */
export interface LogRecord {
  timestamp: number;
  level: LogLevel;
  component: string;
  message: string;
  /** Correlation id for a single agent turn/run, when known. */
  runId?: string;
  /** Owning session id, when known. */
  sessionId?: string;
  /** Arbitrary structured fields. */
  fields?: Record<string, unknown>;
}

/**
 * A sink for log records. Implementations forward records to the console, a
 * ring buffer, a file, or a remote collector. `flush`/`shutdown` are optional.
 */
export interface LogTransport {
  write(record: LogRecord): void;
  flush?(): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}
