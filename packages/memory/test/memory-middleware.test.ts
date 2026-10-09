/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { Msg } from '@agentscript/runtime';

import { HashEmbedder } from '../src/hash-embedder.js';
import { SemanticMemory } from '../src/semantic-memory.js';
import { WorkingMemory } from '../src/working-memory.js';
import { createMemoryMiddleware } from '../src/memory-middleware.js';
import { resolveMemory } from '../src/resolve-memory.js';
import type { Embedder, Vector } from '../src/types.js';

function userMsg(content: string): Msg {
  return { role: 'user', content };
}

/**
 * Drive one full turn through the middleware seams the way the runtime pipeline
 * would: beforeTurn, then N beforeLlmStep iterations, then afterTurn. Returns
 * the messages appended across all beforeLlmStep calls.
 */
async function runTurn(
  mw: ReturnType<typeof createMemoryMiddleware>,
  opts: {
    userInput: string;
    messages: Msg[];
    iterations?: number;
    assistantText?: string;
  }
): Promise<Msg[]> {
  const iterations = opts.iterations ?? 1;
  await mw.beforeTurn?.({ userInput: opts.userInput, node: 'n', state: {} });

  const appended: Msg[] = [];
  let messages = [...opts.messages];
  for (let i = 0; i < iterations; i++) {
    const r = await mw.beforeLlmStep?.({
      node: 'n',
      state: {},
      system: '',
      messages,
      tools: [],
    });
    if (r?.appendMessages) {
      appended.push(...r.appendMessages);
      messages = [...messages, ...r.appendMessages];
    }
  }

  await mw.afterTurn?.({
    assistantText: opts.assistantText ?? '',
    finalNode: 'n',
    state: {},
    events: [],
  });
  return appended;
}

