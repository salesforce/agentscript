import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToolRegistry, GRACE_TIMEOUT_MS } from '../src/tools/registry.js';
import type {
  ToolAdapter,
  ToolAdapterInvocation,
} from '../src/tools/registry.js';

describe('ToolRegistry — grace timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves normally when adapter finishes before abort', async () => {
    const adapter: ToolAdapter = {
      invoke: async () => ({ result: 'success' }),
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const controller = new AbortController();
    const promise = registry.invoke(
      'test://foo',
      {},
      { signal: controller.signal }
    );

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual({ result: 'success' });
  });

  it('passes through adapter error when it aborts cleanly within grace period', async () => {
    const adapter: ToolAdapter = {
      invoke: async ({ signal }: ToolAdapterInvocation) => {
        return new Promise((resolve, reject) => {
          signal?.addEventListener('abort', () => {
            setTimeout(() => {
              reject(new Error('Adapter aborted cleanly'));
            }, 500);
          });
        });
      },
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const controller = new AbortController();
    const promise = registry.invoke(
      'test://foo',
      {},
      { signal: controller.signal }
    );

    // Suppress unhandled rejection warning (the promise rejects later)
    promise.catch(() => {});

    controller.abort();
    await vi.advanceTimersByTimeAsync(500);

    await expect(promise).rejects.toThrow('Adapter aborted cleanly');
  });

  it('throws grace timeout error when adapter hangs past grace period', async () => {
    const adapter: ToolAdapter = {
      invoke: async (_: ToolAdapterInvocation) => {
        // Adapter that ignores the abort signal completely
        return new Promise(() => {
          // Never resolves or rejects
        });
      },
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const controller = new AbortController();
    const promise = registry.invoke(
      'test://foo',
      {},
      { signal: controller.signal }
    );

    // Suppress unhandled rejection warning (the promise rejects later)
    promise.catch(() => {});

    controller.abort();
    await vi.advanceTimersByTimeAsync(GRACE_TIMEOUT_MS);

    await expect(promise).rejects.toThrow(
      `Tool "test://foo" aborted by grace timeout (${String(GRACE_TIMEOUT_MS)}ms)`
    );
  });

  it('throws grace timeout error when signal is pre-aborted and adapter hangs', async () => {
    const adapter: ToolAdapter = {
      invoke: async () => {
        // Adapter that never resolves
        return new Promise(() => {});
      },
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const controller = new AbortController();
    controller.abort();

    const promise = registry.invoke(
      'test://foo',
      {},
      { signal: controller.signal }
    );

    // Suppress unhandled rejection warning (the promise rejects later)
    promise.catch(() => {});

    await vi.advanceTimersByTimeAsync(GRACE_TIMEOUT_MS);

    await expect(promise).rejects.toThrow(
      `Tool "test://foo" aborted by grace timeout (${String(GRACE_TIMEOUT_MS)}ms)`
    );
  });

  it('resolves normally when no abort signal is provided', async () => {
    const adapter: ToolAdapter = {
      invoke: async () => {
        // Simulate some async work
        return new Promise(resolve => {
          setTimeout(() => resolve({ result: 'no signal' }), 100);
        });
      },
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const promise = registry.invoke('test://foo', {});

    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ result: 'no signal' });
  });

  it('does not start grace timer if abort never fires', async () => {
    const adapter: ToolAdapter = {
      invoke: async () => {
        return new Promise(resolve => {
          setTimeout(() => resolve({ result: 'completed' }), 500);
        });
      },
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const controller = new AbortController();
    const promise = registry.invoke(
      'test://foo',
      {},
      { signal: controller.signal }
    );

    // Advance time past grace timeout duration but don't abort
    await vi.advanceTimersByTimeAsync(GRACE_TIMEOUT_MS + 1000);
    const result = await promise;

    // Should resolve successfully without grace timeout
    expect(result).toEqual({ result: 'completed' });
  });

  it('resolves with adapter result when adapter wins race after abort but within grace', async () => {
    const adapter: ToolAdapter = {
      invoke: async ({ signal }: ToolAdapterInvocation) => {
        return new Promise(resolve => {
          signal?.addEventListener('abort', () => {
            // Adapter responds to abort within grace period
            setTimeout(() => {
              resolve({ result: 'aborted gracefully' });
            }, 1000);
          });
        });
      },
    };

    const registry = new ToolRegistry();
    registry.register('test', adapter);

    const controller = new AbortController();
    const promise = registry.invoke(
      'test://foo',
      {},
      { signal: controller.signal }
    );

    controller.abort();
    await vi.advanceTimersByTimeAsync(1000);

    const result = await promise;
    expect(result).toEqual({ result: 'aborted gracefully' });
  });
});
