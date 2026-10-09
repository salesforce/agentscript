/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Checkpoint } from '../checkpoint/types.js';
import {
  isBackgroundTaskTerminal,
  type BackgroundTaskInfo,
  type BackgroundTaskStatus,
  type BackgroundTaskStore,
} from './types.js';
import { MemoryBackgroundTaskStore } from './memory-store.js';

/** Cap on buffered output per task (1 MiB), mirroring the process manager. */
const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024;

/** Default ceiling on concurrently-running background tasks. */
const DEFAULT_MAX_RUNNING = 8;

/**
 * What a background task's `run` thunk resolves to. Deliberately minimal — the
 * manager persists only the observable result, never a live Runtime.
 */
export interface BackgroundLaunchResult {
  /** The child's final assistant text. */
  assistantText: string;
  /** LLM steps the child took. */
  steps: number;
  /**
   * The child's serialized state at completion, so `resume` can reconstruct it
   * via `Runtime.fromCheckpoint`. Optional — a runner that can't checkpoint
   * (or a fresh-respawn strategy) simply omits it.
   */
  checkpoint?: Checkpoint;
}

/** Context handed to a task's `run` thunk. */
export interface BackgroundRunContext {
  /** The task's id, available before `spawn` returns (which the run predates). */
  taskId: string;
  /** Aborted when the task is stopped or times out. */
  signal: AbortSignal;
  /** Stream a chunk of output into the task's log + ring buffer. */
  emit: (chunk: string) => void;
}

/** Everything needed to launch one background task. */
export interface BackgroundSpawnRequest {
  /** The child node the task delegates to. */
  childNode: string;
  /** Subagent identity surfaced to the model as `agent_id`. */
  agentId: string;
  /** Human-readable description of the work. */
  description: string;
  /** The detached work itself. Must honour `ctx.signal`. */
  run: (ctx: BackgroundRunContext) => Promise<BackgroundLaunchResult>;
  /** Optional wall-clock cap; on expiry the task is aborted as `timed_out`. */
  timeoutMs?: number;
}

/** A terminal-notification event for the completion injector / UI. */
export interface BackgroundNotification {
  info: BackgroundTaskInfo;
}

export type BackgroundNotificationListener = (
  event: BackgroundNotification
) => void;

/** Raised when a spawn would exceed the running-task ceiling. */
export class BackgroundCapacityError extends Error {
  constructor(
    readonly running: number,
    readonly max: number
  ) {
    super(
      `Too many background tasks running (${running}/${max}). Wait for one ` +
        `to finish (check subagent://list) before starting another.`
    );
    this.name = 'BackgroundCapacityError';
  }
}

/** Live, non-serialized handle bits for a running task. */
interface LiveTask {
  info: BackgroundTaskInfo;
  controller: AbortController;
  /** Ring buffer of recent output for `since`-based tailing. */
  buffer: Buffer;
  /** Leading bytes dropped to the cap, so cursors stay lifetime-absolute. */
  droppedBytes: number;
  /** Total bytes ever emitted (cursor space). */
  totalBytes: number;
  /** The saved child checkpoint, kept in-memory for immediate resume. */
  checkpoint?: Checkpoint;
  /** Timeout timer, cleared on settle. */
  timer?: ReturnType<typeof setTimeout>;
}

export interface BackgroundTaskManagerOptions {
  /** Durable store. Defaults to an in-memory store (session-lived tasks). */
  store?: BackgroundTaskStore;
  /** Max concurrently-running tasks. Default 8. */
  maxRunning?: number;
  /** Per-task output ring-buffer cap in bytes. Default 1 MiB. */
  maxBufferBytes?: number;
}

/**
 * Passive manager for background subagents — the runtime analogue of the reference agent's
 * `BackgroundManager`. It owns the task table, per-task output ring buffers, a
 * concurrency governor, and a durable {@link BackgroundTaskStore}; it does NOT
 * know how to run an agent (the `run` thunk supplies that), which keeps it
 * decoupled from `Runtime` and independently testable.
 *
 * Created by the host and shared into BOTH the `Runtime` (via
 * `RuntimeOptions.background`, for the `subagent://` tools) AND the harness
 * injectors (which surface completions back into the parent's context). This
 * mirrors how the `AgentRegistry` is shared for foreground delegations.
 */
