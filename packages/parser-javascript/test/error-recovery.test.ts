/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Error recovery metrics: compares CST coverage between parser-ts and tree-sitter
 * across 35 fixture files with intentional errors.
 *
 * CST coverage = fraction of source chars NOT inside ERROR/MISSING nodes.
 * Higher is better — means the parser recovered more of the input.
 *
 * Tree-sitter tests are skipped gracefully if native bindings aren't available.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse as parseTS } from '../src/index.js';
import {
  measureCstCoverage,
  formatMetricsTable,
  type ScenarioMetrics,
} from './error-recovery-metrics.js';

// ---------------------------------------------------------------------------
// Dynamic tree-sitter loading (same pattern as parity.test.ts)
// ---------------------------------------------------------------------------

interface TreeSitterParser {
  parse(source: string): {
    rootNode: {
      type: string;
      isError: boolean;
      isMissing: boolean;
      children: unknown[];
      startIndex: number;
      endIndex: number;
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
  // tree-sitter not available — those metrics will be skipped
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXTURES_DIR = join(__dirname, 'fixtures', 'error-recovery');

const fixtures = readdirSync(FIXTURES_DIR)
  .filter(f => f.endsWith('.agent'))
  .sort()
  .map(f => ({
    id: f.replace('.agent', ''),
    source: readFileSync(join(FIXTURES_DIR, f), 'utf-8'),
  }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('error recovery metrics', () => {
  const allMetrics: ScenarioMetrics[] = [];

  describe('parser-ts', () => {
    for (const { id, source } of fixtures) {
      it(`${id}`, () => {
        let crashed = false;
        let cstCoverage = 0;
        try {
          const result = parseTS(source);
          cstCoverage = measureCstCoverage(
            result.rootNode as unknown as Parameters<
              typeof measureCstCoverage
            >[0],
            source.length
          );
        } catch {
          crashed = true;
        }
        const m: ScenarioMetrics = {
          id,
          parser: 'parser-ts',
          cstCoverage,
          crashed,
        };
        allMetrics.push(m);
        expect(crashed).toBe(false);
      });
    }
  });

  describe.runIf(treeSitterAvailable)('tree-sitter', () => {
    for (const { id, source } of fixtures) {
      it(`${id}`, () => {
        let crashed = false;
        let cstCoverage = 0;
        try {
          const tree = treeSitterParser!.parse(source);
          cstCoverage = measureCstCoverage(
            tree.rootNode as unknown as Parameters<
              typeof measureCstCoverage
            >[0],
            source.length
          );
        } catch {
          crashed = true;
        }
        const m: ScenarioMetrics = {
          id,
          parser: 'tree-sitter',
          cstCoverage,
          crashed,
        };
        allMetrics.push(m);
        expect(crashed).toBe(false);
      });
    }
  });

  it('summary', () => {
    const table = formatMetricsTable(allMetrics);
    console.log('\n=== Error Recovery CST Coverage ===\n');
    console.log(table);
    console.log('');

    // Snapshot for regression tracking
    const snapshot = allMetrics
      .sort(
        (a, b) => a.id.localeCompare(b.id) || a.parser.localeCompare(b.parser)
      )
      .map(m => ({
        id: m.id,
        parser: m.parser,
        cstCoverage: m.cstCoverage,
        crashed: m.crashed,
      }));
    expect(snapshot).toMatchSnapshot();
  });
});
