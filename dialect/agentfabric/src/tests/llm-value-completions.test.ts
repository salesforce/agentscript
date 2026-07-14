/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Regression tests: value-position completions for enum-typed fields inside
 * an LLM entry should include the enum members.
 *
 * Bug (W-22415806): when the cursor is at value position (after `key: `) for
 * an enum-typed field, the LSP returns no completions for:
 *   - `kind:` → expected to suggest the discriminator enum members
 *     (OpenAI, Gemini)
 *   - `reasoning_effort:` (when `kind: "OpenAI"`) → expected to suggest its
 *     enum members (NONE, MINIMAL, LOW, MEDIUM, HIGH, XHIGH)
 *   - `thinking_level:` (when `kind: "Gemini"`) → expected to suggest its
 *     enum members (LOW, HIGH)
 *
 * These tests pin the expected behaviour for the upcoming fix in
 * `dialect/agentfabric`. Today they FAIL because `getValueCompletions` only
 * returns primitive type keywords for TypedMap-typed fields and never
 * surfaces enum constraints attached to `StringValue.enum([...])` fields.
 */

import { describe, it, expect } from 'vitest';
import { getValueCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

const INDENT8 = ' '.repeat(8);

function valueCompletionLabelsAt(
  source: string,
  line: number,
  character: number
): string[] {
  const ast = parseDocument(source);
  const candidates = getValueCompletions(
    ast,
    line,
    character,
    testSchemaCtx,
    source
  );
  return candidates.map(c => c.name);
}

function valueCompletionInsertTextsAt(
  source: string,
  line: number,
  character: number
): Array<string | undefined> {
  const ast = parseDocument(source);
  const candidates = getValueCompletions(
    ast,
    line,
    character,
    testSchemaCtx,
    source
  );
  return candidates.map(c => c.insertText);
}

function build(...lines: string[]): string {
  return ['# @dialect: AGENTFABRIC=1.0-BETA', ...lines].join('\n');
}

describe('LLM entry value-position completions', () => {
  it('after `kind: ` suggests discriminator enum members (OpenAI, Gemini)', () => {
    const kindLine = `${INDENT8}kind: `;
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      kindLine,
      '        model: "The model name to use"'
    );

    const lines = source.split('\n');
    const kindLineIdx = lines.findIndex(l => l === kindLine);
    expect(kindLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(
      source,
      kindLineIdx,
      kindLine.length
    );

    expect(labels).toContain('OpenAI');
    expect(labels).toContain('Gemini');
    // No leakage of TypedMap primitive keywords or unrelated values.
    expect(labels).not.toContain('string');
    expect(labels).not.toContain('NONE');
  });

  it('after `reasoning_effort: ` (kind=OpenAI) suggests OpenAI reasoning enum members', () => {
    const reLine = `${INDENT8}reasoning_effort: `;
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      '        kind: "OpenAI"',
      '        model: "The model name to use"',
      reLine
    );

    const lines = source.split('\n');
    const reLineIdx = lines.findIndex(l => l === reLine);
    expect(reLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(source, reLineIdx, reLine.length);

    expect(labels).toContain('NONE');
    expect(labels).toContain('MINIMAL');
    expect(labels).toContain('LOW');
    expect(labels).toContain('MEDIUM');
    expect(labels).toContain('HIGH');
    expect(labels).toContain('XHIGH');
    expect(labels).not.toContain('OpenAI');
    expect(labels).not.toContain('string');
  });

  it('after `thinking_level: ` (kind=Gemini) suggests Gemini thinking enum members', () => {
    const tlLine = `${INDENT8}thinking_level: `;
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      '        kind: "Gemini"',
      '        model: "The model name to use"',
      tlLine
    );

    const lines = source.split('\n');
    const tlLineIdx = lines.findIndex(l => l === tlLine);
    expect(tlLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(source, tlLineIdx, tlLine.length);

    expect(labels).toContain('LOW');
    expect(labels).toContain('HIGH');
    expect(labels).not.toContain('Gemini');
    expect(labels).not.toContain('NONE');
  });

  it('after `target: ` (plain StringValue, no enum) suggests nothing', () => {
    const targetLine = `${INDENT8}target: `;
    const source = build('llm:', '    myLLM:', targetLine);

    const lines = source.split('\n');
    const targetLineIdx = lines.findIndex(l => l === targetLine);
    expect(targetLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(
      source,
      targetLineIdx,
      targetLine.length
    );

    expect(labels).toEqual([]);
  });

  it('enum members are inserted with surrounding double quotes', () => {
    const kindLine = `${INDENT8}kind: `;
    const source = build('llm:', '    myLLM:', kindLine);

    const lines = source.split('\n');
    const kindLineIdx = lines.findIndex(l => l === kindLine);
    expect(kindLineIdx).toBeGreaterThan(-1);

    const inserts = valueCompletionInsertTextsAt(
      source,
      kindLineIdx,
      kindLine.length
    );

    expect(inserts).toContain('"OpenAI"');
    expect(inserts).toContain('"Gemini"');
  });

  it('after `reasoning_effort: ` with kind=Gemini (variant mismatch) suggests nothing', () => {
    const reLine = `${INDENT8}reasoning_effort: `;
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      '        kind: "Gemini"',
      reLine
    );

    const lines = source.split('\n');
    const reLineIdx = lines.findIndex(l => l === reLine);
    expect(reLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(source, reLineIdx, reLine.length);

    expect(labels).toEqual([]);
  });
});
