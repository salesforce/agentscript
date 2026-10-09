/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Core memory primitives for AgentScript.
 *
 * Two abstractions carry the whole package:
 *  - {@link Embedder} turns text into a dense vector. Live implementations wrap
 *    a provider (OpenAI, etc.); the bundled {@link HashEmbedder} is deterministic
 *    and offline so the loop runs with no API key.
 *  - {@link VectorStore} persists `{id, vector, metadata}` records and answers
 *    nearest-neighbour queries. The bundled {@link MemoryVectorStore} is an
 *    in-process cosine-similarity store; the interface leaves room for pgvector
 *    / external stores later.
 *
 * Higher-level features (semantic recall, working memory, threads) are built on
 * top of these two interfaces so a caller can swap either without touching the
 * recall logic.
 */

/** A dense embedding vector. */
export type Vector = number[];

/** Turns text into embedding vectors. */
export interface Embedder {
  /** Number of dimensions every produced vector has. */
  readonly dimensions: number;
  /** A stable identifier for the model (used to tag stored records). */
  readonly model: string;
  /** Embed a batch of texts, preserving order. */
  embed(texts: string[]): Promise<Vector[]>;
}

/** A stored vector record. */
export interface VectorRecord {
  id: string;
  vector: Vector;
  /** Arbitrary metadata carried alongside the vector (thread/resource ids, text, …). */
  metadata: Record<string, unknown>;
}

/** A single nearest-neighbour hit. */
export interface VectorHit {
  id: string;
  score: number;
  metadata: Record<string, unknown>;
}

/** Optional filter applied to a query before ranking. */
export interface VectorQuery {
  vector: Vector;
  topK?: number;
  /**
   * Exact-match metadata filter. A record matches only when every key present
   * here equals the record's metadata value for that key.
   */
  filter?: Record<string, unknown>;
  /** Drop hits whose similarity is below this threshold (0..1). */
  minScore?: number;
}

/** Persists vectors and answers nearest-neighbour queries. */
export interface VectorStore {
  upsert(records: VectorRecord[]): Promise<void>;
  query(query: VectorQuery): Promise<VectorHit[]>;
  /** Delete by id; ids that don't exist are ignored. */
  delete(ids: string[]): Promise<void>;
  /** Remove every record whose metadata matches the filter (exact-match). */
  deleteByFilter(filter: Record<string, unknown>): Promise<number>;
  /** Total record count (for tests / diagnostics). */
  size(): Promise<number>;
}
