/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Per-stage parsing performance regression guard.
 *
 * Measures the full pipeline — parse (source→CST), parseAndLint (CST→AST),
 * compile (AST→AgentJSON), and end-to-end compileSource in both snake_case
 * (default) and camelCase key modes — across the real `.agent` fixture
 * corpus, then compares against a committed baseline
 * (`perf-values.node<major>.json`, keyed by Node major — see below).
 *
 * To survive noisy shared CI CPUs, the guard compares a CALIBRATION-NORMALIZED
 * ratio (stage.median / calibration.median), not absolute milliseconds. A slow
 * box inflates both numerator and denominator, so the ratio cancels machine
 * speed out. The calibration is a fixed CPU workload with NO dependency on the
 * parser, so a regression in the pipeline never masks itself via the divisor.
 *
 * The calibration cancels HARDWARE speed but NOT V8 engine differences — the
 * same stage sits at a measurably different normalized ratio across Node majors
 * (observed ~20% between Node 22 and 24). So the baseline is keyed by Node major
 * version (perf-values.node<major>.json) and the guard only ever compares a run
 * against the baseline for its own Node version. Each version's baseline must be
 * regenerated (via --update) under that version.
 *
 * Usage:
 *   tsx test/perf/run-perf-guard.ts            # measure + compare (PR gate)
 *   tsx test/perf/run-perf-guard.ts --update   # rewrite perf-values.node<major>.json
 *   tsx test/perf/run-perf-guard.ts --report   # also write PERFORMANCE.node<major>.md
 *
 * In compare (default) mode the guard self-skips when CHANGE_TITLE is unset
 * (i.e. not a PR build), mirroring scripts/check-pr-title.sh. --update and
 * --report always run.
 */

import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from '../../../compiler/test/fixture-pairs.js';
import { buildStageRunners, STAGES, type StageName } from './stages.js';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const WARMUP = 3;
const ITERATIONS = 15;
const WARN_THRESHOLD = 0.15; // +15% normalized regression → warn
const FAIL_THRESHOLD = 0.3; // +30% normalized regression → fail

const UPDATE_MODE = process.argv.includes('--update');
const REPORT_MODE = process.argv.includes('--report');

const thisDir = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(thisDir, '..', '..');
// Baseline (and report) are per Node major — V8 differences shift the normalized
// ratios ~20% across majors, far past the thresholds, so each version compares
// only against its own baseline.
const NODE_MAJOR = process.versions.node.replace(/^v/, '').split('.')[0];
const BASELINE_PATH = join(PACKAGE_ROOT, `perf-values.node${NODE_MAJOR}.json`);
const REPORT_PATH = join(PACKAGE_ROOT, `PERFORMANCE.node${NODE_MAJOR}.md`);
const SCRIPTS_DIR = join(
  thisDir,
  '..',
  '..',
  '..',
  'compiler',
  'test',
  'fixtures',
  'scripts'
);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Metric {
  median: number;
  mean: number;
  p95: number;
  min: number;
  max: number;
}

interface PerfValues {
  schemaVersion: number;
  corpus: { fixtureCount: number; totalBytes: number };
  env: { node: string; commit: string; branch: string };
  stages: Record<StageName, Metric>;
  calibration: { median: number };
  normalized: Record<StageName, number>;
}

// ---------------------------------------------------------------------------
// Timing helpers (shape reused from parser-javascript/test/run-perf.ts)
// ---------------------------------------------------------------------------

function measure(fn: () => void): Metric {
  for (let i = 0; i < WARMUP; i++) fn();

  const times: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);

  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  return {
    median: times[Math.floor(times.length / 2)],
    mean,
    p95: times[Math.min(times.length - 1, Math.floor(times.length * 0.95))],
    min: times[0],
    max: times[times.length - 1],
  };
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/**
 * Fixed, deterministic CPU workload — intentionally independent of the parser
 * so it measures only raw machine speed. Returned value is consumed by a sink
 * to prevent dead-code elimination.
 */
