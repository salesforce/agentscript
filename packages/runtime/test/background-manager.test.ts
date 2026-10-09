/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * The BackgroundTaskManager is the runtime analogue of the reference agent's BackgroundManager:
 * a passive table + output ring buffer + concurrency governor + durable store,
 * decoupled from Runtime via a `run` thunk so it can be tested on its own.
 */

import { describe, it, expect } from 'vitest';
import {
  BackgroundTaskManager,
  BackgroundCapacityError,
  MemoryBackgroundTaskStore,
  type BackgroundLaunchResult,
  type BackgroundRunContext,
} from '../src/background/index.js';

/** A deferred whose resolve/reject we can drive from the test body. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Wait a microtask+ so fire-and-forget settle callbacks flush. */
const tick = () => new Promise<void>(r => setTimeout(r, 0));

const OK: BackgroundLaunchResult = { assistantText: 'done', steps: 1 };

describe('BackgroundTaskManager — spawn + settle', () => {
  it('returns a running record immediately and settles on completion', async () => {
    const mgr = new BackgroundTaskManager();
    const d = deferred<BackgroundLaunchResult>();

    const info = mgr.spawn({
      childNode: 'worker',
      agentId: 'worker',
      description: 'do work',
      run: () => d.promise,
    });

    expect(info.status).toBe('running');
    expect(info.taskId).toMatch(/^task-[a-z0-9]{8}$/);
    expect(mgr.runningCount()).toBe(1);

    d.resolve({ assistantText: 'the answer', steps: 3 });
    await tick();

    const settled = mgr.get(info.taskId)!;
    expect(settled.status).toBe('completed');
    expect(settled.resultText).toBe('the answer');
    expect(settled.steps).toBe(3);
    expect(settled.endedAt).toBeDefined();
    expect(mgr.runningCount()).toBe(0);
  });

  it('marks a thrown run as failed with the error', async () => {
    const mgr = new BackgroundTaskManager();
    const d = deferred<BackgroundLaunchResult>();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: () => d.promise,
    });
    d.reject(new Error('boom'));
    await tick();
    const settled = mgr.get(info.taskId)!;
    expect(settled.status).toBe('failed');
    expect(settled.error).toMatch(/boom/);
  });

  it('mints distinct ids for same-instant spawns', () => {
    const mgr = new BackgroundTaskManager({ maxRunning: 100 });
    const ids = new Set(
      Array.from(
        { length: 50 },
        () =>
          mgr.spawn({
            childNode: 'w',
            agentId: 'w',
            description: 'd',
            run: () => new Promise(() => {}),
          }).taskId
      )
    );
    expect(ids.size).toBe(50);
  });
});

describe('BackgroundTaskManager — concurrency governor', () => {
  it('throws BackgroundCapacityError past the running ceiling', () => {
    const mgr = new BackgroundTaskManager({ maxRunning: 2 });
    const never = () => new Promise<BackgroundLaunchResult>(() => {});
    mgr.spawn({ childNode: 'a', agentId: 'a', description: 'd', run: never });
    mgr.spawn({ childNode: 'b', agentId: 'b', description: 'd', run: never });
    expect(() =>
      mgr.spawn({ childNode: 'c', agentId: 'c', description: 'd', run: never })
    ).toThrow(BackgroundCapacityError);
  });

  it('frees a slot once a task settles', async () => {
    const mgr = new BackgroundTaskManager({ maxRunning: 1 });
    const d = deferred<BackgroundLaunchResult>();
    mgr.spawn({
      childNode: 'a',
      agentId: 'a',
      description: 'd',
      run: () => d.promise,
    });
    expect(() =>
      mgr.spawn({
        childNode: 'b',
        agentId: 'b',
        description: 'd',
        run: () => Promise.resolve(OK),
      })
    ).toThrow(BackgroundCapacityError);
    d.resolve(OK);
    await tick();
    // Slot freed — a new spawn now succeeds.
    expect(
      mgr.spawn({
        childNode: 'b',
        agentId: 'b',
        description: 'd',
        run: () => Promise.resolve(OK),
      }).status
    ).toBe('running');
  });
});

