/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Run `tasks` through `worker` with at most `maxConcurrency` in flight at once,
 * returning results in INPUT order (not completion order). A worker that
 * rejects does not sink the batch — its slot is freed and the rejection is
 * re-surfaced in that task's result position, so the caller decides how to
 * record a failure.
 *
 * This is the swarm's concurrency governor, distilled to a passive primitive
 * (no Runtime, no agent knowledge) so it is unit-testable. It intentionally
 * omits the reference agent's provider-rate-limit ramp/requeue machinery: we don't surface
 * per-provider 429 signals up to a batch scheduler, so a flat sliding-window
 * cap is the honest model here.
 *
 * `maxConcurrency` is clamped to at least 1; a value ≥ tasks.length runs them
 * all at once (still bounded by the JS event loop).
 */
export async function runPool<T, R>(
  tasks: readonly T[],
  maxConcurrency: number,
  worker: (task: T, index: number) => Promise<R>
): Promise<Array<{ value: R } | { error: unknown }>> {
  const results: Array<{ value: R } | { error: unknown }> = new Array(
    tasks.length
  );
  if (tasks.length === 0) return results;

  const limit = Math.max(1, Math.min(maxConcurrency, tasks.length));
  let next = 0;

  // Each worker slot pulls the next unclaimed index until the queue drains.
  const runSlot = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      try {
        results[index] = { value: await worker(tasks[index], index) };
      } catch (error) {
        results[index] = { error };
      }
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runSlot()));
  return results;
}
