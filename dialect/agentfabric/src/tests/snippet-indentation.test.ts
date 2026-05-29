/**
 * Indentation guardrails for completion snippets in AgentFabric `.agent` files.
 *
 * Bug: W-22181425 — when a multi-line completion snippet is inserted at a
 * cursor that is already indented, nested entries inside the snippet are
 * indented too deeply relative to the indentation step the user is already
 * using in the document.
 *
 * The contract we pin:
 *   "Indent step is consistent — same number of spaces at every nesting
 *    level, relative to the cursor, and that step matches the document's
 *    existing step."
 *
 * Concretely:
 *   - If the surrounding document uses 2-space indents, the snippet body's
 *     first nested line should be cursor + 2, second nested at cursor + 4,
 *     etc.
 *   - If the surrounding document uses 4-space indents, step is 4.
 *
 * The snippet generator currently hardcodes `tabSize = 4` regardless of the
 * document's actual step. The repro in the bug uses a 2-space-step document
 * with the cursor at column 4, and `inputs:` produces a body whose first
 * nested entry sits at indent 8 (cursor 4 + step 4 from generator) instead of
 * the expected indent 6 (cursor 4 + step 2 from the document). The second
 * nested line sits at indent 12 instead of the expected 8.
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
import { parseAndLintSource, testSchemaCtx } from './test-utils.js';

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
  const { ast } = parseAndLintSource(source);
  const candidates = getFieldCompletions(
    ast,
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
 * snippet markers (e.g. a `${cursor}` placeholder on its own line) — those
 * are real lines whose indent we still want to assert on.
 */
function bodyIndents(rendered: string): number[] {
  const lines = rendered.split('\n');
  return lines.slice(1).map(leadingSpaces);
}

function build(...lines: string[]): string {
  return ['# @dialect: AGENTFABRIC=1.0-BETA', ...lines].join('\n');
}

// ---------------------------------------------------------------------------
// Scope 1: Action-level fields — primary bug repro
// ---------------------------------------------------------------------------

describe('snippet indentation — action-level fields (W-22181425 repro)', () => {
  /**
   * Document uses 2-space indent step. Cursor at column 4 (one body step
   * inside an action entry). Completing `inputs:` should produce:
   *
   *   inputs:                    <- at cursor (col 4)
   *       ${1:Name}:             <- cursor + 1*step_doc = 6
   *           ${2}               <- cursor + 2*step_doc = 8
   *
   * Today the body lines land at 8 and 12 because the generator uses
   * step=4 unconditionally.
   */
  it('inputs: nested entry at cursor + 1*doc-step (2-space doc, cursor 4)', () => {
    const docStep = 2;
    const cursorIndent = 4;
    const source = build(
      'actions:',
      '  escalate_ticket:',
      '    target: "mcp://x"',
      '    kind: "mcp:tool"',
      '    tool_name: "escalate"',
      '    '
    );
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
      `expected at least 2 non-blank body lines\nRendered:\n${rendered}`
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
  it('inputs: nested entry at cursor + 1*doc-step (4-space doc, cursor 8)', () => {
    const docStep = 4;
    const cursorIndent = 8;
    const source = build(
      'actions:',
      '    escalate_ticket:',
      '        target: "mcp://x"',
      '        kind: "mcp:tool"',
      '        tool_name: "escalate"',
      '        '
    );
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
});

// ---------------------------------------------------------------------------
// Scope 2: Top-level fields — orchestrator is the user-confirmed reference
// ---------------------------------------------------------------------------

describe('snippet indentation — top-level fields', () => {
  /**
   * Reference test: at the root (cursor indent 0), the document hasn't
   * declared its step yet. The generator's default (4) is the de-facto
   * convention and the user reports `orchestrator` works correctly here.
   * Pin: every body line is at a positive multiple of 4.
   */
  it('orchestrator: top-level snippet body at multiples of 4 from cursor 0', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'orchestrator');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });

  it('subagent: top-level snippet body at multiples of 4 from cursor 0', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'subagent');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });

  it('actions: top-level CollectionBlock snippet body at multiples of 4 from cursor 0', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'actions');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });

  it('trigger: top-level snippet body at multiples of 4 from cursor 0', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'trigger');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent).toBeGreaterThan(0);
      expect(indent % 4).toBe(0);
    }
  });

  /**
   * Same orchestrator snippet, but in a 2-space-step document. The user's
   * rule says the snippet's step should match the document's step. Today
   * orchestrator's body lines are at 4, 4, 8, 4, 8 — multiples of 4, so
   * inserting at cursor 0 in a 2-space doc gives "4 spaces" which is two
   * doc-steps: too deep.
   */
  it('orchestrator: nested body matches doc step (2-space doc, cursor 0)', () => {
    const docStep = 2;
    const source = build(
      'system:',
      '  instructions: "x"',
      '' // blank trailing
    );
    const lines = source.split('\n');
    const lastLine = lines.length - 1;
    const cand = getCandidate(source, lastLine, 0, 'orchestrator');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);

    // Every body indent should be a multiple of docStep (2). The current
    // generator emits multiples of 4, which are also multiples of 2 — so
    // this assertion alone passes today. We additionally pin that no body
    // line skips more than one doc-step from the previous one.
    let prev = 0;
    for (const indent of indents) {
      expect(indent % docStep).toBe(0);
      // Indent jumps relative to previous body line should be at most
      // ±docStep (i.e. siblings at same depth, or one step in/out).
      const delta = Math.abs(indent - prev);
      expect(
        delta <= docStep,
        `body line indent ${indent} jumps from ${prev} (delta ${delta}) — should change by at most one doc-step (${docStep})\nRendered:\n${rendered}`
      ).toBe(true);
      prev = indent;
    }
  });
});

