/**
 * Emit round-trip fuzz tester.
 *
 * Tests the invariant: emit(parse(emit(parse(source)))) === emit(parse(source))
 * (idempotent emission). For valid .agent files, also tests exact preservation:
 * emit(parse(source)) === source.
 *
 * Seed inputs are loaded from existing test infrastructure — no hand-maintained
 * lists. Sources:
 *   1. Real .agent files from test-scripts/ and compiler/test/fixtures/
 *   2. Parser corpus files (tree-sitter and parser-javascript)
 *   3. Schema .example() strings from the dialect definition
 *
 * The mutation engine applies structural mutations (line swaps, indent changes,
 * character insertions/deletions) to each seed and asserts idempotent emission.
 *
 * Configuration via environment variables:
 *   SEED             - PRNG seed for reproducibility (default: Date.now())
 *   FUZZ_ITERATIONS  - mutations per seed input (default: 50)
 *   FUZZ_MUTATIONS   - max mutations per iteration (default: 3)
 *
 * Reproduce a failure:
 *   SEED=12345 pnpm --filter @agentscript/dialect test emit-fuzz
 */

import { describe, test, beforeAll } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parseDocument, emitDocument } from './test-utils.js';

// ── Configuration ──────────────────────────────────────────────────

const SEED = process.env.SEED ? parseInt(process.env.SEED, 10) : Date.now();
const ITERATIONS = parseInt(process.env.FUZZ_ITERATIONS ?? '50', 10);
const MAX_MUTATIONS = parseInt(process.env.FUZZ_MUTATIONS ?? '3', 10);

// ── Seeded PRNG (xorshift128) ──────────────────────────────────────

class SeededRandom {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    let s = seed | 0;
    const splitmix = (): number => {
      s = (s + 0x9e3779b9) | 0;
      let t = s ^ (s >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      return t >>> 0;
    };
    this.s0 = splitmix();
    this.s1 = splitmix();
    this.s2 = splitmix();
    this.s3 = splitmix();
  }

