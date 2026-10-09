/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  LOG_LEVELS,
  LOG_LEVEL_SEVERITY,
  type LogLevel,
  type LogRecord,
  type LogTransport,
} from './types.js';
export {
  Logger,
  NOOP_LOGGER,
  type LoggerOptions,
  type LogContext,
} from './logger.js';
export {
  ConsoleLogTransport,
  MemoryLogTransport,
  type MemoryLogTransportOptions,
  type LogQuery,
} from './transports.js';
export { redact } from './redact.js';
export {
  installCrashHandlers,
  uninstallCrashHandlers,
  type CrashHandlerOptions,
} from './crash.js';
