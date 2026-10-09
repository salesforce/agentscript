/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { HashEmbedder } from '../src/hash-embedder.js';
import { SemanticMemory } from '../src/semantic-memory.js';

function memory() {
  return new SemanticMemory({ embedder: new HashEmbedder() });
}

describe('SemanticMemory', () => {
  it('recalls the most relevant remembered entry', async () => {
    const mem = memory();
    await mem.rememberMany([
      { id: '1', text: 'my flight to Tokyo is on March 3', threadId: 't1' },
      { id: '2', text: 'I prefer window seats', threadId: 't1' },
      { id: '3', text: 'the hotel has a rooftop pool', threadId: 't1' },
    ]);
    const hits = await mem.recall('when is my flight to Tokyo', { topK: 1 });
    expect(hits[0].id).toBe('1');
    expect(hits[0].text).toContain('Tokyo');
    expect(hits[0].score).toBeGreaterThan(0);
  });

  it('scopes recall to a thread', async () => {
    const mem = memory();
    await mem.rememberMany([
      { id: 'a', text: 'password reset link expired', threadId: 't1' },
      { id: 'b', text: 'password reset link expired', threadId: 't2' },
    ]);
    const hits = await mem.recall('password reset', {
      threadId: 't2',
      topK: 10,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0].id).toBe('b');
    expect(hits[0].threadId).toBe('t2');
  });

  it('scopes recall to a resource across threads', async () => {
    const mem = memory();
    await mem.rememberMany([
      {
        id: 'a',
        text: 'billing question about invoice',
        threadId: 't1',
        resourceId: 'user-1',
      },
      {
        id: 'b',
        text: 'billing question about invoice',
        threadId: 't2',
        resourceId: 'user-1',
      },
      {
        id: 'c',
        text: 'billing question about invoice',
        threadId: 't3',
        resourceId: 'user-2',
      },
    ]);
    const hits = await mem.recall('invoice billing', {
      resourceId: 'user-1',
      topK: 10,
    });
    expect(hits.map(h => h.id).sort()).toEqual(['a', 'b']);
  });

  it('preserves role and metadata round-trip', async () => {
    const mem = memory();
    await mem.remember({
      id: '1',
      text: 'hello there',
      threadId: 't1',
      role: 'user',
      createdAt: '2026-07-14T00:00:00.000Z',
      metadata: { source: 'chat' },
    });
    const [hit] = await mem.recall('hello', { topK: 1 });
    expect(hit.role).toBe('user');
    expect(hit.createdAt).toBe('2026-07-14T00:00:00.000Z');
    expect(hit.metadata).toEqual({ source: 'chat' });
  });

  it('forgets a thread', async () => {
    const mem = memory();
    await mem.rememberMany([
      { id: 'a', text: 'one', threadId: 't1' },
      { id: 'b', text: 'two', threadId: 't1' },
      { id: 'c', text: 'three', threadId: 't2' },
    ]);
    const removed = await mem.forgetThread('t1');
    expect(removed).toBe(2);
    const hits = await mem.recall('one two three', { topK: 10 });
    expect(hits.map(h => h.id)).toEqual(['c']);
  });

  it('remembering an empty batch is a no-op', async () => {
    const mem = memory();
    await mem.rememberMany([]);
    expect(await mem.recall('anything', { topK: 5 })).toEqual([]);
  });
});
