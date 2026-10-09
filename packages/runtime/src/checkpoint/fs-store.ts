/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { Checkpoint, CheckpointStore } from './types.js';

/**
 * Sanitize a checkpoint id into a filesystem-safe filename fragment.
 *
 * Ids are expected to look like `session-1`, but nothing stops a caller from
 * handing us an id that contains `/`, `..`, or other path-traversal-flavored
 * characters. We escape anything outside a conservative allow-list so the
 * resulting filename can never leave the store directory.
 */
function sanitizeId(id: string): string {
  // Escape everything outside a conservative allow-list — notably `.` and
  // `/` — so the result can never contain a path separator or resolve to a
  // relative segment like `.` or `..`.
  return id.replace(
    /[^a-zA-Z0-9_-]/g,
    char => `_${char.charCodeAt(0).toString(16)}_`
  );
}

function filenameFor(id: string): string {
  return `${sanitizeId(id)}.json`;
}

/**
 * Durable, filesystem-backed {@link CheckpointStore}.
 *
 * Persists one JSON file per checkpoint under a directory, so sessions
 * survive a process restart (unlike {@link MemoryCheckpointStore}, which is
 * in-process only). Writes are atomic (write-to-temp-then-rename) so a crash
 * mid-write can't corrupt an existing checkpoint.
 */
export class FileCheckpointStore implements CheckpointStore {
  private readonly dir: string;
  private ensured = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  private async ensureDir(): Promise<void> {
    if (this.ensured) return;
    await fs.mkdir(this.dir, { recursive: true });
    this.ensured = true;
  }

  private pathFor(id: string): string {
    return path.join(this.dir, filenameFor(id));
  }

  async save(checkpoint: Checkpoint): Promise<string> {
    await this.ensureDir();
    const target = this.pathFor(checkpoint.id);
    const tmp = path.join(
      this.dir,
      `.tmp-${sanitizeId(checkpoint.id)}-${randomUUID()}.json`
    );
    const json = JSON.stringify(structuredClone(checkpoint), null, 2);
    await fs.writeFile(tmp, json, 'utf8');
    await fs.rename(tmp, target);
    return checkpoint.id;
  }

  async load(id: string): Promise<Checkpoint | null> {
    try {
      const raw = await fs.readFile(this.pathFor(id), 'utf8');
      return JSON.parse(raw) as Checkpoint;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async list(filter?: { limit?: number }): Promise<string[]> {
    await this.ensureDir();
    const entries = await fs.readdir(this.dir);
    const files = entries.filter(
      name => name.endsWith('.json') && !name.startsWith('.tmp-')
    );

    const stats = await Promise.all(
      files.map(async name => {
        const stat = await fs.stat(path.join(this.dir, name));
        return { name, mtimeMs: stat.mtimeMs };
      })
    );

    stats.sort((a, b) => b.mtimeMs - a.mtimeMs);

    const ids: string[] = [];
    for (const { name } of stats) {
      const raw = await fs.readFile(path.join(this.dir, name), 'utf8');
      const cp = JSON.parse(raw) as Checkpoint;
      ids.push(cp.id);
    }

    return filter?.limit ? ids.slice(0, filter.limit) : ids;
  }

  async delete(id: string): Promise<void> {
    try {
      await fs.unlink(this.pathFor(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
}
