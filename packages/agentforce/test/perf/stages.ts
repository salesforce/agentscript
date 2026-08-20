/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Per-stage isolation for the parsing pipeline performance guard.
 *
 * Mirrors `compileSource()` (../../src/compile.ts) but exposes each stage as a
 * discrete closure. Inputs for later stages (CST, AST) are precomputed OUTSIDE
 * the timed region so each closure measures ONLY its own stage's work.
 *
 * Uses agentforce's own `getParser()` wrapper, which returns the pure-TS
 * parser-javascript backend unless `init()` is called. We deliberately never
 * call `init()` — the pure-TS path is what CI actually runs.
 */

import { parseAndLint } from '@agentscript/language';
import {
  agentforceDialect,
  type ParsedAgentforce,
} from '@agentscript/agentforce-dialect';
import { compile } from '@agentscript/compiler';
import { getParser } from '../../src/parser.js';
import { compileSource } from '../../src/compile.js';

export type StageName =
  | 'parse'
  | 'parseAndLint'
  | 'compile'
  | 'compileSourceSnake'
  | 'compileSourceCamel';

export const STAGES: StageName[] = [
  'parse',
  'parseAndLint',
  'compile',
  'compileSourceSnake',
  'compileSourceCamel',
];

export type StageRunners = Record<StageName, () => void>;

/**
 * Build one set of stage closures for a single fixture source.
 *
 * The CST and AST are computed once here (untimed); each returned closure
 * re-runs just its own stage against those precomputed inputs. `compileSource`
 * runs the whole pipeline end-to-end and captures cumulative real-world cost.
 */
export function buildStageRunners(source: string): StageRunners {
  const parser = getParser();
  const tree = parser.parse(source);
  const parseResult = parseAndLint(tree.rootNode, agentforceDialect);
  const ast = parseResult.ast as ParsedAgentforce;

  return {
    parse: () => {
      parser.parse(source);
    },
    parseAndLint: () => {
      parseAndLint(tree.rootNode, agentforceDialect);
    },
    compile: () => {
      compile(ast);
    },
    // End-to-end compile, default snake_case output keys.
    compileSourceSnake: () => {
      compileSource(source);
    },
    // End-to-end compile with camelCase output keys — the same pipeline plus
    // the schema-driven snake_case→camelCase key rename. Delta vs
    // compileSourceSnake is the camelCase conversion's own cost.
    compileSourceCamel: () => {
      compileSource(source, { camelCase: true });
    },
  };
}
