/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Corpus test runner: parses each test case from tree-sitter corpus files
 * and compares the s-expression output against expected output.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { parse } from '../src/index.js';
import { parseCorpusFile, normalizeSExp } from './test-utils.js';

const CORPUS_DIR = join(__dirname, '../../parser-tree-sitter/test/corpus');
const OWN_CORPUS_DIR = join(__dirname, 'corpus');

// Get all corpus files
const corpusFiles = readdirSync(CORPUS_DIR)
  .filter(f => f.endsWith('.txt'))
  .sort();

for (const file of corpusFiles) {
  const content = readFileSync(join(CORPUS_DIR, file), 'utf-8');
  const tests = parseCorpusFile(content);

  describe(`corpus/${file}`, () => {
    for (const test of tests) {
      it(test.name, () => {
        const result = parse(test.input);
        const actual = result.rootNode.toSExp();

        const normalizedActual = normalizeSExp(actual);
        const normalizedExpected = normalizeSExp(test.expected);

        if (normalizedActual !== normalizedExpected) {
          // Show readable diff
          console.log('INPUT:');
          console.log(test.input);
          console.log('\nEXPECTED:');
          console.log(test.expected);
          console.log('\nACTUAL:');
          console.log(actual);
        }

        expect(normalizedActual).toBe(normalizedExpected);
      });
    }
  });
}

// Also run our own parser-javascript corpus tests
const ownCorpusFiles = readdirSync(OWN_CORPUS_DIR)
  .filter(f => f.endsWith('.txt'))
  .sort();

for (const file of ownCorpusFiles) {
  const content = readFileSync(join(OWN_CORPUS_DIR, file), 'utf-8');
  const tests = parseCorpusFile(content);

  describe(`parser-javascript/${file}`, () => {
    for (const test of tests) {
      it(test.name, () => {
        const result = parse(test.input);
        const actual = result.rootNode.toSExp();

        const normalizedActual = normalizeSExp(actual);
        const normalizedExpected = normalizeSExp(test.expected);

        if (normalizedActual !== normalizedExpected) {
          console.log('INPUT:');
          console.log(test.input);
          console.log('\nEXPECTED:');
          console.log(test.expected);
          console.log('\nACTUAL:');
          console.log(actual);
        }

        expect(normalizedActual).toBe(normalizedExpected);
      });
    }
  });
}
