/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Logger } from './logger.js';

export interface CrashHandlerOptions {
  logger: Logger;
  /** Called before process exits to flush logs to disk. */
  flushSync?: () => void;
  /** Optional callback invoked when a crash is detected (before flush). */
  onCrash?: (error: unknown, source: string) => void;
}

let installed = false;
let installedUncaughtHandler:
  | ((error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void)
  | null = null;
let installedRejectionHandler: ((reason: unknown) => void) | null = null;

/**
 * Install global crash handlers that log uncaught exceptions and unhandled
 * rejections, then flush logs to disk before exiting. Idempotent: multiple
 * calls replace rather than stack handlers.
 *
 * Deduplicates: a single error that fires both `uncaughtExceptionMonitor` and
 * `uncaughtException` will only be logged once.
 *
 * @returns An `uninstall()` function for cleanup (primarily for tests).
 */
export function installCrashHandlers(options: CrashHandlerOptions): () => void {
  // If already installed, uninstall first to avoid stacking handlers.
  if (installed) {
    uninstallCrashHandlers();
  }

  const { logger, flushSync, onCrash } = options;

  // Track rejections that have been logged so we don't double-report when
  // they bubble through both `unhandledRejection` and `uncaughtExceptionMonitor`.
  const recordedRejections = new Set<unknown>();

  installedUncaughtHandler = (error, origin) => {
    // Skip if this error was already logged via unhandledRejection.
    if (recordedRejections.has(error)) {
      return;
    }

    // Log the crash.
    logger.error('Uncaught exception', { error, origin });
    onCrash?.(error, origin);

    // Flush logs synchronously before the process exits.
    flushSync?.();
  };

  installedRejectionHandler = (reason: unknown) => {
    // Log the rejection.
    logger.error('Unhandled rejection', { error: reason });
    onCrash?.(reason, 'unhandledRejection');
    recordedRejections.add(reason);

    // Flush logs synchronously.
    flushSync?.();

    // Check if we're the sole listener. If so, we need to rethrow to preserve
    // Node's default crash behavior. Otherwise, another handler (e.g., the TUI)
    // will handle the exit.
    const soleListener = process.listenerCount('unhandledRejection') === 1;

    // If we're the only listener, rethrow to let Node crash the process.
    // This ensures uncaughtExceptionMonitor fires, but we dedupe it above.
    if (soleListener) {
      throw reason;
    }
  };

  // Register listeners.
  process.on('uncaughtExceptionMonitor', installedUncaughtHandler);
  process.on('unhandledRejection', installedRejectionHandler);

  installed = true;

  return uninstallCrashHandlers;
}

/**
 * Uninstall crash handlers. Safe to call even if no handlers are installed.
 */
export function uninstallCrashHandlers(): void {
  if (!installed) return;

  if (installedUncaughtHandler !== null) {
    process.off('uncaughtExceptionMonitor', installedUncaughtHandler);
    installedUncaughtHandler = null;
  }
  if (installedRejectionHandler !== null) {
    process.off('unhandledRejection', installedRejectionHandler);
    installedRejectionHandler = null;
  }

  installed = false;
}
