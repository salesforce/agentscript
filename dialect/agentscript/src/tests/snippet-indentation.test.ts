/**
 * Indentation guardrails for completion snippets in AgentScript `.agent` files.
 *
 * Bug: W-22181425 — when a multi-line completion snippet is inserted at a
 * cursor that is already indented (or into a document that uses a non-default
 * indent step), the snippet's body uses a hardcoded 4-space step from the
 * generator instead of matching the document's actual step.
 *
 * The contract we pin:
 *   "Indent step is consistent — same number of spaces at every nesting
 *    level, relative to the cursor, and that step matches the document's
 *    existing step."
 *
 * This file is the AgentScript-dialect mirror of
 * `dialect/agentfabric/src/tests/snippet-indentation.test.ts`. Its purpose is
 * to prove the bug is engine-side (in `packages/language/src/core/analysis/
 * snippet-gen.ts` and `packages/lsp/src/providers/completion.ts`), not
 * specific to AgentFabric. Failing tests here use cursor positions / document
 * steps where the generator's hardcoded `tabSize = 4` does not match the
 * surrounding document.
 *
 * Snippet inflow: `getFieldCompletions` returns the raw snippet (column 0
 * baseline). The LSP layer forwards it verbatim; the host editor (VS Code's
 * snippet engine, mirrored by Monaco) prepends the cursor's leading
 * whitespace to lines 2+ during insertion per LSP semantics. We replicate
 * that host-editor step here so assertions reason about the indentation
 * the user actually sees.
 */

import { describe, it, expect } from 'vitest';
import {
  getFieldCompletions,
  type CompletionCandidate,
} from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

/** Mirrors VS Code/Monaco's snippet engine cursor-indent prepend on insert. */
function applyCursorIndent(snippet: string, baseIndent: number): string {
  const lines = snippet.split('\n');
  if (lines.length <= 1) return snippet;
  const indentStr = ' '.repeat(baseIndent);
  return lines.map((ln, i) => (i === 0 ? ln : indentStr + ln)).join('\n');
}

/** Strip LSP snippet markers (`${1:foo}`, `${1|a,b|}`, `$0`) but keep raw text. */
function stripSnippetMarkers(s: string): string {
  return s
    .replace(/\$\{\d+:([^}]*)\}/g, '$1')
    .replace(/\$\{\d+\|([^}]*)\|\}/g, '$1')
    .replace(/\$\{\d+\}/g, '')
    .replace(/\$0/g, '');
}

function leadingSpaces(line: string): number {
  const m = line.match(/^ */);
  return m ? m[0].length : 0;
}

function getCandidate(
  source: string,
  line: number,
  character: number,
  name: string
): CompletionCandidate {
  const ast = parseDocument(source);
  const candidates = getFieldCompletions(
    // parseDocument returns a Parsed<…> shape that getFieldCompletions
    // accepts at runtime; cast through unknown to satisfy the AstRoot type.
    ast as unknown as Parameters<typeof getFieldCompletions>[0],
    line,
    character,
    testSchemaCtx,
    source
  );
  const cand = candidates.find(c => c.name === name);
  if (!cand) {
    throw new Error(
      `No candidate named "${name}" — got: ${candidates
        .map(c => c.name)
        .join(', ')}`
    );
  }
  return cand;
}

/**
 * Return the leading-space counts of every body line of the rendered
 * snippet (excluding the header line 0 which inherits the cursor indent).
 * We deliberately KEEP lines that become whitespace-only after stripping
 * snippet markers — those are real lines whose indent we still want to
 * assert on.
 */
function bodyIndents(rendered: string): number[] {
  const lines = rendered.split('\n');
  return lines.slice(1).map(leadingSpaces);
}

// ---------------------------------------------------------------------------
// Scope 1: Top-level fields — passing baselines (cursor 0)
// ---------------------------------------------------------------------------

