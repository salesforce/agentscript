/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Middleware } from '@agentscript/runtime';

import { HashEmbedder } from './hash-embedder.js';
import { MemoryVectorStore } from './memory-vector-store.js';
import { createMemoryMiddleware } from './memory-middleware.js';
import { SemanticMemory } from './semantic-memory.js';
import { MemoryWorkingMemoryStore, WorkingMemory } from './working-memory.js';
import type { Embedder, VectorStore } from './types.js';
import type { WorkingMemoryStore } from './working-memory.js';

/**
 * Single source of truth for turning a caller's `memory` intent into a live,
 * offline-by-default memory stack + the middleware that wires it into the loop.
 *
 * Both `createAgent` (runtime-vercel) and `createCodingHarness` (harness)
 * delegate here so their offline defaults never diverge. When a field is
 * omitted it falls back to the dependency-free implementation — `HashEmbedder`,
 * `MemoryVectorStore`, `MemoryWorkingMemoryStore` — so `resolveMemory(true)`
 * runs with no API key and no external services.
 */
export interface AgentMemoryConfig {
  /** Conversation/thread scope. Defaults to `'default'`. */
  threadId?: string;
  /** Owner (user/tenant) scope for cross-thread recall. */
  resourceId?: string;
  /** Live embedder. Defaults to an offline {@link HashEmbedder}. */
  embedder?: Embedder;
  /** Vector store. Defaults to an in-process {@link MemoryVectorStore}. */
  vectorStore?: VectorStore;
  /** Working-memory backing store. Defaults to {@link MemoryWorkingMemoryStore}. */
  workingMemoryStore?: WorkingMemoryStore;
  /** Recall tuning passed through to the middleware. */
  recall?: { topK?: number; minScore?: number };
  /** Supply a pre-built {@link SemanticMemory} instead of assembling one. */
  semantic?: SemanticMemory;
  /** Supply a pre-built {@link WorkingMemory} instead of assembling one. */
  working?: WorkingMemory;
}

export interface ResolvedMemory {
  semantic: SemanticMemory;
  working: WorkingMemory;
  middleware: Middleware;
  threadId: string;
  resourceId?: string;
}

/**
 * Build the semantic + working memory pair and the middleware that injects
 * recall and persists each turn. Pass `true` for the all-offline default.
 */
export function resolveMemory(
  config: AgentMemoryConfig | true
): ResolvedMemory {
  const cfg: AgentMemoryConfig = config === true ? {} : config;
  const threadId = cfg.threadId ?? 'default';
  const { resourceId } = cfg;

  const embedder = cfg.embedder ?? new HashEmbedder(256);
  const semantic =
    cfg.semantic ??
    new SemanticMemory({
      embedder,
      store: cfg.vectorStore ?? new MemoryVectorStore(),
    });
  const working =
    cfg.working ??
    new WorkingMemory({
      store: cfg.workingMemoryStore ?? new MemoryWorkingMemoryStore(),
    });

  const middleware = createMemoryMiddleware({
    semantic,
    working,
    threadId,
    resourceId,
    recall: cfg.recall,
  });

  return { semantic, working, middleware, threadId, resourceId };
}
