/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Diagnostics for the `ask for` statement body (W-23482160):
 * - `instructions:` is required.
 * - the removed `message:` key raises a migration error.
 * (Diagnostic codes keep their internal `collect-*` spelling.)
 */

import { describe, it, expect } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';
import { collectDiagnostics } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { AgentScriptSchema } from '../schema.js';

/** Parse a source string and return the AST-walk diagnostics. */
function astDiagnostics(source: string): Diagnostic[] {
  const result = parseWithDiagnostics(source, AgentScriptSchema);
  return collectDiagnostics(result.value);
}

const HEADER = `subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
`;

describe('collect body validation', () => {
  it('accepts a collect with an instructions: field (no diagnostic)', () => {
    const source = `${HEADER}      ask for @variables.city
        instructions: "Which city are you in?"
`;
    const diags = astDiagnostics(source);
    expect(
      diags.filter(
        d =>
          d.code === 'collect-missing-instructions' ||
          d.code === 'collect-message-removed'
      )
    ).toEqual([]);
  });

  it('flags the removed message: key with a migration error', () => {
    const source = `${HEADER}      ask for @variables.city
        message: "Which city are you in?"
`;
    const diags = astDiagnostics(source);
    const removed = diags.filter(d => d.code === 'collect-message-removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].message).toContain('`message:`');
    expect(removed[0].message).toContain('`instructions:`');
    // The migration hint is the only actionable diagnostic — no redundant
    // missing-instructions error piled on top.
    expect(
      diags.filter(d => d.code === 'collect-missing-instructions')
    ).toEqual([]);
  });

  it('flags a collect with no instructions: field', () => {
    const source = `${HEADER}      ask for @variables.city
        note: "not an instruction"
`;
    const diags = astDiagnostics(source);
    const missing = diags.filter(
      d => d.code === 'collect-missing-instructions'
    );
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('`instructions:`');
  });
});
