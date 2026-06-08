/**
 * Direct performance benchmark runner for parser-javascript.
 *
 * Uses performance.now() for precise timing. Runs each benchmark
 * multiple iterations and reports mean/min/max/p95.
 *
 * Usage:
 *   npx tsx test/run-perf.ts          # print to stdout
 *   npx tsx test/run-perf.ts --report # write PERFORMANCE.md
 */

import { performance } from 'node:perf_hooks';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse, parseAndHighlight } from '../src/index.js';
import { Lexer } from '../src/lexer.js';
import {
  generateFlatMappings,
  generateDeepNesting,
  generateWideMappings,
  generateChainedExpression,
  generateNestedParens,
  generateMixedPrecedence,
  generateLargeString,
  generateEscapeHeavyStrings,
  generateTemplateHeavy,
  generateErrorHeavy,
  generateGarbageInput,
  generateUnclosedDelimiters,
  generateLargeSequence,
  generateProcedureHeavy,
  generateRealisticAgent,
} from './perf-generators.js';

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const REPORT_MODE = process.argv.includes('--report');

// ---------------------------------------------------------------------------
// Benchmark harness
// ---------------------------------------------------------------------------

interface BenchResult {
  name: string;
  iterations: number;
  mean: number;
  min: number;
  max: number;
  p95: number;
  inputSize: string;
  inputBytes: number;
}

interface Section {
  title: string;
  tag: string;
  results: BenchResult[];
}

const sections: Section[] = [];
let currentSection: Section | null = null;

function formatMs(ms: number): string {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)} ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)} µs`;
  if (ms < 1000) return `${ms.toFixed(2)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function opsPerSec(mean: number): string {
  return mean > 0 ? Math.round(1000 / mean).toLocaleString() : '∞';
}

function throughput(mean: number, bytes: number): string {
  if (mean <= 0 || bytes <= 0) return '-';
  const kbPerMs = bytes / 1024 / mean;
  return `${kbPerMs.toFixed(1)} KB/ms`;
}

function runBench(
  name: string,
  fn: () => void,
  inputSource: string,
  opts: { minIterations?: number; minTimeMs?: number } = {}
): BenchResult {
  const minIterations = opts.minIterations ?? 5;
  const minTimeMs = opts.minTimeMs ?? 500;

  // Warmup
  for (let i = 0; i < 3; i++) fn();

  const times: number[] = [];
  const startTotal = performance.now();

  while (
    times.length < minIterations ||
    performance.now() - startTotal < minTimeMs
  ) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);

    // Safety: cap at 200 iterations
    if (times.length >= 200) break;
  }

  times.sort((a, b) => a - b);
  const mean = times.reduce((s, t) => s + t, 0) / times.length;
  const p95 = times[Math.floor(times.length * 0.95)];

  const result: BenchResult = {
    name,
    iterations: times.length,
    mean,
    min: times[0],
    max: times[times.length - 1],
    p95,
    inputSize: formatSize(inputSource.length),
    inputBytes: inputSource.length,
  };

  if (currentSection) {
    currentSection.results.push(result);
  }

  return result;
}

function startSection(title: string, tag: string): void {
  currentSection = { title, tag, results: [] };
  sections.push(currentSection);
}

function printResult(r: BenchResult): void {
  if (!REPORT_MODE) {
    console.log(
      `  ${r.name.padEnd(45)} ${formatMs(r.mean).padStart(10)}  (${opsPerSec(r.mean).padStart(8)} ops/s)  p95=${formatMs(r.p95).padStart(10)}  [${r.inputSize}, ${r.iterations} iters]`
    );
  }
}

function printSection(title: string, tag: string): void {
  startSection(title, tag);
  if (!REPORT_MODE) {
    console.log(`\n${'═'.repeat(120)}`);
    console.log(`  ${title}`);
    console.log(`${'─'.repeat(120)}`);
  }
}

