/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  truncateToolResult,
  MAX_TOOL_RESULT_CHARS,
  type TruncateOptions,
} from './truncate.js';

/** Sentinel target used by the compiler for state-only side effects. */
export const STATE_UPDATE_TARGET = '__state_update_action__';

/**
 * Grace period (ms) after abort before synthetic timeout error. Defends
 * against adapters that ignore their AbortSignal.
 */
export const GRACE_TIMEOUT_MS = 2000;

export interface ToolAdapterInvocation {
  /** Fully-qualified target as written in the script (e.g. "flow://Foo", "fn://bar"). */
  target: string;
  /** Resolved arguments (bound_inputs merged with LLM-provided args). */
  args: Record<string, unknown>;
  /** Optional abort signal forwarded from the runtime turn. */
  signal?: AbortSignal;
}

export interface ToolAdapter {
  invoke(i: ToolAdapterInvocation): Promise<Record<string, unknown>>;
}

export interface ToolRegistryOptions {
  /** Character budget for tool results. Default: MAX_TOOL_RESULT_CHARS (100K). */
  maxResultChars?: number;
  /** Disable truncation entirely (for testing). Default: false. */
  disableTruncation?: boolean;
}

/**
 * Registry keyed by URI scheme (`fn`, `http`, `https`, `mcp`, ...). The
 * `__state_update_action__` sentinel never hits an adapter — the runtime
 * applies state updates directly.
 */
export class ToolRegistry {
  private adapters = new Map<string, ToolAdapter>();
  private readonly truncateOpts: TruncateOptions | null;

  constructor(opts: ToolRegistryOptions = {}) {
    this.truncateOpts =
      opts.disableTruncation === true
        ? null
        : { maxChars: opts.maxResultChars ?? MAX_TOOL_RESULT_CHARS };
  }

  register(scheme: string, adapter: ToolAdapter): void {
    this.adapters.set(scheme, adapter);
  }

  async invoke(
    target: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal }
  ): Promise<Record<string, unknown>> {
    if (target === STATE_UPDATE_TARGET) {
      return {};
    }
    const scheme = target.includes('://')
      ? target.slice(0, target.indexOf('://'))
      : null;
    if (!scheme) {
      throw new Error(
        `Tool target "${target}" has no scheme (expected "scheme://name")`
      );
    }
    const adapter = this.adapters.get(scheme);
    if (!adapter) {
      throw new Error(`No tool adapter registered for scheme "${scheme}://"`);
    }

    const adapterPromise = adapter.invoke({
      target,
      args,
      signal: options?.signal,
    });

    // Grace timeout (Batch A) resolves the raw adapter result; the char-budget
    // cap (#5) then trims oversized string fields before it enters history.
    const signal = options?.signal;
    const raw = signal
      ? await raceWithGraceTimeout(adapterPromise, signal, target)
      : await adapterPromise;
    let result = raw ?? {};
    if (this.truncateOpts !== null) {
      result = truncateToolResult(result, this.truncateOpts);
    }
    return result;
  }
}

/**
 * Race adapter execution against a grace timeout that arms only after abort.
 * Returns adapter's result if it settles before or shortly after abort; throws
 * synthetic error if adapter hangs 2s+ past abort.
 */
async function raceWithGraceTimeout(
  adapterPromise: Promise<Record<string, unknown>>,
  signal: AbortSignal,
  target: string
): Promise<Record<string, unknown>> {
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const graceSentinel: Promise<never> = new Promise((_, reject) => {
    const armTimer = (): void => {
      graceTimer = setTimeout(() => {
        reject(
          new Error(
            `Tool "${target}" aborted by grace timeout (${String(GRACE_TIMEOUT_MS)}ms)`
          )
        );
      }, GRACE_TIMEOUT_MS);
    };
    if (signal.aborted) {
      armTimer();
    } else {
      onAbort = armTimer;
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([adapterPromise, graceSentinel]);
  } finally {
    if (graceTimer !== undefined) clearTimeout(graceTimer);
    if (onAbort !== undefined) {
      try {
        signal.removeEventListener('abort', onAbort);
      } catch {
        // Some AbortSignal polyfills do not implement removeEventListener.
      }
    }
  }
}
