/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * @agentscript/memory — embedding, vector storage, semantic recall, and
 * working memory for AgentScript agents. Offline-by-default (HashEmbedder +
 * MemoryVectorStore); swap in a live Embedder / VectorStore for production.
 */

export type {
  Vector,
  Embedder,
  VectorRecord,
  VectorHit,
  VectorQuery,
  VectorStore,
} from './types.js';

export { cosineSimilarity } from './similarity.js';
export { MemoryVectorStore } from './memory-vector-store.js';
export { HashEmbedder } from './hash-embedder.js';
export { FunctionEmbedder, type EmbedManyFn } from './function-embedder.js';

export {
  SemanticMemory,
  type MemoryEntry,
  type RecallHit,
  type RecallOptions,
  type SemanticMemoryOptions,
} from './semantic-memory.js';

export {
  WorkingMemory,
  MemoryWorkingMemoryStore,
  type WorkingMemoryStore,
  type WorkingMemoryOptions,
  type WorkingMemoryRef,
} from './working-memory.js';

export {
  createMemoryMiddleware,
  type MemoryMiddlewareOptions,
} from './memory-middleware.js';

export {
  resolveMemory,
  type AgentMemoryConfig,
  type ResolvedMemory,
} from './resolve-memory.js';