function printSubheader(text: string): void {
  if (!REPORT_MODE) {
    console.log(`  --- ${text} ---`);
  }
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

if (!REPORT_MODE) {
  console.log('Parser-TS Performance Benchmarks');
  console.log(`${'═'.repeat(120)}`);
}

// 1. File size scaling
printSection('File Size Scaling (flat key: value mappings)', 'file-size');
for (const n of [100, 1_000, 10_000, 50_000, 100_000]) {
  const input = generateFlatMappings(n);
  printResult(
    runBench(`parse ${n.toLocaleString()} lines`, () => parse(input), input)
  );
}
printSubheader('lex-only comparison');
for (const n of [100, 1_000, 10_000, 50_000, 100_000]) {
  const input = generateFlatMappings(n);
  printResult(
    runBench(
      `lex-only ${n.toLocaleString()} lines`,
      () => new Lexer(input).tokenize(),
      input
    )
  );
}

// 2. Deep nesting
printSection('Deep Nesting (indent levels)', 'deep-nesting');
for (const depth of [50, 100, 200, 500, 1_000]) {
  const input = generateDeepNesting(depth);
  try {
    printResult(runBench(`parse depth=${depth}`, () => parse(input), input));
  } catch (e: unknown) {
    if (!REPORT_MODE) {
      console.log(
        `  parse depth=${depth}`.padEnd(45) +
          `  CRASHED: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`
      );
    }
  }
}

// 3. Wide mappings
printSection('Wide Mappings (sibling keys at same level)', 'wide-mappings');
for (const n of [1_000, 5_000, 10_000, 50_000]) {
  const input = generateWideMappings(n);
  printResult(
    runBench(`parse ${n.toLocaleString()} keys`, () => parse(input), input)
  );
}

// 4. Complex expressions
printSection('Chained Expressions (a + b + c + ...)', 'chained-expr');
for (const n of [100, 500, 1_000, 5_000, 10_000]) {
  const input = generateChainedExpression(n);
  try {
    printResult(
      runBench(`parse ${n.toLocaleString()} terms`, () => parse(input), input)
    );
  } catch (e: unknown) {
    if (!REPORT_MODE) {
      console.log(
        `  parse ${n.toLocaleString()} terms`.padEnd(45) +
          `  CRASHED: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`
      );
    }
  }
}

printSection('Nested Parentheses ((((...)))) ', 'nested-parens');
for (const depth of [50, 100, 200, 500, 1_000]) {
  const input = generateNestedParens(depth);
  try {
    printResult(runBench(`parse depth=${depth}`, () => parse(input), input));
  } catch (e: unknown) {
    if (!REPORT_MODE) {
      console.log(
        `  parse depth=${depth}`.padEnd(45) +
          `  CRASHED: ${e instanceof Error ? e.message.slice(0, 60) : String(e)}`
      );
    }
  }
}

printSection('Mixed Precedence (+ * - / interleaved)', 'mixed-prec');
for (const n of [100, 500, 1_000, 5_000]) {
  const input = generateMixedPrecedence(n);
  printResult(
    runBench(`parse ${n.toLocaleString()} terms`, () => parse(input), input)
  );
}

// 5. Strings and templates
printSection('Large String Literals', 'large-strings');
for (const len of [1_000, 10_000, 100_000, 1_000_000]) {
  const input = generateLargeString(len);
  printResult(
    runBench(
      `parse ${(len / 1000).toFixed(0)}K char string`,
      () => parse(input),
      input
    )
  );
}

printSection('Escape-Heavy Strings', 'escape-strings');
for (const n of [100, 500, 1_000, 5_000]) {
  const input = generateEscapeHeavyStrings(n);
  printResult(
    runBench(`parse ${n.toLocaleString()} strings`, () => parse(input), input)
  );
}

printSection('Template Interpolations', 'templates');
for (const n of [50, 200, 500, 1_000]) {
  const input = generateTemplateHeavy(n);
  printResult(runBench(`parse ${n} interpolations`, () => parse(input), input));
}

// 6. Error recovery
printSection(
  'Error Recovery — alternating valid/invalid lines',
  'error-alternating'
);
for (const n of [100, 1_000, 5_000, 10_000]) {
  const input = generateErrorHeavy(n);
  printResult(
    runBench(
      `parse ${n.toLocaleString()} lines (50% errors)`,
      () => parse(input),
      input
    )
  );
}

printSection('Error Recovery — garbage input', 'error-garbage');
for (const bytes of [1_000, 10_000, 50_000, 100_000]) {
  const input = generateGarbageInput(bytes);
  printResult(
    runBench(
      `parse ${(bytes / 1000).toFixed(0)}K bytes garbage`,
      () => parse(input),
      input
    )
  );
}

printSection('Error Recovery — unclosed delimiters', 'error-unclosed');
for (const n of [100, 500, 1_000, 5_000]) {
  const input = generateUnclosedDelimiters(n);
  printResult(
    runBench(
      `parse ${n.toLocaleString()} unclosed parens`,
      () => parse(input),
      input
    )
  );
}

// 7. Large sequences
printSection('Large Sequences (- item)', 'sequences');
for (const n of [1_000, 10_000, 50_000]) {
  const input = generateLargeSequence(n);
  printResult(
    runBench(`parse ${n.toLocaleString()} items`, () => parse(input), input)
  );
}

// 8. Procedure-heavy
printSection('Procedure-Heavy (if/run/set statements)', 'procedures');
for (const n of [100, 500, 1_000, 5_000]) {
  const input = generateProcedureHeavy(n);
  printResult(
    runBench(
      `parse ${n.toLocaleString()} statements`,
      () => parse(input),
      input
    )
  );
}

// 9. Highlighting overhead
printSection(
  'Highlighting Overhead (parse vs parse+highlight)',
  'highlighting'
);
for (const n of [100, 1_000, 5_000]) {
  const input = generateRealisticAgent(n);
  printResult(
    runBench(
      `parse-only ${n.toLocaleString()} lines`,
      () => parse(input),
      input
    )
  );
  printResult(
    runBench(
      `parse+highlight ${n.toLocaleString()} lines`,
      () => parseAndHighlight(input),
      input
    )
  );
}

// 10. Realistic workloads
printSection('Realistic Agent Files', 'realistic');
for (const n of [50, 500, 5_000, 50_000]) {
  const input = generateRealisticAgent(n);
  printResult(
    runBench(`parse ${n.toLocaleString()} lines`, () => parse(input), input)
  );
}
printSubheader('lex-only comparison');
for (const n of [500, 5_000, 50_000]) {
  const input = generateRealisticAgent(n);
  printResult(
    runBench(
      `lex-only ${n.toLocaleString()} lines`,
      () => new Lexer(input).tokenize(),
      input
    )
  );
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

if (!REPORT_MODE) {
  console.log(`\n${'═'.repeat(120)}`);
  console.log('Done.');
} else {
  generateReport();
}

// ---------------------------------------------------------------------------
// Markdown report generator
// ---------------------------------------------------------------------------

function getGitInfo(): { commit: string; branch: string } {
  try {
    const commit = execSync('git rev-parse --short HEAD', {
      encoding: 'utf-8',
    }).trim();
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      encoding: 'utf-8',
    }).trim();
    return { commit, branch };
  } catch {
    return { commit: 'unknown', branch: 'unknown' };
  }
}

