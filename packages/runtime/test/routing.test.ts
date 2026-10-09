/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import {
  CostTracker,
  CostTrackingDriver,
  FallbackDriver,
} from '../src/index.js';
import type { LlmDriver, LlmStepInput, StepEvent } from '../src/index.js';

const INPUT: LlmStepInput = { system: 's', messages: [], tools: [] };

/** A driver that yields a fixed script of events. */
function scriptedDriver(events: StepEvent[]): LlmDriver {
  return {
    async *step() {
      for (const ev of events) yield ev;
    },
  };
}

/** A driver that throws before yielding anything. */
function failingDriver(message: string): LlmDriver {
  return {
    // eslint-disable-next-line require-yield
    async *step() {
      throw new Error(message);
    },
  };
}

async function drain(driver: LlmDriver): Promise<StepEvent[]> {
  const out: StepEvent[] = [];
  for await (const ev of driver.step(INPUT)) out.push(ev);
  return out;
}

describe('FallbackDriver', () => {
  it('uses the first driver when it succeeds', async () => {
    const primary = scriptedDriver([
      { kind: 'text-delta', text: 'primary' },
      { kind: 'finish', reason: 'stop' },
    ]);
    const secondary = scriptedDriver([
      { kind: 'text-delta', text: 'secondary' },
    ]);
    const fallback = new FallbackDriver({
      drivers: [
        { name: 'a', driver: primary },
        { name: 'b', driver: secondary },
      ],
    });
    const events = await drain(fallback);
    expect(events).toContainEqual({ kind: 'text-delta', text: 'primary' });
    expect(events).not.toContainEqual({
      kind: 'text-delta',
      text: 'secondary',
    });
  });

  it('falls over to the next driver on error', async () => {
    const onFallover = vi.fn();
    const fallback = new FallbackDriver({
      drivers: [
        { name: 'primary', driver: failingDriver('boom') },
        {
          name: 'backup',
          driver: scriptedDriver([{ kind: 'text-delta', text: 'saved' }]),
        },
      ],
      onFallover,
    });
    const events = await drain(fallback);
    expect(events).toEqual([{ kind: 'text-delta', text: 'saved' }]);
    expect(onFallover).toHaveBeenCalledOnce();
  });

  it('does not emit partial events from a driver that then throws mid-stream', async () => {
    const flaky: LlmDriver = {
      async *step() {
        yield { kind: 'text-delta', text: 'partial' };
        throw new Error('died mid-stream');
      },
    };
    const fallback = new FallbackDriver({
      drivers: [
        { name: 'flaky', driver: flaky },
        {
          name: 'backup',
          driver: scriptedDriver([{ kind: 'text-delta', text: 'clean' }]),
        },
      ],
    });
    const events = await drain(fallback);
    // The consumer never sees 'partial' — the whole step is buffered.
    expect(events).toEqual([{ kind: 'text-delta', text: 'clean' }]);
  });

  it('rethrows an aggregated error when every driver fails', async () => {
    const fallback = new FallbackDriver({
      drivers: [
        { name: 'a', driver: failingDriver('err-a') },
        { name: 'b', driver: failingDriver('err-b') },
      ],
    });
    await expect(drain(fallback)).rejects.toThrow(/err-a.*err-b/);
  });

  it('treats the error as terminal when shouldFallover returns false', async () => {
    const secondary = vi.fn();
    const fallback = new FallbackDriver({
      drivers: [
        { name: 'a', driver: failingDriver('user abort') },
        { name: 'b', driver: { step: secondary } as unknown as LlmDriver },
      ],
      shouldFallover: () => false,
    });
    await expect(drain(fallback)).rejects.toThrow(/user abort/);
    expect(secondary).not.toHaveBeenCalled();
  });

  it('rejects an empty driver list', () => {
    expect(() => new FallbackDriver({ drivers: [] })).toThrow(/at least one/);
  });
});

describe('CostTracker', () => {
  const prices = {
    'gpt-4o': { inputPer1k: 0.005, outputPer1k: 0.015 },
  };

  it('accumulates tokens and estimates cost from the price table', () => {
    const tracker = new CostTracker(prices);
    tracker.record({ inputTokens: 1000, outputTokens: 500 }, 'gpt-4o');
    const snap = tracker.snapshot();
    expect(snap.inputTokens).toBe(1000);
    expect(snap.outputTokens).toBe(500);
    expect(snap.totalTokens).toBe(1500);
    // 1000/1k * 0.005 + 500/1k * 0.015 = 0.005 + 0.0075 = 0.0125
    expect(snap.costUsd).toBeCloseTo(0.0125, 10);
    expect(snap.steps).toBe(1);
    expect(snap.byModel['gpt-4o'].costUsd).toBeCloseTo(0.0125, 10);
  });

  it('flags unpriced usage and charges it nothing', () => {
    const tracker = new CostTracker(prices);
    tracker.record({ inputTokens: 100, outputTokens: 100 }, 'mystery-model');
    expect(tracker.hasUnpricedUsage()).toBe(true);
    expect(tracker.snapshot().costUsd).toBe(0);
    expect(tracker.snapshot().totalTokens).toBe(200);
  });

  it('derives total from input+output when total is absent', () => {
    const tracker = new CostTracker();
    tracker.record({ inputTokens: 30, outputTokens: 12 });
    expect(tracker.snapshot().totalTokens).toBe(42);
  });

  it('resets to empty', () => {
    const tracker = new CostTracker(prices);
    tracker.record({ inputTokens: 10 }, 'gpt-4o');
    tracker.reset();
    expect(tracker.snapshot().steps).toBe(0);
    expect(tracker.hasUnpricedUsage()).toBe(false);
  });
});

describe('CostTrackingDriver', () => {
  it('records usage events while passing all events through', async () => {
    const tracker = new CostTracker({ m: { inputPer1k: 1, outputPer1k: 1 } });
    const inner = scriptedDriver([
      { kind: 'text-delta', text: 'hi' },
      {
        kind: 'usage',
        usage: { inputTokens: 1000, outputTokens: 1000 },
        model: 'm',
      },
      { kind: 'finish', reason: 'stop' },
    ]);
    const wrapped = new CostTrackingDriver(inner, tracker);
    const events = await drain(wrapped);
    expect(events).toHaveLength(3); // pass-through untouched
    expect(tracker.snapshot().totalTokens).toBe(2000);
    expect(tracker.snapshot().costUsd).toBeCloseTo(2, 10);
  });

  it('attributes usage to the default model when the event carries none', async () => {
    const tracker = new CostTracker();
    const inner = scriptedDriver([
      { kind: 'usage', usage: { inputTokens: 5 } },
      { kind: 'finish', reason: 'stop' },
    ]);
    const wrapped = new CostTrackingDriver(inner, tracker, 'fallback-model');
    await drain(wrapped);
    expect(tracker.snapshot().byModel['fallback-model'].inputTokens).toBe(5);
  });
});
