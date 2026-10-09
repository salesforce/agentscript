/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { cosineSimilarity } from './similarity.js';
import type {
  VectorHit,
  VectorQuery,
  VectorRecord,
  VectorStore,
} from './types.js';

/**
 * In-process cosine-similarity vector store.
 *
 * Backed by a plain Map, so it is O(n) per query — fine for dev, tests, and
 * small deployments. Records are cloned on the way in so the caller can mutate
 * their input arrays without corrupting the store.
 */
export class MemoryVectorStore implements VectorStore {
  private readonly records = new Map<string, VectorRecord>();

  async upsert(records: VectorRecord[]): Promise<void> {
    for (const record of records) {
      this.records.set(record.id, {
        id: record.id,
        vector: [...record.vector],
        metadata: { ...record.metadata },
      });
    }
  }

  async query(query: VectorQuery): Promise<VectorHit[]> {
    const topK = query.topK ?? 5;
    const minScore = query.minScore ?? -Infinity;

    const hits: VectorHit[] = [];
    for (const record of this.records.values()) {
      if (query.filter && !matchesFilter(record.metadata, query.filter)) {
        continue;
      }
      const score = cosineSimilarity(query.vector, record.vector);
      if (score < minScore) continue;
      hits.push({ id: record.id, score, metadata: { ...record.metadata } });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) this.records.delete(id);
  }

  async deleteByFilter(filter: Record<string, unknown>): Promise<number> {
    let removed = 0;
    for (const [id, record] of this.records) {
      if (matchesFilter(record.metadata, filter)) {
        this.records.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  async size(): Promise<number> {
    return this.records.size;
  }
}

/** Exact-match: every key in `filter` must equal the record's metadata value. */
function matchesFilter(
  metadata: Record<string, unknown>,
  filter: Record<string, unknown>
): boolean {
  for (const [key, value] of Object.entries(filter)) {
    if (metadata[key] !== value) return false;
  }
  return true;
}
