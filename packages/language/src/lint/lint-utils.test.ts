/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import type { CstMeta, Range } from '../core/types.js';
import { DiagnosticSeverity, DiagnosticTag } from '../core/diagnostics.js';
import {
  AtIdentifier,
  Identifier,
  MemberExpression,
} from '../core/expressions.js';
import {
  LINT_SOURCE,
  extractOutputRef,
  extractVariableRef,
  findSuggestion,
  formatSuggestionHint,
  levenshtein,
  lintDiagnostic,
  resolveColinearAction,
} from './lint-utils.js';

const range: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 10 },
};

/** Build an `@namespace.property` member expression. */
function atMember(namespace: string, property: string): MemberExpression {
  return new MemberExpression(new AtIdentifier(namespace), property);
}

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('reasoning', 'reasoning')).toBe(0);
  });

  it('returns the length of the other string when one side is empty', () => {
    expect(levenshtein('', 'actions')).toBe(7);
    expect(levenshtein('actions', '')).toBe(7);
  });

  it('counts a single insertion, deletion, or substitution as one edit', () => {
    expect(levenshtein('action', 'actions')).toBe(1);
    expect(levenshtein('actions', 'action')).toBe(1);
    expect(levenshtein('topic', 'tonic')).toBe(1);
  });

  it('returns the same distance regardless of argument order', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('sitting', 'kitten')).toBe(3);
  });

  it('prefers a deletion plus an insertion over substituting every character', () => {
    // flaw <-> lawn: drop the leading "f" and append "n" (2 edits, not 4)
    expect(levenshtein('flaw', 'lawn')).toBe(2);
    expect(levenshtein('lawn', 'flaw')).toBe(2);
  });

  it('is case-sensitive', () => {
    expect(levenshtein('Variables', 'variables')).toBe(1);
  });
});

describe('findSuggestion', () => {
  it('returns undefined when there are no candidates', () => {
    expect(findSuggestion('variables', [])).toBeUndefined();
  });

  it('suggests the closest candidate for a plausible typo', () => {
    expect(
      findSuggestion('varables', ['actions', 'variables', 'outputs'])
    ).toBe('variables');
  });

  it('suggests a match exactly at the threshold but not one just past it', () => {
    // 2 edits / 5 characters = 0.4, exactly SUGGESTION_THRESHOLD
    expect(findSuggestion('abcde', ['abcxy'])).toBe('abcxy');
    // 3 edits / 7 characters = ~0.43
    expect(findSuggestion('abcdefg', ['abcdxyz'])).toBeUndefined();
  });

  it('divides the distance by the longer of the two names', () => {
    // 1 edit / 3 characters in both directions; dividing by the shorter
    // name (2 characters) would exceed the threshold.
    expect(findSuggestion('id', ['ids'])).toBe('ids');
    expect(findSuggestion('ids', ['id'])).toBe('id');
  });

  it('matches case-insensitively and suggests the candidate casing', () => {
    expect(findSuggestion('ORDER_ID', ['customer_id', 'order_id'])).toBe(
      'order_id'
    );
    expect(findSuggestion('order_id', ['ORDER_ID'])).toBe('ORDER_ID');
  });

  it('returns undefined when the name exactly matches a candidate', () => {
    expect(
      findSuggestion('order_id', ['order_ids', 'order_id'])
    ).toBeUndefined();
  });

  it('returns the first candidate when several are equally close', () => {
    expect(findSuggestion('cat', ['bat', 'hat'])).toBe('bat');
    expect(findSuggestion('cat', ['hat', 'bat'])).toBe('hat');
  });
});

describe('formatSuggestionHint', () => {
  it('returns the message unchanged when there is no suggestion', () => {
    expect(formatSuggestionHint("'foo' is not defined", undefined)).toBe(
      "'foo' is not defined"
    );
    expect(formatSuggestionHint("'foo' is not defined", '')).toBe(
      "'foo' is not defined"
    );
  });

  it('appends a "Did you mean" hint', () => {
    expect(formatSuggestionHint("'foo' is not defined", 'food')).toBe(
      "'foo' is not defined. Did you mean 'food'?"
    );
  });

  it('prepends the prefix to the suggestion', () => {
    expect(formatSuggestionHint('Got @acitons', 'actions', '@')).toBe(
      "Got @acitons. Did you mean '@actions'?"
    );
  });
});

describe('lintDiagnostic', () => {
  it('builds a diagnostic with the lint source', () => {
    expect(
      lintDiagnostic(range, 'message', DiagnosticSeverity.Warning, 'test-code')
    ).toStrictEqual({
      range,
      message: 'message',
      severity: DiagnosticSeverity.Warning,
      code: 'test-code',
      source: LINT_SOURCE,
    });
  });

  it('stores the suggestion under data.suggestion', () => {
    const diag = lintDiagnostic(
      range,
      'message',
      DiagnosticSeverity.Error,
      'test-code',
      { suggestion: 'variables' }
    );
    expect(diag.data).toStrictEqual({ suggestion: 'variables' });
  });

  it('copies tags onto the diagnostic', () => {
    const diag = lintDiagnostic(
      range,
      'message',
      DiagnosticSeverity.Warning,
      'test-code',
      { tags: [DiagnosticTag.Unnecessary] }
    );
    expect(diag.tags).toStrictEqual([DiagnosticTag.Unnecessary]);
  });

  it('omits data when the suggestion is undefined', () => {
    // Passes such as expression-validation forward `{ suggestion }` even when
    // findSuggestion() returned undefined.
    const diag = lintDiagnostic(
      range,
      'message',
      DiagnosticSeverity.Error,
      'test-code',
      { suggestion: undefined }
    );
    expect(diag).not.toHaveProperty('data');
  });
});

describe('extractVariableRef', () => {
  it('returns the name of an @variables reference', () => {
    expect(extractVariableRef(atMember('variables', 'order_id'))).toBe(
      'order_id'
    );
  });

  it('returns null for a reference in another namespace', () => {
    expect(extractVariableRef(atMember('outputs', 'order_id'))).toBeNull();
  });

  it('returns null for values that are not @namespace.member expressions', () => {
    expect(extractVariableRef(new AtIdentifier('variables'))).toBeNull();
    expect(
      extractVariableRef(
        new MemberExpression(new Identifier('variables'), 'order_id')
      )
    ).toBeNull();
    expect(extractVariableRef(undefined)).toBeNull();
  });
});

describe('extractOutputRef', () => {
  it('returns the name and CST of an @outputs reference', () => {
    const expr = atMember('outputs', 'result');
    const cst = { range } as unknown as CstMeta;
    expr.__cst = cst;
    expect(extractOutputRef(expr)).toStrictEqual({ name: 'result', cst });
  });

  it('omits cst when the expression has no CST', () => {
    expect(extractOutputRef(atMember('outputs', 'result'))).toStrictEqual({
      name: 'result',
    });
  });

  it('returns null for a reference in another namespace', () => {
    expect(extractOutputRef(atMember('variables', 'result'))).toBeNull();
  });
});

describe('resolveColinearAction', () => {
  it('returns the action name of an @actions reference', () => {
    expect(
      resolveColinearAction({ value: atMember('actions', 'lookup_order') })
    ).toBe('lookup_order');
  });

  it('returns null for a reference in another namespace', () => {
    expect(
      resolveColinearAction({ value: atMember('subagent', 'lookup_order') })
    ).toBeNull();
  });

  it('returns null when there is no value', () => {
    expect(resolveColinearAction({})).toBeNull();
  });
});
