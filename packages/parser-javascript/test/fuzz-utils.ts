/**
 * Shared fuzz testing utilities: PRNG, mutation engine, corpus loader, and
 * invariant checkers. Used by both fuzz.test.ts and fuzz-parity.test.ts.
 */

import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse } from '../src/index.js';
import type { CSTNode } from '../src/cst-node.js';

// ── Seeded PRNG (xorshift128) ──────────────────────────────────────

export class SeededRandom {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // Initialize state from seed using splitmix32
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

  /** Returns a float in [0, 1). */
  next(): number {
    const t = this.s0 ^ (this.s0 << 11);
    this.s0 = this.s1;
    this.s1 = this.s2;
    this.s2 = this.s3;
    this.s3 = (this.s3 ^ (this.s3 >>> 19) ^ (t ^ (t >>> 8))) >>> 0;
    return this.s3 / 0x100000000;
  }

  /** Returns an integer in [0, max). */
  nextInt(max: number): number {
    return (this.next() * max) | 0;
  }

  /** Picks a random element from an array. */
  pick<T>(arr: ReadonlyArray<T>): T {
    return arr[this.nextInt(arr.length)]!;
  }
}

// ── Mutation Engine ────────────────────────────────────────────────

export type MutationType = 'insert' | 'delete' | 'substitute';

export interface MutationRecord {
  type: MutationType;
  position: number;
  char?: string;
}

/** Characters weighted toward AgentScript-significant syntax. */
export const INTERESTING_CHARS = [
  // AgentScript syntax
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
  // Delimiters
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  // Whitespace
  ' ',
  '\t',
  '\n',
  '\r',
  // Operators
  '+',
  '*',
  '/',
  '<',
  ',',
  '.',
  // Printable ASCII
  'a',
  'z',
  'A',
  'Z',
  '0',
  '9',
  '_',
  // Edge cases
  '\0',
  '\x7f',
  // Unicode
  '\u00e9',
  '\u{1f600}',
];

export function applyRandomMutations(
  source: string,
  rng: SeededRandom,
  maxMutations: number
): { mutated: string; mutations: MutationRecord[] } {
  const count = rng.nextInt(maxMutations) + 1;
  const mutations: MutationRecord[] = [];
  let mutated = source;

  for (let i = 0; i < count; i++) {
    if (mutated.length === 0) {
      // Can only insert into empty string
      const ch = rng.pick(INTERESTING_CHARS);
      mutated = ch;
      mutations.push({ type: 'insert', position: 0, char: ch });
      continue;
    }

    const type: MutationType = rng.pick(['insert', 'delete', 'substitute']);
    const pos = rng.nextInt(
      type === 'insert' ? mutated.length + 1 : mutated.length
    );

    switch (type) {
      case 'insert': {
        const ch = rng.pick(INTERESTING_CHARS);
        mutated = mutated.slice(0, pos) + ch + mutated.slice(pos);
        mutations.push({ type: 'insert', position: pos, char: ch });
        break;
      }
      case 'delete': {
        mutated = mutated.slice(0, pos) + mutated.slice(pos + 1);
        mutations.push({ type: 'delete', position: pos });
        break;
      }
      case 'substitute': {
        const ch = rng.pick(INTERESTING_CHARS);
        mutated = mutated.slice(0, pos) + ch + mutated.slice(pos + 1);
        mutations.push({ type: 'substitute', position: pos, char: ch });
        break;
      }
    }
  }

  return { mutated, mutations };
}

// ── Invariant Checkers ─────────────────────────────────────────────

export function assertNoCrash(source: string, label: string): CSTNode {
  let rootNode: CSTNode;
  try {
    rootNode = parse(source).rootNode;
  } catch (e) {
    throw new Error(
      `Parser CRASHED!\n${label}\nSource (first 200 chars): ${JSON.stringify(source.slice(0, 200))}\nError: ${e}`
    );
  }
  if (!rootNode || rootNode.type !== 'source_file') {
    throw new Error(
      `Parser returned invalid root node (type=${rootNode?.type})!\n${label}`
    );
  }
  return rootNode;
}