describe('createMemoryMiddleware', () => {
  it('injects recall of a prior-turn fact once per turn, with no re-embed on later iterations', async () => {
    const embedder = new HashEmbedder(256);
    const embedSpy = vi.spyOn(embedder, 'embed');
    const semantic = new SemanticMemory({ embedder });
    const mw = createMemoryMiddleware({ semantic, threadId: 't1' });

    // Turn 1: user states a fact; assistant acknowledges. Nothing to recall yet.
    const t1 = await runTurn(mw, {
      userInput: 'My order number is A-4471.',
      messages: [userMsg('My order number is A-4471.')],
      assistantText: 'Got it, order A-4471.',
    });
    expect(t1).toHaveLength(0);

    // Turn 2: ask about it across 3 loop iterations. Recall must fire exactly
    // once and surface the turn-1 fact.
    const callsBeforeTurn2 = embedSpy.mock.calls.length;
    const t2 = await runTurn(mw, {
      userInput: 'What was my order number?',
      messages: [userMsg('What was my order number?')],
      iterations: 3,
      assistantText: 'Your order number is A-4471.',
    });

    const recallReminders = t2.filter(
      m =>
        typeof m.content === 'string' &&
        m.content.includes('variant="memory-recall"')
    );
    expect(recallReminders).toHaveLength(1);
    expect(recallReminders[0].content).toContain('A-4471');

    // Exactly one recall embed happened during turn 2's beforeLlmStep loop
    // (the two afterTurn persist-embeds are batched into one embed call each).
    const embedTextsInTurn2 = embedSpy.mock.calls
      .slice(callsBeforeTurn2)
      .map(c => c[0]);
    const recallEmbeds = embedTextsInTurn2.filter(
      texts => texts.length === 1 && texts[0] === 'What was my order number?'
    );
    expect(recallEmbeds).toHaveLength(1);
  });

  it('recalls a prior fact even with topK=1 (no self-recall of the current input)', async () => {
    const semantic = new SemanticMemory({ embedder: new HashEmbedder(256) });
    const mw = createMemoryMiddleware({
      semantic,
      threadId: 't1',
      recall: { topK: 1 },
    });

    await runTurn(mw, {
      userInput: 'Remember: the deploy key lives in vault path secret/deploy.',
      messages: [
        userMsg('Remember: the deploy key lives in vault path secret/deploy.'),
      ],
      assistantText: 'Noted.',
    });

    const t2 = await runTurn(mw, {
      userInput: 'Where does the deploy key live?',
      messages: [userMsg('Where does the deploy key live?')],
      assistantText: 'In vault path secret/deploy.',
    });
    const recall = t2.find(
      m =>
        typeof m.content === 'string' &&
        m.content.includes('variant="memory-recall"')
    );
    expect(recall?.content).toContain('secret/deploy');
  });

  it('persists user and assistant with distinct unique ids so multiple facts are recallable', async () => {
    const semantic = new SemanticMemory({ embedder: new HashEmbedder(256) });
    const mw = createMemoryMiddleware({ semantic, threadId: 't1' });

    await runTurn(mw, {
      userInput: 'My flight is to Tokyo.',
      messages: [userMsg('My flight is to Tokyo.')],
      assistantText: 'Flight to Tokyo saved.',
    });
    await runTurn(mw, {
      userInput: 'My hotel is the Prince.',
      messages: [userMsg('My hotel is the Prince.')],
      assistantText: 'Hotel Prince saved.',
    });

    // Four distinct entries (2 user + 2 assistant), none clobbered.
    expect(
      await semantic.recall('anything', { threadId: 't1', topK: 10 })
    ).toHaveLength(4);

    const flight = await semantic.recall('where is my flight going', {
      threadId: 't1',
      topK: 1,
    });
    expect(flight[0].text).toContain('Tokyo');
    const hotel = await semantic.recall('which hotel', {
      threadId: 't1',
      topK: 1,
    });
    expect(hotel[0].text).toContain('Prince');
  });

  it('injects the working-memory document when present', async () => {
    const working = new WorkingMemory();
    await working.write({ threadId: 't1' }, 'User name: Dana. Tier: gold.');
    const mw = createMemoryMiddleware({ working, threadId: 't1' });

    const appended = await runTurn(mw, {
      userInput: 'hi',
      messages: [userMsg('hi')],
    });
    const workingReminder = appended.find(
      m =>
        typeof m.content === 'string' &&
        m.content.includes('variant="memory-working"')
    );
    expect(workingReminder?.content).toContain('Dana');
  });

  it('fails open when the embedder throws', async () => {
    const throwing: Embedder = {
      dimensions: 8,
      model: 'boom',
      embed: (): Promise<Vector[]> =>
        Promise.reject(new Error('embedder down')),
    };
    const semantic = new SemanticMemory({ embedder: throwing });
    const mw = createMemoryMiddleware({ semantic, threadId: 't1' });

    // failOpen is declared; the pipeline swallows the throw. Here we assert the
    // seam itself rejects (pipeline catches it) and the flag is set.
    expect(mw.failOpen).toBe(true);
    await expect(
      mw.beforeLlmStep?.({
        node: 'n',
        state: {},
        system: '',
        messages: [userMsg('question')],
        tools: [],
      })
    ).rejects.toThrow('embedder down');
  });
});

describe('resolveMemory', () => {
  it('builds a fully offline stack from `true`', () => {
    const resolved = resolveMemory(true);
    expect(resolved.threadId).toBe('default');
    expect(resolved.semantic).toBeInstanceOf(SemanticMemory);
    expect(resolved.working).toBeInstanceOf(WorkingMemory);
    expect(resolved.middleware.name).toBe('memory:recall');
    expect(resolved.middleware.priority).toBe(450);
  });

  it('threads threadId/resourceId through to recall scoping', async () => {
    const resolved = resolveMemory({
      threadId: 'thread-9',
      resourceId: 'user-9',
    });
    await resolved.semantic.remember({
      id: 'x',
      text: 'scoped fact',
      threadId: 'thread-9',
      resourceId: 'user-9',
    });
    const hits = await resolved.semantic.recall('scoped fact', {
      threadId: 'thread-9',
      topK: 1,
    });
    expect(hits[0]?.text).toBe('scoped fact');
  });
});
