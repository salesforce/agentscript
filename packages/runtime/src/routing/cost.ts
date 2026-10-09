/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenUsage } from '../llm/types.js';

/**
 * Per-model pricing, expressed as USD per 1,000 tokens. Split by input/output
 * because every major provider prices them differently.
 */
export interface ModelPrice {
  /** USD per 1K input (prompt) tokens. */
  inputPer1k: number;
  /** USD per 1K output (completion) tokens. */
  outputPer1k: number;
}

/** A running tally of tokens + estimated cost, broken down per model. */
export interface UsageStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Estimated cost in USD; only meaningful for models with a known price. */
  costUsd: number;
  /** Number of LLM steps recorded. */
  steps: number;
  /** Per-model breakdown. */
  byModel: Record<string, ModelUsage>;
}

export interface ModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  steps: number;
}

/**
 * Accumulates {@link TokenUsage} across LLM steps and estimates cost from a
 * price table. A model with no entry in the table contributes tokens but zero
 * cost (so unknown-priced models don't silently inflate the bill estimate) —
 * `hasUnpricedUsage()` lets a caller detect that case.
 */
export class CostTracker {
  private readonly prices: Record<string, ModelPrice>;
  private readonly stats: UsageStats = emptyStats();
  private unpriced = false;

  constructor(prices: Record<string, ModelPrice> = {}) {
    this.prices = prices;
  }

  /** Record one step's usage for a model. */
  record(usage: TokenUsage, model = 'unknown'): void {
    const input = usage.inputTokens ?? 0;
    const output = usage.outputTokens ?? 0;
    const total = usage.totalTokens ?? input + output;

    const price = this.prices[model];
    if (!price) this.unpriced = true;
    const cost = price
      ? (input / 1000) * price.inputPer1k + (output / 1000) * price.outputPer1k
      : 0;

    this.stats.inputTokens += input;
    this.stats.outputTokens += output;
    this.stats.totalTokens += total;
    this.stats.costUsd += cost;
    this.stats.steps += 1;

    const bucket = (this.stats.byModel[model] ??= {
      model,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      steps: 0,
    });
    bucket.inputTokens += input;
    bucket.outputTokens += output;
    bucket.totalTokens += total;
    bucket.costUsd += cost;
    bucket.steps += 1;
  }

  /** A snapshot of the running totals (deep-ish copy so callers can't mutate state). */
  snapshot(): UsageStats {
    return {
      inputTokens: this.stats.inputTokens,
      outputTokens: this.stats.outputTokens,
      totalTokens: this.stats.totalTokens,
      costUsd: this.stats.costUsd,
      steps: this.stats.steps,
      byModel: Object.fromEntries(
        Object.entries(this.stats.byModel).map(([k, v]) => [k, { ...v }])
      ),
    };
  }

  /** True when at least one recorded step used a model with no known price. */
  hasUnpricedUsage(): boolean {
    return this.unpriced;
  }

  reset(): void {
    Object.assign(this.stats, emptyStats());
    this.unpriced = false;
  }
}

function emptyStats(): UsageStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    steps: 0,
    byModel: {},
  };
}
