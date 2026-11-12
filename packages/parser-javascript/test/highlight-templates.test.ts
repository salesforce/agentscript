/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Highlight tests for `do` directives (`|` lines) in workflow steps. They use
 * the same captures as `|` lines in reasoning procedures.
 */

import { describe, it, expect } from 'vitest';
import { parse as parseJavascript } from '../src/index.js';
import { highlight } from '../src/highlighter.js';

function captures(source: string): Array<{ text: string; name: string }> {
  return highlight(parseJavascript(source).rootNode).map(c => ({
    text: c.text,
    name: c.name,
  }));
}

describe('workflow do directive highlighting', () => {
  it('highlights text and interpolations in a step, including if bodies', () => {
    const source = `workflow returns:
    description: "Returns"
    step confirm:
        | Call {!@actions.process_return} now
          and say it back
        if @variables.ready:
            | Use {!@variables.order_id}
`;
    const result = captures(source);

    expect(result.filter(c => c.name === 'punctuation.special')).toEqual([
      { text: '|', name: 'punctuation.special' },
      { text: '|', name: 'punctuation.special' },
    ]);
    expect(
      result.filter(c => c.name === 'punctuation.template').map(c => c.text)
    ).toEqual(['{!', '}', '{!', '}']);
    expect(result).toContainEqual({
      text: ' now\n          and say it back',
      name: 'string',
    });
    expect(result).toContainEqual({ text: 'process_return', name: 'variable' });
    expect(result).toContainEqual({ text: 'order_id', name: 'variable' });
  });
});
