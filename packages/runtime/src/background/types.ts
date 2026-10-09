/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Checkpoint } from '../checkpoint/types.js';

/**
 * Background subagents + Task tools — ported from the reference agent's `agent/background/`.
 *
 * A background task is a subagent (a child node) that the parent launched with
 * `run_in_background: true`: instead of the parent's turn blocking on the child
 * (the synchronous `delegate` path), the child runs DETACHED against an
 * isolated clone of parent state while the parent keeps reasoning. The parent
 * later pulls the child's result via the `subagent://` Task tools, and a
 * completion is pushed back into the parent's context by the harness injectors.
 *
 * The reference agent manages three task kinds (process / agent / question); we port only the
 * `agent` kind — OS processes are already covered by the harness
 * `ProcessManager`, and the question kind maps onto our elicitation layer. The
 * manager itself is kind-agnostic so a future port can add more.
 */

/**
 * Lifecycle of a background task. `running` → one of the terminal states.
 * Mirrors the reference agent's `BackgroundTaskStatus`. `lost` is reconcile-only: a task that
 * was `running` when the process died and is discovered again on restart (it
 * has no live promise to settle it, so it can only be declared lost).
 */
export type BackgroundTaskStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'killed'
  | 'lost';

/** The terminal statuses — a task in any of these will never run again. */
export const TERMINAL_BACKGROUND_STATUSES: ReadonlySet<BackgroundTaskStatus> =
  new Set(['completed', 'failed', 'timed_out', 'killed', 'lost']);

/** True when `status` is terminal (the task is done, one way or another). */
export function isBackgroundTaskTerminal(
  status: BackgroundTaskStatus
): boolean {
  return TERMINAL_BACKGROUND_STATUSES.has(status);
}

/**
 * Serializable record for one background task. This is the unit that persists
 * to disk and rides a {@link Checkpoint} — it holds NO live handles (promise,
 * abort controller), only the observable facts a UI or a later step needs.
 */
export interface BackgroundTaskInfo {
  /** Stable id assigned at registration. `task-<8 lowercase base36 chars>`. */
  taskId: string;
  /** The only kind we currently port. Kept for forward-compatibility. */
  kind: 'agent';
  /** The child node the task delegates to. */
  childNode: string;
  /**
   * Display label for the subagent identity, surfaced to the model as
   * `agent_id`. Distinct from `taskId` (the reference agent keeps the two namespaces apart);
   * defaults to the child node name.
   */
  agentId: string;
  /** Human-readable description of what the task is doing. */
  description: string;
  /** Where the task sits in its lifecycle. */
  status: BackgroundTaskStatus;
  /** ISO timestamp the task was registered. */
  startedAt: string;
  /** ISO timestamp the task reached a terminal status. Absent while running. */
  endedAt?: string;
  /** LLM steps the child took (set on settle). */
  steps?: number;
  /** The child's final `assistantText` (set on successful completion). */
  resultText?: string;
  /** Error message (set on `failed`). */
  error?: string;
  /** Why the task was stopped (set on `killed` / `timed_out` / `lost`). */
  stopReason?: string;
  /**
   * True once a terminal notification for this task has been delivered into the
   * parent's context (so the completion injector doesn't re-announce it). Reset
   * to false across a reconcile so a task that finished during a crash is
   * re-announced once on restart.
   */
  notified?: boolean;
  /**
   * Whether the terminal notification is suppressed (the model stopped the task
   * explicitly via `subagent://stop`, so re-announcing it is noise).
   */
  notificationSuppressed?: boolean;
}

/**
 * A completed child's saved runtime state, stored alongside the task record so
 * `subagent://resume` can reconstruct the child via `Runtime.fromCheckpoint`
 * and continue its conversation. This is the true-resume mechanism (as opposed
 * to a fresh re-spawn) and reuses the existing checkpoint infra wholesale.
 */
export interface BackgroundChildCheckpoint {
  taskId: string;
  checkpoint: Checkpoint;
}

/**
 * PORT — durable storage for background task records + their output logs +
 * child checkpoints. Mirrors the reference agent's `BackgroundTaskPersistence`. The memory
 * default keeps everything in-process (tasks live for the session); the harness
 * ships a filesystem store for cross-session survival + `lost` reconcile.
 */
export interface BackgroundTaskStore {
  /** Persist (create or overwrite) a task record. */
  saveTask(info: BackgroundTaskInfo): Promise<void>;
  /** Append to a task's authoritative output log. */
  appendOutput(taskId: string, chunk: string): Promise<void>;
  /** Persist a completed child's checkpoint for later resume. */
  saveCheckpoint(entry: BackgroundChildCheckpoint): Promise<void>;
  /** Load every persisted task record (for reconcile on startup). */
  loadTasks(): Promise<BackgroundTaskInfo[]>;
  /** Load a task's full output log, or undefined if none was persisted. */
  loadOutput(taskId: string): Promise<string | undefined>;
  /** Load a task's saved child checkpoint, or undefined. */
  loadCheckpoint(taskId: string): Promise<Checkpoint | undefined>;
  /** Remove a task record + its output log + checkpoint. */
  deleteTask(taskId: string): Promise<void>;
}
