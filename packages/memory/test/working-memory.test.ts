/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { WorkingMemory } from '../src/working-memory.js';

describe('WorkingMemory', () => {
  it('reads back what was written, scoped by thread', async () => {
    const wm = new WorkingMemory();
    await wm.write({ threadId: 't1' }, 'user name: Ada');
    expect(await wm.read({ threadId: 't1' })).toBe('user name: Ada');
    expect(await wm.read({ threadId: 't2' })).toBeNull();
  });

  it('scopes by resource when present (shared across threads)', async () => {
    const wm = new WorkingMemory();
    await wm.write(
      { threadId: 't1', resourceId: 'user-1' },
      'prefers dark mode'
    );
    // Same resource, different thread → same scope.
    expect(await wm.read({ threadId: 't2', resourceId: 'user-1' })).toBe(
      'prefers dark mode'
    );
  });

  it('appends lines', async () => {
    const wm = new WorkingMemory();
    await wm.append({ threadId: 't1' }, 'fact one');
    await wm.append({ threadId: 't1' }, 'fact two');
    expect(await wm.read({ threadId: 't1' })).toBe('fact one\nfact two');
  });

  it('truncates to the character cap, keeping the most recent tail', async () => {
    const wm = new WorkingMemory({ maxChars: 10 });
    await wm.write({ threadId: 't1' }, '0123456789ABCDEF');
    expect(await wm.read({ threadId: 't1' })).toBe('6789ABCDEF');
  });

  it('clears a scope', async () => {
    const wm = new WorkingMemory();
    await wm.write({ threadId: 't1' }, 'temp');
    await wm.clear({ threadId: 't1' });
    expect(await wm.read({ threadId: 't1' })).toBeNull();
  });

  it('honours a custom scope function', async () => {
    const wm = new WorkingMemory({ scopeOf: () => 'global' });
    await wm.write({ threadId: 't1' }, 'shared');
    expect(await wm.read({ threadId: 't2' })).toBe('shared');
  });
});
