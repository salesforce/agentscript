/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Regression tests: field completions inside an LLM entry should include the
 * variant-specific fields once `kind` is set.
 *
 * Bug: when the cursor is on a *blank* line inside an `llm` entry whose
 * `kind` is already set (e.g. "OpenAI" / "Gemini"), the kind-specific fields
 * (`reasoning_effort`, `thinking_level`) are missing from the completion list.
 * When the user types even a single prefix character (e.g. `r`), they DO
 * appear.
 */

import { describe, it, expect } from 'vitest';
import { getFieldCompletions } from '@agentscript/language';
import { parseAndLintSource, testSchemaCtx } from './test-utils.js';

const INDENT8 = ' '.repeat(8);

function completionLabelsAt(
  source: string,
  line: number,
  character: number
): string[] {
  const { ast } = parseAndLintSource(source);
  const candidates = getFieldCompletions(
    ast,
    line,
    character,
    testSchemaCtx,
    source
  );
  return candidates.map(c => c.name);
}

function build(...lines: string[]): string {
  return ['# @dialect: AGENTFABRIC=1.0-BETA', ...lines].join('\n');
}

describe('LLM entry variant completions', () => {
  it('blank line in OpenAI llm entry includes reasoning_effort and not thinking_level', () => {
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      '        kind: "OpenAI"',
      '        model: "The model name to use"',
      INDENT8
    );

    const lines = source.split('\n');
    const labels = completionLabelsAt(source, lines.length - 1, INDENT8.length);

    expect(labels).toContain('reasoning_effort');
    expect(labels).toContain('top_logprobs');
    expect(labels).not.toContain('thinking_level');
  });

  it('blank line in Gemini llm entry includes thinking_level and not reasoning_effort', () => {
    const source = build(
      'llm:',
      '    myLLM4:',
      '        target: "llm://connection_name"',
      '        kind: "Gemini"',
      '        model: "The model name to use"',
      INDENT8
    );

    const lines = source.split('\n');
    const labels = completionLabelsAt(source, lines.length - 1, INDENT8.length);

    expect(labels).toContain('thinking_level');
    expect(labels).toContain('thinking_budget');
    expect(labels).not.toContain('reasoning_effort');
  });

  it('two sibling entries — variant fields are scoped to the matching kind', () => {
    const source = build(
      'llm:',
      '    myOpenAI:',
      '        target: "llm://a"',
      '        kind: "OpenAI"',
      '        model: "m"',
      '    myGemini:',
      '        target: "llm://b"',
      '        kind: "Gemini"',
      '        model: "m"',
      INDENT8
    );

    const lines = source.split('\n');
    const labels = completionLabelsAt(source, lines.length - 1, INDENT8.length);

    // Cursor is inside myGemini (last entry) — only Gemini-specific fields.
    expect(labels).toContain('thinking_level');
    expect(labels).not.toContain('reasoning_effort');
  });

  it('blank line with no `kind` set falls back to base schema (no variant fields)', () => {
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      '        model: "The model name to use"',
      INDENT8
    );

    const lines = source.split('\n');
    const labels = completionLabelsAt(source, lines.length - 1, INDENT8.length);

    expect(labels).toContain('kind');
    expect(labels).not.toContain('reasoning_effort');
    expect(labels).not.toContain('thinking_level');
  });
});
