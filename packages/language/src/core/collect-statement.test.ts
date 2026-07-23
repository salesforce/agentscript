/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * AST/emit tests for the `collect` statement (no dialect dependency).
 */
import { describe, it, expect } from 'vitest';
import { CollectClause } from './statements.js';
import { StringLiteral } from './expressions.js';

describe('CollectClause', () => {
  it('emits collect/message shape from a manually constructed node', () => {
    const target = new StringLiteral('@variables.x') as never;
    const message = new StringLiteral('Ask me');
    const clause = new CollectClause(target, message);
    const out = clause.__emit({ indent: 0 });
    expect(out).toContain('collect');
    expect(out).toContain('message:');
    expect(out).toContain('"Ask me"');
    // `collect` is an operator, not a key: no colon after the target. The colon
    // on the `message:` body line is a mapping key and is expected.
    const [header] = out.split('\n');
    expect(header).not.toContain(':');
  });

  it('reports its kind', () => {
    const clause = new CollectClause(
      new StringLiteral('@variables.x') as never,
      new StringLiteral('Ask me')
    );
    expect(clause.__kind).toBe('CollectClause');
  });
});
