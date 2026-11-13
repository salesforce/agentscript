/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { parseAndLint, StringLiteral } from '@agentscript/language';
import type * as Language from '@agentscript/language';
import { compileSource, parse } from '../src/index.js';

// The agentforce schema gates nothing, so diagnostics can't show whether gates
// arrive. Spy on parseAndLint to check what each entry point passes it.
vi.mock('@agentscript/language', async importOriginal => {
  const actual = await importOriginal<typeof Language>();
  return { ...actual, parseAndLint: vi.fn(actual.parseAndLint) };
});

const GATES = { 'test.gate': true };
const SOURCE = 'system:\n    instructions: "Hello"';

function gatesPassed() {
  return vi.mocked(parseAndLint).mock.calls.map(([, , options]) => options);
}

describe('gates forwarding', () => {
  beforeEach(() => {
    vi.mocked(parseAndLint).mockClear();
  });

  test('compileSource passes gates to parse and lint', () => {
    compileSource(SOURCE, { gates: GATES });
    expect(gatesPassed()).toEqual([{ gates: GATES }]);
  });

  test('parse passes gates to parse and lint', () => {
    parse(SOURCE, { gates: GATES });
    expect(gatesPassed()).toEqual([{ gates: GATES }]);
  });

  test('Document keeps its gates when undo and redo re-parse', () => {
    const doc = parse(SOURCE, { gates: GATES });
    doc.mutate(ast => {
      const sys = (ast as unknown as Record<string, Record<string, unknown>>)
        .system;
      if (sys) {
        sys.instructions = new StringLiteral('Changed');
      }
    });
    vi.mocked(parseAndLint).mockClear();

    doc.undo();
    doc.redo();
    expect(gatesPassed()).toEqual([{ gates: GATES }, { gates: GATES }]);
  });
});
