/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Checkpoint } from '../checkpoint/types.js';
import type {
  BackgroundChildCheckpoint,
  BackgroundTaskInfo,
  BackgroundTaskStore,
} from './types.js';

/**
 * In-memory {@link BackgroundTaskStore}. The default store when no durable one
 * is supplied — tasks live for the session and vanish on exit (so there is
 * nothing to reconcile after a restart). The harness ships a filesystem store
 * for cross-session survival.
 */
export class MemoryBackgroundTaskStore implements BackgroundTaskStore {
  private readonly records = new Map<string, BackgroundTaskInfo>();
  private readonly logs = new Map<string, string>();
  private readonly checkpoints = new Map<string, Checkpoint>();

  async saveTask(info: BackgroundTaskInfo): Promise<void> {
    this.records.set(info.taskId, { ...info });
  }

  async appendOutput(taskId: string, chunk: string): Promise<void> {
    this.logs.set(taskId, (this.logs.get(taskId) ?? '') + chunk);
  }

  async saveCheckpoint(entry: BackgroundChildCheckpoint): Promise<void> {
    this.checkpoints.set(entry.taskId, entry.checkpoint);
  }

  async loadTasks(): Promise<BackgroundTaskInfo[]> {
    return [...this.records.values()].map(r => ({ ...r }));
  }

  async loadOutput(taskId: string): Promise<string | undefined> {
    return this.logs.get(taskId);
  }

  async loadCheckpoint(taskId: string): Promise<Checkpoint | undefined> {
    return this.checkpoints.get(taskId);
  }

  async deleteTask(taskId: string): Promise<void> {
    this.records.delete(taskId);
    this.logs.delete(taskId);
    this.checkpoints.delete(taskId);
  }
}