describe('BackgroundTaskManager — output ring buffer', () => {
  it('accumulates emitted output and reports a lifetime cursor', async () => {
    const mgr = new BackgroundTaskManager();
    let emit!: (c: string) => void;
    const d = deferred<BackgroundLaunchResult>();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: (ctx: BackgroundRunContext) => {
        emit = ctx.emit;
        return d.promise;
      },
    });

    emit('hello ');
    emit('world');
    const all = mgr.output(info.taskId);
    expect(all.chunk).toBe('hello world');
    expect(all.nextCursor).toBe(11);

    // Tail from a cursor returns only the newer bytes.
    const tail = mgr.output(info.taskId, 6);
    expect(tail.chunk).toBe('world');

    d.resolve(OK);
    await tick();
  });

  it('drops oldest bytes past the cap but keeps the cursor lifetime-absolute', () => {
    const mgr = new BackgroundTaskManager({ maxBufferBytes: 8 });
    let emit!: (c: string) => void;
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: ctx => {
        emit = ctx.emit;
        return new Promise(() => {});
      },
    });
    emit('123456');
    emit('7890');
    const out = mgr.output(info.taskId);
    // Only the last 8 bytes are retained.
    expect(out.chunk).toBe('34567890');
    expect(out.nextCursor).toBe(10);
  });
});

describe('BackgroundTaskManager — stop', () => {
  it('aborts the run signal and marks the task killed', async () => {
    const mgr = new BackgroundTaskManager();
    let sawAbort = false;
    const d = deferred<BackgroundLaunchResult>();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: ctx => {
        ctx.signal.addEventListener('abort', () => {
          sawAbort = true;
          d.reject(ctx.signal.reason);
        });
        return d.promise;
      },
    });

    await mgr.stop(info.taskId, 'user cancelled');
    await tick();

    expect(sawAbort).toBe(true);
    const settled = mgr.get(info.taskId)!;
    expect(settled.status).toBe('killed');
    expect(settled.stopReason).toMatch(/user cancelled/);
  });

  it('is a no-op on an already-completed task', async () => {
    const mgr = new BackgroundTaskManager();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: () => Promise.resolve(OK),
    });
    await tick();
    const stopped = await mgr.stop(info.taskId);
    expect(stopped.status).toBe('completed');
  });

  it('settles as killed (not failed) when a PARENT signal aborts the run', async () => {
    // Regression: the run thunk chains the parent turn's AbortSignal (see
    // spawnBackground's linkSignals). A parent abort tears the child down and
    // its run() rejects with an AbortError — but WITHOUT touching the manager's
    // own controller. The .catch must recognise the abort-shaped error as a
    // teardown and settle `killed`; the old code checked only its own
    // controller.signal.aborted and mislabelled this `failed` with a spurious
    // error string (and fired a bogus completion notice).
    const mgr = new BackgroundTaskManager();
    const parent = new AbortController();
    const d = deferred<BackgroundLaunchResult>();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      // Mirror the real run thunk: reject with an AbortError when the (parent-
      // linked) signal fires. The manager's own controller is untouched.
      run: ctx => {
        parent.signal.addEventListener('abort', () => {
          const e = new Error('The operation was aborted');
          e.name = 'AbortError';
          d.reject(e);
        });
        void ctx; // manager's controller intentionally not aborted here
        return d.promise;
      },
    });

    parent.abort();
    await tick();

    const settled = mgr.get(info.taskId)!;
    expect(settled.status).toBe('killed');
    expect(settled.error).toBeUndefined(); // a teardown, not a crash
    // Not a spurious pending crash-notification either — killed-by-teardown is
    // still announceable (only mgr.stop suppresses), but it must NOT carry an
    // error, which is the real regression symptom.
  });

  it('still settles as failed on a genuine (non-abort) crash', async () => {
    // The counterpart to the abort case: a real error must remain `failed`.
    const mgr = new BackgroundTaskManager();
    const d = deferred<BackgroundLaunchResult>();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: () => d.promise,
    });
    d.reject(new Error('boom — real crash'));
    await tick();
    const settled = mgr.get(info.taskId)!;
    expect(settled.status).toBe('failed');
    expect(settled.error).toMatch(/boom/);
  });
});

