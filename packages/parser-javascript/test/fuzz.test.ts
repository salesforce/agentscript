/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Fuzz tester: applies random mutations to corpus inputs and asserts
 * parser invariants (no crashes, source preservation, valid CST structure).
 *
 * Modeled after tree-sitter's `tree-sitter fuzz` command.
 *
 * Configuration via environment variables:
 *   SEED             - PRNG seed for reproducibility (default: Date.now())
 *   FUZZ_ITERATIONS  - iterations per seed input (default: 100)
 *   FUZZ_MUTATIONS   - max mutations per iteration (default: 5)
 *
 * Reproduce a failure:
 *   SEED=12345 pnpm --filter @agentscript/parser-javascript test fuzz
 */

import { describe, it, beforeAll } from 'vitest';
import {
  SeededRandom,
  applyRandomMutations,
  assertNoCrash,
  assertSourcePreserved,
  assertValidCSTStructure,
  loadAllSeeds,
  djb2,
} from './fuzz-utils.js';

// ── Configuration ──────────────────────────────────────────────────

const SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : Date.now();
const ITERATIONS = parseInt(process.env.FUZZ_ITERATIONS ?? '100', 10);
const MAX_MUTATIONS = parseInt(process.env.FUZZ_MUTATIONS ?? '5', 10);

// ── Test Suite ──────────────────────────────────────────────────────

const seeds = loadAllSeeds(__dirname);

describe('fuzz: parser invariants under random mutations', () => {
  beforeAll(() => {
    console.log(
      `[fuzz] seed=${SEED} iterations=${ITERATIONS} maxMutations=${MAX_MUTATIONS} seedInputs=${seeds.length}`
    );
  });

  for (const seedInput of seeds) {
    it(`survives ${ITERATIONS} mutations of "${seedInput.name}"`, () => {
      const rng = new SeededRandom(SEED ^ djb2(seedInput.name));

      for (let i = 0; i < ITERATIONS; i++) {
        const { mutated, mutations } = applyRandomMutations(
          seedInput.source,
          rng,
          MAX_MUTATIONS
        );

        const label =
          `SEED=${SEED} input="${seedInput.name}" iteration=${i}\n` +
          `mutations=${JSON.stringify(mutations)}`;

        const rootNode = assertNoCrash(mutated, label);
        assertSourcePreserved(mutated, rootNode, label);
        assertValidCSTStructure(rootNode, mutated, label);
      }
    });
  }
});
