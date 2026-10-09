/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  Logger,
  MemoryLogTransport,
  LOG_LEVEL_SEVERITY,
  type LogRecord,
} from '../src/logger/index.js';

/** A transport that records every write for assertions. */
function capturing(): {
  transport: { write(r: LogRecord): void };
  records: LogRecord[];
} {
  const records: LogRecord[] = [];
  return { transport: { write: r => records.push(r) }, records };
}

// A deterministic clock so timestamps are assertable.
let tick = 1000;
const clock = () => tick++;

describe('Logger', () => {
  it('emits records at or above the configured level', () => {
    const { transport, records } = capturing();
    const log = new Logger({
      level: 'info',
      transports: [transport],
      context: { component: 'test' },
      now: clock,
    });

    log.trace('nope');
    log.debug('nope');
    log.info('yes');
    log.warn('yes');
    log.error('yes');

    expect(records.map(r => r.level)).toEqual(['info', 'warn', 'error']);
    expect(records[0].component).toBe('test');
    expect(records.every(r => typeof r.timestamp === 'number')).toBe(true);
  });

  it('is a no-op when no transports are configured', () => {
    const log = new Logger({ level: 'trace' });
    expect(() => log.info('nothing')).not.toThrow();
    expect(log.isEnabled('trace')).toBe(true);
  });

  it('merges bound context and per-call fields', () => {
    const { transport, records } = capturing();
    const log = new Logger({
      level: 'debug',
      transports: [transport],
      context: { component: 'runtime', fields: { a: 1 } },
    });

    log.info('hi', { b: 2 });

    expect(records[0].fields).toEqual({ a: 1, b: 2 });
    expect(records[0].component).toBe('runtime');
  });

  it('child() inherits config and layers on context', () => {
    const { transport, records } = capturing();
    const root = new Logger({
      level: 'info',
      transports: [transport],
      context: { component: 'server', fields: { app: 'x' } },
    });

    const child = root.child({
      component: 'server.turn',
      runId: 'run-1',
      sessionId: 'sess-1',
      fields: { node: 'main' },
    });
    child.info('turn started');

    const rec = records[0];
    expect(rec.component).toBe('server.turn');
    expect(rec.runId).toBe('run-1');
    expect(rec.sessionId).toBe('sess-1');
    expect(rec.fields).toEqual({ app: 'x', node: 'main' });
  });

  it('isEnabled reflects the threshold', () => {
    const log = new Logger({ level: 'warn' });
    expect(log.isEnabled('info')).toBe(false);
    expect(log.isEnabled('warn')).toBe(true);
    expect(log.isEnabled('error')).toBe(true);
  });
});

describe('MemoryLogTransport', () => {
  function makeLogger(capacity?: number) {
    const transport = new MemoryLogTransport(capacity ? { capacity } : {});
    const log = new Logger({
      level: 'trace',
      transports: [transport],
      context: { component: 'runtime' },
      now: clock,
    });
    return { transport, log };
  }

  it('retains records and returns them newest-first', () => {
    const { transport, log } = makeLogger();
    log.info('first');
    log.info('second');
    const out = transport.query();
    expect(out.map(r => r.message)).toEqual(['second', 'first']);
  });

  it('bounds retention to capacity (ring buffer)', () => {
    const { transport, log } = makeLogger(3);
    for (let i = 0; i < 10; i++) log.info(`m${i}`);
    expect(transport.size).toBe(3);
    expect(transport.query().map(r => r.message)).toEqual(['m9', 'm8', 'm7']);
  });

  it('filters by sessionId, runId, component prefix, and severity', () => {
    const transport = new MemoryLogTransport();
    const base = new Logger({
      level: 'trace',
      transports: [transport],
      context: { component: 'runtime' },
      now: clock,
    });

    base.child({ sessionId: 's1', runId: 'r1' }).info('a');
    base.child({ sessionId: 's2', runId: 'r2' }).warn('b');
    base.child({ component: 'server.http', sessionId: 's1' }).error('c');

    expect(transport.query({ sessionId: 's1' }).map(r => r.message)).toEqual([
      'c',
      'a',
    ]);
    expect(transport.query({ runId: 'r2' }).map(r => r.message)).toEqual(['b']);
    expect(
      transport.query({ component: 'server' }).map(r => r.message)
    ).toEqual(['c']);
    expect(
      transport
        .query({ minSeverity: LOG_LEVEL_SEVERITY.warn })
        .map(r => r.message)
        .sort()
    ).toEqual(['b', 'c']);
  });

  it('honors the query limit', () => {
    const { transport, log } = makeLogger();
    for (let i = 0; i < 5; i++) log.info(`m${i}`);
    expect(transport.query({ limit: 2 }).map(r => r.message)).toEqual([
      'm4',
      'm3',
    ]);
  });
});
