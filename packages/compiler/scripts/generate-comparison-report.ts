#!/usr/bin/env tsx

/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Generate a detailed comparison report for compiler output vs expected DSL
 */

import { writeFileSync, mkdirSync } from 'fs';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { compile } from '../src/compile.js';
import {
  parseSource,
  readFixtureSource,
  readExpectedYaml,
} from '../test/test-utils.js';

const FIXTURE_PAIRS: [string, string][] = [
  ['hello_world.agent', 'hello_world_dsl.yaml'],
  ['weather.agent', 'weather_dsl.yaml'],
  ['deep_supervision.agent', 'deep_supervision_dsl.yaml'],
  ['router_node_template.agent', 'router_node_template_dsl.yaml'],
  ['matrix.agent', 'matrix_dsl.yaml'],
  ['multi-line-descriptions.agent', 'multi_line_descriptions_dsl.yaml'],
];

interface Diff {
  path: string;
  actual: unknown;
  expected: unknown;
}

function findDiffs(actual: unknown, expected: unknown, path: string): Diff[] {
  const diffs: Diff[] = [];
  if (actual === expected) return diffs;
  if (actual === null && expected === null) return diffs;
  if (actual === undefined && expected === undefined) return diffs;
  if (typeof actual !== typeof expected) {
    diffs.push({ path, actual, expected });
    return diffs;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) {
      diffs.push({
        path: `${path}[length]`,
        actual: actual.length,
        expected: expected.length,
      });
    }
    const maxLen = Math.max(actual.length, expected.length);
    for (let i = 0; i < maxLen; i++) {
      diffs.push(...findDiffs(actual[i], expected[i], `${path}[${i}]`));
    }
    return diffs;
  }
  if (
    typeof actual === 'object' &&
    actual !== null &&
    typeof expected === 'object' &&
    expected !== null
  ) {
    const allKeys = new Set([
      ...Object.keys(actual as Record<string, unknown>),
      ...Object.keys(expected as Record<string, unknown>),
    ]);
    for (const key of allKeys) {
      const a = (actual as Record<string, unknown>)[key];
      const e = (expected as Record<string, unknown>)[key];
      if (a === undefined && e !== undefined) {
        diffs.push({ path: `${path}.${key}`, actual: undefined, expected: e });
      } else if (a !== undefined && e === undefined) {
        diffs.push({ path: `${path}.${key}`, actual: a, expected: undefined });
      } else {
        diffs.push(...findDiffs(a, e, `${path}.${key}`));
      }
    }
    return diffs;
  }
  if (actual !== expected) {
    diffs.push({ path, actual, expected });
  }
  return diffs;
}

interface TestResult {
  script: string;
  expected: string;
  diffCount: number;
  diffs: Diff[];
}

function generateReport() {
  console.log('🔄 Running comparison tests...\n');

  const results: TestResult[] = [];
  let totalDiffs = 0;
  let perfectMatches = 0;

  for (const [agentFile, expectedFile] of FIXTURE_PAIRS) {
    const source = readFixtureSource(agentFile);
    const ast = parseSource(source);
    const result = compile(ast);
    const expectedYaml = readExpectedYaml(expectedFile);
    const expected = yamlParse(expectedYaml);
    const actual = yamlParse(yamlStringify(result.output));

    const diffs = findDiffs(actual, expected, '');

    results.push({
      script: agentFile,
      expected: expectedFile,
      diffCount: diffs.length,
      diffs,
    });

    totalDiffs += diffs.length;
    if (diffs.length === 0) {
      perfectMatches++;
      console.log(`✅ ${agentFile} - PERFECT MATCH`);
    } else {
      console.log(`❌ ${agentFile} - ${diffs.length} differences`);
    }
  }

  // Generate summary
  const summary = {
    timestamp: new Date().toISOString(),
    totalScripts: FIXTURE_PAIRS.length,
    perfectMatches,
    scriptsWithDiffs: FIXTURE_PAIRS.length - perfectMatches,
    totalDiffs,
    matchRate: `${((perfectMatches / FIXTURE_PAIRS.length) * 100).toFixed(1)}%`,
    results: results.map(r => ({
      script: r.script,
      expected: r.expected,
      diffCount: r.diffCount,
      status: r.diffCount === 0 ? 'PASS' : 'FAIL',
    })),
  };

  // Generate CSV
  const csvLines = [
    'Script,Expected,Diff Count,Status',
    ...results.map(
      r =>
        `${r.script},${r.expected},${r.diffCount},${r.diffCount === 0 ? 'PASS' : 'FAIL'}`
    ),
  ];

  // Generate detailed JSON with all diffs
  const detailedJson = {
    summary,
    details: results.map(r => ({
      script: r.script,
      expected: r.expected,
      diffCount: r.diffCount,
      diffs: r.diffs,
    })),
  };

  // Write outputs
  const outputDir = './test/outputs';
  mkdirSync(outputDir, { recursive: true });

  writeFileSync(
    `${outputDir}/comparison-summary.json`,
    JSON.stringify(summary, null, 2)
  );

  writeFileSync(`${outputDir}/comparison-report.csv`, csvLines.join('\n'));

  writeFileSync(
    `${outputDir}/comparison-report.json`,
    JSON.stringify(detailedJson, null, 2)
  );

  console.log('\n📊 Summary:');
  console.log(`   Total scripts: ${FIXTURE_PAIRS.length}`);
  console.log(`   ✅ Perfect matches: ${perfectMatches}`);
  console.log(
    `   ❌ Scripts with diffs: ${FIXTURE_PAIRS.length - perfectMatches}`
  );
  console.log(`   📈 Match rate: ${summary.matchRate}`);
  console.log(`   Total differences: ${totalDiffs}`);
  console.log('\n📁 Reports generated:');
  console.log(`   - ${outputDir}/comparison-summary.json`);
  console.log(`   - ${outputDir}/comparison-report.csv`);
  console.log(`   - ${outputDir}/comparison-report.json`);
}

generateReport();
