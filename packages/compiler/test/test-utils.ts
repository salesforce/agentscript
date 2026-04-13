/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Test utilities for the compiler package.
 * Provides parsing helpers to convert .agent source into AST for compile().
 */

import { parse } from '@agentscript/parser';
import { Dialect } from '@agentscript/language';
import { AgentforceSchema } from '@agentscript/agentforce-dialect';
import type { ParsedAgentforce } from '../src/parsed-types.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse an AgentScript source string into the AST expected by compile().
 */
export function parseSource(source: string): ParsedAgentforce {
  const { rootNode: root } = parse(source);

  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, AgentforceSchema);

  return toParsedAgentforce(result.value);
}

/**
 * Narrow a dialect-parsed value to the strongly-typed ParsedAgentforce.
 *
 * `dialect.parse()` returns a generic `Parsed<…>` that is structurally
 * identical to `ParsedAgentforce`, but TypeScript can't prove it.
 * Centralising the single `as unknown as` cast here keeps every call-site
 * cast-free.
 */
export function toParsedAgentforce(value: object): ParsedAgentforce {
  return value as unknown as ParsedAgentforce;
}

/**
 * Read and parse a .agent fixture file.
 */
export function parseFixture(fixtureName: string): ParsedAgentforce {
  const fixturePath = path.resolve(
    __dirname,
    'fixtures',
    'scripts',
    fixtureName
  );
  const source = fs.readFileSync(fixturePath, 'utf-8');
  return parseSource(source);
}

/**
 * Read a .agent fixture file and return source text.
 */
export function readFixtureSource(fixtureName: string): string {
  const fixturePath = path.resolve(
    __dirname,
    'fixtures',
    'scripts',
    fixtureName
  );
  return fs.readFileSync(fixturePath, 'utf-8');
}

/**
 * Read expected YAML output for a fixture.
 */
export function readExpectedYaml(yamlName: string): string {
  const yamlPath = path.resolve(__dirname, 'fixtures', 'expected', yamlName);
  return fs.readFileSync(yamlPath, 'utf-8');
}

/**
 * Fixtures directory paths.
 */
export const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
export const SCRIPTS_DIR = path.resolve(FIXTURES_DIR, 'scripts');
export const EXPECTED_DIR = path.resolve(FIXTURES_DIR, 'expected');
