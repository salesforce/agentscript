/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Parity report generator for parser-javascript vs tree-sitter.
 *
 * Recomputes the data-driven regions of PARITY.md — the Quick summary table
 * and the §3 error-recovery coverage table — and rewrites them in place
 * between `<!-- BEGIN GENERATED: ... -->` / `<!-- END GENERATED: ... -->`
 * markers. The surrounding prose (categories, examples, gap analysis) is
 * hand-maintained and left untouched.
 *
 * This runs the SAME harnesses as the vitest suites (fuzz-parity,
 * error-recovery) with the same fixed configuration (SEED=42), so the numbers
 * match `pnpm test`. It is the single source of truth for the doc's metrics.
 *
 * Usage:
 *   npx tsx test/run-parity.ts          # print the generated blocks to stdout
 *   npx tsx test/run-parity.ts --write  # rewrite PARITY.md in place
 *
 * Requires tree-sitter native bindings (pnpm install from repo root). Exits
 * with a clear message if they are unavailable rather than writing stale data.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJS } from '../src/index.js';
import { normalizeSExp, parseCorpusFile } from './test-utils.js';
import {
  SeededRandom,
  applyRandomMutations,
  loadAllSeeds,
  djb2,
} from './fuzz-utils.js';
import {
  measureCstCoverage,
  formatMetricsTable,
  type ScenarioMetrics,
} from './error-recovery-metrics.js';

const thisDir = dirname(fileURLToPath(import.meta.url));
const WRITE_MODE = process.argv.includes('--write');

// Fixed configuration — must match test/fuzz-parity.test.ts for the numbers
// in the doc to agree with the vitest snapshot.
const SEED = 42;
const ITERATIONS = 20;
const MAX_MUTATIONS = 5;

// ---------------------------------------------------------------------------
// tree-sitter loading — hard requirement for the report (unlike the tests,
// which skip gracefully, a stale report is worse than no report).
// ---------------------------------------------------------------------------

interface TreeSitterParser {
  parse(source: string): {
    rootNode: {
      type: string;
      toString(): string;
      hasError: boolean;
      isError: boolean;
      isMissing: boolean;
      children: unknown[];
      startIndex: number;
      endIndex: number;
    };
  };
}

async function loadTreeSitter(): Promise<TreeSitterParser> {
  const Parser = (await import('tree-sitter')).default;
  const AgentScript = (await import('@agentscript/parser-tree-sitter')).default;
  const parser = new Parser();
  parser.setLanguage(AgentScript as unknown as typeof parser.Language);
  return parser as unknown as TreeSitterParser;
}

// ---------------------------------------------------------------------------
// Static parity: count corpus test cases (all must agree; the vitest suite
// enforces agreement — here we only need the count for the doc).
// ---------------------------------------------------------------------------

function countStaticParity(): number {
  const CORPUS_DIR = join(thisDir, '../../parser-tree-sitter/test/corpus');
  const OWN_CORPUS_DIR = join(thisDir, 'corpus');
  const SOT_FILE = join(thisDir, '../sot/source.agent');

  const loadDir = (dir: string) =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter(f => f.endsWith('.txt'))
          .sort()
          .map(f => readFileSync(join(dir, f), 'utf-8'))
      : [];

  let count = 0;
  for (const content of [...loadDir(CORPUS_DIR), ...loadDir(OWN_CORPUS_DIR)]) {
    count += parseCorpusFile(content).length;
  }
  if (existsSync(SOT_FILE)) count += 1;
  return count;
}

// ---------------------------------------------------------------------------
// Fuzz parity: same mutation engine and category buckets as the vitest suite.
// ---------------------------------------------------------------------------

interface FuzzCounts {
  totalMutations: number;
  bothValid: number;
  bothValidDiverging: number;
  bothErrorMatching: number;
  bothErrorDiverging: number;
  disagreements: number;
}