export class BackgroundTaskManager {
  private readonly store: BackgroundTaskStore;
  private readonly maxRunning: number;
  private readonly maxBufferBytes: number;
  private readonly tasks = new Map<string, LiveTask>();
  private readonly order: string[] = [];
  private readonly listeners = new Set<BackgroundNotificationListener>();
  private counter = 0;

  constructor(options: BackgroundTaskManagerOptions = {}) {
    this.store = options.store ?? new MemoryBackgroundTaskStore();
    this.maxRunning = options.maxRunning ?? DEFAULT_MAX_RUNNING;
    this.maxBufferBytes = options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES;
  }

  /** How many tasks are currently `running`. */
  runningCount(): number {
    let n = 0;
    for (const id of this.order) {
      if (this.tasks.get(id)?.info.status === 'running') n++;
    }
    return n;
  }

  /**
   * Launch a task detached. Returns the `running` record immediately; the
   * `run` thunk settles it later. Throws {@link BackgroundCapacityError} when
   * the running ceiling is reached (the caller surfaces this to the model).
   */
  spawn(request: BackgroundSpawnRequest): BackgroundTaskInfo {
    const running = this.runningCount();
    if (running >= this.maxRunning) {
      throw new BackgroundCapacityError(running, this.maxRunning);
    }

    const taskId = this.mintId();
    const controller = new AbortController();
    const info: BackgroundTaskInfo = {
      taskId,
      kind: 'agent',
      childNode: request.childNode,
      agentId: request.agentId,
      description: request.description,
      status: 'running',
      startedAt: new Date().toISOString(),
    };
    const live: LiveTask = {
      info,
      controller,
      buffer: Buffer.alloc(0),
      droppedBytes: 0,
      totalBytes: 0,
    };
    this.tasks.set(taskId, live);
    this.order.push(taskId);
    void this.store.saveTask({ ...info });

    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      live.timer = setTimeout(() => {
        if (info.status === 'running') {
          controller.abort(new Error('background task timed out'));
        }
      }, request.timeoutMs);
      // Don't keep the event loop alive solely for this timer.
      live.timer.unref?.();
    }

    const ctx: BackgroundRunContext = {
      taskId,
      signal: controller.signal,
      emit: (chunk: string) => this.append(live, chunk),
    };

    // Fire-and-forget: the promise settles the record, never rejects outward.
    void request
      .run(ctx)
      .then(result => {
        this.settle(live, 'completed', {
          resultText: result.assistantText,
          steps: result.steps,
          checkpoint: result.checkpoint,
        });
      })
      .catch((err: unknown) => {
        // Distinguish a deliberate stop/timeout from a genuine crash. A stop or
        // timeout aborts OUR controller; but the run thunk may also chain the
        // parent turn's signal (see spawnBackground's linkSignals), and a PARENT
        // abort tears the child down WITHOUT touching our controller — the child
        // just throws an AbortError. Both are teardowns, not crashes, so we
        // treat an abort from either source as `killed`/`timed_out`, never
        // `failed`. Missing this pinned parent-aborted children as `failed` with
        // a spurious AbortError string and fired a bogus completion notice.
        const errIsAbort = (err as { name?: string })?.name === 'AbortError';
        if (controller.signal.aborted || errIsAbort) {
          const reason = controller.signal.aborted
            ? controller.signal.reason
            : ((err as { reason?: unknown })?.reason ?? err);
          const timedOut =
            reason instanceof Error && /timed out/i.test(reason.message);
          this.settle(live, timedOut ? 'timed_out' : 'killed', {
            stopReason: String(
              (reason as { message?: string })?.message ?? reason ?? 'stopped'
            ),
          });
        } else {
          this.settle(live, 'failed', { error: String(err) });
        }
      });

