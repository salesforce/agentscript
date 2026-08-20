/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Capture-parity test for function highlighting.
 *
 * The two highlighters — tree-sitter's `highlights.scm` and the pure-TS CST
 * walk — must agree on which call names are `function` vs `function.builtin`.
 * tree-sitter's `captures()` returns every matching pattern for a node (so a
 * built-in yields both `function` and `function.builtin`); later patterns win,
 * so we reduce to the last capture per position — that is the effective color,
 * which is exactly what the TS highlighter emits directly.
 *
 */

import { describe, it, expect } from 'vitest';
import { BUILTIN_FUNCTION_NAMES } from '@agentscript/types';
import { parse as parseJavascript } from '../src/index.js';
import { highlight } from '../src/highlighter.js';

interface TSNode {
  text: string;
  startIndex: number;
  endIndex: number;
}
interface TSQuery {
  captures(node: unknown): Array<{ name: string; node: TSNode }>;
}
interface TSParser {
  parse(source: string): { rootNode: unknown };
}

const Parser = (await import('tree-sitter')).default;
const AS = (await import('@agentscript/parser-tree-sitter')).default;
const nativeParser = new Parser();
nativeParser.setLanguage(AS as unknown as typeof nativeParser.Language);
const parser = nativeParser as unknown as TSParser;
const QueryCtor = (
  Parser as unknown as { Query: new (lang: unknown, src: string) => TSQuery }
).Query;
const query = new QueryCtor(
  AS,
  (AS as unknown as { HIGHLIGHTS_QUERY: string }).HIGHLIGHTS_QUERY
);

/** Effective tree-sitter function captures: last (highest-priority) per span. */
function treeSitterFunctionCaptures(
  source: string
): Array<{ text: string; name: string }> {
  const tree = parser.parse(source);
  const caps = query.captures(tree.rootNode);
  const bySpan = new Map<string, { text: string; name: string }>();
  for (const c of caps) {
    if (!c.name.startsWith('function')) continue;
    // Later captures overwrite earlier ones for the same span (priority).
    bySpan.set(`${c.node.startIndex}:${c.node.endIndex}`, {
      text: c.node.text,
      name: c.name,
    });
  }
  return [...bySpan.values()];
}

function tsHighlighterFunctionCaptures(
  source: string
): Array<{ text: string; name: string }> {
  const { rootNode } = parseJavascript(source);
  return highlight(rootNode)
    .filter(c => c.name === 'function' || c.name === 'function.builtin')
    .map(c => ({ text: c.text, name: c.name }));
}

const SAMPLES = [
  ...BUILTIN_FUNCTION_NAMES.map(
    name => `subagent main:
  description: "t"
  before_reasoning:
    if ${name}(@variables.x) == 0:
      transition to @subagent.main
`
  ),
  `subagent main:
  description: "t"
  before_reasoning:
    if len(max(@variables.a, @variables.b)) == 0:
      transition to @subagent.main
`,
  `subagent main:
  description: "t"
  before_reasoning:
    if foo(@variables.x) == 0:
      transition to @subagent.main
`,
];

describe('function highlight parity (tree-sitter vs pure-TS)', () => {
  for (const [i, source] of SAMPLES.entries()) {
    it(`sample ${i} agrees on function captures`, () => {
      const ts = treeSitterFunctionCaptures(source).sort((a, b) =>
        a.text.localeCompare(b.text)
      );
      const js = tsHighlighterFunctionCaptures(source).sort((a, b) =>
        a.text.localeCompare(b.text)
      );
      expect(js).toEqual(ts);
    });
  }
});
