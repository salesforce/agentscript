/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Unit tests for the `else if` clause keyword change.
 *
 * The grammar replaced the single `elif` keyword with a two-token `else if`
 * sequence (CST node `else_if_clause`). These tests pin the contract at the
 * parser-javascript layer:
 *
 *   - `else if` produces a clean CST with `else_if_clause` alternatives.
 *   - The legacy `elif` keyword now produces ERROR nodes (no more silent
 *     accept; `elif` is unrecognized syntax).
 */
import { describe, it, expect } from 'vitest';
import { parse } from '../src/index.js';
import type { CSTNode } from '../src/cst-node.js';

function* walk(node: CSTNode): Generator<CSTNode> {
  yield node;
  for (const child of node.children ?? []) {
    yield* walk(child as CSTNode);
  }
}

function nodesOfType(root: CSTNode, type: string): CSTNode[] {
  const out: CSTNode[] = [];
  for (const n of walk(root)) {
    if (n.type === type) out.push(n);
  }
  return out;
}

function hasError(root: CSTNode): boolean {
  for (const n of walk(root)) {
    if (n.type === 'ERROR' || n.isMissing === true) return true;
  }
  return false;
}

describe('else if clauses', () => {
  it('parses a single else if as an else_if_clause alternative', () => {
    const source = [
      'topic main:',
      '    instructions: ->',
      '        if @var.x:',
      '            run @action.a',
      '        else if @var.y:',
      '            run @action.b',
    ].join('\n');

    const { rootNode } = parse(source);

    expect(hasError(rootNode)).toBe(false);
    expect(nodesOfType(rootNode, 'else_if_clause')).toHaveLength(1);
    expect(nodesOfType(rootNode, 'elif_clause')).toHaveLength(0);
  });

  it('parses a multi-link else if chain', () => {
    const source = [
      'topic main:',
      '    instructions: ->',
      '        if @var.a:',
      '            run @action.one',
      '        else if @var.b:',
      '            run @action.two',
      '        else if @var.c:',
      '            run @action.three',
      '        else:',
      '            run @action.default',
    ].join('\n');

    const { rootNode } = parse(source);

    expect(hasError(rootNode)).toBe(false);
    expect(nodesOfType(rootNode, 'else_if_clause')).toHaveLength(2);
    expect(nodesOfType(rootNode, 'else_clause')).toHaveLength(1);
  });

  it('rejects the legacy elif keyword as unrecognized syntax', () => {
    // Used to be valid grammar before the rename; should now produce ERROR
    // somewhere in the tree (parsed as orphan / unrecognized statement).
    const source = [
      'topic main:',
      '    instructions: ->',
      '        if @var.a:',
      '            run @action.one',
      '        elif @var.b:',
      '            run @action.two',
    ].join('\n');

    const { rootNode } = parse(source);

    expect(hasError(rootNode)).toBe(true);
    expect(nodesOfType(rootNode, 'else_if_clause')).toHaveLength(0);
  });
});