  next(): number {
    const t = this.s0 ^ (this.s0 << 11);
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.s2 = this.s3;
    this.s3 = (this.s3 ^ (this.s3 >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.s3 / 0x100000000;
  }

  nextInt(max: number): number {
    return (this.next() * max) | 0;
  }

  pick<T>(arr: ReadonlyArray<T>): T {
    return arr[this.nextInt(arr.length)]!;
  }
}

// ── Mutation Engine ────────────────────────────────────────────────

const INTERESTING_CHARS = [
  ':',
  '@',
  '#',
  '|',
  '-',
  '>',
  '=',
  '!',
  '\\',
  '"',
  "'",
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  ' ',
  '\t',
  '\n',
  '+',
  '*',
  '/',
  '<',
  ',',
  '.',
  'a',
  'z',
  'A',
  'Z',
  '0',
  '9',
  '_',
];

interface MutationRecord {
  type: string;
  detail: string;
}

function applyRandomMutations(
  source: string,
  rng: SeededRandom,
  maxMutations: number
): { mutated: string; mutations: MutationRecord[] } {
  const count = rng.nextInt(maxMutations) + 1;
  const mutations: MutationRecord[] = [];
  let mutated = source;

  for (let i = 0; i < count; i++) {
    if (mutated.length === 0) {
      const ch = rng.pick(INTERESTING_CHARS);
      mutated = ch;
      mutations.push({
        type: 'insert',
        detail: `char=${JSON.stringify(ch)} pos=0`,
      });
      continue;
    }

    const type = rng.pick([
      'insert',
      'delete',
      'substitute',
      'swap-lines',
      'delete-line',
      'duplicate-line',
      'change-indent',
    ] as const);

    const lines = mutated.split('\n');

    switch (type) {
      case 'insert': {
        const pos = rng.nextInt(mutated.length + 1);
        const ch = rng.pick(INTERESTING_CHARS);
        mutated = mutated.slice(0, pos) + ch + mutated.slice(pos);
        mutations.push({
          type,
          detail: `char=${JSON.stringify(ch)} pos=${pos}`,
        });
        break;
      }
      case 'delete': {
        const pos = rng.nextInt(mutated.length);
        mutated = mutated.slice(0, pos) + mutated.slice(pos + 1);
        mutations.push({ type, detail: `pos=${pos}` });
        break;
      }
      case 'substitute': {
        const pos = rng.nextInt(mutated.length);
        const ch = rng.pick(INTERESTING_CHARS);
        mutated = mutated.slice(0, pos) + ch + mutated.slice(pos + 1);
        mutations.push({
          type,
          detail: `char=${JSON.stringify(ch)} pos=${pos}`,
        });
        break;
      }
      case 'swap-lines': {
        if (lines.length >= 2) {
          const a = rng.nextInt(lines.length);
          let b = rng.nextInt(lines.length);
          if (b === a) b = (b + 1) % lines.length;
          [lines[a], lines[b]] = [lines[b]!, lines[a]!];
          mutated = lines.join('\n');
          mutations.push({ type, detail: `lines ${a}<->${b}` });
        }
        break;
      }
      case 'delete-line': {
        if (lines.length >= 2) {
          const idx = rng.nextInt(lines.length);
          lines.splice(idx, 1);
          mutated = lines.join('\n');
          mutations.push({ type, detail: `line ${idx}` });
        }
        break;
      }
      case 'duplicate-line': {
        const idx = rng.nextInt(lines.length);
        lines.splice(idx, 0, lines[idx]!);
        mutated = lines.join('\n');
        mutations.push({ type, detail: `line ${idx}` });
        break;
      }
      case 'change-indent': {
        const idx = rng.nextInt(lines.length);
        const line = lines[idx]!;
        const stripped = line.trimStart();
        const currentIndent = line.length - stripped.length;
        const delta = rng.pick([-4, -2, -1, 1, 2, 4]);
        const newIndent = Math.max(0, currentIndent + delta);
        lines[idx] = ' '.repeat(newIndent) + stripped;
        mutated = lines.join('\n');
        mutations.push({
          type,
          detail: `line ${idx} indent ${currentIndent}->${newIndent}`,
        });
        break;
      }
    }
  }

  return { mutated, mutations };
}

// ── Emit Round-Trip Assertion ─────────────────────────────────────

/**
 * Assert idempotent emission: parse→emit stabilizes after one round.
 * Even for broken input, emitting twice must produce identical output.
 */
function assertIdempotent(source: string, label: string): string {
  let emitted1: string;
  try {
    const ast1 = parseDocument(source);
    emitted1 = emitDocument(ast1);
  } catch (e) {
    throw new Error(
      `Parse/emit CRASHED on first pass!\n${label}\n` +
        `Source (first 300 chars): ${JSON.stringify(source.slice(0, 300))}\nError: ${e}`
    );
  }

  let emitted2: string;
  try {
    const ast2 = parseDocument(emitted1);
    emitted2 = emitDocument(ast2);
  } catch (e) {
    throw new Error(
      `Parse/emit CRASHED on second pass!\n${label}\n` +
        `Emitted1 (first 300 chars): ${JSON.stringify(emitted1.slice(0, 300))}\nError: ${e}`
    );
  }

  if (emitted2 !== emitted1) {
    let diffPos = 0;
    while (
      diffPos < emitted1.length &&
      diffPos < emitted2.length &&
      emitted1[diffPos] === emitted2[diffPos]
    )
      diffPos++;
    const ctx = 40;
    const snippet1 = emitted1.slice(Math.max(0, diffPos - ctx), diffPos + ctx);
    const snippet2 = emitted2.slice(Math.max(0, diffPos - ctx), diffPos + ctx);
    throw new Error(
      `Emit NOT IDEMPOTENT!\n${label}\n` +
        `Source (first 200 chars): ${JSON.stringify(source.slice(0, 200))}\n` +
        `First diff at offset ${diffPos}:\n` +
        `  emit1: ...${JSON.stringify(snippet1)}...\n` +
        `  emit2: ...${JSON.stringify(snippet2)}...\n` +
        `Full emit1 (${emitted1.length} chars): ${JSON.stringify(emitted1.slice(0, 500))}\n` +
        `Full emit2 (${emitted2.length} chars): ${JSON.stringify(emitted2.slice(0, 500))}`
    );
  }

  return emitted1;
}

/**
 * Assert that emission converges within MAX_PASSES rounds.
 *
 * For mutated/broken input, the first emit may normalize (e1 ≠ source).
 * The key invariant is that the output STABILIZES — after at most a few
 * passes, emit(parse(eN)) === eN. This is the correct invariant for error
 * recovery content where intentional normalizations (omitArrow, canonical
 * indent) change the first output.
 */
function assertConverges(source: string, label: string, maxPasses = 4): void {
  const emits: string[] = [];
  try {
    emits.push(emitDocument(parseDocument(source)));
  } catch (e) {
    throw new Error(
      `Parse/emit CRASHED!\n${label}\n` +
        `Source (first 300 chars): ${JSON.stringify(source.slice(0, 300))}\nError: ${e}`
    );
  }

  for (let pass = 1; pass < maxPasses; pass++) {
    try {
      emits.push(emitDocument(parseDocument(emits[pass - 1]!)));
    } catch (e) {
      throw new Error(
        `Parse/emit CRASHED on pass ${pass + 1}!\n${label}\n` +
          `Previous (first 300 chars): ${JSON.stringify(emits[pass - 1]!.slice(0, 300))}\nError: ${e}`
      );
    }
    if (emits[pass] === emits[pass - 1]) return; // Converged
  }

  // Did not converge — report the last diff
  const last = emits.length - 1;
  const prev = emits[last - 1]!;
  const curr = emits[last]!;
  let diffPos = 0;
  while (
    diffPos < prev.length &&
    diffPos < curr.length &&
    prev[diffPos] === curr[diffPos]
  )
    diffPos++;
  const ctx = 40;
  throw new Error(
    `Emit DID NOT CONVERGE after ${maxPasses} passes!\n${label}\n` +
      `Source (first 200 chars): ${JSON.stringify(source.slice(0, 200))}\n` +
      `Lengths: ${emits.map(e => e.length).join(' → ')}\n` +
      `Last diff at offset ${diffPos}:\n` +
      `  pass${last}: ...${JSON.stringify(prev.slice(Math.max(0, diffPos - ctx), diffPos + ctx))}...\n` +
      `  pass${last + 1}: ...${JSON.stringify(curr.slice(Math.max(0, diffPos - ctx), diffPos + ctx))}...`
  );
}

// ── djb2 hash ───────────────────────────────────────────────────────

function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// ══════════════════════════════════════════════════════════════════════
// SEED LOADERS — all inputs come from existing test infrastructure
// ══════════════════════════════════════════════════════════════════════

interface SeedInput {
  name: string;
  source: string;
}

/** Parse a tree-sitter/parser-javascript corpus file into seed inputs. */
function parseCorpusFile(content: string): SeedInput[] {
  const seeds: SeedInput[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    if (!lines[i]!.startsWith('====')) {
      i++;
      continue;
    }
    i++;
    const name = lines[i]!.trim();
    i++;
    while (i < lines.length && lines[i]!.startsWith('====')) i++;

    const inputLines: string[] = [];
    while (i < lines.length && lines[i] !== '---') {
      inputLines.push(lines[i]!);
      i++;
    }
    i++; // skip ---
    while (i < lines.length && !lines[i]!.startsWith('====')) i++;

    while (inputLines.length > 0 && inputLines[0]!.trim() === '')
      inputLines.shift();
    while (
      inputLines.length > 0 &&
      inputLines[inputLines.length - 1]!.trim() === ''
    )
      inputLines.pop();

    if (inputLines.length > 0) {
      seeds.push({ name, source: inputLines.join('\n') });
    }
  }
  return seeds;
}

/** Load .agent files from a directory. */
function loadAgentFiles(dir: string, prefix: string): SeedInput[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.agent'))
    .sort()
    .map(f => ({
      name: `${prefix}/${f}`,
      source: readFileSync(join(dir, f), 'utf-8'),
    }));
}

/** Load corpus files from a directory. */
function loadCorpusFiles(dir: string, prefix: string): SeedInput[] {
  if (!existsSync(dir)) return [];
  const seeds: SeedInput[] = [];
  for (const file of readdirSync(dir)
    .filter(f => f.endsWith('.txt'))
    .sort()) {
    const content = readFileSync(join(dir, file), 'utf-8');
    for (const seed of parseCorpusFile(content)) {
      seeds.push({ ...seed, name: `${prefix}/${file}/${seed.name}` });
    }
  }
  return seeds;
}

/** Extract .example() strings from schema source. */
function loadSchemaExamples(): SeedInput[] {
  const schemaPath = join(__dirname, '../schema.ts');
  if (!existsSync(schemaPath)) return [];
  const content = readFileSync(schemaPath, 'utf-8');
  const seeds: SeedInput[] = [];

  // Match .example(`...`) template literals
  const regex = /\.example\(\s*`([\s\S]*?)`\s*\)/g;
  let match;
  let idx = 0;
  while ((match = regex.exec(content)) !== null) {
    const raw = match[1]!;
    // Dedent: find minimum non-empty indent and strip it
    const lines = raw.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    const minIndent = nonEmpty.reduce((min, l) => {
      const indent = l.match(/^(\s*)/)?.[1]?.length ?? 0;
      return Math.min(min, indent);
    }, Infinity);
    const dedented = lines
      .map(l => l.slice(minIndent === Infinity ? 0 : minIndent))
      .join('\n')
      .trim();
    if (dedented) {
      seeds.push({ name: `schema-example-${idx}`, source: dedented });
    }
    idx++;
  }
  return seeds;
}

/** Load all seed inputs from existing test infrastructure. */
function loadAllSeeds(): SeedInput[] {
  const root = join(__dirname, '../../../..');
  const seeds: SeedInput[] = [];

  // 1. Real .agent files
  seeds.push(
    ...loadAgentFiles(
      join(root, 'packages/test-scripts/scripts'),
      'test-scripts'
    )
  );
  seeds.push(
    ...loadAgentFiles(
      join(root, 'packages/compiler/test/fixtures/scripts'),
      'compiler-fixtures'
    )
  );
  seeds.push(
    ...loadAgentFiles(
      join(root, 'packages/compiler/test/fixtures'),
      'compiler-fixtures'
    )
  );

  // 2. Parser corpus files
  seeds.push(
    ...loadCorpusFiles(
      join(root, 'packages/parser-tree-sitter/test/corpus'),
      'parser-corpus'
    )
  );
  seeds.push(
    ...loadCorpusFiles(
      join(root, 'packages/parser-javascript/test/corpus'),
      'parser-javascript-corpus'
    )
  );

  // 3. Schema examples
  seeds.push(...loadSchemaExamples());

  // 4. SOT file
  const sotFile = join(root, 'packages/parser-javascript/sot/source.agent');
  if (existsSync(sotFile)) {
    seeds.push({
      name: 'sot/source.agent',
      source: readFileSync(sotFile, 'utf-8'),
    });
  }

  return seeds;
}

// ══════════════════════════════════════════════════════════════════════
// TEST SUITES
// ══════════════════════════════════════════════════════════════════════

const allSeeds = loadAllSeeds();

// TODO: Re-enable once emit convergence issues are fixed
describe.skip('emit fuzz: idempotent round-trips', () => {
  beforeAll(() => {
    console.log(`[emit-fuzz] ${allSeeds.length} seed inputs loaded`);
  });

  for (const seed of allSeeds) {
    test(seed.name, () => {
      assertIdempotent(seed.source, seed.name);
    });
  }
});

// TODO: Re-enable once emit convergence issues are fixed
describe.skip('emit fuzz: exact round-trips for .agent files', () => {
  const agentSeeds = allSeeds.filter(
    s =>
      s.name.startsWith('test-scripts/') ||
      s.name.startsWith('compiler-fixtures/') ||
      s.name.startsWith('sot/')
  );

  for (const seed of agentSeeds) {
    test(seed.name, () => {
      const ast = parseDocument(seed.source);
      const emitted = emitDocument(ast);

      if (emitted !== seed.source) {
        // At minimum, emission must be idempotent
        const ast2 = parseDocument(emitted);
        const emitted2 = emitDocument(ast2);
        if (emitted2 !== emitted) {
          // Find first diff for debugging
          let diffPos = 0;
          while (
            diffPos < emitted.length &&
            diffPos < emitted2.length &&
            emitted[diffPos] === emitted2[diffPos]
          )
            diffPos++;
          throw new Error(
            `Emit NOT IDEMPOTENT for ${seed.name}\n` +
              `First diff at offset ${diffPos}:\n` +
              `  emit1: ...${JSON.stringify(emitted.slice(Math.max(0, diffPos - 40), diffPos + 40))}...\n` +
              `  emit2: ...${JSON.stringify(emitted2.slice(Math.max(0, diffPos - 40), diffPos + 40))}...`
          );
        }
      }
    });
  }
});

// TODO: Re-enable once emit convergence issues are fixed
describe.skip('emit fuzz: mutation-based', () => {
  beforeAll(() => {
    console.log(
      `[emit-fuzz:mutations] seed=${SEED} iterations=${ITERATIONS} ` +
        `maxMutations=${MAX_MUTATIONS} seeds=${allSeeds.length}`
    );
  });

  // Batch seeds to avoid thousands of individual test registrations
  const BATCH_SIZE = 10;
  const batches: SeedInput[][] = [];
  for (let i = 0; i < allSeeds.length; i += BATCH_SIZE) {
    batches.push(allSeeds.slice(i, i + BATCH_SIZE));
  }

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx]!;
    const firstName = batch[0]!.name;
    const lastName = batch[batch.length - 1]!.name;

    test(`batch ${batchIdx}: ${firstName} … ${lastName}`, () => {
      for (const seedInput of batch) {
        const rng = new SeededRandom(SEED ^ djb2(seedInput.name));

        for (let iter = 0; iter < ITERATIONS; iter++) {
          const { mutated, mutations } = applyRandomMutations(
            seedInput.source,
            rng,
            MAX_MUTATIONS
          );

          const label =
            `SEED=${SEED} input="${seedInput.name}" iteration=${iter}\n` +
            `mutations=${JSON.stringify(mutations)}`;

          assertConverges(mutated, label);
        }
      }
    });
  }
});
