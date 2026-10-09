import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FileCheckpointStore,
  CHECKPOINT_SCHEMA_VERSION,
} from '../src/index.js';
import type { Checkpoint } from '../src/index.js';

describe('FileCheckpointStore', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fs-checkpoint-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeCheckpoint(
    id: string,
    overrides?: Partial<Checkpoint>
  ): Checkpoint {
    return {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      id,
      currentNode: 'greeting',
      history: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello!' },
      ],
      stateValues: { counter: 5, nested: { a: 1, b: [1, 2, 3] } },
      metadata: { reason: 'test' },
      ...overrides,
    };
  }

  it('save -> load round-trip preserves the full checkpoint', async () => {
    const store = new FileCheckpointStore(dir);
    const cp = makeCheckpoint('session-1');

    const id = await store.save(cp);
    expect(id).toBe('session-1');

    const loaded = await store.load('session-1');
    expect(loaded).toEqual(cp);
    expect(loaded!.history).toEqual(cp.history);
    expect(loaded!.stateValues).toEqual(cp.stateValues);
    expect(loaded!.currentNode).toBe(cp.currentNode);
    expect(loaded!.metadata).toEqual(cp.metadata);
  });

  it('load of an unknown id returns null', async () => {
    const store = new FileCheckpointStore(dir);
    const loaded = await store.load('does-not-exist');
    expect(loaded).toBeNull();
  });

  it('list returns newest-first and honors limit', async () => {
    const store = new FileCheckpointStore(dir);

    await store.save(makeCheckpoint('cp-1'));
    await new Promise(resolve => setTimeout(resolve, 10));
    await store.save(makeCheckpoint('cp-2'));
    await new Promise(resolve => setTimeout(resolve, 10));
    await store.save(makeCheckpoint('cp-3'));

    const ids = await store.list();
    expect(ids).toEqual(['cp-3', 'cp-2', 'cp-1']);

    const limited = await store.list({ limit: 2 });
    expect(limited).toEqual(['cp-3', 'cp-2']);
  });

  it('delete removes a checkpoint; subsequent load returns null', async () => {
    const store = new FileCheckpointStore(dir);
    await store.save(makeCheckpoint('cp-1'));

    await store.delete('cp-1');
    const loaded = await store.load('cp-1');
    expect(loaded).toBeNull();
  });

  it('deleting a missing id does not throw', async () => {
    const store = new FileCheckpointStore(dir);
    await expect(store.delete('never-existed')).resolves.toBeUndefined();
  });

  it('a path-traversal id does not escape the store directory', async () => {
    const store = new FileCheckpointStore(dir);
    const cp = makeCheckpoint('../evil');

    await store.save(cp);

    // Nothing should have been written outside the store directory.
    const parentDir = join(dir, '..');
    const parentEntries = await readdir(parentDir);
    expect(parentEntries).not.toContain('evil.json');
    expect(parentEntries).not.toContain('evil');

    // The checkpoint should still be reachable through the store's own API,
    // confined to the intended directory.
    const loaded = await store.load('../evil');
    expect(loaded).toEqual(cp);

    // And the file should physically live inside the store directory.
    const entries = await readdir(dir);
    expect(entries.some(name => name.endsWith('.json'))).toBe(true);
    for (const name of entries) {
      expect(name.includes('/')).toBe(false);
      expect(name.startsWith('..')).toBe(false);
    }
  });

  it('another absolute-path-like id also stays confined', async () => {
    const store = new FileCheckpointStore(dir);
    const cp = makeCheckpoint('/etc/passwd');

    await store.save(cp);

    const entries = await readdir(dir);
    expect(entries.length).toBeGreaterThan(0);
    for (const name of entries) {
      expect(name.includes('/')).toBe(false);
    }

    const loaded = await store.load('/etc/passwd');
    expect(loaded).toEqual(cp);
  });
});
