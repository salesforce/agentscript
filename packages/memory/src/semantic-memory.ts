/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { MemoryVectorStore } from './memory-vector-store.js';
import type { Embedder, VectorStore } from './types.js';

/** A remembered message/fact, scoped to a thread and (optionally) a resource. */
export interface MemoryEntry {
  id: string;
  text: string;
  /** Conversation/thread this entry belongs to. */
  threadId: string;
  /** Owner (user/agent/tenant) the thread belongs to; enables cross-thread recall. */
  resourceId?: string;
  role?: 'user' | 'assistant' | 'system' | 'tool';
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

/** A recalled entry plus its similarity to the query. */
export interface RecallHit extends MemoryEntry {
  score: number;
}

export interface RecallOptions {
  /** Restrict recall to a single thread. */
  threadId?: string;
  /** Restrict recall to a single resource (across all its threads). */
  resourceId?: string;
  topK?: number;
  minScore?: number;
}

export interface SemanticMemoryOptions {
  embedder: Embedder;
  /** Defaults to an in-process {@link MemoryVectorStore}. */
  store?: VectorStore;
  /** Default number of hits returned by {@link SemanticMemory.recall}. */
  defaultTopK?: number;
}

/**
 * Semantic recall over remembered entries.
 *
 * `remember()` embeds an entry's text and upserts it; `recall()` embeds a query
 * and returns the nearest entries, optionally scoped to a thread or resource.
 * Scoping is enforced through the vector store's metadata filter, so a thread's
 * memories never leak into an unrelated thread's recall.
 */
export class SemanticMemory {
  private readonly embedder: Embedder;
  private readonly store: VectorStore;
  private readonly defaultTopK: number;

  constructor(options: SemanticMemoryOptions) {
    this.embedder = options.embedder;
    this.store = options.store ?? new MemoryVectorStore();
    this.defaultTopK = options.defaultTopK ?? 5;
  }

  /** Embed and persist one entry. */
  async remember(entry: MemoryEntry): Promise<void> {
    await this.rememberMany([entry]);
  }

  /** Embed and persist a batch of entries in a single embed call. */
  async rememberMany(entries: MemoryEntry[]): Promise<void> {
    if (entries.length === 0) return;
    const vectors = await this.embedder.embed(entries.map(e => e.text));
    await this.store.upsert(
      entries.map((entry, i) => ({
        id: entry.id,
        vector: vectors[i],
        metadata: toMetadata(entry),
      }))
    );
  }

  /** Recall the entries most similar to `query`, newest-similarity-first. */
  async recall(
    query: string,
    options: RecallOptions = {}
  ): Promise<RecallHit[]> {
    const [vector] = await this.embedder.embed([query]);
    const filter: Record<string, unknown> = {};
    if (options.threadId) filter.threadId = options.threadId;
    if (options.resourceId) filter.resourceId = options.resourceId;

    const hits = await this.store.query({
      vector,
      topK: options.topK ?? this.defaultTopK,
      minScore: options.minScore,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    });

    return hits.map(hit => ({
      ...fromMetadata(hit.metadata),
      id: hit.id,
      score: hit.score,
    }));
  }

  /** Forget every entry in a thread (e.g. on session reset). */
  async forgetThread(threadId: string): Promise<number> {
    return this.store.deleteByFilter({ threadId });
  }

  /** Forget specific entries by id. */
  async forget(ids: string[]): Promise<void> {
    await this.store.delete(ids);
  }
}

function toMetadata(entry: MemoryEntry): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    ...entry.metadata,
    text: entry.text,
    threadId: entry.threadId,
  };
  if (entry.resourceId !== undefined) metadata.resourceId = entry.resourceId;
  if (entry.role !== undefined) metadata.role = entry.role;
  if (entry.createdAt !== undefined) metadata.createdAt = entry.createdAt;
  return metadata;
}

function fromMetadata(metadata: Record<string, unknown>): MemoryEntry {
  const { text, threadId, resourceId, role, createdAt, ...rest } = metadata;
  return {
    id: '', // overwritten by the caller with the hit id
    text: typeof text === 'string' ? text : '',
    threadId: typeof threadId === 'string' ? threadId : '',
    resourceId: typeof resourceId === 'string' ? resourceId : undefined,
    role: role as MemoryEntry['role'],
    createdAt: typeof createdAt === 'string' ? createdAt : undefined,
    metadata: Object.keys(rest).length > 0 ? rest : undefined,
  };
}
