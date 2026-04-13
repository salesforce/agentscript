/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared test utilities for parser-ts tests.
 */

export interface TestCase {
  name: string;
  input: string;
  expected: string;
}

export function parseCorpusFile(content: string): TestCase[] {
  const tests: TestCase[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    // Look for separator line (=====)
    if (!lines[i]!.startsWith('====')) {
      i++;
      continue;
    }
    i++; // skip separator

    // Test name
    const name = lines[i]!.trim();
    i++;

    // Skip closing separator
    while (i < lines.length && lines[i]!.startsWith('====')) i++;

    // Collect input lines until ---
    const inputLines: string[] = [];
    while (i < lines.length && lines[i] !== '---') {
      inputLines.push(lines[i]!);
      i++;
    }
    i++; // skip ---

    // Collect expected output until next separator or end
    const expectedLines: string[] = [];
    while (i < lines.length && !lines[i]!.startsWith('====')) {
      expectedLines.push(lines[i]!);
      i++;
    }

    // Trim trailing empty lines
    while (
      inputLines.length > 0 &&
      inputLines[inputLines.length - 1]!.trim() === ''
    ) {
      inputLines.pop();
    }
    while (
      expectedLines.length > 0 &&
      expectedLines[expectedLines.length - 1]!.trim() === ''
    ) {
      expectedLines.pop();
    }

    // Remove leading empty lines from input
    while (inputLines.length > 0 && inputLines[0]!.trim() === '') {
      inputLines.shift();
    }

    tests.push({
      name,
      input: inputLines.join('\n'),
      expected: expectedLines.join('\n'),
    });
  }

  return tests;
}

export function normalizeSExp(sexp: string): string {
  return (
    sexp
      // tree-sitter emits (line_continuation) for `\<newline>` (it's in extras);
      // parser-js consumes it silently, so strip it before comparison.
      .replace(/\(line_continuation\)/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\( /g, '(')
      .replace(/ \)/g, ')')
      .trim()
  );
}
