/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for runPool — the swarm's bounded-concurrency governor. Verifies
 * the invariants the swarm relies on: results in INPUT order, at most N in
 * flight at once, and a worker rejection surfaced (not sunk) in its slot.
 */

import { describe, it, expect } from 'vitest';
import { runPool } from '../src/swarm/index.js';

/** A deferred promise + its resolve/reject, for hand-driving worker timing. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('runPool', () => {
  it('returns results in input order regardless of completion order', async () => {
    // Reverse the completion order: later items finish first.
    const results = await runPool([10, 20, 30], 3, async (ms, i) => {
      await new Promise(r => setTimeout(r, 30 - i * 10));
      return ms * 2;
    });
    expect(results).toEqual([{ value: 20 }, { value: 40 }, { value: 60 }]);
  });

  it('never runs more than maxConcurrency workers at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const tasks = Array.from({ length: 10 }, (_, i) => i);
    await runPool(tasks, 3, async n => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 5));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // actually parallel, not serialized
  });

  it('surfaces a worker rejection in that slot without sinking the batch', async () => {
    const results = await runPool([1, 2, 3], 3, async n => {
      if (n === 2) throw new Error('nope');
      return n * 10;
    });
    expect(results[0]).toEqual({ value: 10 });
    expect(results[1]).toHaveProperty('error');
    expect((results[1] as { error: unknown }).error).toBeInstanceOf(Error);
    expect(results[2]).toEqual({ value: 30 });
  });

  it('clamps maxConcurrency to at least 1', async () => {
    let peak = 0;
    let inFlight = 0;
    await runPool([1, 2, 3], 0, async n => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 2));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBe(1);
  });

  it('returns an empty array for no tasks (never invokes the worker)', async () => {
    let called = false;
    const results = await runPool([], 4, async () => {
      called = true;
      return 1;
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });

  it('drains a queue larger than the concurrency limit', async () => {
    const started: number[] = [];
    const gates = Array.from({ length: 5 }, () => deferred<void>());
    const promise = runPool([0, 1, 2, 3, 4], 2, async n => {
      started.push(n);
      await gates[n].promise;
      return n;
    });
    // Only the first 2 should have started before any gate opens.
    await new Promise(r => setTimeout(r, 5));
    expect(started).toEqual([0, 1]);
    // Open gates one at a time; each frees a slot for the next queued task.
    gates[0].resolve();
    await new Promise(r => setTimeout(r, 5));
    expect(started).toContain(2);
    gates[1].resolve();
    gates[2].resolve();
    gates[3].resolve();
    gates[4].resolve();
    const results = await promise;
    expect(results).toEqual([
      { value: 0 },
      { value: 1 },
      { value: 2 },
      { value: 3 },
      { value: 4 },
    ]);
  });
});
