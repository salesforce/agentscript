/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { MemoryVectorStore } from '../src/memory-vector-store.js';
import { runVectorStoreContract } from './vector-store-contract.js';

// The reference implementation must satisfy the shared contract.
runVectorStoreContract('MemoryVectorStore', () => new MemoryVectorStore());

// Behaviour specific to the in-process store, not part of the shared contract.
describe('MemoryVectorStore specifics', () => {
  it('clones records so caller mutation does not corrupt the store', async () => {
    const store = new MemoryVectorStore();
    const vector = [1, 0, 0];
    await store.upsert([{ id: 'x', vector, metadata: { k: 1 } }]);
    vector[0] = 999; // mutate the caller's array after upsert
    const hits = await store.query({ vector: [1, 0, 0], topK: 1 });
    expect(hits[0].score).toBeCloseTo(1, 10);
  });
});
