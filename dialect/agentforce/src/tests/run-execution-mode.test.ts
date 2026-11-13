/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { defaultRules } from '../lint/passes/index.js';
import {
  emitDocument,
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
} from './test-utils.js';

function source(options: string) {
  return `
config:
    developer_name: "BackgroundLookup"
variables:
    result: string
start_agent main:
    description: "Main"
    actions:
        Lookup:
            description: "Look up a record"
            target: "flow://Lookup"
            outputs:
                result: string
    before_reasoning:
        run @actions.Lookup
            ${options}
    reasoning:
        instructions: ->
            | Help the user.
        actions:
            lookup: @actions.Lookup
`;
}

function diagnostics(text: string) {
  const parsed = parseWithDiagnostics(text);
  return [
    ...parsed.diagnostics,
    ...new LintEngine({ passes: defaultRules() }).run(
      parsed.value,
      testSchemaCtx
    ).diagnostics,
  ];
}

describe('run execution mode', () => {
  it.each(['blocking', 'fire_and_forget'])(
    'accepts and round-trips %s',
    mode => {
      const text = source(`execution_mode: "${mode}"`);
      expect(
        diagnostics(text).filter(d => d.severity === DiagnosticSeverity.Error)
      ).toEqual([]);
      const emitted = emitDocument(parseDocument(text));
      expect(emitted).toContain(`execution_mode: "${mode}"`);
      expect(
        diagnostics(emitted).filter(
          d => d.severity === DiagnosticSeverity.Error
        )
      ).toEqual([]);
    }
  );

  it.each(['"retrievable"', '"later"', 'True', '@variables.result'])(
    'rejects invalid mode %s',
    mode => {
      const issue = diagnostics(source(`execution_mode: ${mode}`)).find(
        d => d.code === 'invalid-run-option'
      );
      expect(issue?.severity).toBe(DiagnosticSeverity.Error);
      expect(issue?.range).toBeDefined();
    }
  );

  it('rejects duplicate execution modes', () => {
    expect(
      diagnostics(
        source(
          'execution_mode: "blocking"\n            execution_mode: "fire_and_forget"'
        )
      ).some(d => d.code === 'duplicate-run-option')
    ).toBe(true);
  });

  it.each(['"execution_mode"'])('normalizes the quoted option key %s', key => {
    const text = source(`${key}: "fire_and_forget"`);
    expect(
      diagnostics(text).filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    const emitted = emitDocument(parseDocument(text));
    expect(
      diagnostics(emitted).filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
    expect(emitDocument(parseDocument(emitted))).toBe(emitted);
    expect(
      diagnostics(
        source(
          `execution_mode: "blocking"\n            ${key}: "fire_and_forget"`
        )
      ).some(d => d.code === 'duplicate-run-option')
    ).toBe(true);
  });

  it('rejects unknown options', () => {
    expect(
      diagnostics(source('execution_mod: "fire_and_forget"')).some(
        d => d.code === 'invalid-run-option'
      )
    ).toBe(true);
  });

  it.each(['@outputs.result', '"constant"'])(
    'rejects background state updates from %s',
    value => {
      const text = source(
        `execution_mode: "fire_and_forget"\n            set @variables.result = ${value}`
      );
      expect(
        diagnostics(text).some(d => d.code === 'non-blocking-state-update')
      ).toBe(true);
      expect(
        diagnostics(text.replace('"fire_and_forget"', '"blocking"')).some(
          d => d.code === 'non-blocking-state-update'
        )
      ).toBe(false);
    }
  );

  it('preserves comments on run options', () => {
    const text = source(
      '# Dispatch without waiting\n            execution_mode: "fire_and_forget" # Invocation mode'
    );
    const emitted = emitDocument(parseDocument(text));
    expect(emitted).toContain('# Dispatch without waiting');
    expect(emitted).toContain(
      'execution_mode: "fire_and_forget" # Invocation mode'
    );
  });

  it.each([
    'execution_mode:',
    'execution_mode:\n                nested: "fire_and_forget"',
    'execution_mode:\n                - "fire_and_forget"',
  ])('rejects nonscalar option syntax %s', option => {
    const text = source(option);
    expect(diagnostics(text).some(d => d.code === 'syntax-error')).toBe(true);
    const emitted = emitDocument(parseDocument(text));
    expect(emitted).toContain('execution_mode:');
    expect(emitDocument(parseDocument(emitted))).toBe(emitted);
  });

  it('rejects option binding suffixes without losing them on emission', () => {
    const text = source(
      'execution_mode: "fire_and_forget" to @variables.result'
    );
    expect(diagnostics(text).some(d => d.code === 'syntax-error')).toBe(true);
    expect(emitDocument(parseDocument(text))).toContain('to @variables.result');
  });

  it('does not turn an action input named execution_mode into an invocation option', () => {
    const text = source('with execution_mode="fire_and_forget"').replace(
      '            outputs:',
      '            inputs:\n                execution_mode: string\n            outputs:'
    );
    expect(
      diagnostics(text).filter(d => d.severity === DiagnosticSeverity.Error)
    ).toEqual([]);
  });
});
