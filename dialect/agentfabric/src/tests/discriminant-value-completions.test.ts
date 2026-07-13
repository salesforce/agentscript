/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Value-position completions for discriminator (`kind:`) fields whose valid
 * values come from `.discriminant()` + `.variant()` declarations rather than
 * a redundant `.enum()` constraint.
 *
 * Previously these returned no completions: `getValueCompletions` only read
 * `field.__metadata.constraints.enum`, so discriminators declared purely via
 * variants (Action `kind`, Echo `kind`) offered nothing. Discriminators that
 * also carried an explicit `.enum()` (LLM `kind`, Trigger `kind`) worked.
 *
 * The variant names are the authoritative set of valid discriminator values,
 * so they should be offered as value completions for the discriminant field.
 */

import { describe, it, expect } from 'vitest';
import { getValueCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { A2A_TASK_STATES } from '../schema.js';

const INDENT4 = ' '.repeat(4);
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

function labelsAtLine(source: string, lineMatch: string): string[] {
  const lines = source.split('\n');
  const idx = lines.findIndex(l => l === lineMatch);
  expect(idx).toBeGreaterThan(-1);
  return valueCompletionLabelsAt(source, idx, lineMatch.length);
}

describe('discriminant value-position completions (variant-declared)', () => {
  it('after Action `kind: ` suggests variant discriminators (mcp:tool, a2a:send_message)', () => {
    const kindLine = `${INDENT8}kind: `;
    const source = build(
      'actions:',
      '    myAction:',
      '        target: "a2a://connection_name"',
      kindLine
    );

    const labels = labelsAtLine(source, kindLine);

    expect(labels).toContain('mcp:tool');
    expect(labels).toContain('a2a:send_message');
    // No leakage of unrelated values.
    expect(labels).not.toContain('string');
  });

  it('Action `kind: ` variant discriminators are inserted with surrounding quotes', () => {
    const kindLine = `${INDENT8}kind: `;
    const source = build('actions:', '    myAction:', kindLine);

    const lines = source.split('\n');
    const idx = lines.findIndex(l => l === kindLine);
    expect(idx).toBeGreaterThan(-1);

    const inserts = valueCompletionInsertTextsAt(source, idx, kindLine.length);

    expect(inserts).toContain('"mcp:tool"');
    expect(inserts).toContain('"a2a:send_message"');
  });

  it('Action discriminator values do not leak onto a non-discriminant field (`target:`)', () => {
    // Pins the gate that confines variant discriminator values to the
    // discriminant field. `target:` is a real Action field (string URI) that
    // is NOT the discriminant — its value completion must never offer
    // `mcp:tool` / `a2a:send_message`, which would otherwise leak now that the
    // entry block carries the discriminant config.
    const targetLine = `${INDENT8}target: `;
    const source = build('actions:', '    myAction:', targetLine);

    const labels = labelsAtLine(source, targetLine);

    expect(labels).not.toContain('mcp:tool');
    expect(labels).not.toContain('a2a:send_message');
  });

  it('after Echo `kind: ` suggests variant discriminators (a2a:status_update_event, a2a:artifact_update_event)', () => {
    // Echo is a NamedCollectionBlock: entries are sibling-keyed `echo Name:`.
    const kindLine = `${INDENT4}kind: `;
    const source = build('echo MyEcho:', kindLine);

    const labels = labelsAtLine(source, kindLine);

    expect(labels).toContain('a2a:status_update_event');
    expect(labels).toContain('a2a:artifact_update_event');
    expect(labels).not.toContain('string');
  });

  it('after Echo discriminant is set, in-variant enum field (`state:`) suggests A2A task states', () => {
    // Exercises the enum branch AFTER discriminant resolution: with
    // `kind: "a2a:status_update_event"` selected, the variant contributes a
    // `state:` field constrained to A2A_TASK_STATES. The `kind:` tests above
    // only cover the discriminant itself; this pins that variant-schema
    // resolution still surfaces the variant's own enum fields. The entry-block
    // tracking added for discriminator completions shares these descent points,
    // so a regression there could silently break this path.
    const stateLine = `${INDENT4}state: `;
    const source = build(
      'echo MyEcho:',
      `${INDENT4}kind: "a2a:status_update_event"`,
      stateLine
    );

    const labels = labelsAtLine(source, stateLine);

    for (const state of A2A_TASK_STATES) {
      expect(labels).toContain(state);
    }
  });
});

describe('discriminant value-position completions (enum regression guard)', () => {
  it('LLM `kind: ` still suggests enum discriminators (OpenAI, Gemini)', () => {
    const kindLine = `${INDENT8}kind: `;
    const source = build(
      'llm:',
      '    myLLM:',
      '        target: "llm://connection_name"',
      kindLine
    );

    const labels = labelsAtLine(source, kindLine);

    expect(labels).toContain('OpenAI');
    expect(labels).toContain('Gemini');
  });

  it('Trigger `kind: ` still suggests its enum discriminator (a2a)', () => {
    // `trigger` is a NamedCollectionBlock(TriggerBlock): entries are
    // sibling-keyed `trigger Name:` (see dialect.test.ts), NOT nested under a
    // `trigger:` map. The nested form happens to pass because
    // walkParentsToSchemaContext is indentation/regex-driven and still reaches
    // the schema — so it would not catch an AST-resolution regression. Use the
    // correct sibling-keyed syntax so this guard genuinely exercises that path.
    const kindLine = `${INDENT4}kind: `;
    const source = build('trigger myTrigger:', kindLine);

    const labels = labelsAtLine(source, kindLine);

    expect(labels).toContain('a2a');
  });
});
