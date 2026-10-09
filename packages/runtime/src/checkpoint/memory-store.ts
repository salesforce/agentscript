/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Checkpoint, CheckpointStore } from './types.js';

export class MemoryCheckpointStore implements CheckpointStore {
  private store = new Map<string, Checkpoint>();

  // eslint-disable-next-line @typescript-eslint/require-await -- interface requires Promise return
  async save(checkpoint: Checkpoint): Promise<string> {
    this.store.set(checkpoint.id, structuredClone(checkpoint));
    return checkpoint.id;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async load(id: string): Promise<Checkpoint | null> {
    const cp = this.store.get(id);
    return cp ? structuredClone(cp) : null;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async list(filter?: { limit?: number }): Promise<string[]> {
    const ids = [...this.store.keys()].reverse();
    return filter?.limit ? ids.slice(0, filter.limit) : ids;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async delete(id: string): Promise<void> {
    this.store.delete(id);
  }
}
