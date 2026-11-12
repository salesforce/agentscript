/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

const CODE = 'handoff-in-on-exit';

function lint(source: string): Diagnostic[] {
  const engine = new LintEngine({ passes: defaultRules() });
  return engine.run(parseDocument(source), testSchemaCtx).diagnostics;
}

function onExitErrors(source: string): Diagnostic[] {
  return lint(source).filter(d => d.code === CODE);
}

function customSubagent(schema: string, onExit: string): string {
  return `
variables:
    done: mutable boolean = False

start_agent Main:
    description: "Main"

subagent Other:
    description: "Other"

subagent Custom:
    schema: "${schema}"
    description: "Custom"
    on_exit: ->
${onExit}
`;
}

const COMMERCE = 'node://commerce/shopper_agent/v1';
const BYON = 'node://byon/acme/widget/v1';

describe('on_exit handoffs in custom subagents', () => {
  it.each([
    ['transition', '        transition to @subagent.Other'],
    ['escalate', '        escalate'],
    ['end_session', '        end_session'],
  ])('reports an error for %s', (keyword, statement) => {
    const errors = onExitErrors(customSubagent(COMMERCE, statement));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toEqual(
      expect.objectContaining({
        code: CODE,
        severity: DiagnosticSeverity.Error,
        message: `\`${keyword}\` is not allowed in on_exit of a custom subagent: on_exit only runs actions.`,
      })
    );
  });

  it('reports errors in generic BYON subagents', () => {
    const errors = onExitErrors(customSubagent(BYON, '        escalate'));
    expect(errors).toHaveLength(1);
  });

  it('reports errors nested in if and else bodies', () => {
    const errors = onExitErrors(
      customSubagent(
        COMMERCE,
        `        if @variables.done:
            transition to @subagent.Other
        else:
            if @variables.done == False:
                end_session`
      )
    );
    expect(errors.map(e => e.message)).toEqual([
      expect.stringContaining('`transition`'),
      expect.stringContaining('`end_session`'),
    ]);
  });

  it('reports one error per handoff statement', () => {
    const errors = onExitErrors(
      customSubagent(
        COMMERCE,
        `        set @variables.done = True
        transition to @subagent.Other
        escalate`
      )
    );
    expect(errors).toHaveLength(2);
  });

  it('allows actions and set statements', () => {
    const errors = onExitErrors(
      customSubagent(
        COMMERCE,
        `        set @variables.done = True
        if @variables.done:
            set @variables.done = False`
      )
    );
    expect(errors).toEqual([]);
  });

  it('allows handoffs in on_init', () => {
    const source = `
start_agent Main:
    description: "Main"

subagent Other:
    description: "Other"

subagent Custom:
    schema: "${COMMERCE}"
    description: "Custom"
    on_init: ->
        transition to @subagent.Other
`;
    expect(onExitErrors(source)).toEqual([]);
  });
});