    return { ...info };
  }

  /** Move a running task to a terminal state, persist, and notify. */
  private settle(
    live: LiveTask,
    status: Exclude<BackgroundTaskStatus, 'running' | 'lost'>,
    fields: {
      resultText?: string;
      steps?: number;
      checkpoint?: Checkpoint;
      error?: string;
      stopReason?: string;
    }
  ): void {
    // Idempotent: a stop() racing with a natural finish must not double-settle.
    if (isBackgroundTaskTerminal(live.info.status)) return;
    if (live.timer) {
      clearTimeout(live.timer);
      live.timer = undefined;
    }
    live.info.status = status;
    live.info.endedAt = new Date().toISOString();
    if (fields.resultText !== undefined)
      live.info.resultText = fields.resultText;
    if (fields.steps !== undefined) live.info.steps = fields.steps;
    if (fields.error !== undefined) live.info.error = fields.error;
    if (fields.stopReason !== undefined)
      live.info.stopReason = fields.stopReason;
    if (fields.checkpoint) {
      live.checkpoint = fields.checkpoint;
      void this.store.saveCheckpoint({
        taskId: live.info.taskId,
        checkpoint: fields.checkpoint,
      });
    }
    void this.store.saveTask({ ...live.info });

    const event: BackgroundNotification = { info: { ...live.info } };
    for (const l of this.listeners) l(event);
  }

  /** Append output to a task's ring buffer + durable log, enforcing the cap. */
  private append(live: LiveTask, chunk: string): void {
    const bytes = Buffer.from(chunk, 'utf8');
    live.totalBytes += bytes.byteLength;
    live.buffer = Buffer.concat([live.buffer, bytes]);
    if (live.buffer.byteLength > this.maxBufferBytes) {
      const overflow = live.buffer.byteLength - this.maxBufferBytes;
      live.buffer = live.buffer.subarray(overflow);
      live.droppedBytes += overflow;
    }
    void this.store.appendOutput(live.info.taskId, chunk);
  }

  private mintId(): string {
    // `task-<8 lowercase base36 chars>`, matching the reference agent's id shape. Uniqueness
    // is belt-and-suspenders: a monotonic counter mixed into the entropy so
    // two spawns in the same millisecond can never collide.
    this.counter += 1;
    const rand = Math.abs((this.counter * 2654435761) ^ Date.now()).toString(
      36
    );
    return `task-${(rand + '00000000').slice(0, 8)}`;
  }

  private require(taskId: string): LiveTask {
    const live = this.tasks.get(taskId);
    if (!live) throw new Error(`unknown background task: ${taskId}`);
    return live;
  }

  /** Snapshot every task record in spawn order. */
  list(): BackgroundTaskInfo[] {
    return this.order
      .map(id => this.tasks.get(id))
      .filter((t): t is LiveTask => !!t)
      .map(t => ({ ...t.info }));
  }

  /** Look up one task record by id, or undefined. */
  get(taskId: string): BackgroundTaskInfo | undefined {
    const live = this.tasks.get(taskId);
    return live ? { ...live.info } : undefined;
  }

  /** Resolve a task by its `taskId` OR its `agentId` (separate namespaces). */
  resolve(idOrAgentId: string): BackgroundTaskInfo | undefined {
    const byTask = this.get(idOrAgentId);
    if (byTask) return byTask;
    for (const id of this.order) {
      const live = this.tasks.get(id);
      if (live?.info.agentId === idOrAgentId) return { ...live.info };
    }
    return undefined;
  }

  /**
   * Read a task's buffered output. Without `since`, returns the whole ring
   * buffer; with `since` (a lifetime-absolute cursor), returns bytes after it.
   * `nextCursor` is always the lifetime total so a tailing caller stays
   * consistent across drops.
   */
  output(
    taskId: string,
    since?: number
  ): { chunk: string; nextCursor: number } {
    const live = this.require(taskId);
    const from =
      since === undefined
        ? 0
        : Math.min(
            Math.max(0, since - live.droppedBytes),
            live.buffer.byteLength
          );
    return {
      chunk: live.buffer.subarray(from).toString('utf8'),
      nextCursor: live.totalBytes,
    };
  }

  /** Retrieve a completed task's saved child checkpoint, if any. */
  async loadCheckpoint(taskId: string): Promise<Checkpoint | undefined> {
    const live = this.tasks.get(taskId);
    if (live?.checkpoint) return live.checkpoint;
    return this.store.loadCheckpoint(taskId);
  }

  /**
   * Stop a running task: abort its signal (which the runner honours) and mark
   * it `killed`. No-op on an already-terminal task. `suppressNotification`
   * silences the completion injector — the model explicitly stopped it, so
   * re-announcing the stop is noise.
   */
  async stop(
    taskId: string,
    reason?: string,
    suppressNotification = true
  ): Promise<BackgroundTaskInfo> {
    const live = this.require(taskId);
    if (isBackgroundTaskTerminal(live.info.status)) return { ...live.info };
    live.info.notificationSuppressed = suppressNotification;
    live.controller.abort(new Error(reason ?? 'stopped by request'));
    // The run() rejection path settles the record to `killed`; if the runner
    // ignores the signal and never rejects, settle defensively here.
    if (!isBackgroundTaskTerminal(live.info.status)) {
      this.settle(live, 'killed', {
        stopReason: reason ?? 'stopped by request',
      });
    }
    return { ...live.info };
  }

  // -------------------------------------------------------------------------
  // Notifications — consumed by the harness completion/active injectors.
  // -------------------------------------------------------------------------

  /** Subscribe to terminal notifications. Returns an unsubscribe function. */
  onNotify(listener: BackgroundNotificationListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Terminal tasks whose completion hasn't been announced to the parent yet. */
  pendingNotifications(): BackgroundTaskInfo[] {
    return this.list().filter(
      t =>
        isBackgroundTaskTerminal(t.status) &&
        !t.notified &&
        !t.notificationSuppressed
    );
  }

  /** Tasks still running (for post-compaction re-injection). */
  activeTasks(): BackgroundTaskInfo[] {
    return this.list().filter(t => t.status === 'running');
  }

  /** Mark a task's completion as delivered so it isn't re-announced. */
  markNotified(taskId: string): void {
    const live = this.tasks.get(taskId);
    if (live) {
      live.info.notified = true;
      void this.store.saveTask({ ...live.info });
    }
  }

  // -------------------------------------------------------------------------
  // Reconcile — cross-session recovery of orphaned tasks.
  // -------------------------------------------------------------------------

  /**
   * Load persisted tasks from the store and adopt them into this session.
   * Any task the store still records as `running` has no live promise to
   * settle it (its process died), so it is declared `lost` and re-announced
   * once. Completed tasks are re-hydrated (with their output + checkpoint) so
   * the model can still read their results or resume them. Idempotent per id.
   */
  async reconcile(seed?: BackgroundTaskInfo[]): Promise<BackgroundTaskInfo[]> {
    // A caller restoring from a Checkpoint passes the checkpoint's records as
    // `seed`; persist them first so they're picked up alongside anything the
    // durable store already holds (a no-op when the store is authoritative).
    if (seed?.length) {
      for (const info of seed) await this.store.saveTask({ ...info });
    }
    const persisted = await this.store.loadTasks();
    const recovered: BackgroundTaskInfo[] = [];
    for (const info of persisted) {
      if (this.tasks.has(info.taskId)) continue;

      const adopted: BackgroundTaskInfo = { ...info };
      if (adopted.status === 'running') {
        adopted.status = 'lost';
        adopted.endedAt = adopted.endedAt ?? new Date().toISOString();
        adopted.stopReason =
          adopted.stopReason ?? 'process exited while task was running';
        // Re-announce a task that finished (or was lost) during the outage.
        adopted.notified = false;
      }

      const buffer = Buffer.from(
        (await this.store.loadOutput(info.taskId)) ?? '',
        'utf8'
      );
      const trimmed =
        buffer.byteLength > this.maxBufferBytes
          ? buffer.subarray(buffer.byteLength - this.maxBufferBytes)
          : buffer;
      const live: LiveTask = {
        info: adopted,
        controller: new AbortController(),
        buffer: trimmed,
        droppedBytes: buffer.byteLength - trimmed.byteLength,
        totalBytes: buffer.byteLength,
        checkpoint: await this.store.loadCheckpoint(info.taskId),
      };
      this.tasks.set(info.taskId, live);
      this.order.push(info.taskId);
      if (adopted.status !== info.status) {
        await this.store.saveTask({ ...adopted });
        for (const l of this.listeners) l({ info: { ...adopted } });
      }
      recovered.push({ ...adopted });
    }
    return recovered;
  }

  /** Abort every running task. Called on session shutdown. */
  async disposeAll(): Promise<void> {
    await Promise.all(
      this.order
        .map(id => this.tasks.get(id))
        .filter((t): t is LiveTask => !!t && t.info.status === 'running')
        .map(t => this.stop(t.info.taskId, 'session shutdown'))
    );
  }
}