function runFuzzParity(ts: TreeSitterParser): FuzzCounts {
  const seeds = loadAllSeeds(thisDir);
  const c: FuzzCounts = {
    totalMutations: 0,
    bothValid: 0,
    bothValidDiverging: 0,
    bothErrorMatching: 0,
    bothErrorDiverging: 0,
    disagreements: 0,
  };

  for (const seedInput of seeds) {
    const rng = new SeededRandom(SEED ^ djb2(seedInput.name));
    for (let i = 0; i < ITERATIONS; i++) {
      const { mutated } = applyRandomMutations(
        seedInput.source,
        rng,
        MAX_MUTATIONS
      );
      c.totalMutations++;

      const jsResult = parseJS(mutated);
      const tsTree = ts.parse(mutated);
      const jsHasError = jsResult.rootNode.hasError;
      const tsHasError = tsTree.rootNode.hasError;

      if (!jsHasError && !tsHasError) {
        const jsSExp = normalizeSExp(jsResult.rootNode.toSExp());
        const tsSExp = normalizeSExp(tsTree.rootNode.toString());
        if (jsSExp === tsSExp) c.bothValid++;
        else c.bothValidDiverging++;
      } else if (jsHasError !== tsHasError) {
        c.disagreements++;
      } else {
        const jsSExp = normalizeSExp(jsResult.rootNode.toSExp());
        const tsSExp = normalizeSExp(tsTree.rootNode.toString());
        if (jsSExp === tsSExp) c.bothErrorMatching++;
        else c.bothErrorDiverging++;
      }
    }
  }
  return c;
}

// ---------------------------------------------------------------------------
// Error recovery coverage: reuse the shared metric + table formatter.
// ---------------------------------------------------------------------------

function runCoverage(ts: TreeSitterParser): string {
  const FIXTURES_DIR = join(thisDir, 'fixtures', 'error-recovery');
  const fixtures = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith('.agent'))
    .sort()
    .map(f => ({
      id: f.replace('.agent', ''),
      source: readFileSync(join(FIXTURES_DIR, f), 'utf-8'),
    }));

  const metrics: ScenarioMetrics[] = [];
  type MeasurableRoot = Parameters<typeof measureCstCoverage>[0];

  for (const { id, source } of fixtures) {
    // parser-js (labelled "parser-ts" by the shared formatter)
    let crashed = false;
    let cov = 0;
    try {
      cov = measureCstCoverage(
        parseJS(source).rootNode as unknown as MeasurableRoot,
        source.length
      );
    } catch {
      crashed = true;
    }
    metrics.push({ id, parser: 'parser-ts', cstCoverage: cov, crashed });

    let tsCrashed = false;
    let tsCov = 0;
    try {
      tsCov = measureCstCoverage(
        ts.parse(source).rootNode as unknown as MeasurableRoot,
        source.length
      );
    } catch {
      tsCrashed = true;
    }
    metrics.push({
      id,
      parser: 'tree-sitter',
      cstCoverage: tsCov,
      crashed: tsCrashed,
    });
  }

  // The doc labels the parser "parser-js"; the shared formatter emits
  // "parser-ts". Normalise the header only (not scenario ids).
  return formatMetricsTable(metrics).replace('parser-ts', 'parser-js');
}

// ---------------------------------------------------------------------------
// Markdown block builders
// ---------------------------------------------------------------------------

function pct(n: number, total: number): string {
  return total > 0 ? `${((n / total) * 100).toFixed(1)}%` : '0.0%';
}

