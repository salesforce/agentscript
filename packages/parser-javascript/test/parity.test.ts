/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Parity test: runs both tree-sitter and parser-js on the same inputs
 * and compares their CST output.
 *
 * - Both valid (no errors): s-expressions must match exactly (test fails if different)
 * - One has errors, the other doesn't: test fails (parser disagreement)
 * - Both have errors: snapshot the deviation for tracking over time
 *
 * Skips gracefully if tree-sitter native bindings are not available.
 */

import { describe, it, expect, assert } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { parse as parseTS } from '../src/index.js';
import { parseCorpusFile, normalizeSExp } from './test-utils.js';

// ---------------------------------------------------------------------------
// Dynamic tree-sitter loading
// ---------------------------------------------------------------------------

interface TreeSitterParser {
  parse(source: string): {
    rootNode: {
      toString(): string;
      hasError: boolean;
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
  // tree-sitter native bindings not available — tests will be skipped
}

// ---------------------------------------------------------------------------
// Corpus loading
// ---------------------------------------------------------------------------

const CORPUS_DIR = join(__dirname, '../../parser-tree-sitter/test/corpus');
const OWN_CORPUS_DIR = join(__dirname, 'corpus');
const SOT_FILE = join(__dirname, '../sot/source.agent');
const DOGFOOD_DIR = join(__dirname, 'fixtures/dogfood-scripts/extracted');

function loadCorpusFiles(dir: string): { file: string; content: string }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(f => f.endsWith('.txt'))
    .sort()
    .map(f => ({ file: f, content: readFileSync(join(dir, f), 'utf-8') }));
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe.runIf(treeSitterAvailable)(
  'parser parity: tree-sitter vs parser-js',
  () => {
    function assertParity(source: string) {
      const tsResult = parseTS(source);
      const treeSitterTree = treeSitterParser!.parse(source);

      const tsSExp = normalizeSExp(tsResult.rootNode.toSExp());
      const treeSitterSExp = normalizeSExp(treeSitterTree.rootNode.toString());

      const tsHasError = tsResult.rootNode.hasError;
      const treeSitterHasError = treeSitterTree.rootNode.hasError;

      if (!tsHasError && !treeSitterHasError) {
        if (tsSExp !== treeSitterSExp) {
          assert.fail(
            [
              `S-expression mismatch (both parsers valid)`,
              `INPUT:\n${source}`,
              `PARSER-JS:\n${tsSExp}`,
              `TREE-SITTER:\n${treeSitterSExp}`,
            ].join('\n\n')
          );
        }
      } else if (tsHasError !== treeSitterHasError) {
        expect.unreachable(
          [
            `Parser disagreement: parser-js hasError=${tsHasError}, tree-sitter hasError=${treeSitterHasError}`,
            `INPUT:\n${source}`,
            `PARSER-JS:\n${tsSExp}`,
            `TREE-SITTER:\n${treeSitterSExp}`,
          ].join('\n\n')
        );
      } else {
        expect({
          parserTs: tsSExp,
          treeSitter: treeSitterSExp,
          match: tsSExp === treeSitterSExp,
        }).toMatchSnapshot();
      }
    }

    const corpusFiles = loadCorpusFiles(CORPUS_DIR);
    const ownCorpusFiles = loadCorpusFiles(OWN_CORPUS_DIR);

    for (const { file, content } of [...corpusFiles, ...ownCorpusFiles]) {
      const tests = parseCorpusFile(content);

      describe(file, () => {
        for (const test of tests) {
          it(test.name, () => {
            assertParity(test.input);
          });
        }
      });
    }

    if (existsSync(SOT_FILE)) {
      it('sot/source.agent', () => {
        assertParity(readFileSync(SOT_FILE, 'utf-8'));
      });
    }

    const dogfoodFiles = existsSync(DOGFOOD_DIR)
      ? readdirSync(DOGFOOD_DIR)
          .filter(f => f.endsWith('.agent'))
          .sort()
      : [];

    describe.skip('dogfood scripts', () => {
      for (const file of dogfoodFiles) {
        it(file, () => {
          assertParity(readFileSync(join(DOGFOOD_DIR, file), 'utf-8'));
        });
      }
    });
  }
);
