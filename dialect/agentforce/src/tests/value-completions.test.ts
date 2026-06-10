/**
 * Regression tests: value-position completions for enum-typed fields in the
 * Agentforce dialect should include the enum members.
 *
 * Bug (W-22415806): when the cursor is at value position (after `key: `) for
 * an enum-typed field, the LSP returns no completions for:
 *   - `visibility:` under a variables entry → expected to suggest
 *     Internal / External / internal / external
 *   - `agent_type:` under config → expected to suggest
 *     AgentforceServiceAgent / AgentforceEmployeeAgent / SalesEinsteinCoach
 *
 * These tests fail today because `getValueCompletions` only returns primitive
 * type keywords for TypedMap-typed fields and never surfaces enum constraints
 * attached to `StringValue.enum([...])` fields.
 */

import { describe, it, expect } from 'vitest';
import { getValueCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

const INDENT4 = ' '.repeat(4);
const INDENT2 = ' '.repeat(2);

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

describe('Agentforce value-position completions', () => {
  it('after `visibility: ` on a variable suggests visibility enum members', () => {
    const visLine = `${INDENT4}visibility: `;
    const source = [
      'variables:',
      `${INDENT2}my_var: mutable string`,
      visLine,
    ].join('\n');

    const lines = source.split('\n');
    const visLineIdx = lines.findIndex(l => l === visLine);
    expect(visLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(source, visLineIdx, visLine.length);

    expect(labels).toContain('Internal');
    expect(labels).toContain('External');
    expect(labels).toContain('internal');
    expect(labels).toContain('external');
    // No leakage from the surrounding TypedMap's primitive keywords.
    expect(labels).not.toContain('string');
    expect(labels).not.toContain('mutable');
  });

  it('at TypedMap entry-name value (e.g. `my_var: `) suggests primitive types, not enum', () => {
    const entryLine = `${INDENT2}my_var: `;
    const source = ['variables:', entryLine].join('\n');

    const lines = source.split('\n');
    const entryLineIdx = lines.findIndex(l => l === entryLine);
    expect(entryLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(
      source,
      entryLineIdx,
      entryLine.length
    );

    expect(labels).toContain('string');
    expect(labels).toContain('number');
    expect(labels).toContain('boolean');
    expect(labels).not.toContain('Internal');
    expect(labels).not.toContain('External');
  });

  it('after `agent_type: ` under config suggests agent_type enum members', () => {
    const atLine = `${INDENT2}agent_type: `;
    const source = ['config:', atLine].join('\n');

    const lines = source.split('\n');
    const atLineIdx = lines.findIndex(l => l === atLine);
    expect(atLineIdx).toBeGreaterThan(-1);

    const labels = valueCompletionLabelsAt(source, atLineIdx, atLine.length);

    expect(labels).toContain('AgentforceServiceAgent');
    expect(labels).toContain('AgentforceEmployeeAgent');
    expect(labels).toContain('SalesEinsteinCoach');
    expect(labels).not.toContain('string');
    expect(labels).not.toContain('Internal');
  });
});