// ---------------------------------------------------------------------------
// Scope 3: Nested-and-not-at-root — the critical bug surface
// ---------------------------------------------------------------------------

describe('snippet indentation — nested compound children (not at root)', () => {
  /**
   * Cursor inside a subagent's `reasoning:` section, in a 2-space-step
   * document. Completing a CollectionBlock-typed field (`actions`) should
   * produce body lines at cursor + N*docStep for N = 1, 2, …
   */
  it('reasoning.actions in 2-space doc: body at cursor + N*doc-step', () => {
    const docStep = 2;
    const cursorIndent = 4;
    const source = build(
      'subagent triage_agent:',
      '  reasoning:',
      '    instructions: "do work"',
      '    '
    );
    const lines = source.split('\n');
    const lastLine = lines.length - 1;

    const cand = getCandidate(source, lastLine, cursorIndent, 'actions');
    const rendered = stripSnippetMarkers(
      applyCursorIndent(cand.snippet!, cursorIndent)
    );
    const indents = bodyIndents(rendered);

    expect(
      indents.length,
      `expected non-empty body for nested actions\nRendered:\n${rendered}`
    ).toBeGreaterThan(0);

    // Each body line should be at cursorIndent + N*docStep for some N >= 1.
    for (const indent of indents) {
      const offset = indent - cursorIndent;
      expect(
        offset > 0 && offset % docStep === 0,
        `nested body line at indent ${indent} has offset ${offset} from cursor — should be a positive multiple of doc step ${docStep}\nRendered:\n${rendered}`
      ).toBe(true);
    }
  });

  /**
   * Same nested context, but using a string-valued field whose snippet is
   * still multi-line because it's a compound (outputs is a Block with
   * `properties: CollectionBlock(...)`). Today `outputs` produces just a
   * one-line body (`${cursor}`) because no children pass the depth-1 filter,
   * so this test pins the consistent behaviour.
   */
  it('reasoning.outputs in 2-space doc: every body line offset is multiple of doc-step', () => {
    const docStep = 2;
    const cursorIndent = 4;
    const source = build(
      'subagent triage_agent:',
      '  reasoning:',
      '    instructions: "do work"',
      '    '
    );
    const lines = source.split('\n');
    const lastLine = lines.length - 1;

    const cand = getCandidate(source, lastLine, cursorIndent, 'outputs');
    const rendered = stripSnippetMarkers(
      applyCursorIndent(cand.snippet!, cursorIndent)
    );
    const indents = bodyIndents(rendered);

    expect(
      indents.length,
      `outputs snippet should expose a body — assertion is vacuous otherwise\nRendered:\n${rendered}`
    ).toBeGreaterThan(0);
    // Require at least one body line at a positive offset from the cursor
    // — otherwise the per-line "positive multiple of docStep" assertion
    // could pass vacuously on a snippet body of just `${cursor}` placeholders.
    expect(
      indents.some(i => i > cursorIndent),
      `outputs snippet should expose at least one indented (positive-offset) body line\nRendered:\n${rendered}`
    ).toBe(true);
    for (const indent of indents) {
      const offset = indent - cursorIndent;
      // Allow zero-offset placeholder lines; require positive-offset lines
      // to land on a docStep boundary.
      if (offset === 0) continue;
      expect(
        offset > 0 && offset % docStep === 0,
        `nested outputs body line at indent ${indent} offset ${offset} — should be positive multiple of ${docStep}\nRendered:\n${rendered}`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Scope 5: Hardening — clamp boundaries, mixed-step docs, block-scalar
// immunity. These pin the heuristic's edge-case behavior so future tweaks
// don't silently regress.
// ---------------------------------------------------------------------------

describe('snippet indentation — heuristic hardening', () => {
  /**
   * 1-space-step documents are below MIN_INDENT_STEP=2 and should fall
   * through to DEFAULT_INDENT_STEP=4. The fix should not honour a doc step
   * we've explicitly excluded.
   */
  it('1-space doc falls back to default step (4)', () => {
    const source = build('actions:', ' escalate_ticket:', '  target: "x"', '');
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 0, 'subagent');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    // Default step = 4. Every body line indent should be a multiple of 4.
    for (const indent of indents) {
      expect(indent % 4).toBe(0);
    }
  });

  /**
   * 10-space-step docs exceed MAX_INDENT_STEP=8 and should fall back to
   * the default. (Outlandish, but pins the upper clamp.)
   */
  it('10-space doc falls back to default step (4)', () => {
    const source = build(
      'actions:',
      '          escalate_ticket:',
      '                    target: "x"',
      ''
    );
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 0, 'subagent');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent % 4).toBe(0);
    }
  });

  /**
   * Mixed-step doc — first structural pair the AST exposes wins. With a
   * 2-space top-level pair followed by a 4-space sub-block, the heuristic
   * picks 2 (most authoritative top-level signal). Pin this so refactors
   * to "mode of all observations" or "deepest pair" don't sneak through
   * silently.
   */
  it('mixed-step doc: first structural pair wins (2 over 4)', () => {
    const source = build(
      'actions:',
      '  outer:',
      '      target: "x"',
      '      kind: "mcp:tool"',
      '      tool_name: "x"',
      ''
    );
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 0, 'subagent');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    // First-pair-wins: should be 2-step, so first body line at 2, not 4.
    const positive = indents.filter(i => i > 0);
    expect(positive.length).toBeGreaterThan(0);
    expect(Math.min(...positive)).toBe(2);
    for (const indent of indents) {
      expect(indent % 2).toBe(0);
    }
  });

  /**
   * Block-scalar pollution immunity. A doc whose ONLY non-trivial nested
   * content lives in a multi-line string body should still resolve to the
   * default step — string content is StringLiteral leaves, not nested
   * AstNodeLike children, so an AST-aware walk skips it entirely.
   *
   * Concretely: `system.instructions: |` followed by deeply-indented prose
   * must not push the heuristic to whatever step the prose happens to
   * use. We use 3-space prose indent (which would be NEW data if it
   * leaked) inside an otherwise-unstructured doc to stress the immunity.
   */
  /**
   * `getFieldCompletions` must accept calls without `source` (e.g. the
   * `service.ts` API) and fall back to the default step. Pin the default
   * so future refactors don't quietly change it.
   */
  it('caller without source falls back to default step (4)', () => {
    const source = build('');
    const { ast } = parseAndLintSource(source);
    const candidates = getFieldCompletions(
      ast,
      1,
      0,
      testSchemaCtx
      // intentionally omit `source` to exercise the fallback branch
    );
    const cand = candidates.find(c => c.name === 'subagent');
    expect(cand?.snippet).toBeDefined();
    const rendered = stripSnippetMarkers(applyCursorIndent(cand!.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    for (const indent of indents) {
      expect(indent % 4).toBe(0);
    }
  });

  it('indented multi-line string content does not pollute the step', () => {
    const source = build(
      'system:',
      '    instructions: |',
      '       line one',
      '          line two with deeper prose indent',
      ''
    );
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 0, 'subagent');
    const rendered = stripSnippetMarkers(applyCursorIndent(cand.snippet!, 0));
    const indents = bodyIndents(rendered);
    expect(indents.length).toBeGreaterThan(0);
    // The structural step is 4 (system → instructions). Prose at +3 / +6
    // inside the block-scalar must NOT be picked up — that would yield 3.
    // Every body line should be a multiple of 4.
    for (const indent of indents) {
      expect(indent % 4).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Scope 4: Internal consistency — the snippet's body uses ONE step throughout
// ---------------------------------------------------------------------------

describe('snippet indentation — internal step consistency', () => {
  /**
   * Verify that within a single snippet, all body indent offsets (from the
   * minimum body indent) are integer multiples of a single step value.
   * This tests the user's rule "same number of spaces at every nesting
   * level" without committing to what the step is.
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
    // Step is the GCD-like consistent unit: all offsets must be multiples
    // of one shared positive integer. Check via successive offsets.
    const offsets = indents.map(i => i - min);
    // Find the minimum non-zero offset — that's the step.
    const nonZero = offsets.filter(o => o > 0);
    const step = nonZero.length > 0 ? Math.min(...nonZero) : fallbackStep;
    for (const o of offsets) {
      expect(
        o % step,
        `${label}: body indent offset ${o} is not a multiple of step ${step}\nIndents: ${JSON.stringify(indents)}\nSnippet:\n${stripped}`
      ).toBe(0);
    }
  }

  it('inputs (action) — single step throughout', () => {
    const source = build(
      'actions:',
      '  escalate_ticket:',
      '    target: "mcp://x"',
      '    kind: "mcp:tool"',
      '    tool_name: "escalate"',
      '    '
    );
    const lines = source.split('\n');
    const cand = getCandidate(source, lines.length - 1, 4, 'inputs');
    assertSingleStep(cand.snippet, 'inputs');
  });

  it('subagent (top-level) — single step throughout', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'subagent');
    assertSingleStep(cand.snippet, 'subagent');
  });

  it('actions (top-level) — single step throughout', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'actions');
    assertSingleStep(cand.snippet, 'actions');
  });

  it('orchestrator (top-level) — single step throughout', () => {
    const source = build('');
    const cand = getCandidate(source, 1, 0, 'orchestrator');
    assertSingleStep(cand.snippet, 'orchestrator');
  });
});
