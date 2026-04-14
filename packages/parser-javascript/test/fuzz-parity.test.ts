/**
 * Parity fuzz tester: applies random mutations to corpus inputs and
 * asserts both parser-javascript and tree-sitter agree on the result.
 *
 * Tracks the following categories:
 *   - Both error-free, matching s-expressions → ideal parity
 *   - Both error-free, diverging s-expressions → pre-existing parity gap
 *   - One error-free, one errored → error detection disagreement
 *   - Both errored → allowed to differ (error recovery strategies diverge)
 *
 * All categories are tracked as metrics via snapshot. Neither parser may crash.
 *
 * Skips gracefully if tree-sitter native bindings are not available.
 *
 * Configuration via environment variables:
 *   SEED             - PRNG seed for reproducibility (default: Date.now())
 *   FUZZ_ITERATIONS  - iterations per seed input (default: 20)
 *   FUZZ_MUTATIONS   - max mutations per iteration (default: 5)
 *
 * Reproduce a failure:
 *   SEED=12345 pnpm --filter @agentscript/parser-javascript test fuzz-parity
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { parse as parseJS } from '../src/index.js';
import { normalizeSExp } from './test-utils.js';
import {
  SeededRandom,
  applyRandomMutations,
  loadAllSeeds,
  djb2,
} from './fuzz-utils.js';

// ── Configuration ──────────────────────────────────────────────────

// Fixed default seed for reproducible snapshot results. Override with env var.
const SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : 42;
const ITERATIONS = parseInt(process.env.FUZZ_ITERATIONS ?? '20', 10);
const MAX_MUTATIONS = parseInt(process.env.FUZZ_MUTATIONS ?? '5', 10);

// ── Dynamic tree-sitter loading ────────────────────────────────────

interface TreeSitterParser {
  parse(source: string): {
    rootNode: {
      toString(): string;
      hasError: boolean;
    };
  };
}

let treeSitterParser: TreeSitterParser | null = null;
let treeSitterAvailable = false;

try {
  const Parser = (await import('tree-sitter')).default;
  const AgentScript = (await import('@agentscript/parser-tree-sitter')).default;
  const parser = new Parser();
  parser.setLanguage(AgentScript as unknown as typeof parser.Language);
  treeSitterParser = parser as unknown as TreeSitterParser;
  treeSitterAvailable = true;
} catch {
  // tree-sitter native bindings not available — tests will be skipped
}

// ── Test Suite ──────────────────────────────────────────────────────

const seeds = loadAllSeeds(__dirname);

describe.runIf(treeSitterAvailable)(
  'fuzz parity: parser-javascript vs tree-sitter under random mutations',
  () => {
    let totalMutations = 0;
    let bothValid = 0;
    let bothValidDiverging = 0;
    let bothErrorMatching = 0;
    let bothErrorDiverging = 0;
    let disagreements = 0;

    // Per-mutation category entries for diffable snapshot
    interface CategoryEntry {
      key: string;
      category: string;
      source: string;
    }
    const categoryLog: CategoryEntry[] = [];

    beforeAll(() => {
      console.log(
        `[fuzz-parity] seed=${SEED} iterations=${ITERATIONS} maxMutations=${MAX_MUTATIONS} seedInputs=${seeds.length}`
      );
    });

    for (const seedInput of seeds) {
      it(`parity across ${ITERATIONS} mutations of "${seedInput.name}"`, () => {
        const rng = new SeededRandom(SEED ^ djb2(seedInput.name));

        for (let i = 0; i < ITERATIONS; i++) {
          const { mutated, mutations } = applyRandomMutations(
            seedInput.source,
            rng,
            MAX_MUTATIONS
          );

          totalMutations++;

          const label =
            `SEED=${SEED} input="${seedInput.name}" iteration=${i}\n` +
            `mutations=${JSON.stringify(mutations)}\n` +
            `source=${JSON.stringify(mutated.slice(0, 200))}`;

          // Parse with parser-javascript
          let jsResult: ReturnType<typeof parseJS>;
          try {
            jsResult = parseJS(mutated);
          } catch (e) {
            throw new Error(
              `parser-javascript CRASHED!\n${label}\nError: ${e}`
            );
          }

          // Parse with tree-sitter
          let tsTree: ReturnType<TreeSitterParser['parse']>;
          try {
            tsTree = treeSitterParser!.parse(mutated);
          } catch (e) {
            throw new Error(`tree-sitter CRASHED!\n${label}\nError: ${e}`);
          }

          const jsHasError = jsResult.rootNode.hasError;
          const tsHasError = tsTree.rootNode.hasError;

          if (!jsHasError && !tsHasError) {
            // Both valid — s-expressions should match
            const jsSExp = normalizeSExp(jsResult.rootNode.toSExp());
            const tsSExp = normalizeSExp(tsTree.rootNode.toString());

            if (jsSExp === tsSExp) {
              bothValid++;
              categoryLog.push({
                key: `${seedInput.name}#${i}`,
                category: 'both-valid',
                source: mutated,
              });
            } else {
              // Tracked as a metric. These represent pre-existing parity
              // gaps where both parsers accept the input but produce
              // different trees (e.g. different field names or node types).
              bothValidDiverging++;
              categoryLog.push({
                key: `${seedInput.name}#${i}`,
                category: 'both-valid-diverging',
                source: mutated,
              });
              if (process.env.FUZZ_VERBOSE) {
                const jsSExp2 = jsSExp;
                const tsSExp2 = tsSExp;
                console.log(
                  `\n[DIVERGE #${bothValidDiverging}] ${seedInput.name} iter=${i}`
                );
                console.log('INPUT:', JSON.stringify(mutated));
                console.log('JS:', jsSExp2);
                console.log('TS:', tsSExp2);
              }
            }
          } else if (jsHasError !== tsHasError) {
            // One valid, one errored — parser disagreement.
            // Tracked as a metric rather than a hard failure since random
            // mutations frequently hit edge cases where the parsers' error
            // detection legitimately differs.
            disagreements++;
            categoryLog.push({
              key: `${seedInput.name}#${i}`,
              category: `disagree (js=${jsHasError} ts=${tsHasError})`,
              source: mutated,
            });
            if (process.env.FUZZ_VERBOSE) {
              const jsSExp = normalizeSExp(jsResult.rootNode.toSExp());
              const tsSExp = normalizeSExp(tsTree.rootNode.toString());
              console.log(
                `\n[DISAGREE #${disagreements}] ${seedInput.name} iter=${i}`
              );
              console.log(
                `  js hasError=${jsHasError}, ts hasError=${tsHasError}`
              );
              console.log('  INPUT:', JSON.stringify(mutated));
              console.log('  JS:', jsSExp);
              console.log('  TS:', tsSExp);
            }
          } else {
            // Both errored — allowed to differ
            const jsSExp = normalizeSExp(jsResult.rootNode.toSExp());
            const tsSExp = normalizeSExp(tsTree.rootNode.toString());
            if (jsSExp === tsSExp) {
              bothErrorMatching++;
              categoryLog.push({
                key: `${seedInput.name}#${i}`,
                category: 'both-error-matching',
                source: mutated,
              });
            } else {
              bothErrorDiverging++;
              categoryLog.push({
                key: `${seedInput.name}#${i}`,
                category: 'both-error-diverging',
                source: mutated,
              });
            }
          }
        }
      });
    }

    it('prints summary stats and snapshots disagreement rate', () => {
      const disagreementRate =
        totalMutations > 0
          ? ((disagreements / totalMutations) * 100).toFixed(1)
          : '0.0';
      console.log('\n[fuzz-parity] Summary:');
      const bothValidDivergingRate =
        totalMutations > 0
          ? ((bothValidDiverging / totalMutations) * 100).toFixed(1)
          : '0.0';
      console.log(`  Total mutations:          ${totalMutations}`);
      console.log(`  Both valid (matched):     ${bothValid}`);
      console.log(
        `  Both valid (diverging):   ${bothValidDiverging} (${bothValidDivergingRate}%)`
      );
      console.log(`  Both error (matching):    ${bothErrorMatching}`);
      console.log(`  Both error (diverging):   ${bothErrorDiverging}`);
      console.log(
        `  Error disagreements:      ${disagreements} (${disagreementRate}%)`
      );

      // Snapshot per-mutation categories so vitest diffs show exactly
      // which mutation changed category when counts shift.
      // Skip both-valid (~750) and both-error-diverging (~3450) for size.
      const interesting = categoryLog
        .filter(
          e =>
            e.category.startsWith('disagree') ||
            e.category === 'both-valid-diverging' ||
            e.category === 'both-error-matching'
        )
        .map(e => ({ ...e, source: e.source.slice(0, 200) }));
      expect({
        totalMutations,
        bothValid,
        bothValidDiverging,
        bothErrorMatching,
        bothErrorDiverging,
        disagreements,
        details: interesting,
      }).toMatchSnapshot();
    });
  }
);