function generateReport(): void {
  const git = getGitInfo();
  const now = new Date()
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d+Z$/, ' UTC');
  const nodeVersion = process.version;

  const lines: string[] = [];
  const w = (s: string) => lines.push(s);

  w('# Parser-TS Performance Report');
  w('');
  w(`> Auto-generated on ${now}`);
  w(`> Node: ${nodeVersion} | Commit: ${git.commit} | Branch: ${git.branch}`);
  w('');
  w('## Summary');
  w('');

  // Build summary from key benchmarks
  const summaryKeys = [
    { section: 'realistic', name: /parse 50,000 lines/ },
    { section: 'realistic', name: /parse 5,000 lines/ },
    { section: 'file-size', name: /parse 100,000 lines/ },
    { section: 'file-size', name: /parse 10,000 lines/ },
    { section: 'wide-mappings', name: /parse 50,000 keys/ },
    { section: 'escape-strings', name: /parse 5,000 strings/ },
    { section: 'error-alternating', name: /parse 10,000 lines/ },
    { section: 'sequences', name: /parse 50,000 items/ },
    { section: 'chained-expr', name: /parse 10,000 terms/ },
  ];

  w('| Benchmark | Size | Mean | Throughput | ops/s |');
  w('|---|---|---|---|---|');
  for (const key of summaryKeys) {
    const sec = sections.find(s => s.tag === key.section);
    const r = sec?.results.find(r => key.name.test(r.name));
    if (r) {
      w(
        `| ${r.name} | ${r.inputSize} | ${formatMs(r.mean)} | ${throughput(r.mean, r.inputBytes)} | ${opsPerSec(r.mean)} |`
      );
    }
  }
  w('');

  // Scaling analysis
  w('## Scaling Analysis');
  w('');
  w('| Dimension | 1K | 10K | 10x Factor | Assessment |');
  w('|---|---|---|---|---|');

  const scalingPairs: Array<{
    label: string;
    section: string;
    small: RegExp;
    large: RegExp;
  }> = [
    {
      label: 'Flat mappings',
      section: 'file-size',
      small: /parse 1,000 lines/,
      large: /parse 10,000 lines/,
    },
    {
      label: 'Wide mappings',
      section: 'wide-mappings',
      small: /parse 1,000 keys/,
      large: /parse 10,000 keys/,
    },
    {
      label: 'Sequences',
      section: 'sequences',
      small: /parse 1,000 items/,
      large: /parse 10,000 items/,
    },
    {
      label: 'Chained expr',
      section: 'chained-expr',
      small: /parse 1,000 terms/,
      large: /parse 10,000 terms/,
    },
    {
      label: 'Escape strings',
      section: 'escape-strings',
      small: /parse 100 strings/,
      large: /parse 1,000 strings/,
    },
    {
      label: 'Error recovery',
      section: 'error-alternating',
      small: /parse 1,000 lines/,
      large: /parse 10,000 lines/,
    },
  ];

  for (const pair of scalingPairs) {
    const sec = sections.find(s => s.tag === pair.section);
    const s = sec?.results.find(r => pair.small.test(r.name));
    const l = sec?.results.find(r => pair.large.test(r.name));
    if (s && l) {
      const factor = l.mean / s.mean;
      const assessment =
        factor <= 11
          ? 'linear'
          : factor <= 15
            ? 'mildly super-linear'
            : 'super-linear';
      w(
        `| ${pair.label} | ${formatMs(s.mean)} | ${formatMs(l.mean)} | ${factor.toFixed(1)}x | ${assessment} |`
      );
    }
  }
  w('');

  // Lexer vs Parser
  w('## Lexer vs Parser');
  w('');
  w('| Input | Lex Time | Parse Time | Lex % |');
  w('|---|---|---|---|');

  const lexComparisons: Array<{
    section: string;
    parse: RegExp;
    lex: RegExp;
  }> = [
    {
      section: 'file-size',
      parse: /parse 10,000 lines/,
      lex: /lex-only 10,000 lines/,
    },
    {
      section: 'file-size',
      parse: /parse 100,000 lines/,
      lex: /lex-only 100,000 lines/,
    },
    {
      section: 'realistic',
      parse: /parse 5,000 lines/,
      lex: /lex-only 5,000 lines/,
    },
    {
      section: 'realistic',
      parse: /parse 50,000 lines/,
      lex: /lex-only 50,000 lines/,
    },
  ];

  for (const cmp of lexComparisons) {
    const sec = sections.find(s => s.tag === cmp.section);
    const p = sec?.results.find(r => cmp.parse.test(r.name));
    const l = sec?.results.find(r => cmp.lex.test(r.name));
    if (p && l) {
      const pct = ((l.mean / p.mean) * 100).toFixed(0);
      w(`| ${p.name} | ${formatMs(l.mean)} | ${formatMs(p.mean)} | ${pct}% |`);
    }
  }
  w('');

  // Highlighting overhead
  w('## Highlighting Overhead');
  w('');
  w('| Input | Parse Only | Parse+Highlight | Overhead |');
  w('|---|---|---|---|');

  const hlSec = sections.find(s => s.tag === 'highlighting');
  if (hlSec) {
    for (const n of [100, 1_000, 5_000]) {
      const nStr = n.toLocaleString();
      const po = hlSec.results.find(r => r.name === `parse-only ${nStr} lines`);
      const ph = hlSec.results.find(
        r => r.name === `parse+highlight ${nStr} lines`
      );
      if (po && ph) {
        const overhead = (((ph.mean - po.mean) / po.mean) * 100).toFixed(0);
        w(
          `| ${nStr} lines | ${formatMs(po.mean)} | ${formatMs(ph.mean)} | +${overhead}% |`
        );
      }
    }
  }
  w('');

  // Detailed results
  w('## Detailed Results');
  w('');

  for (const sec of sections) {
    w(`### ${sec.title}`);
    w('');
    w('| Benchmark | Mean | p95 | ops/s | Throughput | Size |');
    w('|---|---|---|---|---|---|');
    for (const r of sec.results) {
      w(
        `| ${r.name} | ${formatMs(r.mean)} | ${formatMs(r.p95)} | ${opsPerSec(r.mean)} | ${throughput(r.mean, r.inputBytes)} | ${r.inputSize} |`
      );
    }
    w('');
  }

  // Write file
  const thisDir = dirname(fileURLToPath(import.meta.url));
  const outPath = join(thisDir, '..', 'PERFORMANCE.md');
  writeFileSync(outPath, lines.join('\n') + '\n');
  console.log(`Report written to ${outPath}`);
}
