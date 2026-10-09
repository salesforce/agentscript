/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Logger } from '../src/logger/logger.js';
import {
  installCrashHandlers,
  uninstallCrashHandlers,
} from '../src/logger/crash.js';

describe('crash handlers', () => {
  let logs: Array<{ level: string; message: string; fields?: any }>;
  let flushCalled: number;
  let logger: Logger;

  beforeEach(() => {
    logs = [];
    flushCalled = 0;

    // Create a logger that captures logs in memory.
    logger = new Logger({
      transports: [
        {
          write: record => {
            logs.push({
              level: record.level,
              message: record.message,
              fields: record.fields,
            });
          },
        },
      ],
    });
  });

  afterEach(() => {
    uninstallCrashHandlers();
  });

  it('installs and uninstalls handlers', () => {
    const initialUncaught = process.listenerCount('uncaughtExceptionMonitor');
    const initialRejection = process.listenerCount('unhandledRejection');

    const uninstall = installCrashHandlers({ logger });
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(
      initialUncaught + 1
    );
    expect(process.listenerCount('unhandledRejection')).toBe(
      initialRejection + 1
    );

    uninstall();
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(
      initialUncaught
    );
    expect(process.listenerCount('unhandledRejection')).toBe(initialRejection);
  });

  it('logs uncaught exceptions', () => {
    installCrashHandlers({
      logger,
      flushSync: () => {
        flushCalled++;
      },
    });

    const error = new Error('Test error');
    process.emit('uncaughtExceptionMonitor', error, 'uncaughtException');

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].message).toBe('Uncaught exception');
    expect(logs[0].fields.error).toBe(error);
    expect(logs[0].fields.origin).toBe('uncaughtException');
    expect(flushCalled).toBe(1);
  });

  it('logs unhandled rejections', () => {
    // Add a second listener to prevent the handler from rethrowing.
    const noop = () => {};
    process.on('unhandledRejection', noop);

    installCrashHandlers({
      logger,
      flushSync: () => {
        flushCalled++;
      },
    });

    const reason = new Error('Rejection reason');
    // Emit directly; don't actually throw to avoid crashing the test runner.
    // Create a promise that's already resolved to avoid unhandled rejection warnings.
    const dummyPromise = Promise.resolve().then(() => {
      throw reason;
    });
    // Suppress the rejection.
    dummyPromise.catch(() => {});
    process.emit('unhandledRejection', reason, dummyPromise);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe('error');
    expect(logs[0].message).toBe('Unhandled rejection');
    expect(logs[0].fields.error).toBe(reason);
    expect(flushCalled).toBe(1);

    // Clean up the noop listener.
    process.off('unhandledRejection', noop);
  });

  it('deduplicates rejection followed by uncaught exception', () => {
    // Add a second listener to prevent the handler from rethrowing.
    const noop = () => {};
    process.on('unhandledRejection', noop);

    installCrashHandlers({
      logger,
      flushSync: () => {
        flushCalled++;
      },
    });

    const error = new Error('Duplicate error');

    // Simulate a rejection that will also fire uncaughtExceptionMonitor.
    // Create a promise that's already resolved to avoid unhandled rejection warnings.
    const dummyPromise = Promise.resolve().then(() => {
      throw error;
    });
    // Suppress the rejection.
    dummyPromise.catch(() => {});
    process.emit('unhandledRejection', error, dummyPromise);
    process.emit('uncaughtExceptionMonitor', error, 'uncaughtException');

    // Should only log once (rejection), and skip the uncaughtExceptionMonitor
    // because it was already recorded.
    expect(logs).toHaveLength(1);
    expect(logs[0].message).toBe('Unhandled rejection');
    // flushSync called once for the rejection, skipped for the monitor.
    expect(flushCalled).toBe(1);

    // Clean up the noop listener.
    process.off('unhandledRejection', noop);
  });

  it('calls onCrash callback', () => {
    const crashes: Array<{ error: unknown; source: string }> = [];

    installCrashHandlers({
      logger,
      onCrash: (error, source) => {
        crashes.push({ error, source });
      },
    });

    const error = new Error('Crash test');
    process.emit('uncaughtExceptionMonitor', error, 'uncaughtException');

    expect(crashes).toHaveLength(1);
    expect(crashes[0].error).toBe(error);
    expect(crashes[0].source).toBe('uncaughtException');
  });

  it('is idempotent (multiple installs replace)', () => {
    const initialUncaught = process.listenerCount('uncaughtExceptionMonitor');
    const initialRejection = process.listenerCount('unhandledRejection');

    installCrashHandlers({ logger });
    installCrashHandlers({ logger });
    installCrashHandlers({ logger });

    // Should only add one set of listeners.
    expect(process.listenerCount('uncaughtExceptionMonitor')).toBe(
      initialUncaught + 1
    );
    expect(process.listenerCount('unhandledRejection')).toBe(
      initialRejection + 1
    );
  });

  it('handles uninstall when not installed', () => {
    // Should not throw.
    expect(() => uninstallCrashHandlers()).not.toThrow();
  });
});
