#!/usr/bin/env node
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smoke test for @agentscript/memory: drive the offline path end-to-end —
 * embed with the HashEmbedder, remember thread-scoped entries, recall by
 * similarity, and evolve working memory across turns. No API key required.
 */

import { HashEmbedder, SemanticMemory, WorkingMemory } from '../dist/index.js';

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

async function main() {
  const embedder = new HashEmbedder();
  assert(embedder.dimensions === 256, 'hash embedder has default 256 dims');

  const memory = new SemanticMemory({ embedder });
  await memory.rememberMany([
    {
      id: '1',
      text: 'my flight to Tokyo departs March 3rd',
      threadId: 'trip',
      role: 'user',
    },
    {
      id: '2',
      text: 'I always book window seats',
      threadId: 'trip',
      role: 'user',
    },
    {
      id: '3',
      text: 'the conference keynote is about databases',
      threadId: 'work',
    },
  ]);

  const flight = await memory.recall('when does my Tokyo flight leave', {
    threadId: 'trip',
    topK: 1,
  });
  assert(
    flight.length === 1 && flight[0].id === '1',
    'recall surfaces the flight entry'
  );
  assert(
    flight[0].score > 0,
    `recall score is positive (${flight[0].score.toFixed(3)})`
  );

  const scoped = await memory.recall('databases', {
    threadId: 'trip',
    topK: 10,
  });
  assert(
    scoped.every(h => h.threadId === 'trip'),
    'recall is scoped to the requested thread'
  );

  const wm = new WorkingMemory();
  await wm.append({ threadId: 'trip' }, 'destination: Tokyo');
  await wm.append({ threadId: 'trip' }, 'seat preference: window');
  const doc = await wm.read({ threadId: 'trip' });
  assert(
    doc === 'destination: Tokyo\nseat preference: window',
    'working memory accumulates facts across turns'
  );

  const removed = await memory.forgetThread('trip');
  assert(
    removed === 2,
    `forgetThread removed the thread's entries (${removed})`
  );

  console.log('\nsmoke-memory: PASS');
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err);
    process.exit(1);
  }
);
