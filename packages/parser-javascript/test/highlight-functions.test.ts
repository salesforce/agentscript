/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Highlight tests for function-call captures.
 *
 * The pure-TS highlighter must classify direct call names as `function`
 * (`@function.builtin` for known built-ins) — mirroring the tree-sitter
 * `highlights.scm` rules — while leaving namespaced calls as member access.
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_FUNCTION_NAMES } from '@agentscript/types';
import { parse as parseJavascript } from '../src/index.js';
import { highlight, type HighlightCapture } from '../src/highlighter.js';

function highlightSource(source: string): HighlightCapture[] {
  const { rootNode } = parseJavascript(source);
  return highlight(rootNode);
}

/** Names captured under `function` / `function.builtin`, in document order. */
function functionCaptures(
  captures: HighlightCapture[]
): Array<{ text: string; name: string }> {
  return captures
    .filter(c => c.name === 'function' || c.name === 'function.builtin')
    .map(c => ({ text: c.text, name: c.name }));
}

describe('function-call highlighting', () => {
  for (const name of BUILTIN_FUNCTION_NAMES) {
    it(`captures built-in ${name}() as function.builtin`, () => {
      const source = `subagent main:
  description: "t"
  before_reasoning:
    if ${name}(@variables.x) == 0:
      transition to @subagent.main
`;
      const fns = functionCaptures(highlightSource(source));
      expect(fns).toContainEqual({ text: name, name: 'function.builtin' });
    });
  }

  it('captures an unknown function as plain function', () => {
    const source = `subagent main:
  description: "t"
  before_reasoning:
    if foo(@variables.x) == 0:
      transition to @subagent.main
`;
    const fns = functionCaptures(highlightSource(source));
    expect(fns).toContainEqual({ text: 'foo', name: 'function' });
  });

  it('captures nested calls (len(max(...))) — both function.builtin', () => {
    const source = `subagent main:
  description: "t"
  before_reasoning:
    if len(max(@variables.a, @variables.b)) == 0:
      transition to @subagent.main
`;
    const fns = functionCaptures(highlightSource(source));
    expect(fns).toContainEqual({ text: 'len', name: 'function.builtin' });
    expect(fns).toContainEqual({ text: 'max', name: 'function.builtin' });
  });

  it('does NOT capture namespaced calls (a2a.message(...)) as function', () => {
    // Namespaced calls have a member_expression callee; the trailing id keeps
    // member-access (`variable`) highlighting, matching highlights.scm.
    const source = `subagent main:
  description: "t"
  before_reasoning:
    if a2a.message("x") == "":
      transition to @subagent.main
`;
    const captures = highlightSource(source);
    const fns = functionCaptures(captures);
    expect(fns.map(f => f.text)).not.toContain('message');
    expect(fns.map(f => f.text)).not.toContain('a2a');
    // The method name is still highlighted, just as a variable (member access).
    const messageCapture = captures.find(c => c.text === 'message');
    expect(messageCapture?.name).toBe('variable');
  });
});