describe('snippet indentation — top-level fields (cursor 0)', () => {
  /**
   * `variables:` at the root in an empty document. The generator emits a
   * 3-line body whose indents are 4 (entry name) and 8 (description). At
   * cursor 0 with the generator's default step (4), this is correct: every
   * body line is at a positive multiple of 4. Pin this baseline.
   */
  it('variables: top-level body lines at multiples of 4 from cursor 0', () => {
    const source = '';
    const cand = getCandidate(source, 0, 0, 'variables');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });

  it('system: top-level body lines at multiples of 4 from cursor 0', () => {
    const source = '';
    const cand = getCandidate(source, 0, 0, 'system');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });

  it('language: top-level body lines at multiples of 4 from cursor 0', () => {
    const source = '';
    const cand = getCandidate(source, 0, 0, 'language');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Scope 2: Action-level fields — primary bug repro
// ---------------------------------------------------------------------------

describe('snippet indentation — action-level fields (W-22181425 repro)', () => {
  /**
   * Document uses 2-space indent step. Cursor at column 6 (three doc-steps
   * inside an action entry — `subagent` → `actions:` → `<action>:`).
   * Completing `inputs:` should produce:
   *
   *   inputs:                       <- at cursor (col 6)
   *       ${name}: …                <- cursor + 1*step_doc = 8
   *           description: "…"     <- cursor + 2*step_doc = 10
   *
   * Today the body lines land at 10 and 14 because the generator uses
   * step=4 unconditionally.
   */
  it('inputs: nested entry at cursor + 1*doc-step (2-space doc, cursor 6)', () => {
    const docStep = 2;
    const cursorIndent = 6;
    const source = [
      'subagent main:',
      '  description: "main"',
      '  actions:',
      '    Lookup_Order:',
      '      target: "flow://x"',
      '      ',
    ].join('\n');
    const lines = source.split('\n');
    const lastLine = lines.length - 1;

    const cand = getCandidate(source, lastLine, cursorIndent, 'inputs');
    expect(
      cand.snippet,
      'inputs candidate should expose a snippet'
    ).toBeDefined();

    const rendered = stripSnippetMarkers(
      applyCursorIndent(cand.snippet!, cursorIndent)
    );
    const indents = bodyIndents(rendered);

    expect(
      indents.length,
      `expected at least 2 body lines\nRendered:\n${rendered}`
    ).toBeGreaterThanOrEqual(2);

    expect(
      indents[0],
      `entry-name line should sit at cursor + 1*docStep (${cursorIndent + docStep})\nRendered:\n${rendered}`
    ).toBe(cursorIndent + docStep);
    expect(
      indents[1],
      `entry-body line should sit at cursor + 2*docStep (${cursorIndent + 2 * docStep})\nRendered:\n${rendered}`
    ).toBe(cursorIndent + 2 * docStep);
  });

  /**
   * Same field in a 4-space-step document: today this works because the
   * generator's hardcoded step (4) happens to match. Pin it so any fix
   * doesn't regress this case.
   */
  it('inputs: nested entry at cursor + 1*doc-step (4-space doc, cursor 12)', () => {
    const docStep = 4;
    const cursorIndent = 12;
    const source = [
      'subagent main:',
      '    description: "main"',
      '    actions:',
      '        Lookup_Order:',
      '            target: "flow://x"',
      '            ',
    ].join('\n');
    const lines = source.split('\n');
    const lastLine = lines.length - 1;

    const cand = getCandidate(source, lastLine, cursorIndent, 'inputs');
    const rendered = stripSnippetMarkers(
      applyCursorIndent(cand.snippet!, cursorIndent)
    );
    const indents = bodyIndents(rendered);
    expect(indents[0]).toBe(cursorIndent + docStep);
    expect(indents[1]).toBe(cursorIndent + 2 * docStep);
  });

  /**
   * The mirror case for `outputs:` — same structure, different field, same
   * bug surface.
   */
  it('outputs: nested entry at cursor + 1*doc-step (2-space doc, cursor 6)', () => {
    const docStep = 2;
    const cursorIndent = 6;
    const source = [
      'subagent main:',
      '  description: "main"',
      '  actions:',
      '    Lookup_Order:',
      '      target: "flow://x"',
      '      ',
    ].join('\n');
    const lines = source.split('\n');
    const lastLine = lines.length - 1;

    const cand = getCandidate(source, lastLine, cursorIndent, 'outputs');
    const rendered = stripSnippetMarkers(
      applyCursorIndent(cand.snippet!, cursorIndent)
    );
    const indents = bodyIndents(rendered);

    expect(indents.length).toBeGreaterThanOrEqual(2);
    expect(indents[0]).toBe(cursorIndent + docStep);
    expect(indents[1]).toBe(cursorIndent + 2 * docStep);
  });
});

// ---------------------------------------------------------------------------
// Scope 3: Top-level snippet inserted into a 2-space-step document
// ---------------------------------------------------------------------------

describe('snippet indentation — top-level fields in a 2-space document', () => {
  /**
   * Cursor at column 0 in a 2-space-step document. The user's rule says the
   * snippet's step should match the document's step. Today `variables`
   * emits body lines at 4 and 8 (multiples of 4 — generator default),
   * which is two doc-steps and four doc-steps deep.
   *
   * Assert the body's effective step is exactly the document's step. This
   * fails today.
   */
  it('variables: snippet body uses doc-step (2-space doc, cursor 0)', () => {
    const docStep = 2;
    const source = ['system:', '  instructions: "x"', ''].join('\n');
    const lines = source.split('\n');
    const lastLine = lines.length - 1;
    const cand = getCandidate(source, lastLine, 0, 'variables');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);

    expect(indents.length).toBeGreaterThan(0);
    expect(
      indents[0],
      `first body line should sit at 1*docStep (${docStep})\nRendered:\n${rendered}`
    ).toBe(docStep);
    if (indents.length >= 2) {
      expect(
        indents[1],
        `second body line should sit at 2*docStep (${2 * docStep})\nRendered:\n${rendered}`
      ).toBe(2 * docStep);
    }
  });

  /**
   * `system:` in a 2-space-step document. Body line `instructions:` should
   * be at indent 2 (1 * docStep), not 4 (1 * generator-step).
   */
  it('system: snippet body uses doc-step (2-space doc, cursor 0)', () => {
    const docStep = 2;
    const source = ['variables:', '  count: mutable number', ''].join('\n');
    const lines = source.split('\n');
    const lastLine = lines.length - 1;
    const cand = getCandidate(source, lastLine, 0, 'system');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);

    expect(indents.length).toBeGreaterThan(0);
    expect(
      indents[0],
      `first body line should sit at 1*docStep (${docStep})\nRendered:\n${rendered}`
    ).toBe(docStep);
  });
});

// ---------------------------------------------------------------------------
// Scope 4: Internal step consistency — same step at every nesting level
// ---------------------------------------------------------------------------

describe('snippet indentation — internal step consistency', () => {
  /**
   * Within a single snippet, all body indent offsets (from the minimum
   * body indent) must be integer multiples of one step value. This pins
   * the user's rule "same number of spaces at every nesting level"
   * without committing to what the step is.
   */
  function assertSingleStep(
    snippet: string | undefined,
    label: string,
    fallbackStep = 4
  ) {
    expect(snippet, `${label}: missing snippet`).toBeDefined();
    const stripped = stripSnippetMarkers(snippet!);
    const indents = bodyIndents(stripped);
    if (indents.length === 0) return; // single-line — vacuous
    const min = Math.min(...indents);
    const offsets = indents.map(i => i - min);
    const nonZero = offsets.filter(o => o > 0);
    const step = nonZero.length > 0 ? Math.min(...nonZero) : fallbackStep;
    for (const o of offsets) {
      expect(
        o % step,
        `${label}: body indent offset ${o} is not a multiple of step ${step}\nIndents: ${JSON.stringify(indents)}\nSnippet:\n${stripped}`
      ).toBe(0);
    }
  }

  it('variables (top-level) — single step throughout', () => {
    const cand = getCandidate('', 0, 0, 'variables');
    assertSingleStep(cand.snippet, 'variables');
  });

  it('system (top-level) — single step throughout', () => {
    const cand = getCandidate('', 0, 0, 'system');
    assertSingleStep(cand.snippet, 'system');
  });

  it('inputs (action) — single step throughout', () => {
    const source = [
      'subagent main:',
      '    description: "main"',
      '    actions:',
      '        Lookup_Order:',
      '            target: "flow://x"',
      '            ',
    ].join('\n');
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 12, 'inputs');
    assertSingleStep(cand.snippet, 'inputs');
  });
});

// ---------------------------------------------------------------------------
// Scope 5: Mixed-step doc — first structural pair wins. AST traversal order
// over this dialect's root schema must yield the highest-level (= most
// authoritative) step. Refactors that reorder root keys could shift this.
// ---------------------------------------------------------------------------

describe('snippet indentation — heuristic hardening', () => {
  it('mixed-step doc: first structural pair wins (2 over 4)', () => {
    const source = [
      'subagent main:',
      '  description: "main"',
      '      actions:',
      '          Lookup_Order:',
      '              target: "flow://x"',
      '',
    ].join('\n');
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 0, 'variables');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    const positive = indents.filter(i => i > 0);
    expect(positive.length).toBeGreaterThan(0);
    expect(Math.min(...positive)).toBe(2);
    for (const indent of indents) {
      expect(indent % 2).toBe(0);
    }
  });
});
