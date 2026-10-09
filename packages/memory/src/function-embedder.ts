/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Embedder, Vector } from './types.js';

/**
 * Signature a caller implements to bridge a live embedding provider into the
 * {@link Embedder} interface — e.g. wrapping the AI SDK's `embedMany`. Kept as
 * a plain function so this package takes no `ai`/provider dependency; the
 * server (which already owns the provider SDKs) supplies the closure.
 */
export type EmbedManyFn = (texts: string[]) => Promise<Vector[]>;

/**
 * Adapts an {@link EmbedManyFn} into a full {@link Embedder}, validating that
 * every returned vector matches the declared dimension count so a
 * mis-configured model surfaces at embed time rather than as silent recall
 * corruption downstream.
 */
export class FunctionEmbedder implements Embedder {
  readonly dimensions: number;
  readonly model: string;
  private readonly fn: EmbedManyFn;

  constructor(options: {
    dimensions: number;
    model: string;
    embedMany: EmbedManyFn;
  }) {
    this.dimensions = options.dimensions;
    this.model = options.model;
    this.fn = options.embedMany;
  }

  async embed(texts: string[]): Promise<Vector[]> {
    if (texts.length === 0) return [];
    const vectors = await this.fn(texts);
    if (vectors.length !== texts.length) {
      throw new Error(
        `FunctionEmbedder: expected ${texts.length} vectors, got ${vectors.length}`
      );
    }
    for (const [i, vec] of vectors.entries()) {
      if (vec.length !== this.dimensions) {
        throw new Error(
          `FunctionEmbedder: vector ${i} has ${vec.length} dims, expected ${this.dimensions}`
        );
      }
    }
    return vectors;
  }
}
