/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '../src/hash-embedder.js';
import { cosineSimilarity } from '../src/similarity.js';

describe('HashEmbedder', () => {
  it('produces vectors of the declared dimensionality', async () => {
    const embedder = new HashEmbedder(64);
    const [vec] = await embedder.embed(['hello world']);
    expect(vec).toHaveLength(64);
    expect(embedder.dimensions).toBe(64);
  });

  it('is deterministic: identical text → identical vector', async () => {
    const embedder = new HashEmbedder();
    const [a] = await embedder.embed(['the quick brown fox']);
    const [b] = await embedder.embed(['the quick brown fox']);
    expect(a).toEqual(b);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  it('ranks lexically-overlapping text closer than unrelated text', async () => {
    const embedder = new HashEmbedder();
    const [query] = await embedder.embed(['how do I reset my password']);
    const [related] = await embedder.embed(['password reset instructions']);
    const [unrelated] = await embedder.embed(['the weather is sunny today']);
    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated)
    );
  });

  it('normalises to unit length (self-similarity is 1)', async () => {
    const embedder = new HashEmbedder();
    const [vec] = await embedder.embed(['normalise me']);
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1, 10);
  });

  it('embeds an empty batch to an empty array', async () => {
    const embedder = new HashEmbedder();
    expect(await embedder.embed([])).toEqual([]);
  });

  it('rejects a non-positive dimension count', () => {
    expect(() => new HashEmbedder(0)).toThrow(/dimensions/);
  });
});
