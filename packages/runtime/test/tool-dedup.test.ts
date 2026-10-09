/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for the ToolCallDeduplicator streak machine — the pure logic
 * behind the repeated-identical-tool-call loop escape hatch. Kept Runtime-free;
 * the end-to-end wiring is exercised in tool-dedup-integration.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  ToolCallDeduplicator,
  canonicalArgs,
  __testing,
} from '../src/turn/tool-dedup.js';

const {
  REMINDER_TEXT_1,
  REMINDER_TEXT_3,
  makeReminderText2,
  REPEAT_REMINDER_1_START,
  REPEAT_REMINDER_2_START,
  REPEAT_REMINDER_3_START,
  REPEAT_FORCE_STOP_STREAK,
} = __testing;

describe('canonicalArgs', () => {
  it('produces an identical key regardless of object key order', () => {
    expect(canonicalArgs({ a: 1, b: 2 })).toBe(canonicalArgs({ b: 2, a: 1 }));
  });

  it('sorts keys recursively (nested objects too)', () => {
    expect(canonicalArgs({ outer: { y: 1, x: 2 } })).toBe(
      canonicalArgs({ outer: { x: 2, y: 1 } })
    );
  });

  it('preserves array order (arrays are positional, not sorted)', () => {
    expect(canonicalArgs([1, 2, 3])).not.toBe(canonicalArgs([3, 2, 1]));
  });

  it('falls back to String() for un-JSON-able values', () => {
    expect(canonicalArgs(undefined)).toBe('undefined');
  });
});

describe('ToolCallDeduplicator', () => {
  it('reports streak 1 and no reminder for a fresh call', () => {
    const d = new ToolCallDeduplicator();
    const r = d.note('read', { path: 'a' });
    expect(r).toEqual({
      streak: 1,
      reminder: null,
      forceStop: false,
      action: 'none',
    });
  });

  it('does not nudge until the streak reaches the first threshold', () => {
    const d = new ToolCallDeduplicator();
    for (let i = 1; i < REPEAT_REMINDER_1_START; i += 1) {
      const r = d.note('read', { path: 'a' });
      expect(r.action).toBe('none');
      expect(r.reminder).toBeNull();
    }
    const r = d.note('read', { path: 'a' });
    expect(r.streak).toBe(REPEAT_REMINDER_1_START);
    expect(r.action).toBe('r1');
    expect(r.reminder).toBe(REMINDER_TEXT_1);
    expect(r.forceStop).toBe(false);
  });

  it('escalates r1 -> r2 -> r3 -> stop at the documented thresholds', () => {
    const d = new ToolCallDeduplicator();
    const actions: string[] = [];
    for (let i = 1; i <= REPEAT_FORCE_STOP_STREAK; i += 1) {
      actions.push(d.note('grep', { q: 'x' }).action);
    }
    // Indices are 0-based; streak = index + 1.
    expect(actions[REPEAT_REMINDER_1_START - 1]).toBe('r1');
    expect(actions[REPEAT_REMINDER_2_START - 1]).toBe('r2');
    expect(actions[REPEAT_REMINDER_3_START - 1]).toBe('r3');
    expect(actions[REPEAT_FORCE_STOP_STREAK - 1]).toBe('stop');
  });

  it('force-stops with the r3 text once the ceiling is reached', () => {
    const d = new ToolCallDeduplicator();
    let last;
    for (let i = 1; i <= REPEAT_FORCE_STOP_STREAK; i += 1) {
      last = d.note('grep', { q: 'x' });
    }
    expect(last!.streak).toBe(REPEAT_FORCE_STOP_STREAK);
    expect(last!.forceStop).toBe(true);
    expect(last!.reminder).toBe(REMINDER_TEXT_3);
  });

  it('embeds the running streak count in the r2 reminder', () => {
    const d = new ToolCallDeduplicator();
    let r;
    for (let i = 1; i <= REPEAT_REMINDER_2_START; i += 1) {
      r = d.note('grep', { q: 'x' });
    }
    expect(r!.reminder).toBe(makeReminderText2(REPEAT_REMINDER_2_START));
    expect(r!.reminder).toContain(`${REPEAT_REMINDER_2_START} times in a row`);
  });

  it('resets the streak when a DIFFERENT call interrupts the run', () => {
    const d = new ToolCallDeduplicator();
    d.note('read', { path: 'a' });
    d.note('read', { path: 'a' }); // streak 2
    const other = d.note('read', { path: 'b' }); // different args -> reset
    expect(other.streak).toBe(1);
    expect(other.action).toBe('none');
  });

  it('treats key-reordered args as the SAME call (canonicalized)', () => {
    const d = new ToolCallDeduplicator();
    d.note('write', { path: 'a', body: 'x' });
    const r = d.note('write', { body: 'x', path: 'a' });
    expect(r.streak).toBe(2);
  });

  it('reset() clears the streak so a new turn starts fresh', () => {
    const d = new ToolCallDeduplicator();
    d.note('read', { path: 'a' });
    d.note('read', { path: 'a' });
    d.reset();
    const r = d.note('read', { path: 'a' });
    expect(r.streak).toBe(1);
  });

  it('exposes the documented threshold constants', () => {
    expect(REPEAT_REMINDER_1_START).toBe(3);
    expect(REPEAT_REMINDER_2_START).toBe(5);
    expect(REPEAT_REMINDER_3_START).toBe(8);
    expect(REPEAT_FORCE_STOP_STREAK).toBe(12);
  });
});
