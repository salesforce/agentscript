/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlmDriver, LlmStepInput, StepEvent } from '../llm/types.js';

/** A named LLM driver in a fallback chain. */
export interface NamedDriver {
  /** Identifier used in logs / errors (e.g. the model id). */
  name: string;
  driver: LlmDriver;
}

export interface FallbackDriverOptions {
  /** Drivers tried in order; the first to yield events wins. */
  drivers: NamedDriver[];
  /**
   * Decide whether an error from one driver should trigger a fallback to the
   * next. Defaults to {@link retryAll} (any error falls through). Return false
   * to treat the error as terminal (e.g. a user-abort should not fall over to a
   * different model).
   */
  shouldFallover?: (error: unknown, driver: NamedDriver) => boolean;
  /** Called when a driver fails and the chain moves on (for logging). */
  onFallover?: (error: unknown, from: NamedDriver, to: NamedDriver) => void;
}

/**
 * An {@link LlmDriver} that tries a chain of drivers in order, falling over to
 * the next when one fails.
 *
 * Failover is decided *before any events are emitted downstream*: the driver
 * buffers a candidate's events and only forwards them once the candidate's
 * stream completes without throwing. This keeps the contract clean — the
 * consumer never sees a half-emitted step from a driver that then errored and
 * got replaced. (LLM steps here are effectively single-shot generateText calls,
 * so buffering one step's worth of events is cheap.)
 *
 * If every driver fails, the last error is rethrown with all failures attached.
 */
export class FallbackDriver implements LlmDriver {
  private readonly drivers: NamedDriver[];
  private readonly shouldFallover: (
    error: unknown,
    driver: NamedDriver
  ) => boolean;
  private readonly onFallover?: (
    error: unknown,
    from: NamedDriver,
    to: NamedDriver
  ) => void;

  constructor(options: FallbackDriverOptions) {
    if (options.drivers.length === 0) {
      throw new Error('FallbackDriver requires at least one driver.');
    }
    this.drivers = options.drivers;
    this.shouldFallover = options.shouldFallover ?? retryAll;
    this.onFallover = options.onFallover;
  }

  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    const failures: Array<{ name: string; error: unknown }> = [];

    for (let i = 0; i < this.drivers.length; i++) {
      const candidate = this.drivers[i];
      try {
        // Buffer the whole step so a mid-stream throw can still fall over
        // without the consumer having seen a partial step.
        const events: StepEvent[] = [];
        for await (const ev of candidate.driver.step(input)) {
          events.push(ev);
        }
        yield* events;
        return;
      } catch (error) {
        failures.push({ name: candidate.name, error });
        const next = this.drivers[i + 1];
        const canFallover =
          next !== undefined && this.shouldFallover(error, candidate);
        if (!canFallover) {
          throw enrichError(error, failures);
        }
        this.onFallover?.(error, candidate, next);
      }
    }

    // Unreachable in practice (the loop returns or throws), but keeps the
    // control flow total.
    throw enrichError(
      failures.at(-1)?.error ?? new Error('all drivers failed'),
      failures
    );
  }
}

/** Default failover predicate: fall over on any error. */
export function retryAll(): boolean {
  return true;
}

function enrichError(
  error: unknown,
  failures: Array<{ name: string; error: unknown }>
): Error {
  const base = error instanceof Error ? error : new Error(String(error));
  const chain = failures
    .map(
      f =>
        `${f.name}: ${f.error instanceof Error ? f.error.message : String(f.error)}`
    )
    .join('; ');
  base.message = `All LLM drivers failed [${chain}]`;
  return base;
}
