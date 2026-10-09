/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { VectorStore } from '../src/types.js';

/**
 * Behavioural contract every {@link VectorStore} implementation must satisfy.
 *
 * Hosted here in `@agentscript/memory` (not in a pg package) so the
 * dependency arrow points the correct way: downstream stores like
 * `@sf-agentscript/memory-pg` depend on memory and import this contract for
 * their own tests, rather than memory depending on them. The in-process
 * {@link import('../src/memory-vector-store.js').MemoryVectorStore} is the
 * reference implementation and runs this same suite.
 *
 * @param label   name shown in the `describe` block
 * @param makeStore factory returning a FRESH, EMPTY store per call (so each
 *                  `it` is isolated — for pg this means truncating the table)
 */
export function runVectorStoreContract(
  label: string,
  makeStore: () => Promise<VectorStore> | VectorStore
): void {
  async function seeded(): Promise<VectorStore> {
    const store = await makeStore();
    await store.upsert([
      { id: 'a', vector: [1, 0, 0], metadata: { thread: 't1' } },
      { id: 'b', vector: [0.9, 0.1, 0], metadata: { thread: 't1' } },
      { id: 'c', vector: [0, 1, 0], metadata: { thread: 't2' } },
    ]);
    return store;
  }

  describe(`VectorStore contract: ${label}`, () => {
    it('returns nearest neighbours ranked by similarity', async () => {
      const store = await seeded();
      const hits = await store.query({ vector: [1, 0, 0], topK: 2 });
      expect(hits.map(h => h.id)).toEqual(['a', 'b']);
      expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
    });

    it('applies an exact-match metadata filter', async () => {
      const store = await seeded();
      const hits = await store.query({
        vector: [1, 0, 0],
        topK: 10,
        filter: { thread: 't2' },
      });
      expect(hits.map(h => h.id)).toEqual(['c']);
    });

    it('honours minScore', async () => {
      const store = await seeded();
      const hits = await store.query({
        vector: [1, 0, 0],
        topK: 10,
        minScore: 0.95,
      });
      expect(hits.map(h => h.id).sort()).toEqual(['a', 'b']);
    });

    it('upsert overwrites an existing id', async () => {
      const store = await seeded();
      await store.upsert([
        { id: 'a', vector: [0, 0, 1], metadata: { thread: 't3' } },
      ]);
      expect(await store.size()).toBe(3);
      const hits = await store.query({ vector: [0, 0, 1], topK: 1 });
      expect(hits[0].id).toBe('a');
      expect(hits[0].metadata.thread).toBe('t3');
    });

    it('deletes by id, ignoring ids that do not exist', async () => {
      const store = await seeded();
      await store.delete(['a', 'missing']);
      expect(await store.size()).toBe(2);
    });

    it('deletes by filter and reports the count removed', async () => {
      const store = await seeded();
      const removed = await store.deleteByFilter({ thread: 't1' });
      expect(removed).toBe(2);
      expect(await store.size()).toBe(1);
    });
  });
}