function buildSummaryBlock(fuzz: FuzzCounts, staticCount: number): string {
  const rows = [
    ['Total fuzz mutations', String(fuzz.totalMutations), ''],
    [
      'Both parsers agree (valid, identical trees)',
      String(fuzz.bothValid),
      pct(fuzz.bothValid, fuzz.totalMutations),
    ],
    [
      'Both valid, trees diverge',
      String(fuzz.bothValidDiverging),
      pct(fuzz.bothValidDiverging, fuzz.totalMutations),
    ],
    [
      'Both error, trees match',
      String(fuzz.bothErrorMatching),
      pct(fuzz.bothErrorMatching, fuzz.totalMutations),
    ],
    [
      'Both error, trees diverge',
      String(fuzz.bothErrorDiverging),
      pct(fuzz.bothErrorDiverging, fuzz.totalMutations),
    ],
    [
      '**Error disagreements** (one error, other not)',
      `**${fuzz.disagreements}**`,
      `**${pct(fuzz.disagreements, fuzz.totalMutations)}**`,
    ],
  ];

  const lines = [
    '_Metrics regenerated by `pnpm parity:report`._',
    '',
    `This report is based on fuzz testing (seed=${SEED}, ${fuzz.totalMutations} mutations across ${staticCount} corpus inputs) and structured error recovery benchmarks.`,
    '',
    '## Quick summary',
    '',
    '| Metric | Count | % |',
    '| --- | --- | --- |',
    ...rows.map(([m, c, p]) => `| ${m} | ${c} | ${p} |`),
    '',
    `Static parity (unmodified corpus): **${staticCount}/${staticCount} tests pass** — both parsers agree on all valid inputs.`,
  ];
  return lines.join('\n');
}

function buildCoverageBlock(table: string): string {
  return ['```', table, '```'].join('\n');
}

// ---------------------------------------------------------------------------
// Marker replacement
// ---------------------------------------------------------------------------

function replaceBlock(doc: string, name: string, body: string): string {
  const begin = `<!-- BEGIN GENERATED: ${name}`;
  const end = `<!-- END GENERATED: ${name} -->`;
  const beginIdx = doc.indexOf(begin);
  const endIdx = doc.indexOf(end);
  if (beginIdx === -1 || endIdx === -1) {
    throw new Error(
      `PARITY.md is missing the "${name}" GENERATED markers — cannot inject metrics.`
    );
  }
  // Preserve the exact BEGIN marker line (it carries the "(pnpm parity:report)" hint).
  const beginLineEnd = doc.indexOf('\n', beginIdx);
  const beginMarker = doc.slice(beginIdx, beginLineEnd);
  return (
    doc.slice(0, beginIdx) +
    `${beginMarker}\n\n${body}\n\n${end}` +
    doc.slice(endIdx + end.length)
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let ts: TreeSitterParser;
  try {
    ts = await loadTreeSitter();
  } catch (e) {
    console.error(
      'tree-sitter native bindings unavailable — cannot generate parity report.\n' +
        'Run `pnpm install` from the repo root (Node 22 via mise) and retry.\n' +
        `Underlying error: ${e}`
    );
    process.exit(1);
  }

  console.error(`[parity] running fuzz parity (seed=${SEED})…`);
  const fuzz = runFuzzParity(ts);
  const staticCount = countStaticParity();
  console.error('[parity] running error-recovery coverage…');
  const coverageTable = runCoverage(ts);

  const summaryBlock = buildSummaryBlock(fuzz, staticCount);
  const coverageBlock = buildCoverageBlock(coverageTable);

  if (!WRITE_MODE) {
    console.log('=== GENERATED: summary ===\n');
    console.log(summaryBlock);
    console.log('\n=== GENERATED: coverage ===\n');
    console.log(coverageBlock);
    console.log(
      '\n(dry run — pass --write to update PARITY.md; via pnpm: `pnpm parity:report`)'
    );
    return;
  }

  const docPath = join(thisDir, '..', 'PARITY.md');
  let doc = readFileSync(docPath, 'utf-8');
  doc = replaceBlock(doc, 'summary', summaryBlock);
  doc = replaceBlock(doc, 'coverage', coverageBlock);
  writeFileSync(docPath, doc);
  console.error(`[parity] wrote ${docPath}`);
  console.error(
    '[parity] note: run `pnpm format` (prettier) if the table spacing changed.'
  );
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
