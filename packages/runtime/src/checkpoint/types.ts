/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg } from '../llm/types.js';
import type { BackgroundTaskInfo } from '../background/types.js';

/**
 * v1 → v2: added the optional `backgroundTasks` field so a session's
 * background-subagent table survives a checkpoint/restore. v1 checkpoints
 * lack the field entirely; {@link migrateCheckpoint} folds them forward by
 * treating the table as empty (the true state — a v1 session had none).
 */
export const CHECKPOINT_SCHEMA_VERSION = 2;

export interface Checkpoint {
  schemaVersion: number;
  createdAt: string;
  id: string;
  currentNode: string;
  history: Msg[];
  stateValues: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  /**
   * Snapshot of the background-subagent table (v2+). Records only; live handles
   * (promise, abort controller, ring buffer) are never serialized. On restore
   * the manager reconciles these — any still-`running` task becomes `lost`.
   */
  backgroundTasks?: BackgroundTaskInfo[];
}

/**
 * Fold an older checkpoint forward to the current schema. Kept separate from
 * `fromCheckpoint` so the migration path is unit-testable in isolation. Throws
 * (via the caller) only on a FUTURE version we can't understand.
 */
export function migrateCheckpoint(checkpoint: Checkpoint): Checkpoint {
  if (checkpoint.schemaVersion === CHECKPOINT_SCHEMA_VERSION) {
    return checkpoint;
  }
  if (checkpoint.schemaVersion === 1) {
    // v1 predates background tasks — a v1 session had none.
    return {
      ...checkpoint,
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      backgroundTasks: checkpoint.backgroundTasks ?? [],
    };
  }
  return checkpoint;
}

export interface CheckpointStore {
  save(checkpoint: Checkpoint): Promise<string>;
  load(id: string): Promise<Checkpoint | null>;
  list(filter?: { limit?: number }): Promise<string[]>;
  delete(id: string): Promise<void>;
}
