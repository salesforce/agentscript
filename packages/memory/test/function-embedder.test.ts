/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { FunctionEmbedder as FnEmbedder } from '../src/function-embedder.js';

describe('FunctionEmbedder', () => {
  it('delegates to the provided embedMany function', async () => {
    const embedder = new FnEmbedder({
      dimensions: 3,
      model: 'test-model',
      embedMany: async texts => texts.map(() => [0.1, 0.2, 0.3]),
    });
    const vectors = await embedder.embed(['a', 'b']);
    expect(vectors).toEqual([
      [0.1, 0.2, 0.3],
      [0.1, 0.2, 0.3],
    ]);
    expect(embedder.model).toBe('test-model');
  });

  it('short-circuits an empty batch without calling the fn', async () => {
    let called = false;
    const embedder = new FnEmbedder({
      dimensions: 3,
      model: 'test',
      embedMany: async texts => {
        called = true;
        return texts.map(() => [0, 0, 0]);
      },
    });
    expect(await embedder.embed([])).toEqual([]);
    expect(called).toBe(false);
  });

  it('throws when the fn returns the wrong number of vectors', async () => {
    const embedder = new FnEmbedder({
      dimensions: 3,
      model: 'test',
      embedMany: async () => [[0, 0, 0]],
    });
    await expect(embedder.embed(['a', 'b'])).rejects.toThrow(
      /expected 2 vectors/
    );
  });

  it('throws when a vector has the wrong dimensionality', async () => {
    const embedder = new FnEmbedder({
      dimensions: 3,
      model: 'test',
      embedMany: async texts => texts.map(() => [0, 0]),
    });
    await expect(embedder.embed(['a'])).rejects.toThrow(/dims, expected 3/);
  });
});
