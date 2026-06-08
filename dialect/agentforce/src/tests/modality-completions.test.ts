/**
 * Regression test: name-based variant resolution on the indentation
 * (blank-line) completion path.
 *
 * `ModalityBlock` is a `NamedBlock` with a name-based variant — the entry
 * name (`voice`) selects the variant schema, no discriminant field. When
 * the cursor sits on a blank line inside a `modality voice:` entry, the
 * indentation-based completion fallback must resolve the `voice` variant
 * via `resolveSchemaForName` (mirroring the CST-path) so variant-only
 * fields like `voice_id` appear.
 */

import { describe, it, expect } from 'vitest';
import { getFieldCompletions } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

const INDENT4 = ' '.repeat(4);

function completionLabelsAt(
  source: string,
  line: number,
  character: number
): string[] {
  const ast = parseDocument(source);
  const candidates = getFieldCompletions(
    ast,
    line,
    character,
    testSchemaCtx,
    source
  );
  return candidates.map(c => c.name);
}

describe('Modality entry name-based variant completions', () => {
  it('blank line in `modality voice:` entry includes voice-variant fields', () => {
    const source = ['modality voice:', INDENT4].join('\n');

    const lines = source.split('\n');
    const labels = completionLabelsAt(source, lines.length - 1, INDENT4.length);

    expect(labels).toContain('voice_id');
    expect(labels).toContain('inbound_filler_words_detection');
  });
});
