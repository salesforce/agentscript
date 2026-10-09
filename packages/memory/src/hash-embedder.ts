/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Embedder, Vector } from './types.js';

/**
 * Deterministic, offline embedder — the memory-package analogue of the dev
 * mock LLM. It lets semantic recall run with **no API key**: identical text
 * always maps to the identical vector, and lexically-overlapping text lands
 * closer in cosine space than unrelated text, which is enough to exercise and
 * test recall end-to-end.
 *
 * How it works: lowercase-tokenise, hash each token into one of `dimensions`
 * buckets (a hashed bag-of-words / feature-hashing sketch), accumulate a count
 * per bucket, then L2-normalise. Two texts sharing tokens share buckets, so
 * their vectors point in a similar direction. This is NOT semantic — it has no
 * notion of synonyms — but it is stable and dependency-free, which is exactly
 * what the offline dev loop needs. Swap in a real {@link Embedder} for
 * production semantics.
 */
export class HashEmbedder implements Embedder {
  readonly dimensions: number;
  readonly model = 'agentscript-hash-embed';

  constructor(dimensions = 256) {
    if (dimensions < 1) {
      throw new Error('HashEmbedder: dimensions must be >= 1');
    }
    this.dimensions = dimensions;
  }

  async embed(texts: string[]): Promise<Vector[]> {
    return texts.map(text => this.embedOne(text));
  }

  private embedOne(text: string): Vector {
    const vec = new Array<number>(this.dimensions).fill(0);
    for (const token of tokenize(text)) {
      const bucket = hashToken(token) % this.dimensions;
      vec[bucket] += 1;
    }
    return l2normalize(vec);
  }
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** FNV-1a 32-bit hash → non-negative integer. */
function hashToken(token: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    h ^= token.charCodeAt(i);
    // FNV prime multiply, kept in 32-bit range via Math.imul.
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function l2normalize(vec: Vector): Vector {
  let norm = 0;
  for (const v of vec) norm += v * v;
  if (norm === 0) return vec;
  const inv = 1 / Math.sqrt(norm);
  return vec.map(v => v * inv);
}