describe('BackgroundTaskManager — notifications', () => {
  it('emits a terminal notification and tracks pending/notified', async () => {
    const mgr = new BackgroundTaskManager();
    const seen: string[] = [];
    mgr.onNotify(e => seen.push(e.info.status));

    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: () => Promise.resolve(OK),
    });
    await tick();

    expect(seen).toEqual(['completed']);
    expect(mgr.pendingNotifications().map(t => t.taskId)).toEqual([
      info.taskId,
    ]);
    mgr.markNotified(info.taskId);
    expect(mgr.pendingNotifications()).toEqual([]);
  });

  it('suppresses the notification for an explicitly stopped task', async () => {
    const mgr = new BackgroundTaskManager();
    const d = deferred<BackgroundLaunchResult>();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: ctx => {
        ctx.signal.addEventListener('abort', () => d.reject(ctx.signal.reason));
        return d.promise;
      },
    });
    await mgr.stop(info.taskId);
    await tick();
    expect(mgr.pendingNotifications()).toEqual([]);
  });

  it('lists active (still-running) tasks for re-injection', () => {
    const mgr = new BackgroundTaskManager();
    const info = mgr.spawn({
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      run: () => new Promise(() => {}),
    });
    expect(mgr.activeTasks().map(t => t.taskId)).toEqual([info.taskId]);
  });
});

describe('BackgroundTaskManager — resolve by agentId', () => {
  it('resolves a task by either taskId or agentId', () => {
    const mgr = new BackgroundTaskManager();
    const info = mgr.spawn({
      childNode: 'researcher',
      agentId: 'agent-42',
      description: 'd',
      run: () => new Promise(() => {}),
    });
    expect(mgr.resolve(info.taskId)?.taskId).toBe(info.taskId);
    expect(mgr.resolve('agent-42')?.taskId).toBe(info.taskId);
    expect(mgr.resolve('nope')).toBeUndefined();
  });
});

describe('BackgroundTaskManager — reconcile', () => {
  it('declares a persisted-running task lost and re-announces it', async () => {
    const store = new MemoryBackgroundTaskStore();
    // Simulate a prior session that died mid-run.
    await store.saveTask({
      taskId: 'task-ghost001',
      kind: 'agent',
      childNode: 'worker',
      agentId: 'worker',
      description: 'orphaned work',
      status: 'running',
      startedAt: '2026-01-01T00:00:00.000Z',
      notified: true,
    });
    await store.appendOutput('task-ghost001', 'partial output');

    const mgr = new BackgroundTaskManager({ store });
    const announced: string[] = [];
    mgr.onNotify(e => announced.push(e.info.status));

    const recovered = await mgr.reconcile();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].status).toBe('lost');
    expect(recovered[0].stopReason).toMatch(/exited/);
    expect(announced).toEqual(['lost']);
    // Its buffered output is re-hydrated.
    expect(mgr.output('task-ghost001').chunk).toBe('partial output');
  });

  it('re-hydrates a completed task without re-announcing it', async () => {
    const store = new MemoryBackgroundTaskStore();
    await store.saveTask({
      taskId: 'task-done0001',
      kind: 'agent',
      childNode: 'worker',
      agentId: 'worker',
      description: 'finished work',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
      resultText: 'result',
      notified: true,
    });

    const mgr = new BackgroundTaskManager({ store });
    const announced: string[] = [];
    mgr.onNotify(e => announced.push(e.info.status));
    const recovered = await mgr.reconcile();

    expect(recovered[0].status).toBe('completed');
    expect(recovered[0].resultText).toBe('result');
    // Status unchanged → no re-announcement.
    expect(announced).toEqual([]);
  });

  it('is idempotent across repeated reconciles', async () => {
    const store = new MemoryBackgroundTaskStore();
    await store.saveTask({
      taskId: 'task-x0000001',
      kind: 'agent',
      childNode: 'w',
      agentId: 'w',
      description: 'd',
      status: 'completed',
      startedAt: '2026-01-01T00:00:00.000Z',
    });
    const mgr = new BackgroundTaskManager({ store });
    await mgr.reconcile();
    const second = await mgr.reconcile();
    expect(second).toEqual([]);
    expect(mgr.list()).toHaveLength(1);
  });
});
