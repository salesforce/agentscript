/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Error recovery metrics: measures how well each parser recovers from errors.
 *
 * Adapted from dialect/agentscript error-recovery-metrics.ts to support
 * both tree-sitter and parser-ts side-by-side.
 */

/** Minimal node interface covering both CSTNode and tree-sitter SyntaxNode. */
interface MeasurableNode {
  type: string;
  isError?: boolean;
  isMissing?: boolean;
  children: MeasurableNode[];
  /** CSTNode uses startOffset/endOffset, tree-sitter uses startIndex/endIndex. */
  startOffset?: number;
  endOffset?: number;
  startIndex?: number;
  endIndex?: number;
}

function getStart(node: MeasurableNode): number {
  return node.startOffset ?? node.startIndex ?? 0;
}

function getEnd(node: MeasurableNode): number {
  return node.endOffset ?? node.endIndex ?? 0;
}

/**
 * CST Coverage: fraction of source chars NOT inside ERROR/MISSING nodes.
 * Walks the tree collecting error spans, merges them, and computes the ratio.
 */
export function measureCstCoverage(
  rootNode: MeasurableNode,
  sourceLength: number
): number {
  if (sourceLength === 0) return 1.0;

  const errorSpans: Array<[number, number]> = [];

  function walk(node: MeasurableNode): void {
    if (node.isError || node.isMissing) {
      errorSpans.push([getStart(node), getEnd(node)]);
      return; // don't recurse into ERROR children to avoid double-counting
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(rootNode);

  const merged = mergeSpans(errorSpans);
  const errorChars = merged.reduce((sum, [a, b]) => sum + (b - a), 0);
  return Math.round((1 - errorChars / sourceLength) * 100) / 100;
}

/** Merge overlapping [start, end) spans. */
function mergeSpans(spans: Array<[number, number]>): Array<[number, number]> {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]!;
    const cur = sorted[i]!;
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1]);
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

export interface ScenarioMetrics {
  id: string;
  parser: string;
  /** Fraction of source chars not in ERROR/MISSING nodes */
  cstCoverage: number;
  /** Whether parsing threw an exception */
  crashed: boolean;
}

/**
 * Format metrics into a side-by-side summary table.
 */
export function formatMetricsTable(metrics: ScenarioMetrics[]): string {
  // Group by scenario id
  const byId = new Map<string, ScenarioMetrics[]>();
  for (const m of metrics) {
    let arr = byId.get(m.id);
    if (!arr) {
      arr = [];
      byId.set(m.id, arr);
    }
    arr.push(m);
  }

  const header =
    'Scenario                              | parser-ts | tree-sitter | delta';
  const separator =
    '--------------------------------------|-----------|-------------|------';

  const rows: string[] = [];
  for (const [id, group] of byId) {
    const pts = group.find(m => m.parser === 'parser-ts');
    const ts = group.find(m => m.parser === 'tree-sitter');
    const ptsVal = pts
      ? pts.crashed
        ? 'CRASH'
        : pts.cstCoverage.toFixed(2)
      : 'N/A';
    const tsVal = ts
      ? ts.crashed
        ? 'CRASH'
        : ts.cstCoverage.toFixed(2)
      : 'N/A';

    let delta = '';
    if (pts && ts && !pts.crashed && !ts.crashed) {
      const diff = pts.cstCoverage - ts.cstCoverage;
      if (Math.abs(diff) < 0.005) delta = '  =';
      else if (diff > 0) delta = ` +${diff.toFixed(2)}`;
      else delta = ` ${diff.toFixed(2)}`;
    }

    rows.push(
      `${id.padEnd(37)} | ${ptsVal.padStart(9)} | ${tsVal.padStart(11)} | ${delta}`
    );
  }

  // Compute averages (excluding crashes and N/A)
  const ptsValues = metrics
    .filter(m => m.parser === 'parser-ts' && !m.crashed)
    .map(m => m.cstCoverage);
  const tsValues = metrics
    .filter(m => m.parser === 'tree-sitter' && !m.crashed)
    .map(m => m.cstCoverage);

  const ptsAvg =
    ptsValues.length > 0
      ? (ptsValues.reduce((a, b) => a + b, 0) / ptsValues.length).toFixed(2)
      : 'N/A';
  const tsAvg =
    tsValues.length > 0
      ? (tsValues.reduce((a, b) => a + b, 0) / tsValues.length).toFixed(2)
      : 'N/A';

  let avgDelta = '';
  if (ptsValues.length > 0 && tsValues.length > 0) {
    const diff = parseFloat(ptsAvg) - parseFloat(tsAvg);
    if (Math.abs(diff) < 0.005) avgDelta = '  =';
    else if (diff > 0) avgDelta = ` +${diff.toFixed(2)}`;
    else avgDelta = ` ${diff.toFixed(2)}`;
  }

  const avgSeparator =
    '--------------------------------------|-----------|-------------|------';
  const avgRow = `${'AVERAGE'.padEnd(37)} | ${ptsAvg.padStart(9)} | ${tsAvg.padStart(11)} | ${avgDelta}`;

  return [header, separator, ...rows, avgSeparator, avgRow].join('\n');
}