export function assertSourcePreserved(
  source: string,
  rootNode: CSTNode,
  label: string
): void {
  if (rootNode.text !== source) {
    throw new Error(
      `Source not preserved! rootNode.text length=${rootNode.text.length}, source length=${source.length}\n${label}\n` +
        `Source (first 100): ${JSON.stringify(source.slice(0, 100))}\n` +
        `CST text (first 100): ${JSON.stringify(rootNode.text.slice(0, 100))}`
    );
  }
}

export function assertValidCSTStructure(
  rootNode: CSTNode,
  source: string,
  label: string
): void {
  const walk = (node: CSTNode, depth: number): void => {
    // Prevent runaway recursion
    if (depth > 500) {
      throw new Error(
        `CST depth > 500 — possible infinite recursion\n${label}`
      );
    }

    // Offset bounds
    if (node.startOffset < 0 || node.endOffset < 0) {
      throw new Error(
        `Negative offset: ${node.type} [${node.startOffset}, ${node.endOffset}]\n${label}`
      );
    }
    if (node.endOffset > source.length) {
      throw new Error(
        `endOffset ${node.endOffset} > source.length ${source.length} at ${node.type}\n${label}`
      );
    }
    if (node.startOffset > node.endOffset && !node.isMissing) {
      throw new Error(
        `startOffset ${node.startOffset} > endOffset ${node.endOffset} at ${node.type}\n${label}`
      );
    }

    // Position sanity
    if (node.startRow < 0 || node.startCol < 0) {
      throw new Error(`Negative start position at ${node.type}\n${label}`);
    }

    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;

      // Children within parent bounds
      if (child.startOffset < node.startOffset && !child.isMissing) {
        throw new Error(
          `Child ${child.type} startOffset ${child.startOffset} < parent ${node.type} startOffset ${node.startOffset}\n${label}`
        );
      }
      if (child.endOffset > node.endOffset) {
        throw new Error(
          `Child ${child.type} endOffset ${child.endOffset} > parent ${node.type} endOffset ${node.endOffset}\n${label}`
        );
      }

      // Children ordering
      if (i > 0) {
        const prev = children[i - 1]!;
        if (child.startOffset < prev.startOffset && !child.isMissing) {
          throw new Error(
            `Children out of order: ${prev.type}@${prev.startOffset} then ${child.type}@${child.startOffset}\n${label}`
          );
        }
      }

      walk(child, depth + 1);
    }
  };

  walk(rootNode, 0);
}

// ── Corpus Loader ──────────────────────────────────────────────────

export interface SeedInput {
  name: string;
  source: string;
}

export function parseCorpusFileForFuzz(content: string): SeedInput[] {
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

    // Skip expected output
    while (i < lines.length && !lines[i]!.startsWith('====')) i++;

    // Trim
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

export function loadAllSeeds(testDir: string): SeedInput[] {
  const seeds: SeedInput[] = [];

  // Tree-sitter corpus
  const tsCorpusDir = join(testDir, '../../parser-tree-sitter/test/corpus');
  if (existsSync(tsCorpusDir)) {
    for (const file of readdirSync(tsCorpusDir)
      .filter(f => f.endsWith('.txt'))
      .sort()) {
      const content = readFileSync(join(tsCorpusDir, file), 'utf-8');
      for (const seed of parseCorpusFileForFuzz(content)) {
        seeds.push({ ...seed, name: `corpus/${file}/${seed.name}` });
      }
    }
  }

  // Own corpus
  const ownCorpusDir = join(testDir, 'corpus');
  if (existsSync(ownCorpusDir)) {
    for (const file of readdirSync(ownCorpusDir)
      .filter(f => f.endsWith('.txt'))
      .sort()) {
      const content = readFileSync(join(ownCorpusDir, file), 'utf-8');
      for (const seed of parseCorpusFileForFuzz(content)) {
        seeds.push({ ...seed, name: `parser-javascript/${file}/${seed.name}` });
      }
    }
  }

  // SOT file
  const sotFile = join(testDir, '../sot/source.agent');
  if (existsSync(sotFile)) {
    seeds.push({
      name: 'sot/source.agent',
      source: readFileSync(sotFile, 'utf-8'),
    });
  }

  return seeds;
}

// ── djb2 hash for deterministic per-input seeds ────────────────────

export function djb2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
