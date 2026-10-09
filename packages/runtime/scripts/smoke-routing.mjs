#!/usr/bin/env node
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smoke test for model routing + cost tracking: compose a FallbackDriver over
 * a failing "primary" and a working "backup", wrap it in a CostTrackingDriver,
 * drive one step, and assert failover happened and cost was tallied. No API
 * key required — the drivers are in-process mocks.
 */

import {
  CostTracker,
  CostTrackingDriver,
  FallbackDriver,
} from '../dist/index.js';

function assert(cond, msg) {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
  console.log(`✓ ${msg}`);
}

const failing = {
  // eslint-disable-next-line require-yield
  async *step() {
    throw new Error('primary model unavailable (429)');
  },
};

const backup = {
  async *step() {
    yield { kind: 'text-delta', text: 'answer from backup' };
    yield {
      kind: 'usage',
      usage: { inputTokens: 800, outputTokens: 200 },
      model: 'backup-mini',
    };
    yield { kind: 'finish', reason: 'stop' };
  },
};

async function main() {
  const tracker = new CostTracker({
    'backup-mini': { inputPer1k: 0.001, outputPer1k: 0.002 },
  });

  let failedOver = false;
  const routed = new FallbackDriver({
    drivers: [
      { name: 'primary', driver: failing },
      { name: 'backup-mini', driver: backup },
    ],
    onFallover: () => {
      failedOver = true;
    },
  });
  const driver = new CostTrackingDriver(routed, tracker);

  const events = [];
  for await (const ev of driver.step({
    system: 's',
    messages: [],
    tools: [],
  })) {
    events.push(ev);
  }

  assert(failedOver, 'failed over from primary to backup');
  assert(
    events.some(
      e => e.kind === 'text-delta' && e.text === 'answer from backup'
    ),
    'received the backup driver output'
  );

  const snap = tracker.snapshot();
  assert(
    snap.totalTokens === 1000,
    `tracked 1000 tokens (got ${snap.totalTokens})`
  );
  // 800/1k*0.001 + 200/1k*0.002 = 0.0008 + 0.0004 = 0.0012
  assert(
    Math.abs(snap.costUsd - 0.0012) < 1e-9,
    `estimated cost $${snap.costUsd.toFixed(4)}`
  );
  assert(
    snap.byModel['backup-mini'].steps === 1,
    'cost attributed to backup-mini'
  );

  console.log(
    `\nrouted → backup-mini · ${snap.totalTokens} tok · $${snap.costUsd.toFixed(4)}`
  );
  console.log('smoke-routing: PASS');
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err);
    process.exit(1);
  }
);
