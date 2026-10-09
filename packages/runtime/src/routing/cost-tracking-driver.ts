/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlmDriver, LlmStepInput, StepEvent } from '../llm/types.js';
import type { CostTracker } from './cost.js';

/**
 * Wraps an {@link LlmDriver}, recording every `usage` event it emits into a
 * {@link CostTracker} while passing all events through untouched. Transparent
 * to the consumer — it only observes.
 *
 * A `defaultModel` names steps whose `usage` event carries no model id, so
 * cost still attributes to the right bucket for drivers that don't echo the
 * model back.
 */
export class CostTrackingDriver implements LlmDriver {
  constructor(
    private readonly inner: LlmDriver,
    private readonly tracker: CostTracker,
    private readonly defaultModel?: string
  ) {}

  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    for await (const ev of this.inner.step(input)) {
      if (ev.kind === 'usage') {
        this.tracker.record(ev.usage, ev.model ?? this.defaultModel);
      }
      yield ev;
    }
  }
}