function calibrationWorkload(): number {
  let acc = 0;
  for (let i = 1; i < 3_000_000; i++) {
    acc += Math.sqrt(i) * 1.0000001;
    acc %= 1_000_003;
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

function getGitInfo(): { commit: string; branch: string } {
  const git = (args: string[]): string =>
    execFileSync('git', args, { encoding: 'utf-8' }).trim();
  try {
    return {
      commit: git(['rev-parse', '--short', 'HEAD']),
      branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

function loadCorpus(): { sources: string[]; totalBytes: number } {
  const sources: string[] = [];
  let totalBytes = 0;
  for (const name of FIXTURES) {
    const src = readFileSync(join(SCRIPTS_DIR, name), 'utf-8');
    sources.push(src);
    totalBytes += Buffer.byteLength(src, 'utf-8');
  }
  return { sources, totalBytes };
}

function runMeasurement(): PerfValues {
  const { sources, totalBytes } = loadCorpus();

  // Precompute CST + AST per fixture once (untimed).
  const runners = sources.map(buildStageRunners);

  // Bracket the stage runs with calibration measurements taken before AND
  // after, then average. This tracks machine drift/throttling across the run
  // (which can span a minute) so the normalization divisor reflects the same
  // machine state the stages were measured under, not just the state at the end.
  let sink = 0;
  const calibrationBefore = measure(() => {
    sink += calibrationWorkload();
  });

  const stages = {} as Record<StageName, Metric>;
  for (const stage of STAGES) {
    // One iteration = a single pass of this stage over the whole corpus.
    stages[stage] = measure(() => {
      for (const r of runners) r[stage]();
    });
  }

  const calibrationAfter = measure(() => {
    sink += calibrationWorkload();
  });
  if (sink === Number.POSITIVE_INFINITY) console.log(''); // keep sink live

  const calibrationMedian =
    (calibrationBefore.median + calibrationAfter.median) / 2;

  const normalized = {} as Record<StageName, number>;
  for (const stage of STAGES) {
    normalized[stage] = stages[stage].median / calibrationMedian;
  }

  const git = getGitInfo();
  return {
    schemaVersion: 1,
    corpus: { fixtureCount: sources.length, totalBytes },
    env: { node: process.version, commit: git.commit, branch: git.branch },
    stages,
    calibration: { median: calibrationMedian },
    normalized,
  };
}

// ---------------------------------------------------------------------------
// Output modes
// ---------------------------------------------------------------------------

function writeBaseline(values: PerfValues): void {
  writeFileSync(BASELINE_PATH, JSON.stringify(values, null, 2) + '\n');
  console.log(`Baseline written to ${BASELINE_PATH}`);
}

function writeReport(values: PerfValues): void {
  const lines: string[] = [];
  lines.push('# AgentScript Pipeline Performance Report');
  lines.push('');
  lines.push(
    `> Node: ${values.env.node} | Commit: ${values.env.commit} | Branch: ${values.env.branch}`
  );
  lines.push(
    `> Corpus: ${values.corpus.fixtureCount} fixtures, ${(values.corpus.totalBytes / 1024).toFixed(1)} KB total`
  );
  lines.push('');
  lines.push('| Stage | Median | Mean | p95 | Normalized (÷calibration) |');
  lines.push('|---|---|---|---|---|');
  for (const stage of STAGES) {
    const m = values.stages[stage];
    lines.push(
      `| ${stage} | ${formatMs(m.median)} | ${formatMs(m.mean)} | ${formatMs(m.p95)} | ${values.normalized[stage].toFixed(3)} |`
    );
  }
  lines.push('');
  lines.push(`Calibration median: ${formatMs(values.calibration.median)}`);
  lines.push('');
  writeFileSync(REPORT_PATH, lines.join('\n') + '\n');
  console.log(`Report written to ${REPORT_PATH}`);
}

function loadBaseline(): PerfValues {
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf-8')) as PerfValues;
  } catch (e) {
    console.error(
      `Could not read baseline at ${BASELINE_PATH} (Node ${NODE_MAJOR}).\n` +
        `Generate it by running \`pnpm --filter @agentscript/agentforce perf:update\`\n` +
        `under Node ${NODE_MAJOR} and committing the result.`
    );
    throw e;
  }
}

function compareAndReport(current: PerfValues): number {
  const baseline = loadBaseline();

  console.log('\nPer-stage regression check (calibration-normalized):');
  console.log('  stage           baseline    head        delta%    status');
  console.log('  ' + '─'.repeat(58));

  const failures: string[] = [];
  const warnings: string[] = [];

  for (const stage of STAGES) {
    const base = baseline.normalized[stage];
    const head = current.normalized[stage];
    const delta = (head - base) / base; // + = slower
    let status = 'ok';
    if (delta > FAIL_THRESHOLD) {
      status = 'FAIL';
      failures.push(stage);
    } else if (delta > WARN_THRESHOLD) {
      status = 'warn';
      warnings.push(stage);
    }
    console.log(
      `  ${stage.padEnd(15)} ${base.toFixed(3).padStart(9)} ${head.toFixed(3).padStart(11)} ${(delta * 100).toFixed(1).padStart(8)}%   ${status}`
    );
  }
  console.log('');

  if (warnings.length) {
    console.log(
      `⚠️  Warning: ${warnings.join(', ')} regressed > ${WARN_THRESHOLD * 100}%`
    );
  }
  if (failures.length) {
    console.error(
      `❌ FAIL: ${failures.join(', ')} regressed > ${FAIL_THRESHOLD * 100}%.\n` +
        `   If this is an intentional perf change, regenerate the baseline under\n` +
        `   Node ${NODE_MAJOR} with \`pnpm --filter @agentscript/agentforce perf:update\`\n` +
        `   and commit perf-values.node${NODE_MAJOR}.json.`
    );
    return 1;
  }
  console.log('✅ No stage regressed beyond threshold.');
  return 0;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// In compare mode, self-skip off-PR builds (mirrors check-pr-title.sh).
if (!UPDATE_MODE && !REPORT_MODE && !process.env.CHANGE_TITLE) {
  console.log(
    'perf-regression-guard: CHANGE_TITLE unset (not a PR build) — skipping.'
  );
  process.exit(0);
}

const current = runMeasurement();

if (UPDATE_MODE) {
  writeBaseline(current);
  if (REPORT_MODE) writeReport(current);
  process.exit(0);
}

if (REPORT_MODE) {
  writeReport(current);
}

process.exit(compareAndReport(current));
